/** View metadata and local defaults only; API permissions remain authoritative. */
export const WAITER_PERMISSIONS = [
  {
    key: 'perm_garcom_delivery',
    group: 'pedido',
    title: 'Permitir que garçom faça lançamentos de pedidos de delivery',
    description: 'Ao ativar, garçons podem criar comandas com canais externos no salão.',
    available: true,
    initial: true,
    overview: true,
  },
  {
    key: 'perm_garcom_editar',
    group: 'pedido',
    title: 'Permitir que Garçons editem pedidos',
    description: 'Permite atualizar observações ou acrescentar itens em comandas já enviadas.',
    available: true,
    initial: true,
    overview: true,
  },
  {
    key: 'perm_garcom_taxas',
    group: 'pedido',
    title: 'Permitir que Garçons editem cobranças adicionais',
    description: 'Permite retirar/colocar taxas extras, como couvert artístico ou consumação mínima.',
    available: false,
    initial: false,
    overview: false,
  },
  {
    key: 'perm_garcom_cancelar',
    group: 'pedido',
    title: 'Permitir que garçons cancelem pedidos',
    description: 'Permite o cancelamento direto de itens pelo aplicativo sem aprovação do gerente.',
    available: true,
    initial: false,
    overview: true,
  },
  {
    key: 'perm_garcom_status',
    group: 'pedido',
    title: 'Permitir exibição de status de pedidos no mapa de mesas',
    description: "Gera ícones de produção ('Em preparo', 'Pronto') sobre as mesas no mapa.",
    available: true,
    initial: true,
    overview: true,
  },
  {
    key: 'perm_garcom_abrir_vazia',
    group: 'pedido',
    title: 'Permitir que garçons abram comandas sem pedido',
    description: "Permite reservar uma mesa com status 'ocupada' sem lançar nenhum item.",
    available: false,
    initial: false,
    overview: false,
  },
  {
    key: 'perm_garcom_print',
    group: 'pedido',
    title: 'Permitir impressão automática dos pedidos feitos pelo Garçom',
    description: 'Dispara a via térmica de produção no balcão imediatamente após o garçom confirmar.',
    available: true,
    initial: true,
    overview: true,
  },
  {
    key: 'perm_garcom_fechar',
    group: 'fechamento',
    title: 'Permitir que Garçom feche a conta',
    description: 'Autoriza o garçom a encerrar a mesa e dar a baixa definitiva no consumo.',
    available: true,
    initial: false,
    overview: true,
  },
  {
    key: 'perm_garcom_desconto',
    group: 'fechamento',
    title: 'Permitir que Garçom aplique desconto',
    description: 'Habilita a aplicação de porcentagem de desconto na conta final direto pelo aplicativo.',
    available: false,
    initial: false,
    overview: false,
  },
  {
    key: 'perm_garcom_acrescimo',
    group: 'fechamento',
    title: 'Permitir que Garçom aplique acréscimo',
    description: 'Habilita a adição de valores extras ou gorjetas no fechamento da conta pelo app.',
    available: false,
    initial: false,
    overview: false,
  },
  {
    key: 'perm_garcom_pessoas',
    group: 'atendimento',
    title: 'Permitir que o garçom informe quantas pessoas vão sentar à mesa',
    description: 'Abre pergunta inicial na abertura da mesa para cálculo automático do consumo/taxa individual.',
    available: false,
    initial: true,
    overview: false,
  },
  {
    key: 'perm_garcom_transferir_mesa',
    group: 'atendimento',
    title: 'Permitir que Garçom transfira mesas e comandas',
    description: 'Permite realocar todo o consumo de uma mesa para outra mesa vazia.',
    available: true,
    initial: true,
    overview: true,
  },
  {
    key: 'perm_garcom_transferir_item',
    group: 'atendimento',
    title: 'Permitir que Garçom transfira pedidos e pagamentos para mesas ocupadas',
    description: 'Mover itens isolados ou repassar contas a pagar entre comanda de clientes sentados.',
    available: true,
    initial: true,
    overview: true,
  },
  {
    key: 'perm_garcom_chamar',
    group: 'atendimento',
    title: 'Permitir que Cliente chame Garçom na mesa',
    description: 'Dispara notificações no painel do garçom se o cliente apertar o botão no cardápio digital QR Code.',
    available: false,
    initial: false,
    overview: false,
  },
  {
    key: 'perm_garcom_ociosas',
    group: 'atendimento',
    title: 'Permitir exibição de mesas ociosas',
    description: 'Destaca no mapa mesas sem novos pedidos há mais tempo.',
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
