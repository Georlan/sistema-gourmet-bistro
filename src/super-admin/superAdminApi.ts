import { API_BASE_URL } from "../config/api";

export const SUPER_ADMIN_TOKEN_KEY = "koma_super_admin_token";
export const SUPER_ADMIN_AUTH_REQUIRED_EVENT = "koma:super-admin-auth-required";

type ErrorPayload = {
  detail?: unknown;
  error?: unknown;
  message?: unknown;
};

export class SuperAdminApiError extends Error {
  readonly status: number | null;
  readonly unavailable: boolean;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "SuperAdminApiError";
    this.status = status;
    this.unavailable = status === 501 || status === 503;
  }
}

const apiBaseUrl = API_BASE_URL.replace(/\/+$/, "");

export function superAdminApiUrl(path: string): string {
  if (!path.startsWith("/")) {
    throw new Error("O caminho da API deve começar com '/'.");
  }
  return `${apiBaseUrl}${path}`;
}

export function getSuperAdminToken(): string | null {
  try {
    const value = window.sessionStorage.getItem(SUPER_ADMIN_TOKEN_KEY)?.trim();
    return value || null;
  } catch {
    return null;
  }
}

export function setSuperAdminToken(token: string): void {
  const normalized = token.trim();
  if (!normalized) {
    throw new Error("Token de SuperAdmin vazio.");
  }
  window.sessionStorage.setItem(SUPER_ADMIN_TOKEN_KEY, normalized);
}

function notifyAuthenticationRequired(): void {
  window.dispatchEvent(new Event(SUPER_ADMIN_AUTH_REQUIRED_EVENT));
}

export function clearSuperAdminSession(options: { notify?: boolean } = {}): void {
  try {
    window.sessionStorage.removeItem(SUPER_ADMIN_TOKEN_KEY);
  } catch {
    // The gate still needs to close even if storage is unavailable.
  } finally {
    if (options.notify !== false) {
      notifyAuthenticationRequired();
    }
  }
}

async function responseError(response: Response): Promise<SuperAdminApiError> {
  let payload: ErrorPayload = {};
  try {
    payload = await response.clone().json() as ErrorPayload;
  } catch {
    // Some gateways return an empty or non-JSON error body.
  }

  const detail = [payload.detail, payload.error, payload.message]
    .find(value => typeof value === "string" && value.trim()) as string | undefined;

  if (response.status === 501 || response.status === 503) {
    return new SuperAdminApiError(
      `Indisponível: ${detail || "esta capacidade ainda não está configurada no servidor."}`,
      response.status,
    );
  }

  if (response.status === 401) {
    return new SuperAdminApiError("Sessão expirada ou credenciais inválidas.", response.status);
  }

  if (response.status === 403) {
    return new SuperAdminApiError("Acesso negado: a sessão não possui permissão de SuperAdmin.", response.status);
  }

  return new SuperAdminApiError(detail || `A API respondeu HTTP ${response.status}.`, response.status);
}

function hasSimulationMarker(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasSimulationMarker);
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (record.dataStatus === "simulated" || record.simulated === true) return true;
  return Object.values(record).some(hasSimulationMarker);
}

async function checkedFetch(
  url: string,
  init: RequestInit,
  options: { rejectSimulated?: boolean } = {},
): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "falha de rede";
    throw new SuperAdminApiError(`API indisponível: ${reason}`);
  }

  if (response.ok && options.rejectSimulated) {
    let payload: unknown;
    try {
      payload = await response.clone().json();
    } catch {
      payload = undefined;
    }
    if (hasSimulationMarker(payload)) {
      throw new SuperAdminApiError(
        "Indisponível: o servidor devolveu dados simulados; nenhuma operação foi confirmada como real.",
        503,
      );
    }
  }

  if (response.ok) {
    return response;
  }

  const apiError = await responseError(response);
  if (response.status === 401 || response.status === 403) {
    clearSuperAdminSession();
  }
  throw apiError;
}

function requestHeaders(initHeaders: HeadersInit | undefined, token?: string): Headers {
  const headers = new Headers(initHeaders);
  headers.set("Accept", "application/json");
  if (token) {
    // Always replace any caller-provided Authorization value with the dedicated session token.
    headers.set("Authorization", `Bearer ${token}`);
  }
  return headers;
}

export async function superAdminFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = getSuperAdminToken();
  if (!token) {
    notifyAuthenticationRequired();
    throw new SuperAdminApiError("Sessão de SuperAdmin ausente.", 401);
  }

  return checkedFetch(
    superAdminApiUrl(path),
    {
      ...init,
      cache: init.cache ?? "no-store",
      headers: requestHeaders(init.headers, token),
    },
    { rejectSimulated: true },
  );
}

export async function publicApiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return checkedFetch(superAdminApiUrl(path), {
    ...init,
    cache: init.cache ?? "no-store",
    headers: requestHeaders(init.headers),
  });
}

export async function loginSuperAdmin(username: string, password: string): Promise<void> {
  const response = await publicApiFetch("/api/super-admin/token", {
    method: "POST",
    credentials: "omit",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const payload = await response.json() as { access_token?: unknown; token_type?: unknown };
  if (
    typeof payload.access_token !== "string"
    || !payload.access_token.trim()
    || (typeof payload.token_type === "string" && payload.token_type.toLowerCase() !== "bearer")
  ) {
    throw new SuperAdminApiError("A API não retornou uma sessão válida.", response.status);
  }
  setSuperAdminToken(payload.access_token);
}

export function superAdminErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Falha inesperada ao comunicar com a API.";
}
