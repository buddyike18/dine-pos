import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import {
  BackendOrder,
  BarCheck,
  closeBarCheck,
  getBarCheck,
  isUuid,
  listBarCheckOrders,
  updateBarCheck,
} from '../../../../src/lib/api';
import { getIdToken } from '../../../../src/lib/firebase';

function money(cents: number | null | undefined): string {
  const value =
    typeof cents === 'number' && Number.isFinite(cents)
      ? cents
      : 0;

  return `$${(value / 100).toFixed(2)}`;
}

function shortReference(id: string): string {
  return `#${id.replace(/-/g, '').slice(-6).toUpperCase()}`;
}

function orderItems(order: BackendOrder) {
  return order.items ?? order.line_items ?? [];
}

export default function BarCheckSummaryRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    checkId?: string | string[];
  }>();

  const checkId = useMemo(() => {
    const raw = params.checkId;
    return Array.isArray(raw) ? raw[0] ?? '' : raw ?? '';
  }, [params.checkId]);

  const [check, setCheck] = useState<BarCheck | null>(null);
  const [orders, setOrders] = useState<BackendOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [renameVisible, setRenameVisible] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [renameSaving, setRenameSaving] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);

  const [closeRunning, setCloseRunning] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);

  const loadSummary = useCallback(async () => {
    if (!isUuid(checkId)) {
      setLoadError('Invalid bar check.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setLoadError(null);

    try {
      const token = await getIdToken();

      if (!token) {
        throw new Error('Staff authentication is required.');
      }

      const [nextCheck, nextOrders] = await Promise.all([
        getBarCheck({
          token,
          checkId,
        }),
        listBarCheckOrders({
          token,
          checkId,
        }),
      ]);

      setCheck(nextCheck);
      setOrders(nextOrders);
    } catch (error) {
      setLoadError(
        error instanceof Error
          ? error.message
          : 'Unable to load this bar tab.'
      );
    } finally {
      setLoading(false);
    }
  }, [checkId]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  const seatLabel = useMemo(() => {
    if (!check) {
      return 'Bar';
    }

    const displayName = check.chair_display_name?.trim();

    if (displayName) {
      return displayName;
    }

    if (
      typeof check.chair_number === 'number' &&
      Number.isFinite(check.chair_number)
    ) {
      return `Bar ${check.chair_number}`;
    }

    return 'Bar';
  }, [check]);

  const tabName = useMemo(() => {
    const value = check?.display_name?.trim();
    return value || seatLabel;
  }, [check?.display_name, seatLabel]);

  const openRename = () => {
    if (!check) {
      return;
    }

    setRenameValue(check.display_name?.trim() ?? '');
    setRenameError(null);
    setRenameVisible(true);
  };

  const saveRename = async () => {
    if (!check || renameSaving) {
      return;
    }

    setRenameSaving(true);
    setRenameError(null);

    try {
      const token = await getIdToken();

      if (!token) {
        throw new Error('Staff authentication is required.');
      }

      const updated = await updateBarCheck({
        token,
        checkId: check.id,
        displayName: renameValue.trim() || null,
      });

      setCheck(updated);
      setRenameVisible(false);
    } catch (error) {
      setRenameError(
        error instanceof Error
          ? error.message
          : 'Unable to rename this tab.'
      );
    } finally {
      setRenameSaving(false);
    }
  };

  const runClose = async () => {
    if (!check || closeRunning) {
      return;
    }

    setCloseRunning(true);
    setCloseError(null);

    try {
      const token = await getIdToken();

      if (!token) {
        throw new Error('Staff authentication is required.');
      }

      const closed = await closeBarCheck({
        token,
        checkId: check.id,
      });

      if (closed.status !== 'CLOSED') {
        throw new Error('Bar tab did not close successfully.');
      }

      router.back();
    } catch (error) {
      setCloseError(
        error instanceof Error
          ? error.message
          : 'Unable to close this tab.'
      );
    } finally {
      setCloseRunning(false);
    }
  };

  const confirmClose = () => {
    Alert.alert(
      'Close Tab',
      'Close this tab? Tabs with an outstanding balance cannot be closed.',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Close Tab',
          style: 'destructive',
          onPress: () => {
            void runClose();
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
        <Text style={styles.loadingText}>Loading tab…</Text>
      </View>
    );
  }

  if (loadError || !check) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorTitle}>Unable to load tab</Text>
        <Text style={styles.errorText}>
          {loadError ?? 'Bar tab unavailable.'}
        </Text>

        <Pressable
          onPress={() => void loadSummary()}
          style={({ pressed }) => [
            styles.secondaryButton,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.secondaryButtonText}>Try Again</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to Open Tabs"
          onPress={() => router.replace('/bar/tabs')}
          style={({ pressed }) => [
            styles.backButton,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.backButtonText}>← Open Tabs</Text>
        </Pressable>

        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.title}>{tabName}</Text>

            <Text style={styles.subtitle}>
              {seatLabel} · {shortReference(check.id)}
            </Text>
          </View>

          <View style={styles.statusPill}>
            <Text style={styles.statusText}>
              {check.status === 'OPEN' ? 'OPEN TAB' : check.status}
            </Text>
          </View>
        </View>

        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>Open Balance</Text>
          <Text style={styles.balanceValue}>
            {money(check.amount_owed_cents)}
          </Text>
        </View>

        <View style={styles.summaryCard}>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Tab Total</Text>
            <Text style={styles.summaryValue}>
              {money(check.total_cents)}
            </Text>
          </View>

          <View style={styles.divider} />

          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Paid</Text>
            <Text style={styles.summaryValue}>
              {money(check.paid_cents)}
            </Text>
          </View>

          <View style={styles.divider} />

          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Payment State</Text>
            <Text style={styles.summaryValue}>
              {check.payment_state}
            </Text>
          </View>

          <View style={styles.divider} />

          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Order Count</Text>
            <Text style={styles.summaryValue}>
              {check.order_count}
            </Text>
          </View>
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Orders</Text>
          <Text style={styles.sectionCount}>
            {orders.length}
          </Text>
        </View>

        {orders.length === 0 ? (
          <View style={styles.emptyOrders}>
            <Text style={styles.emptyOrdersTitle}>
              No orders yet
            </Text>
            <Text style={styles.emptyOrdersText}>
              Add an order to begin this tab.
            </Text>
          </View>
        ) : (
          <View style={styles.ordersList}>
            {orders.map((order, index) => {
              const items = orderItems(order);

              return (
                <View
                  key={order.id}
                  style={[
                    styles.orderCard,
                    index > 0 && styles.orderCardSpacing,
                  ]}
                >
                  <View style={styles.orderHeader}>
                    <View>
                      <Text style={styles.orderReference}>
                        {shortReference(order.id)}
                      </Text>
                      <Text style={styles.orderStatus}>
                        {order.status}
                      </Text>
                    </View>

                    <Text style={styles.orderTotal}>
                      {money(order.total_cents)}
                    </Text>
                  </View>

                  {items.length > 0 ? (
                    <View style={styles.itemList}>
                      {items.map((item, itemIndex) => (
                        <View
                          key={`${order.id}-${item.menu_item_id ?? itemIndex}-${itemIndex}`}
                          style={styles.itemRow}
                        >
                          <Text
                            numberOfLines={2}
                            style={styles.itemName}
                          >
                            {item.quantity ?? 1}×{' '}
                            {item.name ?? 'Item'}
                          </Text>

                          {typeof item.line_total_cents === 'number' ? (
                            <Text style={styles.itemPrice}>
                              {money(item.line_total_cents)}
                            </Text>
                          ) : null}
                        </View>
                      ))}
                    </View>
                  ) : (
                    <Text style={styles.noItemsText}>
                      No item detail available.
                    </Text>
                  )}
                </View>
              );
            })}
          </View>
        )}

        {closeError ? (
          <View style={styles.closeErrorBox}>
            <Text style={styles.closeErrorText}>
              {closeError}
            </Text>
          </View>
        ) : null}

        <View style={styles.actions}>
          <Pressable
            onPress={() =>
              router.push({
                pathname: '/bar/check/[checkId]/order',
                params: {
                  checkId: check.id,
                  chairNumber:
                    check.chair_number !== null
                      ? String(check.chair_number)
                      : '',
                },
              })
            }
            style={({ pressed }) => [
              styles.primaryButton,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.primaryButtonText}>
              Add Order
            </Text>
          </Pressable>

          <View style={styles.secondaryActions}>
            <Pressable
              onPress={openRename}
              style={({ pressed }) => [
                styles.secondaryButton,
                styles.secondaryAction,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.secondaryButtonText}>
                Rename Tab
              </Text>
            </Pressable>

            <Pressable
              disabled={closeRunning}
              onPress={confirmClose}
              style={({ pressed }) => [
                styles.closeButton,
                styles.secondaryAction,
                pressed && styles.pressed,
                closeRunning && styles.disabled,
              ]}
            >
              {closeRunning ? (
                <ActivityIndicator size="small" />
              ) : (
                <Text style={styles.closeButtonText}>
                  Close Tab
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      </ScrollView>

      <Modal
        animationType="fade"
        transparent
        visible={renameVisible}
        onRequestClose={() => {
          if (!renameSaving) {
            setRenameVisible(false);
          }
        }}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Rename Tab</Text>

            <Text style={styles.modalSubtitle}>
              Enter a name for this bar tab.
            </Text>

            <TextInput
              autoFocus
              editable={!renameSaving}
              maxLength={80}
              onChangeText={setRenameValue}
              placeholder={seatLabel}
              value={renameValue}
              style={styles.input}
            />

            {renameError ? (
              <Text style={styles.modalError}>
                {renameError}
              </Text>
            ) : null}

            <View style={styles.modalActions}>
              <Pressable
                disabled={renameSaving}
                onPress={() => setRenameVisible(false)}
                style={({ pressed }) => [
                  styles.modalSecondaryButton,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.modalSecondaryText}>
                  Cancel
                </Text>
              </Pressable>

              <Pressable
                disabled={renameSaving}
                onPress={() => void saveRename()}
                style={({ pressed }) => [
                  styles.modalPrimaryButton,
                  pressed && styles.pressed,
                  renameSaving && styles.disabled,
                ]}
              >
                {renameSaving ? (
                  <ActivityIndicator size="small" />
                ) : (
                  <Text style={styles.modalPrimaryText}>
                    Save
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#f7f4ee',
  },
  content: {
    width: '100%',
    maxWidth: 820,
    alignSelf: 'center',
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 48,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#f7f4ee',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 15,
    color: '#665f55',
  },
  errorTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#171512',
  },
  errorText: {
    marginTop: 8,
    marginBottom: 18,
    maxWidth: 420,
    textAlign: 'center',
    fontSize: 15,
    lineHeight: 21,
    color: '#6d655b',
  },
  backButton: {
    alignSelf: 'flex-start',
    minHeight: 40,
    justifyContent: 'center',
    marginBottom: 14,
    paddingHorizontal: 2,
  },
  backButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#40392f',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 20,
  },
  headerText: {
    flex: 1,
  },
  title: {
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '700',
    color: '#171512',
  },
  subtitle: {
    marginTop: 5,
    fontSize: 15,
    color: '#746b60',
  },
  statusPill: {
    borderWidth: 1,
    borderColor: '#c9bda9',
    borderRadius: 999,
    backgroundColor: '#fffaf2',
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
    color: '#40392f',
  },
  balanceCard: {
    marginTop: 26,
    borderWidth: 1,
    borderColor: '#c8bda8',
    borderRadius: 14,
    backgroundColor: '#fffaf2',
    padding: 22,
  },
  balanceLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6d655b',
  },
  balanceValue: {
    marginTop: 5,
    fontSize: 34,
    lineHeight: 40,
    fontWeight: '700',
    color: '#171512',
  },
  summaryCard: {
    marginTop: 14,
    borderWidth: 1,
    borderColor: '#ddd5c8',
    borderRadius: 14,
    backgroundColor: '#ffffff',
    paddingHorizontal: 18,
  },
  summaryRow: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  summaryLabel: {
    fontSize: 15,
    color: '#6d655b',
  },
  summaryValue: {
    fontSize: 15,
    fontWeight: '700',
    color: '#211e1a',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#e5ded3',
  },
  sectionHeader: {
    marginTop: 28,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#171512',
  },
  sectionCount: {
    fontSize: 14,
    fontWeight: '700',
    color: '#746b60',
  },
  emptyOrders: {
    borderWidth: 1,
    borderColor: '#ddd5c8',
    borderRadius: 14,
    backgroundColor: '#ffffff',
    padding: 22,
  },
  emptyOrdersTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#211e1a',
  },
  emptyOrdersText: {
    marginTop: 4,
    fontSize: 14,
    color: '#746b60',
  },
  ordersList: {
    width: '100%',
  },
  orderCard: {
    borderWidth: 1,
    borderColor: '#ddd5c8',
    borderRadius: 14,
    backgroundColor: '#ffffff',
    padding: 18,
  },
  orderCardSpacing: {
    marginTop: 10,
  },
  orderHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
  },
  orderReference: {
    fontSize: 16,
    fontWeight: '700',
    color: '#211e1a',
  },
  orderStatus: {
    marginTop: 3,
    fontSize: 12,
    fontWeight: '600',
    color: '#746b60',
  },
  orderTotal: {
    fontSize: 17,
    fontWeight: '700',
    color: '#211e1a',
  },
  itemList: {
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e5ded3',
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
    paddingVertical: 4,
  },
  itemName: {
    flex: 1,
    fontSize: 14,
    lineHeight: 19,
    color: '#4c463e',
  },
  itemPrice: {
    fontSize: 14,
    fontWeight: '600',
    color: '#4c463e',
  },
  noItemsText: {
    marginTop: 12,
    fontSize: 13,
    color: '#847b70',
  },
  closeErrorBox: {
    marginTop: 16,
    borderWidth: 1,
    borderColor: '#d6b7b7',
    borderRadius: 10,
    backgroundColor: '#fff7f7',
    padding: 12,
  },
  closeErrorText: {
    fontSize: 13,
    lineHeight: 18,
    color: '#8b2d2d',
  },
  actions: {
    marginTop: 28,
  },
  primaryButton: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: '#211e1a',
    paddingHorizontal: 20,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#ffffff',
  },
  secondaryActions: {
    marginTop: 10,
    flexDirection: 'row',
    gap: 10,
  },
  secondaryAction: {
    flex: 1,
  },
  secondaryButton: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#c8bda8',
    borderRadius: 10,
    backgroundColor: '#fffaf2',
    paddingHorizontal: 16,
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#302b25',
  },
  closeButton: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#b66b6b',
    borderRadius: 10,
    backgroundColor: '#fff7f7',
    paddingHorizontal: 16,
  },
  closeButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#8b2d2d',
  },
  pressed: {
    opacity: 0.72,
  },
  disabled: {
    opacity: 0.5,
  },
  modalBackdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 440,
    borderRadius: 16,
    backgroundColor: '#ffffff',
    padding: 22,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#171512',
  },
  modalSubtitle: {
    marginTop: 5,
    fontSize: 14,
    color: '#746b60',
  },
  input: {
    marginTop: 18,
    minHeight: 48,
    borderWidth: 1,
    borderColor: '#c8bda8',
    borderRadius: 9,
    backgroundColor: '#ffffff',
    paddingHorizontal: 13,
    fontSize: 16,
    color: '#171512',
  },
  modalError: {
    marginTop: 9,
    fontSize: 13,
    color: '#8b2d2d',
  },
  modalActions: {
    marginTop: 20,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  modalSecondaryButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#c8bda8',
    borderRadius: 9,
    paddingHorizontal: 18,
  },
  modalSecondaryText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#302b25',
  },
  modalPrimaryButton: {
    minWidth: 90,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
    backgroundColor: '#211e1a',
    paddingHorizontal: 18,
  },
  modalPrimaryText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#ffffff',
  },
});
