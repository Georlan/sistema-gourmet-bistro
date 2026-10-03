import type { SuperAdminAuditLogEntry } from "./superAdminTypes";

export interface AuditFilters {
  action: string;
  tenant: string;
  actor: string;
  search: string;
  fromDate: string;
  toDate: string;
}

export function filterAuditLogs(logs: SuperAdminAuditLogEntry[], filters: AuditFilters) {
  const search = filters.search.trim().toLocaleLowerCase("pt-BR");
  const start = filters.fromDate ? new Date(`${filters.fromDate}T00:00:00`).getTime() : null;
  const end = filters.toDate ? new Date(`${filters.toDate}T23:59:59.999`).getTime() : null;
  return logs.filter(log => {
    if (filters.action !== "ALL" && log.action !== filters.action) return false;
    if (filters.tenant !== "ALL" && log.restauranteId !== filters.tenant) return false;
    if (filters.actor !== "ALL" && log.actor !== filters.actor) return false;
    if (start !== null || end !== null) {
      const timestamp = log.createdAt ? new Date(log.createdAt).getTime() : NaN;
      if (!Number.isFinite(timestamp)) return false;
      if (start !== null && timestamp < start) return false;
      if (end !== null && timestamp > end) return false;
    }
    return !search || JSON.stringify([
      log.id, log.restauranteId, log.restaurantName, log.actor, log.action,
      log.reason, log.beforeData, log.afterData,
    ]).toLocaleLowerCase("pt-BR").includes(search);
  });
}
