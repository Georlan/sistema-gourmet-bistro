import { Product, Table, Order, SimulatedDeliveryOrder, Motoboy } from '../types';

export const callCaixaApi = async (
  apiBaseUrl: string,
  authHeaders: Record<string, string>,
  endpoint: string,
  options?: RequestInit
) => {
  const url = endpoint.startsWith('http') ? endpoint : `${apiBaseUrl}${endpoint}`;
  const headers = {
    ...authHeaders,
    ...(options?.body ? { 'Content-Type': 'application/json' } : {}),
    ...options?.headers,
  };
  return fetch(url, {
    ...options,
    headers,
  });
};

export const saveFidelityConfig = async (apiBaseUrl: string, authHeaders: any, config: any) => {
  return callCaixaApi(apiBaseUrl, authHeaders, '/fidelidade/config', {
    method: 'POST',
    body: JSON.stringify(config)
  });
};

export const updateCaixaConfiguracoes = async (apiBaseUrl: string, authHeaders: any, updates: any) => {
  return callCaixaApi(apiBaseUrl, authHeaders, '/caixa/configuracoes', {
    method: 'PUT',
    body: JSON.stringify(updates)
  });
};

export const getActiveDeliveryOrders = async (apiBaseUrl: string, authHeaders: any) => {
  return callCaixaApi(apiBaseUrl, authHeaders, '/comandas/delivery/ativos');
};

export const getMotoboysLista = async (apiBaseUrl: string, authHeaders: any) => {
  return callCaixaApi(apiBaseUrl, authHeaders, '/comandas/motoboys/lista');
};

export const updateDeliveryStatus = async (apiBaseUrl: string, authHeaders: any, orderId: string, statusNovo: string) => {
  return callCaixaApi(apiBaseUrl, authHeaders, `/comandas/${orderId}/delivery/status?status_novo=${statusNovo}`, {
    method: 'PUT'
  });
};

export const finalizarPedido = async (apiBaseUrl: string, authHeaders: any, orderId: string) => {
  return callCaixaApi(apiBaseUrl, authHeaders, `/comandas/${orderId}/delivery/status?status_novo=finalizado`, {
    method: 'PUT'
  });
};

export const fecharComanda = async (apiBaseUrl: string, authHeaders: any, orderId: string) => {
  return callCaixaApi(apiBaseUrl, authHeaders, `/comandas/${orderId}/fechar`, {
    method: 'PUT'
  });
};

export const updateItemStatus = async (apiBaseUrl: string, authHeaders: any, itemId: number, status: string) => {
  return callCaixaApi(apiBaseUrl, authHeaders, `/comandas/itens/${itemId}/status?status=${status}`, {
    method: 'PUT'
  });
};

export const despacharPedido = async (apiBaseUrl: string, authHeaders: any, orderId: string, motoboyId: number) => {
  return callCaixaApi(apiBaseUrl, authHeaders, `/comandas/${orderId}/delivery/despachar`, {
    method: 'POST',
    body: JSON.stringify({ motoboy_id: motoboyId })
  });
};

export const cadastrarMotoboy = async (apiBaseUrl: string, authHeaders: any, payload: any) => {
  return callCaixaApi(apiBaseUrl, authHeaders, '/comandas/motoboys/cadastro', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
};

export const getTurnoAtual = async (apiBaseUrl: string, authHeaders: any) => {
  return callCaixaApi(apiBaseUrl, authHeaders, '/caixa/turno/atual');
};

export const getUsuarios = async (apiBaseUrl: string, authHeaders: any) => {
  return callCaixaApi(apiBaseUrl, authHeaders, '/auth/usuarios');
};

export const getCaixaConfiguracoes = async (apiBaseUrl: string, authHeaders: any) => {
  return callCaixaApi(apiBaseUrl, authHeaders, '/caixa/configuracoes');
};

export const getCaixaConfigCardapio = async (apiBaseUrl: string, authHeaders: any) => {
  return callCaixaApi(apiBaseUrl, authHeaders, '/caixa/config-cardapio');
};

export const updateCaixaConfigCardapio = async (apiBaseUrl: string, authHeaders: any, data: any) => {
  return callCaixaApi(apiBaseUrl, authHeaders, '/caixa/config-cardapio', {
    method: 'PUT',
    body: JSON.stringify(data)
  });
};

export const getFidelidadeCliente = async (apiBaseUrl: string, authHeaders: any, phone: string) => {
  return callCaixaApi(apiBaseUrl, authHeaders, `/fidelidade/clientes/${phone}`);
};

export const getFidelidadeClientes = async (apiBaseUrl: string, authHeaders: any) => {
  return callCaixaApi(apiBaseUrl, authHeaders, '/fidelidade/clientes');
};

export const cadastrarFidelidadeCliente = async (apiBaseUrl: string, authHeaders: any, data: any) => {
  return callCaixaApi(apiBaseUrl, authHeaders, '/fidelidade/clientes', {
    method: 'POST',
    body: JSON.stringify(data)
  });
};

export const updateFidelidadeCliente = async (apiBaseUrl: string, authHeaders: any, phone: string, data: any) => {
  return callCaixaApi(apiBaseUrl, authHeaders, `/fidelidade/clientes/${phone}`, {
    method: 'PUT',
    body: JSON.stringify(data)
  });
};

export const getInsumos = async (apiBaseUrl: string, authHeaders: any) => {
  return callCaixaApi(apiBaseUrl, authHeaders, '/estoque/insumos');
};

export const getDistribuidores = async (apiBaseUrl: string, authHeaders: any) => {
  return callCaixaApi(apiBaseUrl, authHeaders, '/estoque/distribuidores');
};

export const saveInsumo = async (apiBaseUrl: string, authHeaders: any, endpoint: string, method: string, data: any) => {
  return callCaixaApi(apiBaseUrl, authHeaders, endpoint, {
    method,
    body: JSON.stringify(data)
  });
};

export const ajustarInsumo = async (apiBaseUrl: string, authHeaders: any, insumoId: number, data: any) => {
  return callCaixaApi(apiBaseUrl, authHeaders, `/estoque/insumos/${insumoId}/ajustar`, {
    method: 'POST',
    body: JSON.stringify(data)
  });
};

export const saveDistribuidor = async (apiBaseUrl: string, authHeaders: any, endpoint: string, method: string, data: any) => {
  return callCaixaApi(apiBaseUrl, authHeaders, endpoint, {
    method,
    body: JSON.stringify(data)
  });
};

export const deletarDistribuidor = async (apiBaseUrl: string, authHeaders: any, distId: number) => {
  return callCaixaApi(apiBaseUrl, authHeaders, `/estoque/distribuidores/${distId}`, {
    method: 'DELETE'
  });
};

export const getProdutos = async (apiBaseUrl: string, authHeaders: any) => {
  return callCaixaApi(apiBaseUrl, authHeaders, '/produtos/');
};

export const getCategorias = async (apiBaseUrl: string, authHeaders: any) => {
  return callCaixaApi(apiBaseUrl, authHeaders, '/produtos/categorias');
};

export const getGarconsRelatorio = async (apiBaseUrl: string, authHeaders: any, start: string, end: string) => {
  return callCaixaApi(apiBaseUrl, authHeaders, `/garcons/relatorio?data_inicio=${start}&data_fim=${end}`);
};

export const getEstatisticasGeral = async (apiBaseUrl: string, authHeaders: any, start: string, end: string) => {
  return callCaixaApi(apiBaseUrl, authHeaders, `/comandas/estatisticas/geral?data_inicio=${start}&data_fim=${end}`);
};

export const getSugestoesEstoque = async (apiBaseUrl: string, authHeaders: any) => {
  return callCaixaApi(apiBaseUrl, authHeaders, '/estoque/sugestoes');
};

export const getNotasEstoque = async (apiBaseUrl: string, authHeaders: any) => {
  return callCaixaApi(apiBaseUrl, authHeaders, '/estoque/notas');
};

export const getEstatisticasPico = async (apiBaseUrl: string, authHeaders: any) => {
  return callCaixaApi(apiBaseUrl, authHeaders, '/comandas/estatisticas/pico');
};

export const getFidelidadeConfig = async (apiBaseUrl: string, authHeaders: any) => {
  return callCaixaApi(apiBaseUrl, authHeaders, '/fidelidade/config');
};

export const abrirCaixa = async (apiBaseUrl: string, authHeaders: any, saldoInicial: number) => {
  return callCaixaApi(apiBaseUrl, authHeaders, '/caixa/turno/abrir', {
    method: 'POST',
    body: JSON.stringify({ saldo_inicial: saldoInicial })
  });
};

export const fecharCaixa = async (apiBaseUrl: string, authHeaders: any, payload: any) => {
  return callCaixaApi(apiBaseUrl, authHeaders, '/caixa/turno/fechar', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
};

export const movimentarCaixa = async (apiBaseUrl: string, authHeaders: any, payload: any) => {
  return callCaixaApi(apiBaseUrl, authHeaders, '/caixa/turno/movimentar', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
};

export const pagarComanda = async (apiBaseUrl: string, authHeaders: any, comandaId: string, payload: any) => {
  return callCaixaApi(apiBaseUrl, authHeaders, `/caixa/comandas/${comandaId}/pagar`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
};

export const getTodasDetalhesComandas = async (apiBaseUrl: string, authHeaders: any) => {
  return callCaixaApi(apiBaseUrl, authHeaders, '/comandas/detalhes/todos?fechada=false');
};

export const cadastrarUsuario = async (apiBaseUrl: string, authHeaders: any, payload: any) => {
  return callCaixaApi(apiBaseUrl, authHeaders, '/auth/usuarios', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
};

export const deletarUsuario = async (apiBaseUrl: string, authHeaders: any, userId: string) => {
  return callCaixaApi(apiBaseUrl, authHeaders, `/auth/usuarios/${userId}`, {
    method: 'DELETE'
  });
};

export const aprovarPagamentoPendente = async (apiBaseUrl: string, authHeaders: any, pagId: number) => {
  return callCaixaApi(apiBaseUrl, authHeaders, `/caixa/pagamentos/${pagId}/aprovar`, {
    method: 'POST'
  });
};

export const recusarPagamentoPendente = async (apiBaseUrl: string, authHeaders: any, pagId: number) => {
  return callCaixaApi(apiBaseUrl, authHeaders, `/caixa/pagamentos/${pagId}/recusar`, {
    method: 'POST'
  });
};

export const abrirComandaPdv = async (apiBaseUrl: string, authHeaders: any, payload: any) => {
  return callCaixaApi(apiBaseUrl, authHeaders, '/comandas/', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
};

export const lancarItensComanda = async (apiBaseUrl: string, authHeaders: any, comandaId: string, payload: any) => {
  return callCaixaApi(apiBaseUrl, authHeaders, `/comandas/${comandaId}/lancamentos`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
};

export const getImpressorasDetectadas = async (apiBaseUrl: string, authHeaders: any) => {
  return callCaixaApi(apiBaseUrl, authHeaders, '/comandas/impressoras/detectadas');
};

export const testeImpressao = async (apiBaseUrl: string, authHeaders: any, payload: any) => {
  return callCaixaApi(apiBaseUrl, authHeaders, '/comandas/teste-impressao', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
};

export const reimprimirLancamento = async (apiBaseUrl: string, authHeaders: any, lancamentoId: string, payload: any) => {
  return callCaixaApi(apiBaseUrl, authHeaders, `/comandas/lancamentos/${lancamentoId}/reimprimir`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
};

export const chatWaiter = async (apiBaseUrl: string, authHeaders: any, payload: any) => {
  return callCaixaApi(apiBaseUrl, authHeaders, '/api/chat-waiter', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
};

export const imprimirReciboMesa = async (
  apiBaseUrl: string,
  authHeaders: any,
  mesaId: number,
  apenasValores: boolean,
  printHeader: string,
  printFooter: string
) => {
  let url = `/mesas/${mesaId}/imprimir-recibo?apenas_valores=${apenasValores}`;
  const params = new URLSearchParams();
  if (printHeader) params.append("print_header", printHeader);
  if (printFooter) params.append("print_footer", printFooter);
  if (params.toString()) url += `&${params.toString()}`;
  return callCaixaApi(apiBaseUrl, authHeaders, url, {
    method: 'POST'
  });
};
