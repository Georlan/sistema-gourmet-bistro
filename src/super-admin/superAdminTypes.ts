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
}

export interface FailedWebhook {
  id: string;
  tenantName: string;
  orderId: string;
  event: string;
  amount: number;
  errorReason: string;
  createdAt: string;
  resolved: boolean;
}

export interface ActiveDevice {
  restaurantId: string;
  restaurantName: string;
  device: "Painel do Caixa" | "Printer Gateway";
  status: "CONNECTED" | "DISCONNECTED";
  ip: string;
}

export interface CredentialsStatus {
  cloudflare?: { configured: boolean };
  railway?: { configured: boolean };
  github?: { configured: boolean };
  telegram?: { configured: boolean };
  supabase?: { configured: boolean };
}

export interface IntegrationsHealthStatus {
  database?: {
    status: "available" | "unavailable" | "unknown";
    latency_ms?: number;
    source?: string;
  };
  supabase?: { status: string };
  cloudflare?: { status: string };
  railway?: { status: string };
  github?: { status: string };
  telegram?: { status: string };
  evolution?: { status: string; details?: unknown };
}
