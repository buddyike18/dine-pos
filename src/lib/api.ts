import { Platform } from 'react-native';
import { config } from '../config';
import { fetchWithTimeout } from './network';

export type ApiErrorKind = 'network' | 'auth' | 'permission' | 'conflict' | 'not_found' | 'server' | 'unknown';

/**
 * Central API client for dine-pos.
 *
 * Phase 40E order creation uses canonical database-backed menu UUIDs and
 * server-authoritative pricing. Clients submit item and modifier identity only.
 */

function stripTrailingSlash(url: string) {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

export function getApiBase(): string {
  return stripTrailingSlash(config.api.baseUrl);
}

export function isUuid(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  // UUID v4 (loose) + allow other versions; keep simple
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

async function readJsonSafe(res: Response): Promise<any> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function buildUrl(path: string) {
  const base = getApiBase();
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  if (!path.startsWith('/')) return `${base}/${path}`;
  return `${base}${path}`;
}

export type CreateOrderModifierSelection = {
  group_id: string;
  option_ids: string[];
};

export type CreateOrderItem = {
  menu_item_id: string;
  quantity: number;
  modifiers: CreateOrderModifierSelection[];
};

export type CreateOrderBody = {
  restaurant_id: string;
  table_id?: string | null;
  check_id?: string | null;
  type?: 'DINE_IN' | 'QUICK';
  items: CreateOrderItem[];
};

// POS Phase 6.2: Order status and list helpers
export type BackendOrderStatus = 'OPEN' | 'SENT' | 'READY' | 'CLOSED' | 'CANCELLED';

export type ManagerInterventionReason = string;

export type OverrideOrderStatusBody = {
  to_status: BackendOrderStatus;
  reason: ManagerInterventionReason;
};

export type BackendOrderItemModifier = {
  id?: string;
  group_id?: string | null;
  option_id?: string | null;
  group_name_snapshot?: string;
  option_name_snapshot?: string;
  price_delta_cents_snapshot?: number;
  quantity?: number;
  group_name?: string;
  option_name?: string;
  name?: string;
};

export type BackendOrderItem = {
  id?: string;
  menu_item_id?: string | null;
  name?: string;
  menu_item_name?: string;
  name_snapshot?: string;
  quantity?: number;
  qty?: number;
  unit_price_cents_snapshot?: number;
  line_total_cents?: number;
  modifiers?: BackendOrderItemModifier[];
  order_item_modifiers?: BackendOrderItemModifier[];
};

export type BackendOrder = {
  id: string;
  status: BackendOrderStatus;
  table_id?: string | null;
  check_id?: string | null;
  opened_at?: string;
  items?: BackendOrderItem[];
  line_items?: BackendOrderItem[];
  total_cents?: number;
  total_price?: number;
  paid_cents?: number;
  balance_cents?: number;
  payment_status?: string;
  is_paid?: boolean;
  created_at?: string;
};

export type BarChair = {
  id: string;
  chair_number: number;
  display_name: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type BarCheckStatus = 'OPEN' | 'CLOSED' | 'VOIDED';

export type BarCheck = {
  id: string;
  restaurant_id: string;
  bar_chair_id: string | null;
  opened_by_user_id: string;
  closed_by_user_id: string | null;
  display_name: string | null;
  status: BarCheckStatus;
  opened_at: string;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
  chair_number: number | null;
  chair_display_name: string | null;
  order_count: number;
  total_cents: number;
  paid_cents: number;
  comped_cents: number;
  amount_owed_cents: number;
  payment_state: 'UNPAID' | 'PARTIAL' | 'PAID' | 'COMPED';
};

export type TableAssignment = {
  id?: string;
  restaurant_id?: string;
  table_id: string;
  staff_user_id?: string;
  active?: boolean;
  staff_name?: string;
  staff_role?: string;
  staff_active?: boolean;
};

export function pickOrderId(data: any): string | null {
  const id =
    data?.order?.id ||
    data?.data?.order?.id ||
    data?.orderId ||
    data?.order_id ||
    data?.id ||
    null;

  return typeof id === 'string' && id.length > 0 ? id : null;
}

/**
 * POS order creation preserves its service context.
 * Table orders pass `table_id`; bar-tab rounds pass `check_id`.
 */
export async function createOrder(args: {
  token: string;
  body: CreateOrderBody;
  idempotencyKey?: string;
}): Promise<{ orderId: string; raw: any; idempotencyKey: string }> {
  const { token, body } = args;
  const key = args.idempotencyKey || randomIdempotencyKey();

  const url = buildUrl('/api/orders');
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Idempotency-Key': key,
      'X-Client': 'dine-pos',
      'X-Platform': Platform.OS,
    },
    body: JSON.stringify(body),
  });

  const data = await readJsonSafe(res);

  if (!res.ok) {
    const msg =
      data?.error ||
      data?.message ||
      `createOrder failed (${res.status})`;
    const err: any = new Error(msg);
    err.status = res.status;
    throw err;
  }

  const orderId = pickOrderId(data);
  if (!orderId) {
    throw new Error('createOrder succeeded but order id was not returned');
  }

  return { orderId, raw: data, idempotencyKey: key };
}

function randomIdempotencyKey(): string {
  // Lightweight: time + random. Good enough for client-side idempotency keys.
  const rnd = Math.random().toString(16).slice(2);
  return `pos_${Date.now().toString(16)}_${rnd}`;
}

export async function createPaymentIntent(args: {
  token: string;
  orderId: string;
  idempotencyKey?: string;
}): Promise<{ clientSecret: string; raw: any; idempotencyKey: string }> {
  const { token, orderId } = args;
  const key = args.idempotencyKey || randomIdempotencyKey();

  const url = buildUrl('/api/payments/intent');
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Idempotency-Key': key,
      'X-Client': 'dine-pos',
      'X-Platform': Platform.OS,
    },
    body: JSON.stringify({ order_id: orderId }),
  });

  const data = await readJsonSafe(res);

  if (!res.ok) {
    const msg =
      data?.error ||
      data?.message ||
      `createPaymentIntent failed (${res.status})`;
    const err: any = new Error(msg);
    err.status = res.status;
    throw err;
  }

  const clientSecret =
    data?.paymentIntentClientSecret ||
    data?.clientSecret ||
    data?.data?.paymentIntentClientSecret ||
    null;

  if (typeof clientSecret !== 'string' || clientSecret.length === 0) {
    throw new Error('Payment intent created but client secret missing');
  }

  return { clientSecret, raw: data, idempotencyKey: key };
}

// POS Phase 6.2: Order list and status helpers

async function getJsonOrThrow(res: Response, op: string) {
  const data = await readJsonSafe(res);

  if (!res.ok) {
    const msg =
      data?.error ||
      data?.message ||
      `${op} failed (${res.status})`;
    const err: any = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data;
}

function extractArrayOrThrow(data: any, op: string, paths: string[][]): any[] {
  for (const path of paths) {
    let value = data;

    for (const key of path) {
      value = value?.[key];
    }

    if (Array.isArray(value)) {
      return value;
    }
  }

  console.warn(`DINE_POS_${op.toUpperCase()}_MALFORMED_RESPONSE`, data);
  throw new Error(`${op} response was malformed`);
}

/**
 * Phase 6.7: Fetch a single order by id for the Order Details screen.
 */

export async function getOrderById(orderId: string, token: string): Promise<any> {
  if (!orderId) throw new Error('getOrderById requires orderId');
  if (!token) {
    const err: any = new Error('Not signed in');
    err.status = 401;
    throw err;
  }

  const url = buildUrl(`/api/orders/${encodeURIComponent(orderId)}`);
  const res = await fetchWithTimeout(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'X-Client': 'dine-pos',
      'X-Platform': Platform.OS,
    },
  });

  const data = await getJsonOrThrow(res, 'getOrderById');
  return data?.order || data?.data?.order || data?.data || data;
}

/**
 * Phase 7.3: Fetch read-only order event history (manager-only).
 */
export async function getOrderEvents(orderId: string, token: string): Promise<any[]> {
  if (!orderId) throw new Error('getOrderEvents requires orderId');
  if (!token) {
    const err: any = new Error('Not signed in');
    err.status = 401;
    throw err;
  }

  const url = buildUrl(
    `/api/orders/${encodeURIComponent(orderId)}/events?cache_bust=${Date.now()}`
  );
  const res = await fetchWithTimeout(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'X-Client': 'dine-pos',
      'X-Platform': Platform.OS,
    },
  });

  const data = await getJsonOrThrow(res, 'getOrderEvents');
  return extractArrayOrThrow(data, 'getOrderEvents', [['events'], ['data', 'events'], ['data'], []]);
}

/**
 * Phase 6.2: Use the KDS list endpoints as the POS source of truth for queues.
 * These are role-gated on the backend (Manager/Employee) and already match kitchen workflow.
 */
export async function listKdsActiveOrders(args: {
  token: string;
  restaurantId?: string; // optional; backend may infer from token/claims
}): Promise<BackendOrder[]> {
  const { token, restaurantId } = args;

  const url = restaurantId
    ? buildUrl(`/api/orders/kds/active?restaurant_id=${encodeURIComponent(restaurantId)}`)
    : buildUrl('/api/orders/kds/active');

  const res = await fetchWithTimeout(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'X-Client': 'dine-pos',
      'X-Platform': Platform.OS,
    },
  });

  const data = await getJsonOrThrow(res, 'listKdsActiveOrders');

  return extractArrayOrThrow(data, 'listKdsActiveOrders', [['active_orders'], ['orders'], []]) as BackendOrder[];
}

// Phase 5: POS-scoped active orders (FloorBoard awareness)

export async function listActiveOrders(args: {
  token: string;
  restaurantId?: string;
}): Promise<BackendOrder[]> {
  const { token, restaurantId } = args;

  const url = restaurantId
    ? buildUrl(`/api/orders/active?restaurant_id=${encodeURIComponent(restaurantId)}`)
    : buildUrl('/api/orders/active');

  const res = await fetchWithTimeout(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'X-Client': 'dine-pos',
      'X-Platform': Platform.OS,
    },
  });

  const data = await getJsonOrThrow(res, 'listActiveOrders');

  return extractArrayOrThrow(data, 'listActiveOrders', [['active_orders'], ['orders'], []]) as BackendOrder[];
}

export async function listBarChairs(args: {
  token: string;
}): Promise<BarChair[]> {
  const response = await fetchWithTimeout(
    buildUrl('/api/bar/chairs'),
    {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${args.token}`,
        'X-Dine-Client': 'pos',
        'X-Dine-Platform': Platform.OS,
      },
    }
  );

  const data = await getJsonOrThrow(response, 'list_bar_chairs');
  return extractArrayOrThrow(
    data,
    'list_bar_chairs',
    [['chairs']]
  ) as BarChair[];
}

export async function listBarChecks(args: {
  token: string;
  status?: BarCheckStatus;
}): Promise<BarCheck[]> {
  const status = args.status ?? 'OPEN';
  const response = await fetchWithTimeout(
    buildUrl(
      `/api/bar/checks?status=${encodeURIComponent(status)}`
    ),
    {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${args.token}`,
        'X-Dine-Client': 'pos',
        'X-Dine-Platform': Platform.OS,
      },
    }
  );

  const data = await getJsonOrThrow(response, 'list_bar_checks');
  return extractArrayOrThrow(
    data,
    'list_bar_checks',
    [['checks']]
  ) as BarCheck[];
}

function extractBarResourceOrThrow<T>(
  data: any,
  key: 'chair' | 'check',
  op: string
): T {
  const resource = data?.[key];

  if (!resource || typeof resource !== 'object' || Array.isArray(resource)) {
    console.warn(`[api] ${op}: malformed successful response`, data);
    throw new Error(`Malformed ${op} response`);
  }

  return resource as T;
}

export async function createBarChair(args: {
  token: string;
  chairNumber: number;
  displayName?: string | null;
}): Promise<BarChair> {
  const res = await fetchWithTimeout(buildUrl('/api/bar/chairs'), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${args.token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Dine-Client': 'pos',
      'X-Dine-Platform': Platform.OS,
    },
    body: JSON.stringify({
      chair_number: args.chairNumber,
      ...(args.displayName !== undefined
        ? { display_name: args.displayName }
        : {}),
    }),
  });

  const data = await getJsonOrThrow(res, 'create_bar_chair');
  return extractBarResourceOrThrow<BarChair>(
    data,
    'chair',
    'create_bar_chair'
  );
}

export async function updateBarChair(args: {
  token: string;
  chairId: string;
  displayName?: string | null;
  active?: boolean;
}): Promise<BarChair> {
  const res = await fetchWithTimeout(
    buildUrl(`/api/bar/chairs/${encodeURIComponent(args.chairId)}`),
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${args.token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Dine-Client': 'pos',
        'X-Dine-Platform': Platform.OS,
      },
      body: JSON.stringify({
        ...(args.displayName !== undefined
          ? { display_name: args.displayName }
          : {}),
        ...(args.active !== undefined ? { active: args.active } : {}),
      }),
    }
  );

  const data = await getJsonOrThrow(res, 'update_bar_chair');
  return extractBarResourceOrThrow<BarChair>(
    data,
    'chair',
    'update_bar_chair'
  );
}

export async function createBarCheck(args: {
  token: string;
  barChairId?: string | null;
  displayName?: string | null;
}): Promise<BarCheck> {
  const res = await fetchWithTimeout(buildUrl('/api/bar/checks'), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${args.token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Dine-Client': 'pos',
      'X-Dine-Platform': Platform.OS,
    },
    body: JSON.stringify({
      ...(args.barChairId !== undefined
        ? { bar_chair_id: args.barChairId }
        : {}),
      ...(args.displayName !== undefined
        ? { display_name: args.displayName }
        : {}),
    }),
  });

  const data = await getJsonOrThrow(res, 'create_bar_check');
  return extractBarResourceOrThrow<BarCheck>(
    data,
    'check',
    'create_bar_check'
  );
}

export async function listBarCheckOrders({
  token,
  checkId,
}: {
  token: string;
  checkId: string;
}): Promise<BackendOrder[]> {
  const res = await fetchWithTimeout(
    buildUrl(`/api/bar/checks/${encodeURIComponent(checkId)}/orders`),
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'X-Dine-Client': 'pos',
        'X-Dine-Platform': Platform.OS,
      },
    }
  );

  const data = await getJsonOrThrow(res, 'list_bar_check_orders');

  if (
    !data ||
    typeof data !== 'object' ||
    !Array.isArray((data as { orders?: unknown }).orders)
  ) {
    throw new Error(
      'list_bar_check_orders: invalid response payload.'
    );
  }

  return (data as { orders: BackendOrder[] }).orders;
}

export async function getBarCheck({
  token,
  checkId,
}: {
  token: string;
  checkId: string;
}): Promise<BarCheck> {
  const res = await fetchWithTimeout(
    buildUrl(`/api/bar/checks/${encodeURIComponent(checkId)}`),
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'X-Dine-Client': 'pos',
        'X-Dine-Platform': Platform.OS,
      },
    }
  );

  const data = await getJsonOrThrow(res, 'get_bar_check');

  return extractBarResourceOrThrow<BarCheck>(
    data,
    'check',
    'get_bar_check'
  );
}

export type BarCheckPaymentIntentResponse = {
  paymentIntentId: string;
  paymentIntentClientSecret?: string;
  amountCents: number;
  reused: boolean;
  paymentCompleted?: boolean;
  reconciled?: boolean;
};

export async function createBarCheckPaymentIntent({
  token,
  checkId,
  idempotencyKey,
}: {
  token: string;
  checkId: string;
  idempotencyKey: string;
}): Promise<BarCheckPaymentIntentResponse> {
  const res = await fetchWithTimeout(
    buildUrl(
      `/api/bar/checks/${encodeURIComponent(checkId)}/payment-intent`
    ),
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
        'X-Dine-Client': 'pos',
        'X-Dine-Platform': Platform.OS,
      },
      body: JSON.stringify({}),
    }
  );

  const data = await getJsonOrThrow(
    res,
    'create_bar_check_payment_intent'
  );

  if (
    !data ||
    typeof data !== 'object' ||
    typeof (data as any).paymentIntentId !== 'string' ||
    typeof (data as any).amountCents !== 'number'
  ) {
    throw new Error(
      'create_bar_check_payment_intent: invalid response payload.'
    );
  }

  return data as BarCheckPaymentIntentResponse;
}

export async function closeBarCheck({
  token,
  checkId,
}: {
  token: string;
  checkId: string;
}): Promise<BarCheck> {
  const res = await fetchWithTimeout(
    buildUrl(`/api/bar/checks/${encodeURIComponent(checkId)}/close`),
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Dine-Client': 'pos',
        'X-Dine-Platform': Platform.OS,
      },
    }
  );

  const data = await getJsonOrThrow(res, 'close_bar_check');

  return extractBarResourceOrThrow<BarCheck>(
    data,
    'check',
    'close_bar_check'
  );
}

export async function updateBarCheck(args: {
  token: string;
  checkId: string;
  barChairId?: string | null;
  displayName?: string | null;
}): Promise<BarCheck> {
  const res = await fetchWithTimeout(
    buildUrl(`/api/bar/checks/${encodeURIComponent(args.checkId)}`),
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${args.token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Dine-Client': 'pos',
        'X-Dine-Platform': Platform.OS,
      },
      body: JSON.stringify({
        ...(args.barChairId !== undefined
          ? { bar_chair_id: args.barChairId }
          : {}),
        ...(args.displayName !== undefined
          ? { display_name: args.displayName }
          : {}),
      }),
    }
  );

  const data = await getJsonOrThrow(res, 'update_bar_check');
  return extractBarResourceOrThrow<BarCheck>(
    data,
    'check',
    'update_bar_check'
  );
}

export async function listTableAssignments(args: {
  token: string;
  restaurantId?: string;
}): Promise<TableAssignment[]> {
  const { token, restaurantId } = args;

  const url = restaurantId
    ? buildUrl(`/api/table-assignments?restaurant_id=${encodeURIComponent(restaurantId)}`)
    : buildUrl('/api/table-assignments');


  const res = await fetchWithTimeout(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'X-Client': 'dine-pos',
      'X-Platform': Platform.OS,
    },
  });

  const data = await getJsonOrThrow(res, 'listTableAssignments');

  return extractArrayOrThrow(data, 'listTableAssignments', [
    ['assignments'],
    ['data', 'assignments'],
    ['data'],
    [],
  ]) as TableAssignment[];
}

function normalizeOrderTableKey(value: unknown) {
  return String(value ?? '').trim().toLowerCase();
}

function getSafeOrderTime(order: BackendOrder | null | undefined) {
  const value = order?.opened_at ?? order?.created_at;
  if (!value) return 0;

  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function compareOrdersForTable(a: BackendOrder, b: BackendOrder) {
  const aTime = getSafeOrderTime(a);
  const bTime = getSafeOrderTime(b);

  if (aTime !== bTime) {
    return bTime - aTime;
  }

  return String(b?.id ?? '').localeCompare(String(a?.id ?? ''));
}

function normalizeMoneyCents(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.round(numeric));
}

export function getOrderTotalCents(order: BackendOrder | null | undefined): number {
  const totalCents = normalizeMoneyCents(order?.total_cents);
  if (totalCents > 0) return totalCents;

  const totalPrice = Number(order?.total_price);
  if (Number.isFinite(totalPrice) && totalPrice > 0) {
    return Math.round(totalPrice * 100);
  }

  return 0;
}

export function getOrderPaidCents(order: BackendOrder | null | undefined): number {
  const paidCents = normalizeMoneyCents(order?.paid_cents);
  if (paidCents > 0) return paidCents;

  if (order?.is_paid === true) {
    return getOrderTotalCents(order);
  }

  const paymentStatus = String(order?.payment_status ?? '').trim().toLowerCase();
  if (paymentStatus === 'paid') {
    return getOrderTotalCents(order);
  }

  return 0;
}

export function isOrderFullyPaid(order: BackendOrder | null | undefined): boolean {
  const totalCents = getOrderTotalCents(order);
  if (totalCents <= 0) return false;
  return getOrderPaidCents(order) >= totalCents;
}

export function getOrderPaymentState(order: BackendOrder | null | undefined): 'unpaid' | 'partial' | 'paid' {
  const totalCents = getOrderTotalCents(order);
  const paidCents = getOrderPaidCents(order);

  if (totalCents <= 0 || paidCents <= 0) {
    return 'unpaid';
  }

  if (paidCents >= totalCents) {
    return 'paid';
  }

  return 'partial';
}

export async function listOrdersForTable(args: {
  token: string;
  tableId: string;
  restaurantId?: string;
}): Promise<BackendOrder[]> {
  const { token, tableId } = args;

  const normalizedTableId = normalizeOrderTableKey(tableId);
  if (!normalizedTableId) {
    return [];
  }

  const url = buildUrl(
    `/api/orders/table/${encodeURIComponent(normalizedTableId)}/active?cache_bust=${Date.now()}`
  );

  const res = await fetchWithTimeout(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'X-Client': 'dine-pos',
      'X-Platform': Platform.OS,
    },
  });

  const data = await getJsonOrThrow(res, 'listOrdersForTable');

  const list = extractArrayOrThrow(data, 'listOrdersForTable', [
    ['active_orders'],
    ['orders'],
    ['data', 'active_orders'],
    ['data', 'orders'],
    ['data'],
    [],
  ]);

  return (list as BackendOrder[])
    .filter((order) => normalizeOrderTableKey(order?.table_id) === normalizedTableId)
    .sort(compareOrdersForTable);
}

export async function listKdsCompletedOrders(args: {
  token: string;
  restaurantId?: string;
}): Promise<BackendOrder[]> {
  const { token, restaurantId } = args;

  const url = restaurantId
    ? buildUrl(`/api/orders/kds/completed?restaurant_id=${encodeURIComponent(restaurantId)}`)
    : buildUrl('/api/orders/kds/completed');

  const res = await fetchWithTimeout(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'X-Client': 'dine-pos',
      'X-Platform': Platform.OS,
    },
  });

  const data = await getJsonOrThrow(res, 'listKdsCompletedOrders');

  return extractArrayOrThrow(data, 'listKdsCompletedOrders', [['completed_orders'], ['orders'], []]) as BackendOrder[];
}

export async function listOrdersByStatus(args: {
  token: string;
  status: BackendOrderStatus;
  restaurantId?: string;
}): Promise<BackendOrder[]> {
  const { token, status, restaurantId } = args;

  const url = restaurantId
    ? buildUrl(
        `/api/orders/status/${encodeURIComponent(status)}?restaurant_id=${encodeURIComponent(restaurantId)}`
      )
    : buildUrl(`/api/orders/status/${encodeURIComponent(status)}`);

  const res = await fetchWithTimeout(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'X-Client': 'dine-pos',
      'X-Platform': Platform.OS,
    },
  });

  const data = await getJsonOrThrow(res, 'listOrdersByStatus');

  return extractArrayOrThrow(data, 'listOrdersByStatus', [['orders'], ['data', 'orders'], ['data'], []]) as BackendOrder[];
}

/**
 * Phase 6.2: Authoritative status transition endpoint.
 * Backend uses CLOSED for "completed".
 */
export async function updateOrderStatus(args: {
  token: string;
  orderId: string;
  status: BackendOrderStatus;
}): Promise<{ raw: any }> {
  const { token, orderId, status } = args;

  const url = buildUrl(`/api/orders/${encodeURIComponent(orderId)}/status`);
  const res = await fetchWithTimeout(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Client': 'dine-pos',
      'X-Platform': Platform.OS,
    },
    body: JSON.stringify({ status }),
  });

  const data = await getJsonOrThrow(res, 'updateOrderStatus');
  return { raw: data };
}

/**
 * Phase 10.0: Manager-only exception control endpoints.
 * These helpers intentionally use explicit dedicated routes so intervention
 * actions do not share the generic payment or lifecycle mutation path.
 */
export async function voidOrder(args: {
  token: string;
  orderId: string;
  reason: ManagerInterventionReason;
}): Promise<{ raw: any }> {
  const { token, orderId, reason } = args;

  const url = buildUrl(`/api/orders/${encodeURIComponent(orderId)}/void`);
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Client': 'dine-pos',
      'X-Platform': Platform.OS,
    },
    body: JSON.stringify({ reason }),
  });

  const data = await getJsonOrThrow(res, 'voidOrder');
  return { raw: data };
}

export async function compOrder(args: {
  token: string;
  orderId: string;
  reason: ManagerInterventionReason;
}): Promise<{ raw: any }> {
  const { token, orderId, reason } = args;

  const url = buildUrl(`/api/orders/${encodeURIComponent(orderId)}/comp`);
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Client': 'dine-pos',
      'X-Platform': Platform.OS,
    },
    body: JSON.stringify({ reason }),
  });

  const data = await getJsonOrThrow(res, 'compOrder');
  return { raw: data };
}

export async function overrideOrderStatus(args: {
  token: string;
  orderId: string;
  body: OverrideOrderStatusBody;
}): Promise<{ raw: any }> {
  const { token, orderId, body } = args;

  const url = buildUrl(`/api/orders/${encodeURIComponent(orderId)}/override-status`);
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Client': 'dine-pos',
      'X-Platform': Platform.OS,
    },
    body: JSON.stringify(body),
  });

  const data = await getJsonOrThrow(res, 'overrideOrderStatus');
  return { raw: data };
}

export async function markOrderPaid(args: {
  token: string;
  orderId: string;
  payment_method: 'cash' | 'card';
}): Promise<{ raw: any }> {
  const { token, orderId, payment_method } = args;

  const url = buildUrl(`/api/orders/${encodeURIComponent(orderId)}/pay`);
  const res = await fetchWithTimeout(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Client': 'dine-pos',
      'X-Platform': Platform.OS,
    },
    body: JSON.stringify({ payment_method }),
  });

  const data = await getJsonOrThrow(res, 'markOrderPaid');
  return { raw: data };
}

export async function resetTable(args: {
  token: string;
  tableId: string;
  restaurantId?: string;
  idempotencyKey?: string;
}): Promise<{ raw: any }> {
  const { token, tableId, restaurantId } = args;
  const key = args.idempotencyKey || randomIdempotencyKey();

  const qs = restaurantId
    ? `?restaurant_id=${encodeURIComponent(restaurantId)}`
    : '';

  const url = buildUrl(`/api/orders/table/${encodeURIComponent(tableId)}/reset${qs}`);
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Idempotency-Key': key,
      'X-Client': 'dine-pos',
      'X-Platform': Platform.OS,
    },
    body: JSON.stringify({ table_id: tableId }),
  });

  const data = await getJsonOrThrow(res, 'resetTable');
  return { raw: data };
}

function isFetchLikeNetworkError(e: unknown): boolean {
  // React Native typically throws TypeError("Network request failed")
  if (e instanceof TypeError) return true;
  const msg = (e as any)?.message;
  return typeof msg === 'string' && msg.toLowerCase().includes('network request failed');
}

export function classifyApiError(e: unknown): ApiErrorKind {
  if (isFetchLikeNetworkError(e)) return 'network';
  const status = (e as any)?.status;
  if (typeof status === 'number') {
    if (status === 401) return 'auth';
    if (status === 403) return 'permission';
    if (status === 404) return 'not_found';
    if (status === 409) return 'conflict';
    if (status >= 500) return 'server';
  }
  return 'unknown';
}

const API_REQUEST_TIMEOUT_MS = 15_000;

export async function checkBackendReachable(args?: { timeoutMs?: number }): Promise<boolean> {
  const timeoutMs = args?.timeoutMs ?? 2000;

  const url = buildUrl('/health');

  try {
    const res = await fetchWithTimeout(
      url,
      {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'X-Client': 'dine-pos',
          'X-Platform': Platform.OS,
        },
      },
      timeoutMs
    );
    return res.ok;
  } catch (e) {
    return false;
  }
}
