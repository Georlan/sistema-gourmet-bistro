/** View metadata and local defaults only; API permissions remain authoritative. */
export const WAITER_PERMISSIONS = [
  {
    key: 'perm_garcom_delivery',
    group: 'pedido',
    title: 'Criar pedidos de delivery',
    description: 'Permite ao garçom lançar pedidos de delivery diretamente pelo app.',
    available: true,
    initial: true,
    overview: true,
  },
  {
    key: 'perm_garcom_editar',
    group: 'pedido',
    title: 'Editar pedidos em andamento',
    description: 'Permite atualizar observações ou acrescentar itens em comandas já enviadas.',
    available: true,
    initial: true,
    overview: true,
  },
  {
    key: 'perm_garcom_taxas',
    group: 'pedido',
    title: 'Alterar cobranças adicionais',
    description: 'Permitirá ajustar cobranças extras, como couvert ou consumação mínima.',
    available: false,
    initial: false,
    overview: false,
  },
  {
    key: 'perm_garcom_cancelar',
    group: 'pedido',
    title: 'Cancelar itens e pedidos',
    description: 'Permite cancelar diretamente pelo app sem aprovação do gerente.',
    available: true,
    initial: false,
    overview: true,
  },
  {
    key: 'perm_garcom_status',
    group: 'pedido',
    title: 'Ver status de preparo nas mesas',
    description: 'Mostra no mapa quando o pedido está em preparo ou pronto.',
    available: true,
    initial: true,
    overview: true,
  },
  {
    key: 'perm_garcom_abrir_vazia',
    group: 'pedido',
    title: 'Abrir mesa sem lançar itens',
    description: 'Permitirá ocupar uma mesa antes de registrar o primeiro item.',
    available: false,
    initial: false,
    overview: false,
  },
  {
    key: 'perm_garcom_print',
    group: 'pedido',
    title: 'Imprimir pedido automaticamente',
    description: 'Envia a via térmica de produção assim que o garçom confirma o pedido.',
    available: true,
    initial: true,
    overview: true,
  },
  {
    key: 'perm_garcom_fechar',
    group: 'fechamento',
    title: 'Fechar conta pelo app',
    description: 'Autoriza o garçom a encerrar a mesa e concluir o consumo.',
    available: true,
    initial: false,
    overview: true,
  },
  {
    key: 'perm_garcom_desconto',
    group: 'fechamento',
    title: 'Aplicar desconto',
    description: 'Permitirá aplicar desconto na conta final diretamente pelo app.',
    available: false,
    initial: false,
    overview: false,
  },
  {
    key: 'perm_garcom_acrescimo',
    group: 'fechamento',
    title: 'Aplicar acréscimo',
    description: 'Permitirá adicionar valores extras no fechamento da conta pelo app.',
    available: false,
    initial: false,
    overview: false,
  },
  {
    key: 'perm_garcom_pessoas',
    group: 'atendimento',
    title: 'Informar número de pessoas',
    description: 'Permitirá registrar quantas pessoas estão na mesa durante a abertura.',
    available: false,
    initial: true,
    overview: false,
  },
  {
    key: 'perm_garcom_transferir_mesa',
    group: 'atendimento',
    title: 'Transferir mesa ou comanda',
    description: 'Permite mover todo o consumo de uma mesa para outra mesa vazia.',
    available: true,
    initial: true,
    overview: true,
  },
  {
    key: 'perm_garcom_transferir_item',
    group: 'atendimento',
    title: 'Transferir itens entre mesas',
    description: 'Permite mover itens ou valores em aberto entre comandas de mesas ocupadas.',
    available: true,
    initial: true,
    overview: true,
  },
  {
    key: 'perm_garcom_chamar',
    group: 'atendimento',
    title: 'Receber chamado do cliente',
    description: 'Permitirá receber no app chamados feitos pelo cardápio digital da mesa.',
    available: false,
    initial: false,
    overview: false,
  },
  {
    key: 'perm_garcom_ociosas',
    group: 'atendimento',
    title: 'Destacar mesas sem novos pedidos',
    description: 'Permitirá sinalizar no mapa as mesas que estão há mais tempo sem novos pedidos.',
    available: false,
    initial: true,
    overview: false,
  },
] as const;
export type WaiterPermissionKey = typeof WAITER_PERMISSIONS[number]['key'];
export type WaiterPermissions = Record<WaiterPermissionKey, boolean | undefined>;

export const DEFAULT_WAITER_PERMISSIONS = Object.fromEntries(
  WAITER_PERMISSIONS.map(({ key, initial }) => [key, initial]),
) as WaiterPermissions;

export function readWaiterPermissions(data: Partial<WaiterPermissions>): WaiterPermissions {
  return Object.fromEntries(WAITER_PERMISSIONS.map(({ key }) => [key, data[key]])) as WaiterPermissions;
}

export function patchWaiterPermissions(current: WaiterPermissions, updates: Partial<WaiterPermissions>): WaiterPermissions {
  const next = { ...current };
  for (const { key } of WAITER_PERMISSIONS) {
    if (updates[key] !== undefined) next[key] = updates[key];
  }
  return next;
}
