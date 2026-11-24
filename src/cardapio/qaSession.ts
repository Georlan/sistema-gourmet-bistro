export const QA_TOKEN_STORAGE_KEY = 'koma_qa_token';
const VALID_QA_TOKEN_RE = /^\d+\.[A-Za-z0-9_-]{16,128}$/;

function getTabStorage(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

export function isValidQaTokenSyntax(raw: string | null | undefined): raw is string {
  return typeof raw === 'string' && VALID_QA_TOKEN_RE.test(raw.trim());
}

export function getQaToken(): string | null {
  const storage = getTabStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(QA_TOKEN_STORAGE_KEY);
    return isValidQaTokenSyntax(raw) ? raw.trim() : null;
  } catch {
    return null;
  }
}

export function clearQaToken(): void {
  const storage = getTabStorage();
  if (!storage) return;
  try {
    storage.removeItem(QA_TOKEN_STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
}

export function captureQaTokenFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const url = new URL(window.location.href);
    const param = url.searchParams.get('qa_token');
    if (param === null) return getQaToken();

    const trimmed = param.trim();
    url.searchParams.delete('qa_token');
    const cleanUrl = `${url.pathname}${url.searchParams.toString() ? `?${url.searchParams.toString()}` : ''}${url.hash}`;
    try {
      window.history.replaceState(window.history.state, '', cleanUrl);
    } catch {
      // Ignore history replacement restrictions in constrained WebViews.
    }

    if (!isValidQaTokenSyntax(trimmed)) {
      clearQaToken();
      return null;
    }
    const storage = getTabStorage();
    storage?.setItem(QA_TOKEN_STORAGE_KEY, trimmed);
    return trimmed;
  } catch {
    return getQaToken();
  }
}

export function getQaRequestHeaders(): Record<string, string> {
  const token = getQaToken();
  return token ? { 'X-Koma-QA-Token': token } : {};
}
