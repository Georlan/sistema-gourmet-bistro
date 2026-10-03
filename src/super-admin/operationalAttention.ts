export type AttentionPriority = "critical" | "incident" | "blocked" | "unverified" | "no_attention";
export interface OperationalAttention {
  tenant_id: string;
  priority: AttentionPriority;
  blockers: string[];
  release_state: string | null;
  incident_count: number;
  incident_sources: string[];
  primary_incident: { id: string; source: string; severity: string; title: string; detected_at: string; recommended_action: string } | null;
  unavailable_sources: string[];
}
export const attentionLabels: Record<AttentionPriority, string> = {
  critical: "Crítico", incident: "Incidente detectado", blocked: "Implantação pendente",
  unverified: "Não verificado", no_attention: "Sem atenção detectada",
};
const order: Record<AttentionPriority, number> = { critical: 0, incident: 1, blocked: 2, unverified: 3, no_attention: 4 };
export function compareAttention(a?: OperationalAttention, b?: OperationalAttention) {
  return order[a?.priority || "unverified"] - order[b?.priority || "unverified"];
}
export function matchesAttention(item: OperationalAttention | undefined, filter: string) {
  if (filter === "ALL") return true;
  if (filter === "unverified") return !item || item.priority === "unverified" || item.unavailable_sources.length > 0;
  return item?.priority === filter || Boolean(item?.incident_sources.includes(filter));
}
