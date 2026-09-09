// src/features/floorboard/FloorBoard.tsx

import React, { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, TextStyle, View, ViewStyle } from "react-native";

import {
  MAX_CONTENT_WIDTH,
  SURFACE_PADDING,
  TableTile,
  toStyle,
} from "../../design-system";
import { background } from "../../design-system/tokens/colors";

import {
  floorTablesStore,
  FloorTable,
  FloorTablesSnapshot,
} from "../../state/floorTables.store";
import type { TableAssignment } from "../../lib/api";

interface FloorBoardProps {
  tables?: FloorTable[];
  assignments?: TableAssignment[];
  visibleTableIds?: string[];
  onOpenTable: (tableId: string) => void;
  onOpenBar?: () => void;
  style?: ViewStyle;
}

const FLOOR_LAYOUT = {
  rows: {
    top: ["11", "12", "13", "14"],
    second: ["21", "22", "23", "24"],
    third: ["31", "32", "33", "34", "35"],
    fourth: ["41", "42", "43", "44", "45"],
    lowerLeftTop: ["51", "52", "53"],
    lowerLeftBottom: ["61", "62", "63", "main"],
    back: ["71", "72", "73", "74", "75", "76"],
  },
  rightColumn: {
    floorStack: ["floor1", "floor2", "floor3", "floor4"],
  },
} as const;

export const FloorBoard: React.FC<FloorBoardProps> = ({
  tables,
  assignments = [],
  visibleTableIds,
  onOpenTable,
  onOpenBar,
  style,
}) => {
  const [storeSnapshot, setStoreSnapshot] = useState<FloorTablesSnapshot>(
    floorTablesStore.getSnapshot()
  );

  useEffect(() => {
    if (tables && tables.length > 0) {
      return;
    }

    const unsubscribe = floorTablesStore.subscribe((nextSnapshot) => {
      setStoreSnapshot(nextSnapshot);
    });

    return unsubscribe;
  }, [tables]);

  const resolvedTables: FloorTable[] = useMemo(() => {
    if (tables && tables.length > 0) return tables;
    return storeSnapshot.tables;
  }, [storeSnapshot, tables]);

  const awarenessStatus = useMemo(() => {
    if (tables && tables.length > 0) return "healthy" as const;
    return storeSnapshot.awarenessStatus;
  }, [storeSnapshot, tables]);

  const tableMap = useMemo(() => {
    return new Map(resolvedTables.map((table) => [table.id, table]));
  }, [resolvedTables]);

  const assignmentMap = useMemo(() => {
    const nextMap = new Map<string, string>();

    assignments.forEach((assignment) => {
      const tableId = String(assignment.table_id ?? "").trim();
      const staffName = assignment.staff_name?.trim();

      if (tableId && staffName && assignment.active !== false) {
        nextMap.set(tableId, staffName);
      }
    });

    return nextMap;
  }, [assignments]);

  const visibleTableIdSet = useMemo(() => {
    if (!visibleTableIds || visibleTableIds.length === 0) {
      return null;
    }

    return new Set(visibleTableIds.map((tableId) => String(tableId).trim()).filter(Boolean));
  }, [visibleTableIds]);

  const assignedVisibleTables = useMemo(() => {
    if (!visibleTableIds) {
      return null;
    }

    return visibleTableIds
      .map((tableId) => tableMap.get(String(tableId).trim()))
      .filter((table): table is FloorTable => Boolean(table));
  }, [tableMap, visibleTableIds]);

  const renderTable = (
    tableId: string,
    tileStyle?: ViewStyle,
    isAngled: boolean = false
  ) => {
    if (visibleTableIdSet && !visibleTableIdSet.has(tableId)) {
      return null;
    }

    const table = tableMap.get(tableId);
    if (!table) {
      if (__DEV__) {
        console.warn(`[FloorBoard] Missing table for tableId: ${tableId}`);
      }
      return null;
    }

    return (
      <View
        key={table.id}
        style={[
          {
            minWidth: 56,
            flexBasis: 56,
          },
          tileStyle,
          isAngled
            ? {
                transform: [{ rotate: "-18deg" }],
                marginTop: 14,
                marginLeft: 6,
              }
            : null,
        ]}
      >
        <View style={{ minHeight: 84 }}>
          <TableTile
            tableLabel={table.label}
            state={table.state}
            assignedStaffName={assignmentMap.get(table.id)}
            unseenCount={table.unseenCount}
            onPress={() => onOpenTable(table.id)}
          />
        </View>
      </View>
    );
  };

  const renderRow = (
    ids: readonly string[],
    options?: {
      justifyContent?: "flex-start" | "center" | "space-between";
      tileStyle?: ViewStyle;
      rowStyle?: ViewStyle;
      angledId?: string;
      wrap?: boolean;
    }
  ) => {
    const justifyContent = options?.justifyContent ?? "flex-start";
    const tileStyle = options?.tileStyle;
    const rowStyle = options?.rowStyle;
    const angledId = options?.angledId;
    const wrap = options?.wrap ?? false;

    return (
      <View
        style={[
          {
            flexDirection: "row",
            flexWrap: wrap ? "wrap" : "nowrap",
            gap: 8,
            justifyContent,
          },
          rowStyle,
        ]}
      >
        {ids.map((id) => renderTable(id, tileStyle, angledId === id))}
      </View>
    );
  };

  const renderFixture = (
    label: string,
    fixtureStyle: ViewStyle,
    textStyle?: TextStyle
  ) => {
    return (
      <View
        style={[
          {
            borderWidth: 1,
            borderColor: "#c8bda8",
            backgroundColor: "#efe7d8",
            borderRadius: 12,
            alignItems: "center",
            justifyContent: "center",
          },
          fixtureStyle,
        ]}
      >
        <Text
          style={[
            {
              color: "#4f463b",
              fontSize: 12,
              fontWeight: "900",
              letterSpacing: 0.8,
              textTransform: "uppercase",
            },
            textStyle,
          ]}
        >
          {label}
        </Text>
      </View>
    );
  };

  const renderSectionTitle = (title: string) => {
    return (
      <Text
        style={{
          color: "#6f6252",
          fontSize: 10,
          fontWeight: "900",
          letterSpacing: 1,
          textTransform: "uppercase",
          marginBottom: 10,
        }}
      >
        {title}
      </Text>
    );
  };

  const boardStyle: ViewStyle = {
    width: "100%",
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: "center",
    gap: 8,
  };

  if (assignedVisibleTables) {
    return (
      <View
        style={[
          {
            flex: 1,
            backgroundColor: background.app,
          },
          style,
        ]}
      >
        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: SURFACE_PADDING,
            paddingTop: SURFACE_PADDING * 0.75,
            paddingBottom: SURFACE_PADDING * 1.5,
          }}
        >
          <View style={boardStyle}>
            {awarenessStatus === "degraded" ? (
              <View
                style={{
                  borderWidth: 1,
                  borderColor: "#d6a099",
                  backgroundColor: "#f7e8e5",
                  borderRadius: 10,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  gap: 4,
                }}
              >
                <Text
                  style={{
                    color: "#8a2f22",
                    fontSize: 12,
                    fontWeight: "900",
                    letterSpacing: 0.3,
                    textTransform: "uppercase",
                  }}
                >
                  Live floor awareness degraded
                </Text>
                <Text
                  style={{
                    color: "#8a2f22",
                    fontSize: 12,
                    fontWeight: "700",
                  }}
                >
                  Order updates may be delayed. Reconnecting automatically.
                </Text>
              </View>
            ) : null}

            {renderSectionTitle("My Tables")}

            {assignedVisibleTables.length > 0 ? (
              <View
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  gap: 12,
                }}
              >
                {assignedVisibleTables.map((table) => (
                  <View
                    key={table.id}
                    style={{
                      width: 220,
                      minHeight: 104,
                    }}
                  >
                    <TableTile
                      tableLabel={table.label}
                      state={table.state}
                      assignedStaffName={assignmentMap.get(table.id)}
                      unseenCount={table.unseenCount}
                      onPress={() => onOpenTable(table.id)}
                    />
                  </View>
                ))}
              </View>
            ) : (
              <View
                style={{
                  borderWidth: 1,
                  borderColor: "#c8bda8",
                  backgroundColor: "#fffaf2",
                  borderRadius: 10,
                  padding: 16,
                }}
              >
                <Text
                  style={{
                    color: "#4f463b",
                    fontSize: 14,
                    fontWeight: "800",
                  }}
                >
                  No assigned tables.
                </Text>
              </View>
            )}
          </View>
        </ScrollView>
      </View>
    );
  }

  return (
    <View
      style={[
        {
          flex: 1,
          backgroundColor: background.app,
        },
        style,
      ]}
    >
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: SURFACE_PADDING,
          paddingTop: SURFACE_PADDING * 0.75,
          paddingBottom: SURFACE_PADDING * 1.5,
        }}
      >
        <View style={boardStyle}>
          {awarenessStatus === "degraded" ? (
            <View
              style={{
                borderWidth: 1,
                borderColor: "#d6a099",
                backgroundColor: "#f7e8e5",
                borderRadius: 10,
                paddingHorizontal: 12,
                paddingVertical: 10,
                gap: 4,
              }}
            >
              <Text
                style={{
                  color: "#8a2f22",
                  fontSize: 12,
                  fontWeight: "900",
                  letterSpacing: 0.3,
                  textTransform: "uppercase",
                }}
              >
                Live floor awareness degraded
              </Text>
              <Text
                style={{
                  color: "#8a2f22",
                  fontSize: 12,
                  fontWeight: "700",
                }}
              >
                Order updates may be delayed. Reconnecting automatically.
              </Text>
            </View>
          ) : null}
          {renderSectionTitle("Front Line")}
          {renderRow(FLOOR_LAYOUT.rows.top, {
            justifyContent: "space-between",
            tileStyle: { flex: 1 },
          })}

          {renderSectionTitle("Second Line")}
          {renderRow(FLOOR_LAYOUT.rows.second, {
            justifyContent: "flex-start",
            tileStyle: { flex: 1, maxWidth: "24%" },
          })}

          {renderSectionTitle("Third Line")}
          {renderRow(FLOOR_LAYOUT.rows.third, {
            justifyContent: "space-between",
            tileStyle: { flex: 1 },
          })}

          {renderSectionTitle("Main Run")}
          <View
            style={{
              flexDirection: "row",
              alignItems: "flex-start",
              gap: 72,
            }}
          >
            <View style={{ flex: 1.25, gap: 36 }}>
              {renderRow(FLOOR_LAYOUT.rows.fourth, {
                justifyContent: "space-between",
                tileStyle: { flex: 1 },
              })}

              {onOpenBar ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Open Bar seating"
                  onPress={onOpenBar}
                  style={({ pressed }) => ({
                    minHeight: 112,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: "#c8bda8",
                    backgroundColor: "#fffaf2",
                    opacity: pressed ? 0.85 : 1,
                  })}
                >
                  {renderFixture(
                    "Bar",
                    {
                      minHeight: 110,
                      borderRadius: 11,
                      backgroundColor: "#fffaf2",
                    },
                    {
                      color: "#111111",
                      fontSize: 28,
                      fontWeight: "700",
                      letterSpacing: 0,
                      textTransform: "none",
                    }
                  )}
                </Pressable>
              ) : (
                renderFixture("Bar", {
                  minHeight: 100,
                  borderRadius: 12,
                  backgroundColor: "#efe7d8",
                })
              )}

              {renderRow(FLOOR_LAYOUT.rows.lowerLeftTop, {
                justifyContent: "space-between",
                tileStyle: { flex: 1 },
              })}

              {renderRow(FLOOR_LAYOUT.rows.lowerLeftBottom, {
                justifyContent: "space-between",
                tileStyle: { flex: 1 },
              })}
            </View>

            <View
              style={{
                width: 212,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                paddingTop: 4,
              }}
            >
              <View style={{ gap: 8 }}>
                {FLOOR_LAYOUT.rightColumn.floorStack.map((id) => {
                  if (visibleTableIdSet && !visibleTableIdSet.has(id)) {
                    return null;
                  }

                  const table = tableMap.get(id);
                  if (!table) {
                    if (__DEV__) {
                      console.warn(`[FloorBoard] Missing table for tableId: ${id}`);
                    }
                    return null;
                  }

                  return (
                    <View
                      key={id}
                      style={{
                        width: 124,
                        height: 96,
                        borderRadius: 12,
                        overflow: "hidden",
                      }}
                    >
                      <TableTile
                        tableLabel={table.label}
                        state={table.state}
                        assignedStaffName={assignmentMap.get(table.id)}
                        unseenCount={table.unseenCount}
                        onPress={() => onOpenTable(table.id)}
                      />
                    </View>
                  );
                })}
              </View>

              {renderFixture("Stage", {
                width: 72,
                minHeight: 170,
                borderRadius: 12,
                backgroundColor: "#efe7d8",
              })}
            </View>
          </View>

          {renderSectionTitle("Back Line")}
          {renderRow(FLOOR_LAYOUT.rows.back, {
            justifyContent: "space-between",
            tileStyle: { flex: 1 },
          })}
        </View>
      </ScrollView>
    </View>
  );
};