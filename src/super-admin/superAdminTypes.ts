export interface Tenant {
  id: string;
  name: string;
  subdomain: string;
  plan: "Pocket" | "Pro" | "Bistro" | "Delivery" | "Premium";
  monthlyOrders: number;
  monthlyBilling: number;
  status: "ACTIVE" | "SUSPENDED" | "PENDING";
  createdAt: string;
  lastActivity?: string;
  printerStatus?: "online" | "offline";
  failedWebhooksCount24h?: number;
  healthStatus?: "green" | "yellow" | "red";
  onlinePaymentStatus?: "connected" | "disconnected" | "pending";
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
