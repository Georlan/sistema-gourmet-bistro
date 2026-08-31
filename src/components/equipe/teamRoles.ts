/** Display metadata only. Server authorization remains the authority. */
export const canonicalRoleSlug = (role: string) => role === 'operador_caixa' ? 'caixa' : role;

export const ROLE_META: Record<string, { label: string; description: string; permissionDescription: string }> = {
  admin: {
    label: 'Administrador',
    description: 'Acesso completo à gestão do restaurante.',
    permissionDescription: 'Configura toda a operação e possui acesso completo.',
  },
  gerente: {
    label: 'Gerente',
    description: 'Acompanha operação, caixa, relatórios e equipe.',
    permissionDescription: 'Acompanha resultados, caixa e gestão da equipe.',
  },
  caixa: {
    label: 'Operador de caixa',
    description: 'Opera vendas, recebimentos e rotinas do caixa.',
    permissionDescription: 'Opera pedidos, recebimentos e rotinas do caixa.',
  },
  garcom: {
    label: 'Garçom',
    description: 'Abre pedidos e acompanha o atendimento do salão.',
    permissionDescription: 'Registra pedidos e acompanha o atendimento do salão.',
  },
  atendente: {
    label: 'Atendente',
    description: 'Registra e acompanha pedidos da operação.',
    permissionDescription: 'Registra e acompanha pedidos da operação.',
  },
  cozinha: {
    label: 'Cozinha',
    description: 'Acompanha o preparo dos itens.',
    permissionDescription: 'Visualiza somente o fluxo de preparo.',
  },
  motoboy: {
    label: 'Entregador',
    description: 'Acompanha somente as entregas atribuídas.',
    permissionDescription: 'Acompanha as entregas atribuídas.',
  },
};
export const ROLE_ORDER = Object.keys(ROLE_META);
