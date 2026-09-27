import { API_BASE_URL } from "../config/api";

export const SUPPORT_ERROR_EVENT = "koma:support-error";

export function supportCodeFromRequestId(requestId: string | null): string | null {
  const value = requestId?.trim() || "";
  return /^[a-fA-F0-9]{32}$/.test(value) || /^[a-fA-F0-9-]{36}$/.test(value)
    ? value.slice(0, 12)
    : null;
}

export function installSupportCodeObserver(): void {
  const originalFetch = window.fetch.bind(window);
  const apiOrigin = new URL(API_BASE_URL).origin;
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const response = await originalFetch(input, init);
    if (response.status < 500) return response;
    const requestUrl = input instanceof Request ? input.url : String(input);
    if (new URL(requestUrl, window.location.href).origin !== apiOrigin) return response;
    const requestId = response.headers.get("X-Request-ID");
    const code = supportCodeFromRequestId(requestId);
    if (code) window.dispatchEvent(new CustomEvent(SUPPORT_ERROR_EVENT, {
      detail: { code, requestId },
    }));
    return response;
  };
}
