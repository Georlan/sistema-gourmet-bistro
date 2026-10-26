import { API_BASE_URL } from "../config/api";

export const SUPPORT_ERROR_EVENT = "koma:support-error";
const inlineSupportRequests = new WeakSet<Request>();

/** The caller owns the visible error/code; do not overlay a second global notice. */
export function fetchWithInlineSupport(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = new Request(input, init);
  inlineSupportRequests.add(request);
  return window.fetch(request);
}

export function supportCodeFromRequestId(requestId: string | null): string | null {
  const value = requestId?.trim() || "";
  return /^[A-Za-z0-9_-]{8,64}$/.test(value)
    ? value.slice(0, 12)
    : null;
}

export function installSupportCodeObserver(): void {
  const originalFetch = window.fetch.bind(window);
  const apiOrigin = new URL(API_BASE_URL).origin;
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const response = await originalFetch(input, init);
    if (response.status < 500 || (input instanceof Request && inlineSupportRequests.has(input))) return response;
    let url: URL;
    try {
      url = new URL(input instanceof Request ? input.url : String(input), window.location.href);
    } catch { return response; }
    if (url.origin !== apiOrigin) return response;
    const requestId = response.headers.get("X-Request-ID");
    const code = supportCodeFromRequestId(requestId);
    if (code) window.dispatchEvent(new CustomEvent(SUPPORT_ERROR_EVENT, {
      detail: { code, requestId },
    }));
    return response;
  };
}
