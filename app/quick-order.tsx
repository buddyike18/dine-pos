import { useCallback, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import * as Linking from "expo-linking";
import { useStripe } from "@stripe/stripe-react-native";

import PosOrderingWorkspace from "../src/features/orders/PosOrderingWorkspace";
import {
  createPaymentIntent,
  getOrderById,
  updateOrderStatus,
} from "../src/lib/api";
import { getIdToken } from "../src/lib/firebase";

const SETTLEMENT_POLL_ATTEMPTS = 12;
const SETTLEMENT_POLL_DELAY_MS = 500;

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function isSettledQuickOrder(order: Awaited<ReturnType<typeof getOrderById>>) {
  const totalCents = Number(order.total_cents ?? 0);
  const paidCents = Number(order.paid_cents ?? 0);
  const compedCents = Number(order.comped_cents ?? 0);

  return (
    order.status === "SENT" &&
    paidCents + compedCents >= totalCents
  );
}

export default function QuickOrderScreen() {
  const router = useRouter();
  const { initPaymentSheet, presentPaymentSheet } = useStripe();

  const [createdOrderId, setCreatedOrderId] =
    useState<string | null>(null);
  const [paymentRunning, setPaymentRunning] = useState(false);
  const [paymentSubmitted, setPaymentSubmitted] = useState(false);

  const confirmSettlement = useCallback(
    async (orderId: string, token: string) => {
      for (
        let attempt = 0;
        attempt < SETTLEMENT_POLL_ATTEMPTS;
        attempt += 1
      ) {
        const order = await getOrderById(orderId, token);

        if (isSettledQuickOrder(order)) {
          return true;
        }

        if (attempt < SETTLEMENT_POLL_ATTEMPTS - 1) {
          await wait(SETTLEMENT_POLL_DELAY_MS);
        }
      }

      return false;
    },
    []
  );

  const payCreatedOrder = useCallback(
    async (orderId: string) => {
      if (paymentRunning) {
        return;
      }

      setPaymentRunning(true);

      try {
        const token = await getIdToken(true);

        if (!token) {
          throw new Error(
            "Authentication required to pay Quick Order."
          );
        }

        // A retry always checks authoritative state first so an already
        // settled order can never create a second payment attempt.
        const currentOrder = await getOrderById(orderId, token);

        if (isSettledQuickOrder(currentOrder)) {
          setCreatedOrderId(null);
          router.back();
          return;
        }

        const paymentIntent = await createPaymentIntent({
          token,
          orderId,
          idempotencyKey: `pos-quick-order-${orderId}`,
        });

        if (!paymentIntent.clientSecret) {
          throw new Error(
            "Quick order payment intent did not return a client secret."
          );
        }

        const { error: initError } = await initPaymentSheet({
          merchantDisplayName: "Dine",
          paymentIntentClientSecret: paymentIntent.clientSecret,
          returnURL: Linking.createURL("stripe-return"),
        });

        if (initError) {
          throw new Error(
            initError.message ||
              "Unable to initialize Quick Order payment."
          );
        }

        const { error: paymentError } = await presentPaymentSheet();

        if (paymentError) {
          if (
            String(paymentError.code)
              .toLowerCase()
              .includes("cancel")
          ) {
            return;
          }

          throw new Error(
            paymentError.message ||
              "Unable to complete Quick Order payment."
          );
        }

        setPaymentSubmitted(true);

        const settled = await confirmSettlement(orderId, token);

        if (settled) {
          setCreatedOrderId(null);
          router.back();
          return;
        }

        Alert.alert(
          "Payment submitted",
          "Stripe accepted the payment, but Dine is still waiting for " +
            "authoritative settlement. Do not submit another payment."
        );
      } catch (error) {
        Alert.alert(
          "Unable to Pay Quick Order",
          error instanceof Error
            ? error.message
            : "Unable to complete Quick Order payment."
        );
      } finally {
        setPaymentRunning(false);
      }
    },
    [
      confirmSettlement,
      initPaymentSheet,
      paymentRunning,
      presentPaymentSheet,
      router,
    ]
  );

  const checkSubmittedPayment = useCallback(async () => {
    if (!createdOrderId || paymentRunning) {
      return;
    }

    setPaymentRunning(true);

    try {
      const token = await getIdToken(true);

      if (!token) {
        throw new Error(
          "Authentication required to check Quick Order payment."
        );
      }

      const settled = await confirmSettlement(
        createdOrderId,
        token
      );

      if (settled) {
        setCreatedOrderId(null);
        router.back();
        return;
      }

      Alert.alert(
        "Payment still settling",
        "Dine has not confirmed authoritative settlement yet. " +
          "Do not submit another payment."
      );
    } catch (error) {
      Alert.alert(
        "Unable to Check Payment",
        error instanceof Error
          ? error.message
          : "Unable to check Quick Order payment."
      );
    } finally {
      setPaymentRunning(false);
    }
  }, [
    confirmSettlement,
    createdOrderId,
    paymentRunning,
    router,
  ]);

  const sendCreatedOrder = useCallback(
    async (orderId: string) => {
      const token = await getIdToken(true);

      if (!token) {
        throw new Error("Staff authentication is required.");
      }

      await updateOrderStatus({
        token,
        orderId,
        status: "SENT",
      });

      router.back();
    },
    [router],
  );

  const handleOrderCreated = useCallback(
    async (orderId: string) => {
      // Persist the authoritative created order before starting Stripe.
      // From this point forward this transaction never calls createOrder again.
      setCreatedOrderId(orderId);
      setPaymentSubmitted(false);

      await payCreatedOrder(orderId);
    },
    [payCreatedOrder]
  );

  if (createdOrderId) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: "#f6f2eb",
          alignItems: "center",
          justifyContent: "center",
          padding: 32,
          gap: 18,
        }}
      >
        <Text
          style={{
            fontSize: 28,
            fontWeight: "700",
            textAlign: "center",
          }}
        >
          Quick Order Created
        </Text>

        <Text
          style={{
            fontSize: 16,
            textAlign: "center",
            lineHeight: 23,
          }}
        >
          {paymentSubmitted
            ? "Payment was submitted. Confirm settlement before leaving this order."
            : "Payment is still required for this Quick Order."}
        </Text>

        <Pressable
          disabled={paymentRunning}
          onPress={
            paymentSubmitted
              ? checkSubmittedPayment
              : () => void payCreatedOrder(createdOrderId)
          }
          style={{
            minWidth: 220,
            paddingHorizontal: 24,
            paddingVertical: 16,
            borderRadius: 12,
            backgroundColor: paymentRunning ? "#d8d2c8" : "#111111",
          }}
        >
          <Text
            style={{
              color: "#ffffff",
              fontSize: 17,
              fontWeight: "700",
              textAlign: "center",
            }}
          >
            {paymentRunning
              ? "Working..."
              : paymentSubmitted
                ? "Check Payment Status"
                : "Retry Payment"}
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <PosOrderingWorkspace
      context={{
        kind: "QUICK",
        displayLabel: "Quick Order",
        statusLabel: "OPEN",
        unavailable: false,
        unavailableMessage: "Quick Order unavailable.",
      }}
      onSendOrderCreated={sendCreatedOrder}
      onPayOrderCreated={handleOrderCreated}
    />
  );
}
