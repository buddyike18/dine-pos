import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";

import { FullScreenModeContainer } from "../../design-system";
import { createOrder, getApiBase } from "../../lib/api";
import { getIdToken } from "../../lib/firebase";
import { config } from '../../config';
import { fetchWithTimeout } from '../../lib/network';

type PosMenuItem = {
  id: string;
  categoryId: string | null;
  category: string;
  name: string;
  description?: string;
  priceCents: number;
  available: boolean;
};

type ModifierOption = {
  id: string;
  name: string;
  priceDeltaCents: number;
};

type ModifierGroup = {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  options: ModifierOption[];
};

type CartModifierSelection = {
  groupId: string;
  groupName: string;
  optionIds: string[];
  optionNames: string[];
  priceDeltaCents: number;
};

type CartItem = PosMenuItem & {
  cartKey: string;
  quantity: number;
  modifiers: CartModifierSelection[];
};

type MenuCategory = {
  id: string;
  name: string;
  sortOrder: number;
};


function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function buildCartKey(
  menuItemId: string,
  modifiers: CartModifierSelection[],
) {
  const signature = modifiers
    .map((modifier) => ({
      groupId: modifier.groupId,
      optionIds: [...modifier.optionIds].sort(),
    }))
    .sort((a, b) => a.groupId.localeCompare(b.groupId));

  return `${menuItemId}:${JSON.stringify(signature)}`;
}

function formatCurrency(cents: unknown) {
  const numericCents = Number(cents);
  const safeCents = Number.isFinite(numericCents) ? numericCents : 0;
  return `$${(safeCents / 100).toFixed(2)}`;
}

type PosOrderContextBase = {
  displayLabel: string;
  statusLabel: string;
  unavailable: boolean;
  unavailableMessage: string;
  secondaryLabel?: string;
  referenceLabel?: string;
  actionLabel?: string;
  onAction?: () => void;
};

export type PosOrderContext =
  | (PosOrderContextBase & {
      kind: "TABLE";
      id: string;
    })
  | (PosOrderContextBase & {
      kind: "BAR_CHECK";
      id: string;
    })
  | (PosOrderContextBase & {
      kind: "QUICK";
    });

type PosOrderingWorkspaceProps = {
  context: PosOrderContext;
  onOrderCreated?: (orderId: string) => Promise<void> | void;
};

export default function PosOrderingWorkspace({
  context,
  onOrderCreated,
}: PosOrderingWorkspaceProps) {
  const router = useRouter();

  const [menuCategories, setMenuCategories] = useState<MenuCategory[]>([]);
  const [menuItems, setMenuItems] = useState<PosMenuItem[]>([]);
  const [menuLoading, setMenuLoading] = useState(false);
  const [menuError, setMenuError] = useState<string | null>(null);
  const [expandedMenuSection, setExpandedMenuSection] = useState("");

  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [isSubmittingOrder, setIsSubmittingOrder] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submissionIdempotencyKey, setSubmissionIdempotencyKey] =
    useState<string | null>(null);

  const [customizingItem, setCustomizingItem] =
    useState<PosMenuItem | null>(null);
  const [modifierGroups, setModifierGroups] = useState<ModifierGroup[]>([]);
  const [selectedOptions, setSelectedOptions] =
    useState<Record<string, string[]>>({});
  const [modifierLoading, setModifierLoading] = useState(false);
  const [modifierError, setModifierError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    setMenuLoading(true);
    setMenuError(null);

    void (async () => {
      try {
        const apiBase = getApiBase();
        const encodedRestaurantId = encodeURIComponent(config.restaurantId);

        const [categoriesResponse, itemsResponse] = await Promise.all([
          fetchWithTimeout(
            `${apiBase}/api/menu/categories?restaurant_id=${encodedRestaurantId}`,
          ),
          fetchWithTimeout(
            `${apiBase}/api/menu/items?restaurant_id=${encodedRestaurantId}`,
          ),
        ]);

        if (!categoriesResponse.ok || !itemsResponse.ok) {
          throw new Error("MENU_LOAD_FAILED");
        }

        const categoriesData = await categoriesResponse.json();
        const itemsData = await itemsResponse.json();

        const categories: MenuCategory[] = Array.isArray(
          categoriesData?.categories,
        )
          ? categoriesData.categories
              .map((category: unknown): MenuCategory | null => {
                if (!category || typeof category !== "object") return null;

                const value = category as Record<string, unknown>;
                const id =
                  typeof value.id === "string" ? value.id.trim() : "";
                const name =
                  typeof value.name === "string" ? value.name.trim() : "";
                const sortOrder = Number(value.sort_order);

                if (!isUuid(id) || !name) return null;

                return {
                  id,
                  name,
                  sortOrder: Number.isFinite(sortOrder) ? sortOrder : 0,
                };
              })
              .filter(
                (category: MenuCategory | null): category is MenuCategory =>
                  category !== null,
              )
          : [];

        const items: PosMenuItem[] = Array.isArray(itemsData?.items)
          ? itemsData.items
              .map((item: unknown): PosMenuItem | null => {
                if (!item || typeof item !== "object") return null;

                const value = item as Record<string, unknown>;

                const id =
                  typeof value.id === "string" ? value.id.trim() : "";

                const categoryId =
                  value.category_id === null
                    ? null
                    : typeof value.category_id === "string"
                      ? value.category_id
                      : null;

                const category =
                  typeof value.category_name === "string" &&
                  value.category_name.trim()
                    ? value.category_name.trim()
                    : "Other";

                const name =
                  typeof value.name === "string" ? value.name.trim() : "";

                const description =
                  typeof value.description === "string"
                    ? value.description
                    : undefined;

                const priceCents = Number(value.price_cents);
                const available = value.available === true;

                if (
                  !isUuid(id) ||
                  !name ||
                  !Number.isInteger(priceCents) ||
                  priceCents < 0
                ) {
                  return null;
                }

                return {
                  id,
                  categoryId,
                  category,
                  name,
                  description,
                  priceCents,
                  available,
                };
              })
              .filter(
                (item: PosMenuItem | null): item is PosMenuItem =>
                  item !== null,
              )
          : [];

        const sortedCategories = [...categories].sort(
          (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
        );

        if (items.some((item) => item.categoryId === null)) {
          sortedCategories.push({
            id: "uncategorized",
            name: "Other",
            sortOrder: Number.MAX_SAFE_INTEGER,
          });
        }

        if (!alive) return;

        setMenuCategories(sortedCategories);
        setMenuItems(items);
        setExpandedMenuSection(
          (current) =>
            current || sortedCategories[0]?.name || "",
        );
      } catch (error) {
        console.warn("Failed to load POS menu", error);

        if (alive) {
          setMenuCategories([]);
          setMenuItems([]);
          setMenuError("Menu could not be loaded. Check connection and try again.");
        }
      } finally {
        if (alive) {
          setMenuLoading(false);
        }
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  const cartSubtotalCents = useMemo(() => {
    return cartItems.reduce(
      (sum, item) => sum + item.priceCents * item.quantity,
      0,
    );
  }, [cartItems]);

  const visibleMenuItems = useMemo(() => {
    return menuItems.filter((item) => {
      if (expandedMenuSection === "Other") {
        return item.categoryId === null;
      }

      return item.category === expandedMenuSection;
    });
  }, [expandedMenuSection, menuItems]);

  function addCanonicalItem(
    item: PosMenuItem,
    modifiers: CartModifierSelection[],
  ) {
    setSubmissionIdempotencyKey(null);
    const modifierDeltaCents = modifiers.reduce(
      (sum, modifier) => sum + modifier.priceDeltaCents,
      0,
    );

    const cartKey = buildCartKey(item.id, modifiers);
    const priceCents = item.priceCents + modifierDeltaCents;

    setCartItems((currentItems) => {
      const existingItem = currentItems.find(
        (cartItem) => cartItem.cartKey === cartKey,
      );

      if (existingItem) {
        return currentItems.map((cartItem) =>
          cartItem.cartKey === cartKey
            ? {
                ...cartItem,
                quantity: cartItem.quantity + 1,
              }
            : cartItem,
        );
      }

      return [
        ...currentItems,
        {
          ...item,
          cartKey,
          priceCents,
          quantity: 1,
          modifiers,
        },
      ];
    });
  }

  async function selectMenuItem(item: PosMenuItem) {
    if (context.unavailable) {
      setSubmitError(context.unavailableMessage);
      return;
    }

    if (!item.available || !isUuid(item.id)) {
      return;
    }

    setModifierLoading(true);
    setModifierError(null);

    try {
      const response = await fetchWithTimeout(
        `${getApiBase()}/api/menu/items/${encodeURIComponent(
          item.id,
        )}/modifier-groups?restaurant_id=${encodeURIComponent(
          config.restaurantId,
        )}`,
      );

      if (!response.ok) {
        throw new Error(`MODIFIER_LOAD_FAILED_${response.status}`);
      }

      const data = await response.json();

      const groups: ModifierGroup[] = Array.isArray(data?.modifier_groups)
        ? data.modifier_groups
            .map((group: unknown): ModifierGroup | null => {
              if (!group || typeof group !== "object") return null;

              const value = group as Record<string, unknown>;
              const id =
                typeof value.id === "string" ? value.id.trim() : "";
              const name =
                typeof value.name === "string" ? value.name.trim() : "";
              const minSelect = Number(value.min_select);
              const maxSelect = Number(value.max_select);

              const options: ModifierOption[] = Array.isArray(value.options)
                ? value.options
                    .map((option: unknown): ModifierOption | null => {
                      if (!option || typeof option !== "object") return null;

                      const optionValue = option as Record<string, unknown>;
                      const optionId =
                        typeof optionValue.id === "string"
                          ? optionValue.id.trim()
                          : "";
                      const optionName =
                        typeof optionValue.name === "string"
                          ? optionValue.name.trim()
                          : "";
                      const priceDeltaCents = Number(
                        optionValue.price_delta_cents,
                      );

                      if (
                        !isUuid(optionId) ||
                        !optionName ||
                        !Number.isInteger(priceDeltaCents) ||
                        priceDeltaCents < 0
                      ) {
                        return null;
                      }

                      return {
                        id: optionId,
                        name: optionName,
                        priceDeltaCents,
                      };
                    })
                    .filter(
                      (
                        option: ModifierOption | null,
                      ): option is ModifierOption => option !== null,
                    )
                : [];

              if (
                !isUuid(id) ||
                !name ||
                !Number.isInteger(minSelect) ||
                minSelect < 0 ||
                !Number.isInteger(maxSelect) ||
                maxSelect < minSelect
              ) {
                return null;
              }

              return {
                id,
                name,
                minSelect,
                maxSelect,
                options,
              };
            })
            .filter(
              (group: ModifierGroup | null): group is ModifierGroup =>
                group !== null,
            )
        : [];

      if (groups.length === 0) {
        addCanonicalItem(item, []);
        return;
      }

      setCustomizingItem(item);
      setModifierGroups(groups);
      setSelectedOptions({});
      setModifierError(null);
    } catch (error) {
      console.warn("Failed to load POS modifiers", error);
      setModifierError("Customization options could not be loaded.");
    } finally {
      setModifierLoading(false);
    }
  }

  function toggleModifierOption(
    group: ModifierGroup,
    optionId: string,
  ) {
    setModifierError(null);

    setSelectedOptions((previous) => {
      const current = previous[group.id] ?? [];

      if (current.includes(optionId)) {
        return {
          ...previous,
          [group.id]: current.filter((id) => id !== optionId),
        };
      }

      if (current.length >= group.maxSelect) {
        return previous;
      }

      return {
        ...previous,
        [group.id]: [...current, optionId],
      };
    });
  }

  function cancelCustomization() {
    setCustomizingItem(null);
    setModifierGroups([]);
    setSelectedOptions({});
    setModifierError(null);
  }

  function confirmCustomization() {
    if (!customizingItem) return;

    for (const group of modifierGroups) {
      const selected = selectedOptions[group.id] ?? [];

      if (
        selected.length < group.minSelect ||
        selected.length > group.maxSelect
      ) {
        setModifierError(`Please complete ${group.name}.`);
        return;
      }
    }

    const modifiers = modifierGroups
      .map<CartModifierSelection | null>((group) => {
        const optionIds = selectedOptions[group.id] ?? [];

        if (optionIds.length === 0) return null;

        const selectedOptionRows = group.options.filter((option) =>
          optionIds.includes(option.id),
        );

        return {
          groupId: group.id,
          groupName: group.name,
          optionIds: selectedOptionRows.map((option) => option.id),
          optionNames: selectedOptionRows.map((option) => option.name),
          priceDeltaCents: selectedOptionRows.reduce(
            (sum, option) => sum + option.priceDeltaCents,
            0,
          ),
        };
      })
      .filter(
        (
          modifier: CartModifierSelection | null,
        ): modifier is CartModifierSelection => modifier !== null,
      );

    addCanonicalItem(customizingItem, modifiers);
    cancelCustomization();
  }

  function incrementCartItem(cartKey: string) {
    setSubmitError(null);
    setSubmissionIdempotencyKey(null);

    setCartItems((currentItems) =>
      currentItems.map((item) =>
        item.cartKey === cartKey
          ? { ...item, quantity: item.quantity + 1 }
          : item,
      ),
    );
  }

  function removeMenuItem(cartKey: string) {
    setSubmitError(null);
    setSubmissionIdempotencyKey(null);

    setCartItems((currentItems) =>
      currentItems
        .map((item) =>
          item.cartKey === cartKey
            ? { ...item, quantity: item.quantity - 1 }
            : item,
        )
        .filter((item) => item.quantity > 0),
    );
  }

  async function submitOrder() {
    if (cartItems.length === 0 || isSubmittingOrder || context.unavailable) {
      if (context.unavailable) {
        setSubmitError(context.unavailableMessage);
      }
      return;
    }

    setIsSubmittingOrder(true);
    setSubmitError(null);

    try {
      const token = await getIdToken();

      if (!token) {
        throw new Error("SIGN_IN_REQUIRED");
      }

      const items = cartItems.map((item) => ({
        menu_item_id: item.id,
        quantity: item.quantity,
        modifiers: item.modifiers.map((modifier) => ({
          group_id: modifier.groupId,
          option_ids: modifier.optionIds,
        })),
      }));

      const idempotencyKey =
        submissionIdempotencyKey ??
        `pos_${Date.now().toString(16)}_${Math.random().toString(16).slice(2)}`;

      if (!submissionIdempotencyKey) {
        setSubmissionIdempotencyKey(idempotencyKey);
      }

      const createdOrder = await createOrder({
        token,
        body: {
          restaurant_id: config.restaurantId,
          ...(context.kind === "TABLE"
            ? { table_id: context.id }
            : context.kind === "BAR_CHECK"
              ? { check_id: context.id }
              : { type: "QUICK" as const }),
          items,
        },
        idempotencyKey,
      });

      setSubmissionIdempotencyKey(null);
      setCartItems([]);

      if (onOrderCreated) {
        try {
          await onOrderCreated(createdOrder.orderId);
        } catch (error) {
          console.warn(
            "POS order created, but post-create handling failed",
            error,
          );
        }
      } else {
        router.back();
      }
    } catch (error) {
      console.warn("Failed to submit POS order", error);

      setSubmitError(
        error instanceof Error && error.message === "SIGN_IN_REQUIRED"
          ? "Sign in required."
          : "Order could not be submitted. Check connection and try again.",
      );
    } finally {
      setIsSubmittingOrder(false);
    }
  }

  return (
    <FullScreenModeContainer>
      <View
        style={{
          flex: 1,
          backgroundColor: "#f6f2eb",
          paddingHorizontal: 28,
          paddingTop: 24,
          paddingBottom: 18,
        }}
      >
        <View style={{ flex: 1, gap: 14 }}>
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <View style={{ gap: 4 }}>
              <Text
                style={{
                  color: "#6f6252",
                  fontSize: 15,
                  lineHeight: 20,
                  fontWeight: "700",
                }}
              >
                {context.displayLabel}
                {context.secondaryLabel
                  ? ` • ${context.secondaryLabel}`
                  : ""}
                {` • ${context.statusLabel}`}
                {context.referenceLabel
                  ? ` • ${context.referenceLabel}`
                  : ""}
              </Text>

              {context.unavailable ? (
                <Text
                  style={{
                    color: "#6f6252",
                    fontSize: 16,
                    lineHeight: 24,
                    fontWeight: "700",
                  }}
                >
                  {context.unavailableMessage}
                </Text>
              ) : null}
            </View>

            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
              }}
            >
              {context.actionLabel && context.onAction ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={context.onAction}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    borderWidth: 1,
                    borderColor: "#b8ad9d",
                    borderRadius: 8,
                    backgroundColor: "#ffffff",
                  }}
                >
                  <Text
                    style={{
                      color: "#4f463b",
                      fontSize: 16,
                      lineHeight: 24,
                      fontWeight: "700",
                    }}
                  >
                    {context.actionLabel}
                  </Text>
                </Pressable>
              ) : null}

              <Pressable
                accessibilityRole="button"
                onPress={() => router.back()}
                style={{ paddingHorizontal: 12, paddingVertical: 8 }}
              >
                <Text
                  style={{
                    color: "#4f463b",
                    fontSize: 16,
                    lineHeight: 24,
                    fontWeight: "700",
                  }}
                >
                  Exit
                </Text>
              </Pressable>
            </View>
          </View>

          <View style={{ height: 1, backgroundColor: "#c8bda8" }} />

          <View
            style={{
              flex: 1,
              flexDirection: "row",
              gap: 20,
              alignItems: "stretch",
            }}
          >
            <View
              style={{
                flex: 2.55,
                backgroundColor: "#fffaf2",
                borderColor: "#c8bda8",
                borderWidth: 1,
                borderRadius: 10,
                padding: 14,
              }}
            >
            {customizingItem || modifierLoading ? (
              <View style={{ flex: 1, gap: 10 }}>
                {customizingItem ? (
                  <View style={{ flex: 1 }}>
                    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 12 }}>
                    <View style={{ gap: 10 }}>
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 12,
                        }}
                      >
                        <Pressable
                          onPress={cancelCustomization}
                          style={{
                            borderWidth: 1,
                            borderColor: "#c8bda8",
                            borderRadius: 8,
                            paddingHorizontal: 12,
                            paddingVertical: 8,
                          }}
                        >
                          <Text style={{ fontWeight: "700", color: "#4f463b" }}>
                            ← Back to Menu
                          </Text>
                        </Pressable>

                        <Text
                          style={{
                            flex: 1,
                            fontSize: 18,
                            fontWeight: "700",
                            color: "#111111",
                          }}
                        >
                          Customize {customizingItem.name}
                        </Text>
                      </View>

                      {modifierGroups.map((group) => {
                        const selected = selectedOptions[group.id] ?? [];

                        return (
                          <View
                            key={group.id}
                            style={{
                              borderTopWidth: 1,
                              borderColor: "#c8bda8",
                              paddingTop: 10,
                              gap: 8,
                            }}
                          >
                            <Text
                              style={{
                                color: "#111111",
                                fontWeight: "700",
                              }}
                            >
                              {group.name}
                            </Text>

                            <Text
                              style={{
                                color: "#6f6252",
                                fontSize: 12,
                              }}
                            >
                              {group.minSelect > 0
                                ? `Choose at least ${group.minSelect}`
                                : "Optional"}{" "}
                              • Up to {group.maxSelect}
                            </Text>

                            <View
                              style={{
                                flexDirection: "row",
                                flexWrap: "wrap",
                                gap: 8,
                              }}
                            >
                              {group.options.map((option) => {
                                const isSelected = selected.includes(option.id);

                                return (
                                  <Pressable
                                    key={option.id}
                                    onPress={() =>
                                      toggleModifierOption(group, option.id)
                                    }
                                    style={{
                                      width: "49%",
                                      borderWidth: 1,
                                      borderColor: isSelected
                                        ? "#4f463b"
                                        : "#c8bda8",
                                      borderRadius: 8,
                                      padding: 10,
                                      backgroundColor: isSelected
                                        ? "#efe7d8"
                                        : "#fffaf2",
                                      flexDirection: "row",
                                      justifyContent: "space-between",
                                      alignItems: "center",
                                      gap: 8,
                                    }}
                                  >
                                    <Text
                                      style={{
                                        color: "#111111",
                                        fontWeight: "700",
                                        flexShrink: 1,
                                      }}
                                    >
                                      {isSelected ? "✓ " : ""}
                                      {option.name}
                                    </Text>

                                    {option.priceDeltaCents > 0 ? (
                                      <Text
                                        style={{
                                          color: "#4f463b",
                                          fontWeight: "700",
                                        }}
                                      >
                                        +{formatCurrency(option.priceDeltaCents)}
                                      </Text>
                                    ) : null}
                                  </Pressable>
                                );
                              })}
                            </View>
                          </View>
                        );
                      })}

                      {modifierError ? (
                        <Text
                          style={{
                            color: "#4f463b",
                            fontWeight: "700",
                          }}
                        >
                          {modifierError}
                        </Text>
                      ) : null}

                    </View>
                  </ScrollView>

                  <View
                    style={{
                      borderTopWidth: 1,
                      borderColor: "#c8bda8",
                      paddingTop: 10,
                    }}
                  >
                    <Pressable
                      onPress={confirmCustomization}
                      style={{
                        borderWidth: 1,
                        borderColor: "#4f463b",
                        backgroundColor: "#4f463b",
                        borderRadius: 8,
                        padding: 12,
                        alignItems: "center",
                      }}
                    >
                      <Text
                        style={{
                          color: "#fffaf2",
                          fontWeight: "700",
                        }}
                      >
                        Add
                      </Text>
                    </Pressable>
                  </View>
                  </View>
                ) : null}

                {modifierLoading ? (
                  <Text style={{ color: "#6f6252", fontWeight: "700" }}>
                    Loading customization options...
                  </Text>
                ) : null}

              </View>
            ) : (
              <>

              <View style={{ flex: 1, gap: 10 }}>
                <Text
                  style={{
                    color: "#111111",
                    fontSize: 19,
                    lineHeight: 24,
                    fontWeight: "700",
                  }}
                >
                  Menu
                </Text>

                {menuLoading ? (
                  <Text style={{ color: "#6f6252", fontWeight: "700" }}>
                    Loading menu...
                  </Text>
                ) : null}

                {menuError ? (
                  <Text style={{ color: "#4f463b", fontWeight: "700" }}>
                    {menuError}
                  </Text>
                ) : null}

                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={{ maxHeight: 36 }}
                  contentContainerStyle={{
                    gap: 6,
                    paddingRight: 8,
                    alignItems: "center",
                  }}
                >
                  {menuCategories.map((category) => {
                    const isSelected =
                      expandedMenuSection === category.name;

                    return (
                      <Pressable
                        key={category.id}
                        accessibilityRole="button"
                        onPress={() =>
                          setExpandedMenuSection(category.name)
                        }
                        style={({ pressed }) => ({
                          borderWidth: 1,
                          borderColor: isSelected ? "#4f463b" : "#c8bda8",
                          borderRadius: 8,
                          backgroundColor: isSelected
                            ? "#4f463b"
                            : pressed
                              ? "#efe7d8"
                              : "#fffaf2",
                          paddingHorizontal: 12,
                          paddingVertical: 7,
                          height: 32,
                          justifyContent: "center",
                        })}
                      >
                        <Text
                          style={{
                            color: isSelected ? "#fffaf2" : "#4f463b",
                            fontSize: 13,
                            lineHeight: 18,
                            fontWeight: "700",
                          }}
                        >
                          {category.name}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>

                <ScrollView
                  style={{ flex: 1 }}
                  contentContainerStyle={{
                    flexGrow: 1,
                    paddingTop: 2,
                    paddingBottom: 8,
                    paddingRight: 8,
                    gap: 10,
                  }}
                  showsVerticalScrollIndicator={false}
                >
                  {Array.from({
                    length: Math.ceil(visibleMenuItems.length / 3),
                  }).map((_, rowIndex) => {
                    const rowItems = visibleMenuItems.slice(
                      rowIndex * 3,
                      rowIndex * 3 + 3,
                    );

                    return (
                      <View
                        key={`menu-row-${rowIndex}`}
                        style={{ flexDirection: "row", gap: 8 }}
                      >
                        {rowItems.map((item) => (
                          <Pressable
                            key={item.id}
                            accessibilityRole="button"
                            onPress={() => void selectMenuItem(item)}
                            disabled={
                              context.unavailable || !item.available
                            }
                            style={({ pressed }) => ({
                              flex: 1,
                              borderWidth: 1,
                              borderColor:
                                context.unavailable || !item.available
                                  ? "#c8bda8"
                                  : pressed
                                    ? "#4f463b"
                                    : "#c8bda8",
                              borderRadius: 8,
                              backgroundColor:
                                context.unavailable || !item.available
                                  ? "#f3ede3"
                                  : pressed
                                    ? "#efe7d8"
                                    : "#fffaf2",
                              opacity:
                                context.unavailable || !item.available
                                  ? 0.6
                                  : 1,
                            })}
                          >
                            <View
                              style={{
                                paddingHorizontal: 10,
                                paddingVertical: 8,
                                gap: 4,
                                minHeight: 104,
                              }}
                            >
                              <View
                                style={{
                                  flexDirection: "row",
                                  justifyContent: "space-between",
                                  gap: 10,
                                  flex: 1,
                                }}
                              >
                                <View style={{ flex: 1, gap: 4 }}>
                                  <Text
                                    style={{
                                      color: "#111111",
                                      fontSize: 14,
                                      lineHeight: 18,
                                      fontWeight: "700",
                                    }}
                                  >
                                    {item.name}
                                  </Text>

                                  {item.description ? (
                                    <Text
                                      numberOfLines={3}
                                      style={{
                                        color: "#6f6252",
                                        fontSize: 11,
                                        lineHeight: 15,
                                      }}
                                    >
                                      {item.description}
                                    </Text>
                                  ) : null}
                                </View>

                                <View
                                  style={{
                                    alignItems: "flex-end",
                                    justifyContent: "space-between",
                                    minHeight: 88,
                                  }}
                                >
                                  <Text
                                    style={{
                                      color: "#4f463b",
                                      fontSize: 13,
                                      lineHeight: 18,
                                      fontWeight: "700",
                                    }}
                                  >
                                    {formatCurrency(item.priceCents)}
                                  </Text>

                                  <View
                                    style={{
                                      borderWidth: 1,
                                      borderColor: "#111111",
                                      borderRadius: 7,
                                      paddingHorizontal: 12,
                                      paddingVertical: 6,
                                      backgroundColor: "#4f463b",
                                    }}
                                  >
                                    <Text
                                      style={{
                                        color: "#fffaf2",
                                        fontSize: 13,
                                        lineHeight: 18,
                                        fontWeight: "700",
                                      }}
                                    >
                                      {item.available ? "ADD" : "Unavailable"}
                                    </Text>
                                  </View>
                                </View>
                              </View>
                            </View>
                          </Pressable>
                        ))}

                        {rowItems.length < 3
                          ? Array.from({
                              length: 3 - rowItems.length,
                            }).map((_, emptyIndex) => (
                              <View
                                key={`menu-empty-${rowIndex}-${emptyIndex}`}
                                style={{ flex: 1 }}
                              />
                            ))
                          : null}
                      </View>
                    );
                  })}
                </ScrollView>
              </View>
              </>
            )}
            </View>

            <View
              style={{
                flex: 1,
                backgroundColor: "#fffaf2",
                borderColor: "#c8bda8",
                borderWidth: 1,
                borderRadius: 10,
                padding: 14,
              }}
            >
              <View style={{ flex: 1, gap: 10 }}>
                <Text
                  style={{
                    color: "#111111",
                    fontSize: 19,
                    lineHeight: 24,
                    fontWeight: "700",
                  }}
                >
                  Current Order
                </Text>

                <View style={{ height: 1, backgroundColor: "#c8bda8" }} />

                <View style={{ flex: 1 }}>
                  {cartItems.length === 0 ? (
                    <Text style={{ color: "#6f6252", fontWeight: "700" }}>
                      Add items from the menu to begin.
                    </Text>
                  ) : (
                    <ScrollView>
                      {cartItems.map((item) => (
                        <View
                          key={item.cartKey}
                          style={{
                            borderBottomWidth: 1,
                            borderBottomColor: "#c8bda8",
                            paddingVertical: 8,
                            gap: 5,
                          }}
                        >
                          <View
                            style={{
                              flexDirection: "row",
                              justifyContent: "space-between",
                              gap: 10,
                            }}
                          >
                            <View style={{ flex: 1 }}>
                              <Text
                                style={{
                                  color: "#111111",
                                  fontWeight: "700",
                                }}
                              >
                                {item.name}
                              </Text>

                              {item.modifiers.flatMap(
                                (modifier) => modifier.optionNames,
                              ).length > 0 ? (
                                <Text
                                  style={{
                                    color: "#6f6252",
                                    fontSize: 12,
                                    marginTop: 3,
                                  }}
                                >
                                  {item.modifiers
                                    .flatMap(
                                      (modifier) => modifier.optionNames,
                                    )
                                    .join(", ")}
                                </Text>
                              ) : null}
                            </View>

                            <Text
                              style={{
                                color: "#111111",
                                fontWeight: "700",
                              }}
                            >
                              {formatCurrency(
                                item.priceCents * item.quantity,
                              )}
                            </Text>
                          </View>

                          <View
                            style={{
                              flexDirection: "row",
                              alignItems: "center",
                              gap: 8,
                            }}
                          >
                            <Pressable
                              onPress={() => removeMenuItem(item.cartKey)}
                            >
                              <Text style={{ fontSize: 18 }}>−</Text>
                            </Pressable>

                            <Text>Qty {item.quantity}</Text>

                            <Pressable
                              onPress={() =>
                                incrementCartItem(item.cartKey)
                              }
                            >
                              <Text style={{ fontSize: 18 }}>+</Text>
                            </Pressable>
                          </View>
                        </View>
                      ))}
                    </ScrollView>
                  )}
                </View>

                <View style={{ gap: 8 }}>
                  <View
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                    }}
                  >
                    <Text style={{ color: "#6f6252", fontWeight: "700" }}>
                      Subtotal
                    </Text>

                    <Text style={{ color: "#111111", fontWeight: "700" }}>
                      {formatCurrency(cartSubtotalCents)}
                    </Text>
                  </View>

                  {submitError ? (
                    <Text
                      style={{
                        color: "#4f463b",
                        fontWeight: "700",
                      }}
                    >
                      {submitError}
                    </Text>
                  ) : null}

                  <Pressable
                    accessibilityRole="button"
                    onPress={submitOrder}
                    disabled={
                      cartItems.length === 0 ||
                      isSubmittingOrder ||
                      context.unavailable
                    }
                    style={{
                      borderWidth: 1,
                      borderColor: "#4f463b",
                      borderRadius: 10,
                      backgroundColor:
                        cartItems.length === 0 ||
                        isSubmittingOrder ||
                        context.unavailable
                          ? "#efe7d8"
                          : "#4f463b",
                      paddingVertical: 14,
                      paddingHorizontal: 18,
                    }}
                  >
                    <Text
                      style={{
                        color:
                          cartItems.length === 0 ||
                          isSubmittingOrder ||
                          context.unavailable
                            ? "#6f6252"
                            : "#fffaf2",
                        fontSize: 19,
                        fontWeight: "700",
                        textAlign: "center",
                      }}
                    >
                      {isSubmittingOrder ? "Submitting..." : "Submit Order"}
                    </Text>
                  </Pressable>
                </View>
              </View>
            </View>
          </View>
      </View>
    </View>
    </FullScreenModeContainer>
  );
}
