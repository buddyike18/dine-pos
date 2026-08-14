

import React from "react";

import {
  ButtonPrimitive,
  Divider,
  Row,
  Stack,
  Surface,
  TextPrimitive,
} from "../../design-system/primitives";

export type TableOrderCardAction =
  | "SEND"
  | "MARK_READY"
  | "RECALL"
  | "VOID_ORDER"
  | "COMP_ORDER";

export type TableOrderCardTimelineRow = {
  id: string;
  createdAt: string;
  actor: string;
};

export type TableOrderCardItem = {
  name: string;
  quantity: number;
};

export type TableOrderCardOrder = {
  id: string;
  status: string;
  openedAt?: string | null;
  createdAt: string;
  paidCents: number;
  totalCents: number;
  items: TableOrderCardItem[];
  timelineRows: TableOrderCardTimelineRow[];
};

export type TableOrderCardActionPresentation = {
  primary: TableOrderCardAction | null;
  secondary: TableOrderCardAction[];
};

export type TableOrderCardInterventionState = {
  isVoided: boolean;
  isComped: boolean;
};

type Props = {
  order: TableOrderCardOrder;
  orderLabel: string;
  statusDetail: string;
  actionPresentation: TableOrderCardActionPresentation;
  pendingAction?: TableOrderCardAction;
  isActionPending: boolean;
  managerActions: TableOrderCardAction[];
  intervention: TableOrderCardInterventionState;
  getActionLabel: (action: TableOrderCardAction) => string;
  formatTimelineTimestamp: (value?: string | null) => string;
  formatTimelineEventLabel: (event: TableOrderCardTimelineRow) => string;
  formatMoneyCents: (value: number) => string;
  onActionPress: (orderId: string, action: TableOrderCardAction) => void;
};

export function TableOrderCard({
  order,
  orderLabel,
  statusDetail,
  actionPresentation,
  pendingAction,
  isActionPending,
  managerActions,
  intervention,
  getActionLabel,
  formatTimelineTimestamp,
  formatTimelineEventLabel,
  formatMoneyCents,
  onActionPress,
}: Props) {
  return (
    <Surface padding={3}>
      <Stack gap={2}>
        <Row justify="space-between" align="center">
          <TextPrimitive variant="bodyMd">{orderLabel}</TextPrimitive>
          <TextPrimitive variant="bodyMd">
            {intervention.isVoided
              ? "VOIDED"
              : intervention.isComped
                ? "COMPED"
                : order.status}
          </TextPrimitive>
        </Row>

        <TextPrimitive variant="bodySm">ID: {order.id}</TextPrimitive>

        <TextPrimitive variant="bodySm">
          Opened: {formatTimelineTimestamp(order.openedAt || order.createdAt)}
        </TextPrimitive>

        <TextPrimitive variant="bodySm">
          Payment: {formatMoneyCents(order.paidCents)} / {formatMoneyCents(order.totalCents)}
        </TextPrimitive>

        <TextPrimitive variant="bodySm">{statusDetail}</TextPrimitive>

        <Stack gap={1}>
          <TextPrimitive variant="bodyMd">Next Action</TextPrimitive>
          {actionPresentation.primary ? (
            <ButtonPrimitive
              key={`${order.id}-primary-action-${actionPresentation.primary}`}
              hierarchy="primary"
              label={
                pendingAction === actionPresentation.primary
                  ? `${getActionLabel(actionPresentation.primary)}...`
                  : getActionLabel(actionPresentation.primary)
              }
              disabled={isActionPending}
              onPress={() => onActionPress(order.id, actionPresentation.primary as TableOrderCardAction)}
            />
          ) : (
            <TextPrimitive variant="bodySm">No action available.</TextPrimitive>
          )}
        </Stack>

        {actionPresentation.secondary.length > 0 ? (
          <Stack gap={2}>
            <TextPrimitive variant="bodyMd">Operational Exceptions</TextPrimitive>
            {actionPresentation.secondary.map((action) => (
              <ButtonPrimitive
                key={`${order.id}-secondary-action-${action}`}
                hierarchy="secondary"
                label={pendingAction === action ? `${getActionLabel(action)}...` : getActionLabel(action)}
                disabled={isActionPending}
                onPress={() => onActionPress(order.id, action)}
              />
            ))}
          </Stack>
        ) : null}

        {managerActions.length > 0 ? (
          <Stack gap={2}>
            <TextPrimitive variant="bodyMd">Manager Actions</TextPrimitive>
            <TextPrimitive variant="bodySm">Manager-only intervention controls.</TextPrimitive>
            {managerActions.map((action) => (
              <ButtonPrimitive
                key={`${order.id}-manager-action-${action}`}
                hierarchy="destructive"
                label={pendingAction === action ? `${getActionLabel(action)}...` : getActionLabel(action)}
                disabled={isActionPending}
                onPress={() => onActionPress(order.id, action)}
              />
            ))}
          </Stack>
        ) : null}

        <Divider />

        <Stack gap={1}>
          <TextPrimitive variant="bodyMd">Items</TextPrimitive>
          {order.items.length === 0 ? (
            <TextPrimitive variant="bodySm">No items found.</TextPrimitive>
          ) : (
            <Stack gap={1}>
              {order.items.map((item, itemIndex) => (
                <Row key={`${order.id}-item-${itemIndex}`} justify="space-between" align="center">
                  <TextPrimitive variant="bodySm">{item.name}</TextPrimitive>
                  <TextPrimitive variant="bodySm">x{item.quantity}</TextPrimitive>
                </Row>
              ))}
            </Stack>
          )}
        </Stack>

        <Divider />

        <Stack gap={2}>
          <TextPrimitive variant="bodyMd">Timeline</TextPrimitive>
          <Row justify="space-between" align="center">
            <TextPrimitive variant="bodyMd">Time</TextPrimitive>
            <TextPrimitive variant="bodyMd">Event</TextPrimitive>
            <TextPrimitive variant="bodyMd">Actor</TextPrimitive>
          </Row>

          <Divider />

          {order.timelineRows.length === 0 ? (
            <TextPrimitive variant="bodySm">No events yet.</TextPrimitive>
          ) : (
            <Stack gap={2}>
              {order.timelineRows.map((event, index) => (
                <React.Fragment key={event.id}>
                  {index > 0 ? <Divider /> : null}
                  <Row justify="space-between" align="center">
                    <TextPrimitive variant="bodyMd">{formatTimelineTimestamp(event.createdAt)}</TextPrimitive>
                    <TextPrimitive variant="bodyMd">{formatTimelineEventLabel(event)}</TextPrimitive>
                    <TextPrimitive variant="bodyMd">{event.actor}</TextPrimitive>
                  </Row>
                </React.Fragment>
              ))}
            </Stack>
          )}
        </Stack>
      </Stack>
    </Surface>
  );
}