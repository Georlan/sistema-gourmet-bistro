import { readCheckLaunchIdentities } from '../../../domain/orderIdentity';
import type { Order, Product } from '../../../types';
import { parseBackendTimestamp } from '../../../utils/dateTime';

const parseBackendDateTime = (dateStr: any): number =>
  parseBackendTimestamp(dateStr)?.getTime() ?? Date.now();

const readOperationalOrigin = (comanda: any): NonNullable<Order['origemOperacional']> => {
  const origins = (Array.isArray(comanda?.lancamentos) ? comanda.lancamentos : []).map((launch: any) =>
    String(launch?.origem || '').toLowerCase(),
  );
  if (origins.includes('smartpos')) return 'smartpos';
  if (origins.includes('cardapio')) return 'cardapio';
  if (origins.includes('caixa')) return 'caixa';
  if (origins.includes('garcom')) return 'garcom';
  return 'desconhecida';
};

/**
 * Normaliza a comanda compartilhada preservando, também nos itens, o contexto
 * operacional que Caixa e KDS precisam reconhecer da mesma forma.
 * O overlay otimista continua pertencendo ao hook operacional, que é o dono do cache.
 */
export function mapBackendComandaToOperationalOrder({
  comanda,
  liveProdutos,
}: {
  comanda: any;
  liveProdutos: readonly Product[];
}): Order {
  const launchIdentities = readCheckLaunchIdentities(comanda);
  const numeroPedido = Number.isFinite(Number(comanda.numero_pedido))
    ? Number(comanda.numero_pedido)
    : undefined;
  const origemOperacional = readOperationalOrigin(comanda);
  const tipo = comanda.tipo as Order['tipo'];
  const identificador = comanda.identificador || undefined;

  return {
    launchIdentities,
    id: comanda.id,
    numeroPedido,
    origemOperacional,
    clienteId: comanda.cliente_id || comanda.cliente?.id || null,
    clientePhone: comanda.cliente?.telefone || comanda.delivery_telefone || comanda.telefone || null,
    mesaId: comanda.mesa_id || 0,
    garcomId: comanda.garcom_id,
    garcomNome: comanda.criada_por?.nome || comanda.garcom?.nome || 'Garçom',
    timestamp: parseBackendDateTime(comanda.criado_em),
    created_at: comanda.criado_em,
    tipo,
    valorPago: comanda.valor_pago || 0,
    identificador,
    statusComanda: comanda.status_comanda || null,
    deliveryStatus: comanda.delivery_status || null,
    deliveryTax: Number(comanda.delivery_taxa) || 0,
    deliveryAddress: comanda.delivery_endereco || null,
    mesaOrigemId: comanda.mesa_origem_id || null,
    mesaTransferidaDe: comanda.mesa_transferida_de || null,
    itens: (comanda.itens || [])
      .filter((item: any) => item.status !== 'cancelado')
      .map((item: any) => {
        const launchId = item.lancamento_id ? String(item.lancamento_id) : undefined;
        return {
          id: item.id,
          produtoId: item.produto_id,
          nome:
            item.produto?.nome ||
            liveProdutos.find((p) => p.id === item.produto_id)?.nome ||
            `Item #${item.produto_id}`,
          preco: item.preco_unit,
          observacao: item.observacao || '',
          clienteNome: item.cliente_nome || 'Consumo Geral',
          status: item.status,
          pago: Boolean(item.pago),
          lancamentoId: launchId,
          comandaId: comanda.id,
          displayNumber: launchId ? launchIdentities[launchId]?.displayNumber : undefined,
          numeroPedido,
          tipo,
          origemOperacional,
          identificador,
        };
      }),
  };
}
