import { authFetch } from '../../../utils/authRequest';

export type FinancialPendingSituation =
  | 'awaiting_payment'
  | 'creation_failed'
  | 'uncertain'
  | 'provider_query_failed'
  | 'approved'
  | 'closed_after_review';

export type FinancialPendingProvider = 'pagbank' | 'mercado_pago' | 'direct_pix';

export interface FinancialPendingHistoryItem {
  id: number | string;
  action: string;
  reason: string;
  actor_user_id: string | null;
  actor_name: string;
  created_at: string | null;
  created_at_local: string | null;
  status_before: string | null;
  status_after: string | null;
  evidence_code: string | null;
}

export interface FinancialPendingItem {
  id: string;
  comanda_id: string;
  order_number: number | null;
  amount: string;
  created_at: string | null;
  created_at_local: string | null;
  provider: FinancialPendingProvider;
  provider_label: string;
  status: string;
  comanda_open: boolean;
  turno_id: number | null;
  shift_scope: 'current_shift' | 'previous_shift' | 'no_open_shift';
  situation: FinancialPendingSituation;
  situation_label: string;
  blocks_disconnect: boolean;
  reason_title: string;
  reason_detail: string;
  evidence_code: string;
  evidence_summary: string;
  provider_code: string | null;
  provider_request_id: string | null;
  http_status: number | null;
  has_external_id: boolean;
  external_payment_id_ref: string | null;
  reconciliation_attempted_at: string | null;
  expires_at: string | null;
  can_reconcile: boolean;
  can_close_creation_failure: boolean;
  can_direct_pix_confirm: boolean;
  can_direct_pix_cancel: boolean;
  requires_manual_escalation: boolean;
  escalation_guidance: string | null;
  allowed_actions: string[];
  recommended_action: string;
  review_history: FinancialPendingHistoryItem[];
}

export interface FinancialPendingSummary {
  blocking_count: number;
  blocking_total_amount: string;
  current_shift_id: number | null;
  current_shift_blocking_count: number;
  current_shift_blocking_total_amount: string;
  previous_shift_blocking_count: number;
  previous_shift_blocking_total_amount: string;
  by_situation: Record<
    'awaiting_payment' | 'creation_failed' | 'uncertain' | 'provider_query_failed',
    number
  >;
  by_provider: Record<FinancialPendingProvider, number>;
  can_disconnect_pagbank: boolean;
  can_disconnect_mercado_pago: boolean;
  can_switch_receiver: boolean;
  active_receiver: FinancialPendingProvider | 'multiple' | null;
}

export interface FinancialPendingReviewResponse {
  summary: FinancialPendingSummary;
  items: FinancialPendingItem[];
  history_items: FinancialPendingItem[];
}

export interface PaymentBlockSummaryItem {
  id: string;
  comanda_id: string;
  order_number: number | null;
  amount: string;
  provider: string;
  provider_label: string;
  situation: FinancialPendingSituation;
  situation_label: string;
  reason_title: string;
  can_close_creation_failure: boolean;
  can_reconcile: boolean;
  requires_manual_escalation: boolean;
}

export interface PaymentBlockError {
  code: string | null;
  message: string;
  blockingCount: number;
  blockingTotalAmount: string | null;
  categories: Record<string, number> | null;
  blockingItems: PaymentBlockSummaryItem[];
}

export function extractErrorMessage(detail: unknown, fallback: string): string {
  if (typeof detail === 'string' && detail.trim()) return detail.trim();
  if (detail && typeof detail === 'object' && 'message' in detail) {
    const msg = (detail as { message?: unknown }).message;
    if (typeof msg === 'string' && msg.trim()) return msg.trim();
  }
  return fallback;
}

export function parsePaymentBlockError(detail: unknown, fallback: string): PaymentBlockError {
  if (typeof detail === 'string') {
    return {
      code: null,
      message: detail.trim() || fallback,
      blockingCount: 0,
      blockingTotalAmount: null,
      categories: null,
      blockingItems: [],
    };
  }

  if (detail && typeof detail === 'object') {
    const record = detail as Record<string, unknown>;
    const rawItems = Array.isArray(record.blocking_items) ? record.blocking_items : [];
    const blockingItems: PaymentBlockSummaryItem[] = rawItems
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
      .map(item => ({
        id: String(item.id ?? ''),
        comanda_id: String(item.comanda_id ?? ''),
        order_number: typeof item.order_number === 'number' ? item.order_number : null,
        amount: String(item.amount ?? '0.00'),
        provider: String(item.provider ?? ''),
        provider_label: String(item.provider_label ?? item.provider ?? ''),
        situation: (String(item.situation ?? 'uncertain') as FinancialPendingSituation),
        situation_label: String(item.situation_label ?? ''),
        reason_title: String(item.reason_title ?? ''),
        can_close_creation_failure: Boolean(item.can_close_creation_failure),
        can_reconcile: Boolean(item.can_reconcile),
        requires_manual_escalation: Boolean(item.requires_manual_escalation),
      }));

    const categoriesRaw = record.categories;
    const categories =
      categoriesRaw && typeof categoriesRaw === 'object' && !Array.isArray(categoriesRaw)
        ? Object.fromEntries(
            Object.entries(categoriesRaw as Record<string, unknown>).map(([k, v]) => [k, Number(v) || 0]),
          )
        : null;

    return {
      code: typeof record.code === 'string' ? record.code : null,
      message: extractErrorMessage(record, fallback),
      blockingCount:
        typeof record.blocking_count === 'number'
          ? record.blocking_count
          : blockingItems.length,
      blockingTotalAmount:
        typeof record.blocking_total_amount === 'string' || typeof record.blocking_total_amount === 'number'
          ? String(record.blocking_total_amount)
          : null,
      categories,
      blockingItems,
    };
  }

  return {
    code: null,
    message: fallback,
    blockingCount: 0,
    blockingTotalAmount: null,
    categories: null,
    blockingItems: [],
  };
}

const EMAIL_LOCAL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/;
const EMAIL_DOMAIN_LABEL_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
const EMAIL_TLD_RE = /^[A-Za-z]{2,24}$/;

/** Parity with backend `valid_order_payer_email` (PagBank / Mercado Pago). */
export function isValidPixPayerEmail(value: string): boolean {
  const email = String(value ?? '').trim();
  if (email.length < 6 || email.length > 254) return false;
  for (let i = 0; i < email.length; i += 1) {
    const code = email.charCodeAt(i);
    if (code <= 32 || code >= 127) return false;
  }
  const atIndex = email.indexOf('@');
  if (atIndex <= 0 || email.indexOf('@', atIndex + 1) !== -1) return false;

  const local = email.slice(0, atIndex);
  const domain = email.slice(atIndex + 1);

  if (
    !local
    || local.length > 64
    || local.startsWith('.')
    || local.endsWith('.')
    || local.includes('..')
    || !EMAIL_LOCAL_RE.test(local)
  ) {
    return false;
  }

  if (!domain || domain.length > 253 || domain.includes('..') || !domain.includes('.')) {
    return false;
  }

  const labels = domain.split('.');
  if (labels.some(label => !EMAIL_DOMAIN_LABEL_RE.test(label))) {
    return false;
  }
  return EMAIL_TLD_RE.test(labels[labels.length - 1] ?? '');
}

async function readJsonSafe(response: Response): Promise<Record<string, unknown>> {
  try {
    const body = await response.json();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function fetchPendingReview(
  apiBaseUrl: string,
  authHeaders: Record<string, string>,
  options?: {
    includeResolved?: boolean;
    provider?: string;
    shiftScope?: string;
    signal?: AbortSignal;
  },
): Promise<FinancialPendingReviewResponse> {
  const params = new URLSearchParams();
  if (options?.includeResolved === false) params.set('include_resolved', 'false');
  if (options?.provider) params.set('provider', options.provider);
  if (options?.shiftScope && options.shiftScope !== 'all') params.set('shift_scope', options.shiftScope);
  const qs = params.toString();
  const response = await authFetch(
    `${apiBaseUrl}/payments/pending-review${qs ? `?${qs}` : ''}`,
    { headers: authHeaders, signal: options?.signal },
  );
  const body = await readJsonSafe(response);
  if (!response.ok) {
    throw new Error(extractErrorMessage(body.detail, 'Não foi possível carregar a central de pendências financeiras.'));
  }
  return body as unknown as FinancialPendingReviewResponse;
}

export async function reconcilePendingIntent(
  apiBaseUrl: string,
  authHeaders: Record<string, string>,
  intentId: string,
): Promise<{ status: string; queried: boolean; approved: boolean; item: FinancialPendingItem | null }> {
  const response = await authFetch(`${apiBaseUrl}/payments/pending-review/${encodeURIComponent(intentId)}/reconcile`, {
    method: 'POST',
    headers: authHeaders,
  });
  const body = await readJsonSafe(response);
  if (!response.ok) {
    throw new Error(extractErrorMessage(body.detail, 'Não foi possível consultar o pagamento no provedor.'));
  }
  return body as { status: string; queried: boolean; approved: boolean; item: FinancialPendingItem | null };
}

export async function closeCreationFailureIntent(
  apiBaseUrl: string,
  authHeaders: Record<string, string>,
  intentId: string,
  payload: { reason: string; confirmed_no_charge: boolean },
): Promise<{ status: string; already_closed: boolean; intent_id: string; comanda_id: string }> {
  const response = await authFetch(
    `${apiBaseUrl}/payments/pending-review/${encodeURIComponent(intentId)}/close-creation-failure`,
    {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  );
  const body = await readJsonSafe(response);
  if (!response.ok) {
    throw new Error(extractErrorMessage(body.detail, 'Não foi possível encerrar a falha de criação.'));
  }
  return body as { status: string; already_closed: boolean; intent_id: string; comanda_id: string };
}

export async function confirmDirectPixIntent(
  apiBaseUrl: string,
  authHeaders: Record<string, string>,
  intentId: string,
  payload: { checked_bank_statement: boolean; received_amount: string; bank_reference?: string },
): Promise<{ status: string; already_approved?: boolean }> {
  const response = await authFetch(`${apiBaseUrl}/payments/direct-pix/${encodeURIComponent(intentId)}/confirm`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await readJsonSafe(response);
  if (!response.ok) {
    throw new Error(extractErrorMessage(body.detail, 'Não foi possível confirmar o Pix recebido.'));
  }
  return body as { status: string; already_approved?: boolean };
}

export async function cancelDirectPixIntent(
  apiBaseUrl: string,
  authHeaders: Record<string, string>,
  intentId: string,
): Promise<{ status: string; message?: string }> {
  const response = await authFetch(`${apiBaseUrl}/payments/direct-pix/${encodeURIComponent(intentId)}/cancel`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ checked_no_receipt: true }),
  });
  const body = await readJsonSafe(response);
  if (!response.ok) {
    throw new Error(extractErrorMessage(body.detail, 'Não foi possível cancelar a tentativa de Pix.'));
  }
  return body as { status: string; message?: string };
}
