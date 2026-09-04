export interface PendingOrderSubmission {
  key: string;
  fingerprint: string;
  createdAt: number;
}

export interface PendingOrderSubmissionStore {
  submissions: PendingOrderSubmission[];
}

export const MAX_PENDING_ORDER_SUBMISSIONS = 8;

interface ResolveOrderSubmissionKeyInput {
  fingerprint: string;
  now: number;
  ttlMs: number;
  pending: PendingOrderSubmission | null;
  currentKey: string;
  currentFingerprint: string | null;
  createKey: () => string;
}

export function buildOrderSubmissionFingerprint(request: Record<string, unknown>): string {
  return JSON.stringify(request);
}

export function normalizePendingOrderSubmissions(
  stored: unknown,
  now: number,
  ttlMs: number,
): PendingOrderSubmission[] {
  const legacy = stored as Partial<PendingOrderSubmission> | null;
  const store = stored as Partial<PendingOrderSubmissionStore> | null;
  const candidates = Array.isArray(store?.submissions)
    ? store.submissions
    : legacy?.key && legacy?.fingerprint
      ? [legacy]
      : [];
  const newestByFingerprint = new Map<string, PendingOrderSubmission>();

  for (const candidate of candidates) {
    const createdAt = Number(candidate?.createdAt);
    const age = now - createdAt;
    if (
      typeof candidate?.key !== 'string'
      || !candidate.key
      || typeof candidate.fingerprint !== 'string'
      || !candidate.fingerprint
      || !Number.isFinite(createdAt)
      || age < 0
      || age > ttlMs
    ) {
      continue;
    }
    const current = newestByFingerprint.get(candidate.fingerprint);
    if (!current || createdAt > current.createdAt) {
      newestByFingerprint.set(candidate.fingerprint, {
        key: candidate.key,
        fingerprint: candidate.fingerprint,
        createdAt,
      });
    }
  }

  return [...newestByFingerprint.values()]
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, MAX_PENDING_ORDER_SUBMISSIONS);
}

export function upsertPendingOrderSubmission(
  submissions: PendingOrderSubmission[],
  submission: PendingOrderSubmission,
  now: number,
  ttlMs: number,
): PendingOrderSubmission[] {
  return normalizePendingOrderSubmissions(
    { submissions: [submission, ...submissions.filter((item) => item.fingerprint !== submission.fingerprint)] },
    now,
    ttlMs,
  );
}

export function resolveOrderSubmissionKey({
  fingerprint,
  now,
  ttlMs,
  pending,
  currentKey,
  currentFingerprint,
  createKey,
}: ResolveOrderSubmissionKeyInput): string {
  const pendingAge = pending === null ? Number.POSITIVE_INFINITY : now - pending.createdAt;
  const pendingIsFresh = pending !== null
    && Number.isFinite(pending.createdAt)
    && pendingAge >= 0
    && pendingAge <= ttlMs;
  if (pendingIsFresh && pending.key && pending.fingerprint === fingerprint) {
    return pending.key;
  }
  if (currentKey && currentFingerprint === fingerprint) {
    return currentKey;
  }
  return createKey();
}
