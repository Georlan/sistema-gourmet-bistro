import { buildMultipartUploadHeaders } from './multipartUpload';
import { campaignLocalTime } from './promotionSchedule';

export { buildMultipartUploadHeaders };

export type PromotionType = 'compre_ganhe' | 'combo' | 'desconto_item';
export type GiftSourceMode = 'brinde_simples' | 'produto_cardapio';
export type ScheduleQuickPreset = 'agora' | 'hoje' | 'amanha' | 'fim_de_semana';

export interface PromotionProductSummary {
  id: string;
  nome: string;
  preco: number;
}

export interface PromotionTextSuggestion {
  nome: string;
  descricao: string;
  preco?: string;
}

export type BuyGetSuggestion = {
  nome: string;
  descricao: string;
  preco: string;
};

/**
 * Normaliza ou infere o tipo de promoção para retrocompatibilidade com ofertas legadas.
 */
export function inferPromotionType(promotion: {
  tipo?: string | null;
  brinde_nome?: string | null;
  componentes?: ReadonlyArray<ReadonlyArray<string>> | null;
}): PromotionType {
  if (
    promotion.tipo === 'compre_ganhe'
    || promotion.tipo === 'combo'
    || promotion.tipo === 'desconto_item'
  ) {
    return promotion.tipo;
  }
  if (typeof promotion.brinde_nome === 'string' && promotion.brinde_nome.trim().length > 0) {
    return 'compre_ganhe';
  }
  if (Array.isArray(promotion.componentes) && promotion.componentes.length === 1) {
    return 'desconto_item';
  }
  return 'combo';
}

export function getPromotionTypeLabel(tipo: PromotionType): string {
  switch (tipo) {
    case 'compre_ganhe':
      return 'Compre e ganhe';
    case 'desconto_item':
      return 'Desconto agendado';
    case 'combo':
    default:
      return 'Combo promocional';
  }
}

export function clampPromotionQuantity(value: number, max = 20): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(max, Math.trunc(value)));
}

export function normalizeSlotQuantities(
  slotCount: number,
  raw?: ReadonlyArray<number> | null,
  max = 20,
): number[] {
  return Array.from({ length: Math.max(0, slotCount) }, (_, index) => {
    const candidate = Array.isArray(raw) ? Number(raw[index]) : 1;
    return clampPromotionQuantity(candidate, max);
  });
}

export function calculatePromotionRegularTotal(
  slots: ReadonlyArray<{ preco: number; qty?: number }>,
): number {
  return slots.reduce((sum, slot) => {
    const price = Number(slot.preco);
    if (!Number.isFinite(price) || price <= 0) return sum;
    const qty = clampPromotionQuantity(Number(slot.qty ?? 1));
    return sum + price * qty;
  }, 0);
}

export function formatPromotionItemsSummary(
  items: ReadonlyArray<{ nome: string; qty?: number }>,
  brindeNome?: string | null,
): string {
  const validItems = items.filter((item) => item.nome.trim().length > 0);
  const showExplicitQty = validItems.some((item) => clampPromotionQuantity(Number(item.qty ?? 1)) > 1);
  const parts = validItems.map((item) => {
    const qty = clampPromotionQuantity(Number(item.qty ?? 1));
    return showExplicitQty ? `${qty}× ${item.nome.trim()}` : item.nome.trim();
  });
  const cleanGift = typeof brindeNome === 'string' && brindeNome.trim() ? brindeNome.trim() : null;
  if (cleanGift) {
    parts.push(`Brinde: ${cleanGift}`);
  }
  return parts.join(' + ');
}

/**
 * Sugere nome, descrição e preço fechado no modo "Compre N e ganhe M (Produto do cardápio)",
 * mantendo o preço da oferta igual a N × preço do item principal (X).
 */
export function buildBuyGetSuggestion(
  mainProduct: PromotionProductSummary | undefined,
  giftProduct: PromotionProductSummary | undefined,
  mainQty = 1,
  giftQty = 1,
): BuyGetSuggestion | null {
  if (!mainProduct || !giftProduct || mainProduct.id === giftProduct.id) return null;
  const safeMainQty = clampPromotionQuantity(mainQty, 20);
  const safeGiftQty = clampPromotionQuantity(giftQty, 5);
  const mainPrice = Number(mainProduct.preco);
  const totalMainPrice = Number.isFinite(mainPrice) && mainPrice > 0 ? mainPrice * safeMainQty : 0;

  if (safeMainQty === 1 && safeGiftQty === 1) {
    return {
      nome: `Compre ${mainProduct.nome} e ganhe ${giftProduct.nome}`.slice(0, 90),
      descricao: `Na compra de ${mainProduct.nome}, leve ${giftProduct.nome} de brinde.`.slice(0, 240),
      preco: totalMainPrice > 0 ? totalMainPrice.toFixed(2) : '',
    };
  }

  return {
    nome: `Comprando ${safeMainQty} ${mainProduct.nome}, ganha ${safeGiftQty} ${giftProduct.nome}`.slice(0, 90),
    descricao: `Comprando ${safeMainQty}× ${mainProduct.nome}, leve ${safeGiftQty}× ${giftProduct.nome} de brinde.`.slice(0, 240),
    preco: totalMainPrice > 0 ? totalMainPrice.toFixed(2) : '',
  };
}

/**
 * Sugere nome, descrição e preço no modo "Compre N e ganhe Brinde simples (texto livre)",
 * sem exigir produto oculto cadastrado no cardápio.
 */
export function buildSimpleGiftSuggestion(
  mainProduct: PromotionProductSummary | undefined,
  brindeNome: string,
  mainQty = 1,
): BuyGetSuggestion | null {
  const cleanGift = brindeNome.trim();
  if (!mainProduct || cleanGift.length < 2) return null;
  const safeMainQty = clampPromotionQuantity(mainQty, 20);
  const mainPrice = Number(mainProduct.preco);
  const totalMainPrice = Number.isFinite(mainPrice) && mainPrice > 0 ? mainPrice * safeMainQty : 0;

  if (safeMainQty === 1) {
    return {
      nome: `Compre ${mainProduct.nome} e ganhe ${cleanGift}`.slice(0, 90),
      descricao: `Na compra de ${mainProduct.nome}, leve ${cleanGift} de brinde.`.slice(0, 240),
      preco: totalMainPrice > 0 ? totalMainPrice.toFixed(2) : '',
    };
  }

  return {
    nome: `Comprando ${safeMainQty} ${mainProduct.nome}, ganha ${cleanGift}`.slice(0, 90),
    descricao: `Comprando ${safeMainQty}× ${mainProduct.nome}, leve ${cleanGift} de brinde.`.slice(0, 240),
    preco: totalMainPrice > 0 ? totalMainPrice.toFixed(2) : '',
  };
}

/**
 * Sugere nome e descrição no modo "Desconto agendado em 1 item".
 */
export function buildItemDiscountSuggestion(
  product: PromotionProductSummary | undefined,
): PromotionTextSuggestion | null {
  if (!product) return null;
  return {
    nome: `Oferta: ${product.nome}`.slice(0, 90),
    descricao: `${product.nome} com preço promocional por tempo limitado.`.slice(0, 240),
  };
}

/**
 * Sugere nome e descrição para um combo com 2 a 4 itens (com suporte a quantidades por item).
 */
export function buildComboSuggestion(
  selectedProducts: ReadonlyArray<PromotionProductSummary>,
  quantities?: ReadonlyArray<number>,
): PromotionTextSuggestion | null {
  if (selectedProducts.length < 2) return null;
  const normalizedQty = normalizeSlotQuantities(selectedProducts.length, quantities);
  const hasMulti = normalizedQty.some((q) => q > 1);
  const joined = selectedProducts
    .map((p, index) => (hasMulti ? `${normalizedQty[index]}× ${p.nome}` : p.nome))
    .join(' + ');
  return {
    nome: `Combo ${joined}`.slice(0, 90),
    descricao: `Inclui ${joined} com preço especial de combo.`.slice(0, 240),
  };
}

function getLocalDateParts(now: Date, timeZone: string): { year: number; month: number; day: number; weekday: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).formatToParts(now);

  const byType = (type: string) => parts.find((p) => p.type === type)?.value || '';
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: Number(byType('year')),
    month: Number(byType('month')),
    day: Number(byType('day')),
    weekday: weekdayMap[byType('weekday')] ?? 0,
  };
}

function addCalendarDays(year: number, month: number, day: number, offsetDays: number): string {
  const utc = new Date(Date.UTC(year, month - 1, day + offsetDays));
  const y = utc.getUTCFullYear();
  const m = String(utc.getUTCMonth() + 1).padStart(2, '0');
  const d = String(utc.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Gera strings `datetime-local` (`YYYY-MM-DDTHH:mm`) no fuso da loja para atalhos rápidos.
 */
export function buildSchedulePreset(
  preset: ScheduleQuickPreset,
  timeZone: string,
  now: Date = new Date(),
): { inicio: string; fim: string } {
  if (preset === 'agora') {
    return { inicio: '', fim: '' };
  }

  const { year, month, day, weekday } = getLocalDateParts(now, timeZone);

  if (preset === 'hoje') {
    const today = addCalendarDays(year, month, day, 0);
    const currentLocal = campaignLocalTime(now.toISOString(), timeZone);
    return {
      inicio: currentLocal,
      fim: `${today}T23:59`,
    };
  }

  if (preset === 'amanha') {
    const tomorrow = addCalendarDays(year, month, day, 1);
    return {
      inicio: `${tomorrow}T08:00`,
      fim: `${tomorrow}T23:59`,
    };
  }

  // fim_de_semana: sexta 17:00 até domingo 23:59 (se já for sáb/dom, começa agora e termina domingo 23:59)
  if (weekday === 6 || weekday === 0) {
    const daysUntilSunday = weekday === 0 ? 0 : 1;
    const sunday = addCalendarDays(year, month, day, daysUntilSunday);
    return {
      inicio: campaignLocalTime(now.toISOString(), timeZone),
      fim: `${sunday}T23:59`,
    };
  }

  const daysUntilFriday = 5 - weekday;
  const friday = addCalendarDays(year, month, day, daysUntilFriday);
  const sunday = addCalendarDays(year, month, day, daysUntilFriday + 2);
  return {
    inicio: `${friday}T17:00`,
    fim: `${sunday}T23:59`,
  };
}
