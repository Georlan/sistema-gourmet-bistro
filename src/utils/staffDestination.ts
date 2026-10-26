export type OperationalPortal = 'caixa' | 'garcom';
export type StaffDestination = OperationalPortal | 'entregador';

export function resolveStaffDestination(role: unknown): StaffDestination | null {
  switch (String(role || '').trim().toLowerCase()) {
    case 'garcom': return 'garcom';
    case 'motoboy': return 'entregador';
    case 'admin': case 'gerente': case 'caixa': case 'atendente': case 'cozinha': return 'caixa';
    default: return null;
  }
}

export function normalizeStaffRole(user: { role?: unknown; cargo?: unknown }): string {
  return String(user.role || user.cargo || '').trim().toLowerCase();
}

export function resolveOperationalPortal(user: { role?: unknown; cargo?: unknown }): OperationalPortal | null {
  const destination = resolveStaffDestination(normalizeStaffRole(user));
  return destination === 'caixa' || destination === 'garcom' ? destination : null;
}

export function parseStaffLogin(data: unknown) {
  const payload = data as Record<string, unknown> | null;
  const user = payload?.usuario as Record<string, unknown> | null;
  if (typeof payload?.access_token !== 'string' || !payload.access_token.trim()
    || !user || !['string', 'number'].includes(typeof user.id) || !String(user.id).trim()
    || typeof user.nome !== 'string' || !user.nome.trim()
    || !Number.isInteger(user.restaurante_id) || Number(user.restaurante_id) <= 0) {
    throw new Error('A resposta de autenticação está incompleta. Tente novamente.');
  }
  const role = normalizeStaffRole(user);
  const destination = resolveStaffDestination(role);
  if (!destination) throw new Error('Este perfil ainda não possui uma área operacional disponível neste aplicativo.');
  return {
    token: payload.access_token, destination,
    user: {
      id: user.id as string | number, nome: user.nome.trim(), role,
      ...(typeof user.cargo === 'string' ? { cargo: user.cargo } : {}),
      restaurante_id: Number(user.restaurante_id),
    },
  };
}
