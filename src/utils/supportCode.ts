import { API_BASE_URL } from "../config/api";
import { isAbortOrCancellation, operationalArea, operationalEndpoint } from "../analytics/operational";

export const SUPPORT_ERROR_EVENT = "koma:support-error";
export const OPEN_SUPPORT_WIDGET_EVENT = "koma:open-support-widget";
export const RECENT_API_ERRORS_KEY = "koma_recent_api_errors";
export const MAX_RECENT_API_ERRORS = 5;
export const RECENT_API_ERROR_TTL_MS = 30 * 60 * 1000;

export interface RecentApiError {
  support_code: string | null;
  status: number;
  endpoint: string;
  area: string;
  at: number;
}

interface ScopedRecentApiErrorBuffer {
  scope: string;
  items: RecentApiError[];
}

const inlineSupportRequests = new WeakSet<Request>();

/** The caller owns the visible error/code; do not overlay a second global notice. */
export function fetchWithInlineSupport(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = new Request(input, init);
  inlineSupportRequests.add(request);
  return window.fetch(request);
}

export function supportCodeFromRequestId(requestId: string | null | undefined): string | null {
  const value = requestId?.trim() || "";
  return /^[A-Za-z0-9_-]{8,64}$/.test(value)
    ? value.slice(0, 12)
    : null;
}

function getStorage(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

export function getCurrentSupportScope(): string {
  const storage = getStorage();
  if (!storage) return "public";
  try {
    const portal = storage.getItem("koma_active_operational_portal");
    const sessionKey = portal === "caixa"
      ? "koma_operator_session_caixa"
      : portal === "garcom"
        ? "koma_operator_session_garcom"
        : null;
    if (!sessionKey) return "public";
    const raw = storage.getItem(sessionKey);
    if (!raw) return "public";
    const parsed = JSON.parse(raw) as { user?: { restaurante_id?: unknown; id?: unknown } };
    const rid = parsed?.user?.restaurante_id;
    const uid = parsed?.user?.id;
    if (rid != null && uid != null) {
      return `${String(rid)}:${String(uid)}`;
    }
  } catch {
    // Ignore invalid storage payload and keep fail-closed scope.
  }
  return "public";
}

function readScopedBuffer(scope: string, now: number): RecentApiError[] {
  const storage = getStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(RECENT_API_ERRORS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ScopedRecentApiErrorBuffer;
    if (!parsed || parsed.scope !== scope || !Array.isArray(parsed.items)) {
      return [];
    }
    return parsed.items.filter(
      (item): item is RecentApiError =>
        Boolean(item)
        && typeof item.endpoint === "string"
        && item.endpoint.startsWith("/")
        && !item.endpoint.includes("?")
        && !item.endpoint.includes("#")
        && typeof item.status === "number"
        && typeof item.area === "string"
        && typeof item.at === "number"
        && Number.isFinite(item.at)
        && now - item.at >= 0
        && now - item.at <= RECENT_API_ERROR_TTL_MS,
    );
  } catch {
    return [];
  }
}

export function recordRecentApiError(
  entry: Omit<RecentApiError, "at"> & { at?: number },
  scope: string = getCurrentSupportScope(),
  now: number = Date.now(),
): RecentApiError[] {
  const cleanEndpoint = entry.endpoint.split("?", 1)[0].split("#", 1)[0].trim();
  if (!cleanEndpoint.startsWith("/")) return [];
  const nextEntry: RecentApiError = {
    support_code: supportCodeFromRequestId(entry.support_code),
    status: Number.isFinite(entry.status) ? entry.status : 0,
    endpoint: cleanEndpoint.slice(0, 160),
    area: String(entry.area || "other").slice(0, 48),
    at: typeof entry.at === "number" && Number.isFinite(entry.at) ? entry.at : now,
  };
  const existing = readScopedBuffer(scope, now);
  const deduped = existing.filter(
    (item) => !(nextEntry.support_code && item.support_code === nextEntry.support_code),
  );
  const nextItems = [nextEntry, ...deduped].slice(0, MAX_RECENT_API_ERRORS);
  const storage = getStorage();
  if (storage) {
    try {
      storage.setItem(
        RECENT_API_ERRORS_KEY,
        JSON.stringify({ scope, items: nextItems } satisfies ScopedRecentApiErrorBuffer),
      );
    } catch {
      // Storage quota or private browsing must not break API callers.
    }
  }
  return nextItems;
}

export function getRecentApiErrors(
  scope: string = getCurrentSupportScope(),
  now: number = Date.now(),
): RecentApiError[] {
  return readScopedBuffer(scope, now);
}

export function getLatestApiError(
  scope: string = getCurrentSupportScope(),
  now: number = Date.now(),
): RecentApiError | null {
  return readScopedBuffer(scope, now)[0] ?? null;
}

export function clearRecentApiErrors(): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.removeItem(RECENT_API_ERRORS_KEY);
  } catch {
    // Ignore storage removal errors.
  }
}

export function openSupportWidgetWithCode(supportCode?: string | null): void {
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return;
  const clean = supportCodeFromRequestId(supportCode);
  window.dispatchEvent(
    new CustomEvent(OPEN_SUPPORT_WIDGET_EVENT, {
      detail: clean ? { supportCode: clean } : {},
    }),
  );
}

export function installSupportCodeObserver(): void {
  const originalFetch = window.fetch.bind(window);
  const pageUrl = window.location.href;
  const apiOrigin = new URL(API_BASE_URL, window.location.origin).origin;
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const rawUrl = input instanceof Request ? input.url : String(input);
    const safeEndpoint = operationalEndpoint(rawUrl, apiOrigin, pageUrl);
    let response: Response;
    try {
      response = await originalFetch(input, init);
    } catch (error) {
      const signal = init?.signal || (input instanceof Request ? input.signal : null);
      if (safeEndpoint && !isAbortOrCancellation(error, signal, input)) {
        recordRecentApiError({
          support_code: null,
          status: 0,
          endpoint: safeEndpoint,
          area: operationalArea(safeEndpoint),
        });
      }
      throw error;
    }

    if (response.status < 400) return response;

    let url: URL;
    try {
      url = new URL(rawUrl, pageUrl);
    } catch {
      return response;
    }
    if (url.origin !== apiOrigin) return response;

    const requestId = response.headers.get("X-Request-ID");
    const code = supportCodeFromRequestId(requestId);
    if (safeEndpoint) {
      recordRecentApiError({
        support_code: code,
        status: response.status,
        endpoint: safeEndpoint,
        area: operationalArea(safeEndpoint),
      });
    }

    if (response.status < 500 || (input instanceof Request && inlineSupportRequests.has(input))) {
      return response;
    }
    if (code && typeof window.dispatchEvent === "function") {
      window.dispatchEvent(new CustomEvent(SUPPORT_ERROR_EVENT, {
        detail: { code, requestId },
      }));
    }
    return response;
  };
}
