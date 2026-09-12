import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Linking from "expo-linking";
import { useStripe } from "@stripe/stripe-react-native";

import PosOrderingWorkspace, {
  type PosOrderContext,
} from "../../../src/features/orders/PosOrderingWorkspace";
import { floorTablesStore } from "../../../src/state/floorTables.store";
import { resolveHighestPriorityState } from "../../../src/design-system/foundations/statePriority";
import {
  createPaymentIntent,
  getOrderById,
  updateOrderStatus,
} from "../../../src/lib/api";
import { getIdToken } from "../../../src/lib/firebase";

const SETTLEMENT_POLL_ATTEMPTS = 12;
const SETTLEMENT_POLL_DELAY_MS = 500;

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function isSettledTableOrder(order: Awaited<ReturnType<typeof getOrderById>>) {
  const totalCents = Number(order.total_cents ?? 0);
  const paidCents = Number(order.paid_cents ?? 0);
  const compedCents = Number(order.comped_cents ?? 0);

  return (
    order.status === "SENT" &&
    paidCents + compedCents >= totalCents
  );
}


const STATE_LABELS: Record<string, string> = {
  urgent: "NEEDS ATTENTION",
  ready: "READY",
  paid: "SENT",
  active: "OPEN",
  idle: "IDLE",
};

export default function OrderingModeScreen() {
  const router = useRouter();
  const { initPaymentSheet, presentPaymentSheet } = useStripe();

  const { tableId } = useLocalSearchParams<{ tableId: string }>();

  const safeTableId =
    typeof tableId === "string" ? tableId.trim() : "";
  const hasValidTableId = safeTableId.length > 0;

  const [storeTables, setStoreTables] = useState(
    floorTablesStore.getTables()
  );

  useEffect(() => {
    const interval = setInterval(() => {
      setStoreTables(floorTablesStore.getTables());
    }, 250);

    return () => clearInterval(interval);
  }, []);

  const table = useMemo(() => {
    return storeTables.find((t) => t.id === safeTableId);
  }, [safeTableId, storeTables]);

  const resolvedState = useMemo(() => {
    if (!table) return "idle";
    return resolveHighestPriorityState([table.state]);
  }, [table]);

  const context: PosOrderContext = {
    kind: "TABLE",
    id: safeTableId,
    displayLabel: table?.label ?? "Unknown",
    statusLabel:
      STATE_LABELS[resolvedState] ?? resolvedState.toUpperCase(),
    unavailable: !hasValidTableId || !table,
    unavailableMessage:
      "Table unavailable. Return to floorboard and try again.",
  };

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

        if (isSettledTableOrder(order)) {
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
            "Authentication required to pay Table Order."
          );
        }

        // A retry always checks authoritative state first so an already
        // settled order can never create a second payment attempt.
        const currentOrder = await getOrderById(orderId, token);

        if (isSettledTableOrder(currentOrder)) {
          setCreatedOrderId(null);
          router.back();
          return;
        }

        const paymentIntent = await createPaymentIntent({
          token,
          orderId,
          idempotencyKey: `pos-table-order-${orderId}`,
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
              "Unable to initialize Table Order payment."
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
              "Unable to complete Table Order payment."
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
          "Unable to Pay Table Order",
          error instanceof Error
            ? error.message
            : "Unable to complete Table Order payment."
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
          "Authentication required to check Table Order payment."
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
          : "Unable to check Table Order payment."
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
          Table Order Created
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
            : "Payment is still required for this Table Order."}
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
      context={context}
      onSendOrderCreated={sendCreatedOrder}
      onPayOrderCreated={handleOrderCreated}
    />
  );
}
