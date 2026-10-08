export interface Tenant {
  id: string;
  name: string;
  subdomain?: string;
  plan: "Pocket" | "Pro" | "Bistro" | "Delivery" | "Premium" | string;
  monthlyOrders?: number | null;
  monthlyBilling?: number | null;
  status: "ACTIVE" | "SUSPENDED" | "PENDING" | string;
  createdAt?: string | null;
  lastActivity?: string | null;
  printerStatus?: "online" | "offline" | null;
  failedWebhooksCount24h?: number | null;
  healthStatus?: "green" | "yellow" | "red" | null;
  onlinePaymentStatus?: "connected" | "disconnected" | "pending" | string | null;
  billing?: {status:string; open_total:string; open_count:number; due_at:string|null; subscription_status:string; subscription_due_at:string|null};
}

export interface ActiveDevice {
  restaurantId: string;
  restaurantName: string;
  device: "Painel do Caixa" | "Printer Gateway";
  status: "CONNECTED" | "DISCONNECTED";
  ip: string;
}

export interface CredentialsStatus {
  mercado_pago?: { configured: boolean };
  cloudflare?: { configured: boolean };
  railway?: { configured: boolean };
  github?: { configured: boolean };
  telegram?: { configured: boolean };
  supabase?: { configured: boolean };
}

export interface IntegrationsHealthStatus {
  runtime?: {
    status: string;
    environment?: string;
    source?: string;
  };
  database?: {
    status: "available" | "unavailable" | "unknown";
    latency_ms?: number;
    source?: string;
  };
  supabase?: { status: string };
  cloudflare?: { status: string };
  railway?: { status: string; hosting_detected?: boolean };
  github?: { status: string };
  mercado_pago?: { status: string };
  telegram?: { status: string };
  evolution?: {
    status: "available" | "degraded" | "unavailable" | "not_configured" | string;
    details?: {
      configured?: boolean;
      connected?: boolean;
      status?: string;
      details?: string;
    };
  };
}

export interface TelegramHealthStatus {
  status: "verified" | "unavailable" | "unverified" | "not_configured";
  checks: Record<string, string>;
  checked_at: string;
  delivery_status: "not_tested";
  detail: string;
}

export interface SuperAdminAuditLogEntry {
  id: string;
  restauranteId: string;
  restaurantName: string;
  actor: string;
  action: string;
  reason: string;
  beforeData?: Record<string, unknown> | null;
  afterData?: Record<string, unknown> | null;
  createdAt?: string | null;
}
