import type { DraftItem } from '../../../types';
import { getOperatorSession, type OperationalPortal } from '../../../utils/authSession';

export type OperationalDraftMap = Record<number, DraftItem[]>;

export const LEGACY_OPERATIONAL_DRAFTS_KEY = 'koma_drafts_vFinal_v3';
const OPERATIONAL_DRAFTS_KEY_PREFIX = 'koma_drafts_v4';

const browserStorage = (): Storage | null => {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  return window.localStorage;
};

export function buildOperationalDraftStorageKey(
  restauranteId: number | null | undefined,
  operatorId: string | number | null | undefined,
): string | null {
  const tenantId = Number(restauranteId);
  const operator = String(operatorId ?? '').trim();
  if (!Number.isInteger(tenantId) || tenantId <= 0 || !operator) return null;
  return `${OPERATIONAL_DRAFTS_KEY_PREFIX}:${tenantId}:${operator}`;
}

export function resolveOperationalDraftStorageKey(portal?: OperationalPortal): string | null {
  const session = getOperatorSession(portal);
  return buildOperationalDraftStorageKey(session?.user?.restaurante_id, session?.user?.id);
}

function sanitizeDraftMap(value: unknown): OperationalDraftMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  const safe: OperationalDraftMap = {};
  for (const [rawTableId, rawItems] of Object.entries(value as Record<string, unknown>)) {
    const tableId = Number(rawTableId);
    if (!Number.isInteger(tableId) || tableId <= 0 || !Array.isArray(rawItems)) continue;
    safe[tableId] = rawItems as DraftItem[];
  }
  return safe;
}

export function readOperationalDraftsForKey(
  storageKey: string | null,
  storage: Storage | null = browserStorage(),
): OperationalDraftMap {
  if (!storageKey || !storage) return {};

  // The legacy key had no tenant boundary. Never infer which tenant owns it.
  storage.removeItem(LEGACY_OPERATIONAL_DRAFTS_KEY);

  try {
    const raw = storage.getItem(storageKey);
    return raw ? sanitizeDraftMap(JSON.parse(raw)) : {};
  } catch (error) {
    console.error('Error loading tenant-scoped drafts from localStorage', error);
    return {};
  }
}

export function writeOperationalDraftsForKey(
  storageKey: string | null,
  drafts: OperationalDraftMap,
  storage: Storage | null = browserStorage(),
): boolean {
  if (!storageKey || !storage) return false;

  storage.removeItem(LEGACY_OPERATIONAL_DRAFTS_KEY);
  storage.setItem(storageKey, JSON.stringify(drafts));
  return true;
}

export function readOperationalDrafts(
  portal?: OperationalPortal,
  storage: Storage | null = browserStorage(),
): OperationalDraftMap {
  return readOperationalDraftsForKey(resolveOperationalDraftStorageKey(portal), storage);
}
