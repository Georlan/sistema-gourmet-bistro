import { formatWhatsAppPhone, openWhatsAppMessage } from '../../../config/whatsappUtils';
import { formatCurrency } from '../cashierPresentation';
import type { CaixaTurnoResumo, Order } from '../../../types';

export interface DigitalReceiptItem {
  nome?: string;
  name?: string;
  preco?: number;
  preco_unit?: number;
  price?: number;
  quantidade?: number;
  qty?: number;
  status?: string;
}

export interface RestaurantReceiptInfo {
  nome?: string;
  telefone?: string;
  chave_pix?: string;
  pix_chave?: string;
  pix_tipo_chave?: string;
}

/**
 * Monta o extrato/conta de consumo formatado para WhatsApp ou visualização digital.
 */
export function buildWhatsAppOrderReceipt(
  order: Partial<Order> & {
    itens?: string | readonly DigitalReceiptItem[];
    identificador?: string;
    mesaId?: number;
    numeroPedido?: number | string;
    total?: number;
    valorPago?: number;
    clientePhone?: string | null;
    telefone?: string | null;
  },
  restaurant?: RestaurantReceiptInfo | null,
  options?: {
    taxaServicoAtiva?: boolean;
    serviceTaxRate?: number;
  }
): string {
  const restName = (restaurant?.nome || 'KÔMA').trim();
  const title = order.mesaId && order.mesaId > 0
    ? `Mesa ${String(order.mesaId).padStart(2, '0')}`
    : order.numeroPedido
      ? `Pedido #${order.numeroPedido}`
      : order.identificador || 'Atendimento';

  const lines: string[] = [
    `🧾 *${restName}*`,
    `*Conta — ${title}*`,
    '────────────────────────',
  ];

  const rawItems = order.itens;
  let parsedItems: { nome: string; qtd: number; totalPreco: number }[] = [];

  if (typeof rawItems === 'string') {
    const parts = rawItems.split(/\+|\,/);
    parsedItems = parts.map((p) => {
      const trimmed = p.trim();
      const match = trimmed.match(/^(\d+)x?\s*(.+)$/i);
      if (match) {
        return { qtd: parseInt(match[1], 10), nome: match[2].trim(), totalPreco: 0 };
      }
      return { qtd: 1, nome: trimmed, totalPreco: 0 };
    }).filter((it) => it.nome.length > 0);
  } else if (Array.isArray(rawItems)) {
    const itemMap = new Map<string, { nome: string; qtd: number; totalPreco: number }>();
    (rawItems as readonly DigitalReceiptItem[]).forEach((it) => {
      if ((it.status as string) === 'cancelado') return;
      const nome = it.nome || it.name || 'Item';
      const unit = Number(it.preco_unit || it.preco || it.price || 0);
      const qtd = Number(it.quantidade || it.qty || 1);
      const existing = itemMap.get(nome);
      if (existing) {
        existing.qtd += qtd;
        existing.totalPreco += unit * qtd;
      } else {
        itemMap.set(nome, { nome, qtd, totalPreco: unit * qtd });
      }
    });
    parsedItems = Array.from(itemMap.values());
  }

  if (parsedItems.length === 0) {
    lines.push('Nenhum item consumido.');
  } else {
    parsedItems.forEach(({ nome, qtd, totalPreco }) => {
      if (totalPreco > 0) {
        lines.push(`${qtd}× ${nome} · ${formatCurrency(totalPreco)}`);
      } else {
        lines.push(`${qtd}× ${nome}`);
      }
    });
  }

  lines.push('────────────────────────');

  const subtotal = parsedItems.reduce((acc, it) => acc + it.totalPreco, 0) || Number(order.total || 0);

  lines.push(`Subtotal: ${formatCurrency(subtotal)}`);

  let totalCalculado = subtotal;
  if (options?.taxaServicoAtiva && options?.serviceTaxRate) {
    const taxa = subtotal * (options.serviceTaxRate / 100);
    lines.push(`Taxa de serviço (${options.serviceTaxRate}%): ${formatCurrency(taxa)}`);
    totalCalculado += taxa;
  }

  const valorPago = Number(order.valorPago || 0);
  lines.push(`*Total: ${formatCurrency(totalCalculado)}*`);

  if (valorPago > 0) {
    lines.push(`Valor já pago: ${formatCurrency(valorPago)}`);
    const saldoRestante = Math.max(0, totalCalculado - valorPago);
    lines.push(`*Saldo a pagar: ${formatCurrency(saldoRestante)}*`);
  }

  const chavePix = restaurant?.chave_pix || restaurant?.pix_chave;
  if (chavePix) {
    lines.push('');
    lines.push(`💳 *Chave Pix:* \`${chavePix.trim()}\``);
  }

  lines.push('');
  lines.push('Agradecemos a preferência!');

  return lines.join('\n');
}

/**
 * Monta o resumo de fechamento de turno formatado para WhatsApp.
 */
export function buildWhatsAppShiftReceipt(
  turno: CaixaTurnoResumo,
  restaurantName = 'KÔMA'
): string {
  const lines: string[] = [
    `📊 *Fechamento de Caixa — ${restaurantName}*`,
    `Turno: #${turno.turno_id || '-'} · Operador: ${turno.operador_nome || 'Caixa'}`,
    '────────────────────────',
    `*Total de Vendas: ${formatCurrency(Number(turno.total_vendas || 0))}*`,
  ];

  // Detalhamento por método de pagamento
  const metodosMap: [string, number][] = [
    ['Dinheiro', turno.total_dinheiro],
    ['Pix', turno.total_pix],
    ['Cartão', turno.total_cartao],
  ];
  metodosMap.forEach(([label, valor]) => {
    const v = Number(valor || 0);
    if (v > 0) {
      lines.push(`• ${label}: ${formatCurrency(v)}`);
    }
  });

  lines.push('────────────────────────');
  lines.push(`Saldo Inicial: ${formatCurrency(Number(turno.saldo_inicial || 0))}`);
  if (Number(turno.total_suprimentos || 0) > 0) {
    lines.push(`Suprimentos (+): ${formatCurrency(Number(turno.total_suprimentos))}`);
  }
  if (Number(turno.total_sangrias || 0) > 0) {
    lines.push(`Sangrias (-): ${formatCurrency(Number(turno.total_sangrias))}`);
  }
  lines.push(`*Dinheiro Esperado em Gaveta: ${formatCurrency(Number(turno.saldo_esperado_dinheiro || 0))}*`);

  return lines.join('\n');
}

/**
 * Dispara compartilhamento da mensagem (via WhatsApp se número informado, Web Share API ou Clipboard).
 */
export async function shareDigitalReceipt(payload: {
  text: string;
  phone?: string | null;
  onSuccess?: (message: string) => void;
  onError?: (err: unknown) => void;
}): Promise<boolean> {
  const cleanPhone = formatWhatsAppPhone(payload.phone);

  if (cleanPhone) {
    return openWhatsAppMessage(cleanPhone, payload.text);
  }

  // Tenta Web Share API se disponível (ótimo em smartphones)
  if (typeof navigator !== 'undefined' && navigator.share) {
    try {
      await navigator.share({
        title: 'Comprovante KÔMA',
        text: payload.text,
      });
      payload.onSuccess?.('Comprovante compartilhado com sucesso!');
      return true;
    } catch (shareErr) {
      if ((shareErr as { name?: string })?.name === 'AbortError') {
        return false;
      }
    }
  }

  // Fallback: copia para a área de transferência
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(payload.text);
      payload.onSuccess?.('Texto do comprovante copiado para a área de transferência!');
      return true;
    } catch (clipErr) {
      payload.onError?.(clipErr);
      return false;
    }
  }

  payload.onError?.(new Error('Compartilhamento não disponível neste navegador.'));
  return false;
}
