/** Groups display-only attention cards; individual evidence and actions stay in Operação. */
export function summarizeIncidents<T extends {
  tenant_id: number; source: string; severity: string; title: string; recommended_action: string;
}>(incidents: readonly T[]): Array<{ incident: T; count: number }> {
  const groups = new Map<string, { incident: T; count: number }>();
  for (const incident of incidents) {
    const key = JSON.stringify([incident.tenant_id, incident.source, incident.severity, incident.title, incident.recommended_action]);
    const group = groups.get(key);
    if (group) group.count++;
    else groups.set(key, { incident, count: 1 });
  }
  return [...groups.values()];
}
