import { useStripe } from '@stripe/stripe-react-native';
import * as Linking from 'expo-linking';
import {
  useLocalSearchParams,
  useRouter,
} from 'expo-router';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { Alert } from 'react-native';

import PosOrderingWorkspace, {
  type PosOrderContext,
} from '../../../../src/features/orders/PosOrderingWorkspace';
import {
  BarCheck,
  closeBarCheck,
  createBarCheckPaymentIntent,
  getBarCheck,
  isUuid,
  updateOrderStatus,
} from '../../../../src/lib/api';
import { getIdToken } from '../../../../src/lib/firebase';

export default function BarCheckOrderingRoute() {
  const router = useRouter();
  const {
    initPaymentSheet,
    presentPaymentSheet,
  } = useStripe();
  const params = useLocalSearchParams<{
    checkId?: string | string[];
    chairNumber?: string | string[];
  }>();

  const checkId =
    typeof params.checkId === 'string'
      ? params.checkId.trim()
      : '';

  const chairNumberRaw =
    typeof params.chairNumber === 'string'
      ? params.chairNumber.trim()
      : '';

  const chairNumber = Number(chairNumberRaw);
  const hasValidChairNumber =
    Number.isInteger(chairNumber) && chairNumber > 0;

  const [check, setCheck] = useState<BarCheck | null>(null);
  const [checkLoading, setCheckLoading] = useState(true);
  const [checkError, setCheckError] = useState<string | null>(null);



  const loadCheck = useCallback(async () => {
    if (!isUuid(checkId)) {
      setCheck(null);
      setCheckError('Invalid bar check.');
      setCheckLoading(false);
      return;
    }

    setCheckLoading(true);
    setCheckError(null);

    try {
      const token = await getIdToken();

      if (!token) {
        throw new Error('Staff authentication is required.');
      }

      const loaded = await getBarCheck({
        token,
        checkId,
      });

      setCheck(loaded);
    } catch (error) {
      console.warn('[bar-check-order] Failed to load check', error);

      setCheckError(
        error instanceof Error
          ? error.message
          : 'Unable to load bar check.'
      );
    } finally {
      setCheckLoading(false);
    }
  }, [checkId]);

  useEffect(() => {
    void loadCheck();
  }, [loadCheck]);

  const seatLabel = useMemo(() => {
    const authoritativeChairNumber =
      typeof check?.chair_number === 'number'
        ? check.chair_number
        : hasValidChairNumber
          ? chairNumber
          : null;

    if (check?.chair_display_name?.trim()) {
      return check.chair_display_name.trim();
    }

    return authoritativeChairNumber !== null
      ? `Bar ${authoritativeChairNumber}`
      : 'Bar';
  }, [check, chairNumber, hasValidChairNumber]);

  const tabName = check?.display_name?.trim() || null;

  const referenceLabel = isUuid(checkId)
    ? `#${checkId.replace(/-/g, '').slice(-6).toUpperCase()}`
    : undefined;

  const [paymentRunning, setPaymentRunning] = useState(false);

  const refreshAuthoritativeCheck = async (
    token: string
  ): Promise<BarCheck> => {
    const fresh = await getBarCheck({
      token,
      checkId,
    });

    setCheck(fresh);
    return fresh;
  };

  const finishSettledPayment = async (
    token: string
  ): Promise<boolean> => {
    let fresh: BarCheck | null = null;

    // Stripe confirmation completes before webhook settlement can
    // become visible to the POS. Poll the authoritative backend
    // briefly rather than assuming local payment success means the
    // check has already been settled.
    for (let attempt = 0; attempt < 12; attempt += 1) {
      fresh = await refreshAuthoritativeCheck(token);

      const amountOwedCents =
        Number(fresh.amount_owed_cents ?? 0);

      if (
        Number.isFinite(amountOwedCents)
        && amountOwedCents <= 0
      ) {
        if (fresh.status === 'OPEN') {
          await closeBarCheck({
            token,
            checkId,
          });
        }

        router.back();
        return true;
      }

      await new Promise((resolve) => {
        setTimeout(resolve, 500);
      });
    }

    return false;
  };

  const payTab = async () => {
    if (
      paymentRunning
      || !isUuid(checkId)
      || checkLoading
      || checkError
    ) {
      return;
    }

    setPaymentRunning(true);

    try {
      const token = await getIdToken(true);

      if (!token) {
        throw new Error(
          'Staff authentication is required.'
        );
      }

      const payment = await createBarCheckPaymentIntent({
        token,
        checkId,
        idempotencyKey:
          `pos-bar-check-${checkId}-${Date.now()}`,
      });

      if (payment.paymentCompleted === true) {
        const settled = await finishSettledPayment(token);

        if (!settled) {
          Alert.alert(
            'Payment received',
            'The payment succeeded, but the tab is still settling. '
              + 'Return to Open Tabs and refresh before attempting another payment.'
          );
        }

        return;
      }

      const clientSecret =
        payment.paymentIntentClientSecret;

      if (!clientSecret) {
        throw new Error(
          'Stripe payment client secret was not returned.'
        );
      }

      const returnURL =
        Linking.createURL('stripe-return');

      const {
        error: initError,
      } = await initPaymentSheet({
        merchantDisplayName: 'Dine',
        paymentIntentClientSecret:
          clientSecret,
        returnURL,
      });

      if (initError) {
        throw new Error(
          initError.message
          || 'Unable to initialize payment.'
        );
      }

      const {
        error: paymentError,
      } = await presentPaymentSheet();

      if (paymentError) {
        if (
          String(paymentError.code)
            .toLowerCase()
            .includes('cancel')
        ) {
          return;
        }

        throw new Error(
          paymentError.message
          || 'Unable to complete payment.'
        );
      }

      const settled = await finishSettledPayment(token);

      if (!settled) {
        Alert.alert(
          'Payment submitted',
          'Stripe accepted the payment, but Dine is still waiting for '
            + 'authoritative settlement. Do not submit the tab again yet.'
        );
      }
    } catch (error) {
      Alert.alert(
        'Unable to Pay Tab',
        error instanceof Error
          ? error.message
          : 'Unable to complete this tab payment.'
      );
    } finally {
      setPaymentRunning(false);
    }
  };

  const sendCreatedBarOrder = async (orderId: string) => {
    const token = await getIdToken(true);

    if (!token) {
      throw new Error('Staff authentication is required.');
    }

    await updateOrderStatus({
      token,
      orderId,
      status: 'SENT',
    });

    await refreshAuthoritativeCheck(token);
  };

  const payCreatedBarOrder = async (_orderId: string) => {
    await payTab();
  };

  const context: PosOrderContext = {
    kind: 'BAR_CHECK',
    id: checkId,
    displayLabel: tabName ?? seatLabel,
    secondaryLabel: tabName ? seatLabel : undefined,
    statusLabel: 'OPEN TAB',
    referenceLabel,
    actionLabel: paymentRunning ? 'Processing…' : 'Pay Tab',
    onAction:
      isUuid(checkId)
      && !checkLoading
      && !checkError
      && !paymentRunning
        ? () => {
            void payTab();
          }
        : undefined,
    unavailable: !isUuid(checkId) || Boolean(checkError),
    unavailableMessage:
      checkError
      || 'Bar check unavailable. Return to the bar floorchart and try again.',
  };

  return (
    <PosOrderingWorkspace
      context={context}
      onBarSendOrderCreated={sendCreatedBarOrder}
      onBarPayOrderCreated={payCreatedBarOrder}
      barActionRunning={paymentRunning}
    />
  );
}
