/** Shortcuts open authenticated controls; they never perform an administrative write. */
export function readAdminShortcut(search: string) {
  const params = new URLSearchParams(search);
  const rawTenant = params.get('tenant') || '';
  const tenantId = /^[1-9]\d{0,8}$/.test(rawTenant) ? rawTenant : null;
  const panel = params.get('panel');
  return { tenantId, finance: panel === 'finance', resources: tenantId !== null && panel === 'resources' };
}
