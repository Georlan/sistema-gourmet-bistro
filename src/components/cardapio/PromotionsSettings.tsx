import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  CalendarClock,
  Check,
  Eye,
  Gift,
  ImagePlus,
  Layers,
  LoaderCircle,
  Minus,
  Percent,
  Plus,
  Save,
  ToggleLeft,
  ToggleRight,
  Trash2,
} from 'lucide-react';
import { campaignInstant, campaignLocalTime } from '../../utils/promotionSchedule';
import { prepareImageUpload } from '../../utils/imageUpload';
import {
  buildBuyGetSuggestion,
  buildComboSuggestion,
  buildItemDiscountSuggestion,
  buildMultipartUploadHeaders,
  buildSchedulePreset,
  buildSimpleGiftSuggestion,
  calculatePromotionRegularTotal,
  clampPromotionQuantity,
  formatPromotionItemsSummary,
  getPromotionTypeLabel,
  inferPromotionType,
  normalizeSlotQuantities,
  type GiftSourceMode,
  type PromotionType,
  type ScheduleQuickPreset,
} from '../../utils/promotionFormHelpers';

type CatalogProduct = {
  id: string;
  nome: string;
  preco: number;
  ativo: boolean;
  tamanho?: string | null;
  somente_promocao?: boolean;
};

type Promotion = {
  id: string;
  nome: string;
  descricao: string;
  preco: number;
  tipo?: PromotionType;
  brinde_nome?: string | null;
  componentes: string[][];
  quantidades?: number[];
  ativo: boolean;
  inicio_em?: string | null;
  fim_em?: string | null;
  fuso_horario?: string;
  status?: 'agendada' | 'ativa' | 'pausada' | 'encerrada';
  imagem_url?: string | null;
};

type PromotionFormState = {
  tipo: PromotionType;
  giftSource: GiftSourceMode;
  brindeNome: string;
  slotIds: string[];
  slotQuantities: number[];
  nome: string;
  descricao: string;
  imagemUrl: string;
  preco: string;
  ativo: boolean;
  inicio: string;
  fim: string;
  fuso: string;
};

const createEmptyForm = (tipo: PromotionType = 'compre_ganhe'): PromotionFormState => ({
  tipo,
  giftSource: 'produto_cardapio',
  brindeNome: '',
  slotIds: tipo === 'combo' || tipo === 'compre_ganhe' ? ['', ''] : [''],
  slotQuantities: tipo === 'combo' || tipo === 'compre_ganhe' ? [1, 1] : [1],
  nome: '',
  descricao: '',
  imagemUrl: '',
  preco: '',
  ativo: false,
  inicio: '',
  fim: '',
  fuso: 'America/Fortaleza',
});

const money = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

const SCHEDULE_PRESETS: ReadonlyArray<{ id: ScheduleQuickPreset; label: string }> = [
  { id: 'agora', label: 'Agora (sem fim)' },
  { id: 'hoje', label: 'Hoje' },
  { id: 'amanha', label: 'Amanhã' },
  { id: 'fim_de_semana', label: 'Fim de semana' },
];

const BUY_QTY_PILLS = [1, 2, 3, 5] as const;
const GIFT_QTY_PILLS = [1, 2, 3] as const;

const PROMOTION_TYPES: ReadonlyArray<{
  id: PromotionType;
  title: string;
  example: string;
}> = [
  {
    id: 'desconto_item',
    title: 'Desconto em 1 item',
    example: 'Ex.: Item de R$ 14 por R$ 10',
  },
  {
    id: 'compre_ganhe',
    title: 'Compre e ganhe',
    example: 'Ex.: Comprando 5 unidades, ganha 1',
  },
  {
    id: 'combo',
    title: 'Combo com preço fechado',
    example: 'Ex.: Prato + Bebida por preço especial',
  },
];

export default function PromotionsSettings({
  apiBaseUrl,
  authHeaders,
  onPromotionsLoaded,
  catalogVersion,
}: {
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
  onPromotionsLoaded?: (count: number) => void;
  catalogVersion?: string;
}) {
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [form, setForm] = useState<PromotionFormState>(() => createEmptyForm('compre_ganhe'));
  const [autoSuggestedText, setAutoSuggestedText] = useState<{ nome: string; descricao: string } | null>(null);
  const [priceManuallyEdited, setPriceManuallyEdited] = useState(false);
  const [activeSchedulePreset, setActiveSchedulePreset] = useState<ScheduleQuickPreset | null>('agora');
  const [editing, setEditing] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [available, setAvailable] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [notice, setNotice] = useState('');
  const [noticeTone, setNoticeTone] = useState<'info' | 'warning' | 'success'>('info');
  const [showEditor, setShowEditor] = useState(false);
  const [forbidden, setForbidden] = useState(false);

  const api = `${apiBaseUrl}/api/cardapio-digital/promocoes`;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(api, { headers: authHeaders, cache: 'no-store' });
      if (response.status === 403) {
        setForbidden(true);
        setAvailable(false);
        return;
      }
      if (!response.ok) throw new Error('Não foi possível carregar as promoções.');
      const data = await response.json();
      setForbidden(false);
      setAvailable(true);
      setProducts(Array.isArray(data.produtos) ? data.produtos : []);
      const loadedPromotions = Array.isArray(data.promocoes) ? data.promocoes : [];
      setPromotions(loadedPromotions);
      onPromotionsLoaded?.(loadedPromotions.length);
    } catch (error) {
      setNoticeTone('warning');
      setNotice(error instanceof Error ? error.message : 'Erro ao carregar as promoções.');
    } finally {
      setLoading(false);
    }
  }, [api, authHeaders, onPromotionsLoaded]);

  useEffect(() => {
    void load();
  }, [api, authHeaders.Authorization, authHeaders.authorization, catalogVersion]);

  const productById = useMemo(
    () => new Map(products.map((product) => [product.id, product])),
    [products],
  );

  const applyAutoSuggestion = (
    nextForm: PromotionFormState,
    forcePrice = false,
  ): PromotionFormState => {
    let suggestion: { nome: string; descricao: string; preco?: string } | null = null;
    const qtys = normalizeSlotQuantities(nextForm.slotIds.length, nextForm.slotQuantities);

    if (nextForm.tipo === 'compre_ganhe') {
      const mainProduct = productById.get(nextForm.slotIds[0] || '');
      const mainQty = qtys[0] ?? 1;
      if (nextForm.giftSource === 'brinde_simples') {
        suggestion = buildSimpleGiftSuggestion(mainProduct, nextForm.brindeNome, mainQty);
      } else {
        const giftProduct = productById.get(nextForm.slotIds[1] || '');
        const giftQty = clampPromotionQuantity(qtys[1] ?? 1, 5);
        suggestion = buildBuyGetSuggestion(mainProduct, giftProduct, mainQty, giftQty);
      }
    } else if (nextForm.tipo === 'desconto_item') {
      suggestion = buildItemDiscountSuggestion(productById.get(nextForm.slotIds[0] || ''));
    } else {
      const paired = nextForm.slotIds
        .map((id, index) => ({ product: productById.get(id), qty: qtys[index] ?? 1 }))
        .filter((entry): entry is { product: CatalogProduct; qty: number } => Boolean(entry.product));
      suggestion = buildComboSuggestion(
        paired.map((entry) => entry.product),
        paired.map((entry) => entry.qty),
      );
    }

    if (!suggestion) return nextForm;

    const shouldReplaceNome = !nextForm.nome.trim() || nextForm.nome === autoSuggestedText?.nome;
    const shouldReplaceDesc =
      !nextForm.descricao.trim() || nextForm.descricao === autoSuggestedText?.descricao;
    setAutoSuggestedText({ nome: suggestion.nome, descricao: suggestion.descricao });

    return {
      ...nextForm,
      nome: shouldReplaceNome ? suggestion.nome : nextForm.nome,
      descricao: shouldReplaceDesc ? suggestion.descricao : nextForm.descricao,
      preco:
        forcePrice && suggestion.preco !== undefined
          ? suggestion.preco
          : !nextForm.preco.trim() && suggestion.preco
            ? suggestion.preco
            : nextForm.preco,
    };
  };

  const handleTypeChange = (nextType: PromotionType) => {
    setAutoSuggestedText(null);
    setPriceManuallyEdited(false);
    setForm((current) => {
      const firstId = current.slotIds[0] || '';
      const secondId = current.slotIds[1] || '';
      const firstQty = clampPromotionQuantity(current.slotQuantities[0] ?? 1, 20);
      const secondQty = clampPromotionQuantity(current.slotQuantities[1] ?? 1, nextType === 'compre_ganhe' ? 5 : 20);

      let nextSlots: string[];
      let nextQuantities: number[];
      if (nextType === 'combo') {
        nextSlots = [firstId, secondId];
        nextQuantities = [firstQty, secondQty];
      } else if (nextType === 'compre_ganhe') {
        nextSlots = current.giftSource === 'produto_cardapio' ? [firstId, secondId] : [firstId];
        nextQuantities = current.giftSource === 'produto_cardapio' ? [firstQty, secondQty] : [firstQty];
      } else {
        nextSlots = [firstId];
        nextQuantities = [1];
      }

      const next: PromotionFormState = {
        ...current,
        tipo: nextType,
        slotIds: nextSlots,
        slotQuantities: nextQuantities,
        brindeNome: nextType === 'compre_ganhe' ? current.brindeNome : '',
        preco: nextType === 'desconto_item' ? '' : current.preco,
      };
      return applyAutoSuggestion(next, nextType === 'compre_ganhe');
    });
  };

  const handleGiftSourceChange = (nextSource: GiftSourceMode) => {
    setForm((current) => {
      const firstId = current.slotIds[0] || '';
      const secondId = current.slotIds[1] || '';
      const firstQty = clampPromotionQuantity(current.slotQuantities[0] ?? 1, 20);
      const secondQty = clampPromotionQuantity(current.slotQuantities[1] ?? 1, 5);
      const next: PromotionFormState = {
        ...current,
        giftSource: nextSource,
        slotIds: nextSource === 'produto_cardapio' ? [firstId, secondId] : [firstId],
        slotQuantities: nextSource === 'produto_cardapio' ? [firstQty, secondQty] : [firstQty],
        brindeNome: nextSource === 'brinde_simples' ? current.brindeNome : '',
      };
      return applyAutoSuggestion(next, !priceManuallyEdited);
    });
  };

  const handleSlotChange = (index: number, value: string) => {
    setForm((current) => {
      const nextSlots = [...current.slotIds];
      nextSlots[index] = value;
      const next: PromotionFormState = { ...current, slotIds: nextSlots };
      const shouldRecalcBuyGetPrice =
        current.tipo === 'compre_ganhe' && index === 0 && !priceManuallyEdited;
      if (shouldRecalcBuyGetPrice) {
        const mainProduct = productById.get(value);
        const mainQty = clampPromotionQuantity(current.slotQuantities[0] ?? 1, 20);
        if (mainProduct && Number.isFinite(Number(mainProduct.preco)) && Number(mainProduct.preco) > 0) {
          next.preco = (Number(mainProduct.preco) * mainQty).toFixed(2);
        }
      }
      return applyAutoSuggestion(next, shouldRecalcBuyGetPrice);
    });
  };

  const handleSlotQuantityChange = (index: number, rawQty: number, max = 20) => {
    const qty = clampPromotionQuantity(rawQty, max);
    setForm((current) => {
      const nextQuantities = normalizeSlotQuantities(current.slotIds.length, current.slotQuantities, 20);
      nextQuantities[index] = qty;
      const next: PromotionFormState = { ...current, slotQuantities: nextQuantities };
      const shouldRecalcBuyGetPrice =
        current.tipo === 'compre_ganhe' && index === 0 && !priceManuallyEdited;
      if (shouldRecalcBuyGetPrice) {
        const mainProduct = productById.get(current.slotIds[0] || '');
        if (mainProduct && Number.isFinite(Number(mainProduct.preco)) && Number(mainProduct.preco) > 0) {
          next.preco = (Number(mainProduct.preco) * qty).toFixed(2);
        }
      }
      return applyAutoSuggestion(next, shouldRecalcBuyGetPrice);
    });
  };

  const handleBrindeNomeChange = (value: string) => {
    setForm((current) => {
      const next: PromotionFormState = { ...current, brindeNome: value };
      return applyAutoSuggestion(next, false);
    });
  };

  const addComboSlot = () => {
    setForm((current) => {
      if (current.slotIds.length >= 4) return current;
      return {
        ...current,
        slotIds: [...current.slotIds, ''],
        slotQuantities: [...normalizeSlotQuantities(current.slotIds.length, current.slotQuantities), 1],
      };
    });
  };

  const removeComboSlot = (index: number) => {
    setForm((current) => {
      if (current.slotIds.length <= 2) return current;
      const nextSlots = current.slotIds.filter((_, i) => i !== index);
      const nextQuantities = normalizeSlotQuantities(current.slotIds.length, current.slotQuantities).filter(
        (_, i) => i !== index,
      );
      return applyAutoSuggestion({ ...current, slotIds: nextSlots, slotQuantities: nextQuantities }, false);
    });
  };

  const applySchedulePreset = (preset: ScheduleQuickPreset) => {
    const { inicio, fim } = buildSchedulePreset(preset, form.fuso);
    setActiveSchedulePreset(preset);
    setForm((current) => ({ ...current, inicio, fim }));
  };

  const edit = (p: Promotion) => {
    const tipo = inferPromotionType(p);
    const hasSimpleGift = tipo === 'compre_ganhe' && Boolean(p.brinde_nome?.trim());
    const giftSource: GiftSourceMode = hasSimpleGift ? 'brinde_simples' : 'produto_cardapio';
    const rawSlots = (p.componentes || []).map((slot) => slot?.[0] || '');
    const slotIds =
      tipo === 'combo'
        ? rawSlots.length >= 2
          ? rawSlots.slice(0, 4)
          : [rawSlots[0] || '', rawSlots[1] || '']
        : tipo === 'compre_ganhe' && giftSource === 'produto_cardapio'
          ? [rawSlots[0] || '', rawSlots[1] || '']
          : [rawSlots[0] || ''];
    const slotQuantities = normalizeSlotQuantities(slotIds.length, p.quantidades);

    setShowEditor(true);
    setEditing(p.id);
    setAutoSuggestedText(null);
    setPriceManuallyEdited(true);
    setActiveSchedulePreset(!p.inicio_em && !p.fim_em ? 'agora' : null);
    setNotice('');
    setForm({
      tipo,
      giftSource,
      brindeNome: p.brinde_nome?.trim() || '',
      slotIds,
      slotQuantities,
      nome: p.nome,
      descricao: p.descricao || '',
      imagemUrl: p.imagem_url?.trim() || '',
      preco: String(p.preco),
      ativo: p.ativo,
      inicio: campaignLocalTime(p.inicio_em, p.fuso_horario || 'America/Fortaleza'),
      fim: campaignLocalTime(p.fim_em, p.fuso_horario || 'America/Fortaleza'),
      fuso: p.fuso_horario || 'America/Fortaleza',
    });
  };

  const uploadPromotionImage = async (file: File) => {
    setUploadingImage(true);
    setNotice('');
    try {
      const preparedFile = await prepareImageUpload(file, 'products');
      const formData = new FormData();
      formData.append('file', preparedFile);
      const response = await fetch(`${apiBaseUrl}/api/cardapio-digital/assets/promotion`, {
        method: 'POST',
        headers: buildMultipartUploadHeaders(authHeaders),
        body: formData,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof data.detail === 'string' ? data.detail : 'Não foi possível enviar a foto.');
      }
      const uploadedUrl = typeof data.url === 'string' ? data.url : typeof data.imagem_url === 'string' ? data.imagem_url : '';
      if (!uploadedUrl) {
        throw new Error('Resposta inválida ao enviar a foto da promoção.');
      }
      setForm((f) => ({ ...f, imagemUrl: uploadedUrl }));
      setNoticeTone('success');
      setNotice('Foto da promoção enviada.');
    } catch (error) {
      setNoticeTone('warning');
      setNotice(error instanceof Error ? error.message : 'Erro ao enviar foto.');
    } finally {
      setUploadingImage(false);
    }
  };

  const submit = async () => {
    const numericPrice = Number(form.preco);
    if (form.nome.trim().length < 4 || !form.preco.trim() || !Number.isFinite(numericPrice) || numericPrice <= 0) {
      setNoticeTone('warning');
      setNotice('Preencha o nome (mínimo 4 caracteres) e um preço válido para a promoção.');
      return;
    }

    let finalSlotIds: string[] = [];
    let finalQuantities: number[] = [];
    let brindeNomePayload: string | null = null;
    const normalizedQty = normalizeSlotQuantities(form.slotIds.length, form.slotQuantities);

    if (form.tipo === 'compre_ganhe') {
      const mainId = form.slotIds[0] || '';
      const mainQty = clampPromotionQuantity(normalizedQty[0] ?? 1, 20);
      if (!mainId) {
        setNoticeTone('warning');
        setNotice('Selecione o produto principal da oferta Compre e Ganhe.');
        return;
      }
      if (form.giftSource === 'brinde_simples') {
        const cleanGift = form.brindeNome.trim();
        if (cleanGift.length < 2) {
          setNoticeTone('warning');
          setNotice('Informe o nome do brinde (ex: Refrigerante lata ou Sobremesa).');
          return;
        }
        finalSlotIds = [mainId];
        finalQuantities = [mainQty];
        brindeNomePayload = cleanGift;
      } else {
        const giftId = form.slotIds[1] || '';
        const giftQty = clampPromotionQuantity(normalizedQty[1] ?? 1, 5);
        if (!giftId) {
          setNoticeTone('warning');
          setNotice('Selecione o produto do cardápio que será entregue como brinde.');
          return;
        }
        if (giftId === mainId) {
          setNoticeTone('warning');
          setNotice('Selecione um brinde diferente do produto principal.');
          return;
        }
        finalSlotIds = [mainId, giftId];
        finalQuantities = [mainQty, giftQty];
      }
    } else if (form.tipo === 'desconto_item') {
      const itemId = form.slotIds[0] || '';
      if (!itemId) {
        setNoticeTone('warning');
        setNotice('Selecione o produto que receberá o desconto.');
        return;
      }
      finalSlotIds = [itemId];
      finalQuantities = [1];
    } else {
      const filled = form.slotIds.filter(Boolean);
      if (filled.length < 2 || filled.length !== form.slotIds.length) {
        setNoticeTone('warning');
        setNotice('Selecione todos os produtos do combo (entre 2 e 4 itens).');
        return;
      }
      if (new Set(filled).size !== filled.length) {
        setNoticeTone('warning');
        setNotice('Cada etapa do combo precisa ter um produto diferente.');
        return;
      }
      finalSlotIds = filled;
      finalQuantities = normalizedQty.slice(0, filled.length);
    }

    const totalUnits = finalQuantities.reduce((sum, qty) => sum + qty, 0);
    if (totalUnits > 25) {
      setNoticeTone('warning');
      setNotice('O total de unidades na promoção não pode passar de 25.');
      return;
    }

    const previousPromotion = editing ? promotions.find((p) => p.id === editing) : undefined;
    const componentes = finalSlotIds.map((id, index) => {
      const previous = previousPromotion?.componentes?.[index];
      return previous?.[0] === id ? previous : [id];
    });

    setSaving(true);
    try {
      const response = await fetch(editing ? `${api}/${encodeURIComponent(editing)}` : api, {
        method: editing ? 'PUT' : 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome: form.nome.trim(),
          descricao: form.descricao.trim(),
          preco: numericPrice,
          tipo: form.tipo,
          brinde_nome: brindeNomePayload,
          componentes,
          quantidades: finalQuantities,
          ativo: form.ativo,
          inicio_em: campaignInstant(form.inicio, form.fuso),
          fim_em: campaignInstant(form.fim, form.fuso),
          fuso_horario: form.fuso,
          imagem_url: form.imagemUrl.trim() || null,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof data.detail === 'string' ? data.detail : 'Não foi possível salvar a promoção.');
      }
      setEditing(null);
      setForm(createEmptyForm('compre_ganhe'));
      setAutoSuggestedText(null);
      setPriceManuallyEdited(false);
      setActiveSchedulePreset('agora');
      setShowEditor(false);
      setNoticeTone('success');
      setNotice('Promoção salva. Se estiver ativa, aparecerá automaticamente no topo do cardápio.');
      await load();
    } catch (error) {
      setNoticeTone('warning');
      setNotice(error instanceof Error ? error.message : 'Erro ao salvar.');
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (p: Promotion) => {
    setSaving(true);
    try {
      const tipo = inferPromotionType(p);
      const quantidades = normalizeSlotQuantities(p.componentes.length, p.quantidades);
      const response = await fetch(`${api}/${encodeURIComponent(p.id)}`, {
        method: 'PUT',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome: p.nome,
          descricao: p.descricao || '',
          preco: p.preco,
          tipo,
          brinde_nome: p.brinde_nome || null,
          componentes: p.componentes,
          quantidades,
          ativo: !p.ativo,
          inicio_em: p.inicio_em || null,
          fim_em: p.fim_em || null,
          fuso_horario: p.fuso_horario || 'America/Fortaleza',
          imagem_url: p.imagem_url || null,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof data.detail === 'string' ? data.detail : 'Não foi possível alterar.');
      }
      setNoticeTone('info');
      setNotice(
        p.ativo
          ? 'Promoção pausada no cardápio.'
          : 'Oferta habilitada. A publicação respeita o período programado.',
      );
      await load();
    } catch (error) {
      setNoticeTone('warning');
      setNotice(error instanceof Error ? error.message : 'Erro ao alterar.');
    } finally {
      setSaving(false);
    }
  };

  const newOffer = () => {
    setEditing(null);
    setAutoSuggestedText(null);
    setPriceManuallyEdited(false);
    setActiveSchedulePreset('agora');
    setForm(createEmptyForm('compre_ganhe'));
    setNotice('');
    setShowEditor(true);
  };

  const cancelEditor = () => {
    setEditing(null);
    setAutoSuggestedText(null);
    setPriceManuallyEdited(false);
    setActiveSchedulePreset('agora');
    setForm(createEmptyForm('compre_ganhe'));
    setShowEditor(false);
    setNotice('');
  };

  if (loading && !available) {
    return (
      <div className="rounded-2xl border border-koma-border bg-koma-panel p-4 text-sm text-koma-muted">
        Carregando promoções...
      </div>
    );
  }
  if (forbidden) return null;
  if (!available) {
    return (
      <section className="rounded-2xl border border-koma-border bg-koma-panel p-4 sm:p-5" aria-label="Gerenciar promoções">
        <h2
          className="text-base font-bold text-koma-foreground"
          style={{ fontFamily: 'var(--koma-font-display)' }}
        >
          Ofertas e combos
        </h2>
        <p
          role="alert"
          className="mt-2 rounded-xl border px-3 py-2 text-xs font-semibold"
          style={{
            background: 'var(--koma-warning-bg)',
            borderColor: 'var(--koma-warning-border)',
            color: 'var(--koma-warning-text)',
          }}
        >
          {notice || 'Não foi possível carregar as promoções.'}
        </p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-3 min-h-11 rounded-xl border border-koma-border bg-koma-card px-4 text-sm font-semibold text-koma-foreground"
        >
          Tentar novamente
        </button>
      </section>
    );
  }

  const normalizedFormQtys = normalizeSlotQuantities(form.slotIds.length, form.slotQuantities);
  const selectedSlots = form.slotIds
    .map((id, index) => {
      const product = productById.get(id);
      if (!product) return null;
      return {
        product,
        qty: normalizedFormQtys[index] ?? 1,
      };
    })
    .filter((entry): entry is { product: CatalogProduct; qty: number } => Boolean(entry));

  const previewPrice = Number(form.preco);
  const hasValidPreviewPrice = Boolean(form.preco.trim()) && Number.isFinite(previewPrice) && previewPrice > 0;

  let previewSubtotal: number | null = null;
  if (form.tipo === 'combo' && selectedSlots.length >= 2) {
    previewSubtotal = calculatePromotionRegularTotal(
      selectedSlots.map((entry) => ({ preco: entry.product.preco, qty: entry.qty })),
    );
  } else if (form.tipo === 'compre_ganhe' && form.giftSource === 'produto_cardapio' && selectedSlots.length >= 2) {
    previewSubtotal = calculatePromotionRegularTotal(
      selectedSlots.map((entry) => ({ preco: entry.product.preco, qty: entry.qty })),
    );
  } else if (form.tipo === 'desconto_item' && selectedSlots[0]) {
    previewSubtotal = Number(selectedSlots[0].product.preco);
  }

  const previewSavings =
    previewSubtotal != null && hasValidPreviewPrice && previewSubtotal > previewPrice
      ? previewSubtotal - previewPrice
      : null;
  const previewDiscountPercent =
    previewSavings != null && previewSubtotal && previewSubtotal > 0
      ? Math.round((previewSavings / previewSubtotal) * 100)
      : null;

  const previewItemsSummary = formatPromotionItemsSummary(
    selectedSlots.map((entry) => ({ nome: entry.product.nome, qty: entry.qty })),
    form.tipo === 'compre_ganhe' && form.giftSource === 'brinde_simples' ? form.brindeNome : null,
  );

  const mainProductForBuyGet = productById.get(form.slotIds[0] || '');
  const mainBuyQty = clampPromotionQuantity(normalizedFormQtys[0] ?? 1, 20);
  const giftBuyQty = clampPromotionQuantity(normalizedFormQtys[1] ?? 1, 5);
  const suggestedBuyGetPrice =
    form.tipo === 'compre_ganhe' && mainProductForBuyGet && Number(mainProductForBuyGet.preco) > 0
      ? Number(mainProductForBuyGet.preco) * mainBuyQty
      : null;

  const renderQuantityStepper = (
    slotIndex: number,
    value: number,
    max: number,
    ariaLabel: string,
  ) => (
    <div className="inline-flex items-center rounded-xl border border-koma-border bg-koma-input p-0.5">
      <button
        type="button"
        onClick={() => handleSlotQuantityChange(slotIndex, value - 1, max)}
        disabled={value <= 1}
        aria-label={`Diminuir ${ariaLabel}`}
        className="grid min-h-11 w-10 place-items-center rounded-lg text-koma-secondary transition hover:bg-koma-raised hover:text-koma-foreground disabled:opacity-40"
      >
        <Minus size={15} aria-hidden="true" />
      </button>
      <input
        type="number"
        min={1}
        max={max}
        value={value}
        onChange={(e) => handleSlotQuantityChange(slotIndex, Number(e.target.value), max)}
        aria-label={ariaLabel}
        className="w-12 bg-transparent text-center text-sm font-bold text-koma-foreground tabular-nums outline-none"
      />
      <button
        type="button"
        onClick={() => handleSlotQuantityChange(slotIndex, value + 1, max)}
        disabled={value >= max}
        aria-label={`Aumentar ${ariaLabel}`}
        className="grid min-h-11 w-10 place-items-center rounded-lg text-koma-secondary transition hover:bg-koma-raised hover:text-koma-foreground disabled:opacity-40"
      >
        <Plus size={15} aria-hidden="true" />
      </button>
    </div>
  );

  const renderProductSelect = (
    slotIndex: number,
    label: string,
    options?: { canRemove?: boolean; showQtyStepper?: boolean },
  ) => {
    const selectedId = form.slotIds[slotIndex] || '';
    const slotQty = normalizedFormQtys[slotIndex] ?? 1;
    return (
      <div key={`slot-${slotIndex}`} className="flex flex-wrap items-end gap-2">
        <label className="min-w-0 flex-1 text-xs font-semibold text-koma-secondary">
          {label}
          <select
            value={selectedId}
            onChange={(e) => handleSlotChange(slotIndex, e.target.value)}
            className="mt-1 min-h-11 w-full rounded-xl border border-koma-border bg-koma-input px-3 text-sm text-koma-foreground"
          >
            <option value="">Selecione um produto</option>
            {products
              .filter((p) => p.ativo || p.id === selectedId)
              .map((p) => (
                <option key={p.id} value={p.id} disabled={!p.ativo}>
                  {p.nome} · {money(p.preco)}
                  {!p.ativo ? ' · pausado' : ''}
                </option>
              ))}
          </select>
        </label>
        {options?.showQtyStepper && (
          <div className="shrink-0">
            <span className="mb-1 block text-xs font-semibold text-koma-secondary">Qtd.</span>
            {renderQuantityStepper(slotIndex, slotQty, 20, `quantidade do produto ${slotIndex + 1}`)}
          </div>
        )}
        {options?.canRemove && (
          <button
            type="button"
            onClick={() => removeComboSlot(slotIndex)}
            aria-label={`Remover produto ${slotIndex + 1} do combo`}
            className="grid min-h-11 w-11 shrink-0 place-items-center rounded-xl border border-koma-border bg-koma-panel text-koma-secondary transition hover:bg-koma-raised hover:text-koma-foreground"
          >
            <Trash2 size={16} aria-hidden="true" />
          </button>
        )}
      </div>
    );
  };

  return (
    <section
      className="space-y-4 rounded-2xl border border-koma-border bg-koma-panel p-4 sm:p-5"
      aria-label="Gerenciar promoções"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Gift size={18} className="text-koma-secondary" aria-hidden="true" />
            <h2
              className="text-base font-bold text-koma-foreground"
              style={{ fontFamily: 'var(--koma-font-display)' }}
            >
              Ofertas e combos
            </h2>
            <span className="rounded-full border border-koma-border bg-koma-card px-2.5 py-0.5 text-xs font-semibold text-koma-muted tabular-nums">
              {promotions.length}
            </span>
          </div>
          <p className="mt-1 text-xs text-koma-muted">
            Crie descontos em 1 item, ofertas Compre N e ganhe M ou combos com preço fechado para o topo do cardápio.
          </p>
        </div>
        {!showEditor && (
          <button
            type="button"
            onClick={newOffer}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition"
            style={{
              background: 'var(--koma-action-bg)',
              color: 'var(--koma-action-text)',
            }}
          >
            <Plus size={17} aria-hidden="true" /> Nova oferta
          </button>
        )}
      </div>

      {notice && (
        <p
          role="status"
          className="rounded-xl border px-3.5 py-2.5 text-xs font-semibold"
          style={
            noticeTone === 'success'
              ? {
                  background: 'var(--koma-success-bg)',
                  borderColor: 'var(--koma-success-border)',
                  color: 'var(--koma-success-text)',
                }
              : noticeTone === 'warning'
                ? {
                    background: 'var(--koma-warning-bg)',
                    borderColor: 'var(--koma-warning-border)',
                    color: 'var(--koma-warning-text)',
                  }
                : {
                    background: 'var(--koma-info-bg)',
                    borderColor: 'var(--koma-info-border)',
                    color: 'var(--koma-info-text)',
                  }
          }
        >
          {notice}
        </p>
      )}

      {showEditor && (
        <section
          className="space-y-4 rounded-2xl border border-koma-border bg-koma-card p-3.5 sm:p-5"
          aria-label={editing ? 'Editar promoção' : 'Cadastrar promoção'}
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-koma-border pb-3">
            <div>
              <h3
                className="text-base font-bold text-koma-foreground"
                style={{ fontFamily: 'var(--koma-font-display)' }}
              >
                {editing ? 'Editar promoção' : 'Criar nova promoção'}
              </h3>
              <p className="text-xs text-koma-muted">
                Siga os 3 passos e confira ao lado como a oferta aparece para o cliente.
              </p>
            </div>
            <button
              type="button"
              onClick={cancelEditor}
              className="min-h-11 rounded-xl border border-koma-border bg-koma-panel px-4 text-xs font-semibold text-koma-secondary transition hover:bg-koma-raised hover:text-koma-foreground"
            >
              Cancelar
            </button>
          </div>

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
            {/* Coluna esquerda: 3 passos objetivos */}
            <div className="space-y-5">
              {/* Passo 1: Tipo */}
              <div className="space-y-2.5" role="group" aria-label="Tipo de oferta">
                <div className="flex items-center gap-2">
                  <span className="grid h-6 w-6 place-items-center rounded-full border border-koma-border bg-koma-panel text-xs font-bold text-koma-foreground tabular-nums">
                    1
                  </span>
                  <span
                    className="text-sm font-bold text-koma-foreground"
                    style={{ fontFamily: 'var(--koma-font-display)' }}
                  >
                    Tipo de oferta
                  </span>
                </div>

                <div className="grid gap-2.5 sm:grid-cols-3">
                  {PROMOTION_TYPES.map((option) => {
                    const selected = form.tipo === option.id;
                    const Icon =
                      option.id === 'compre_ganhe'
                        ? Gift
                        : option.id === 'combo'
                          ? Layers
                          : Percent;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => handleTypeChange(option.id)}
                        className="flex min-h-11 flex-col items-start gap-1.5 rounded-xl border p-3.5 text-left transition"
                        style={
                          selected
                            ? {
                                background: 'var(--koma-success-bg)',
                                borderColor: 'var(--koma-success-border)',
                                color: 'var(--koma-success-text)',
                              }
                            : {
                                background: 'var(--koma-surface-panel)',
                                borderColor: 'var(--koma-border-default)',
                                color: 'var(--koma-text-primary)',
                              }
                        }
                      >
                        <span className="flex w-full items-center justify-between gap-2">
                          <span className="grid h-8 w-8 place-items-center rounded-lg border border-current/20">
                            <Icon size={16} aria-hidden="true" />
                          </span>
                          {selected && <Check size={16} aria-hidden="true" />}
                        </span>
                        <span
                          className="text-sm font-bold leading-snug"
                          style={{ fontFamily: 'var(--koma-font-display)' }}
                        >
                          {option.title}
                        </span>
                        <span className="text-xs leading-relaxed opacity-85">{option.example}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Passo 2: Itens e preço */}
              <div className="space-y-3 rounded-xl border border-koma-border bg-koma-panel p-3.5 sm:p-4">
                <div className="flex items-center gap-2">
                  <span className="grid h-6 w-6 place-items-center rounded-full border border-koma-border bg-koma-card text-xs font-bold text-koma-foreground tabular-nums">
                    2
                  </span>
                  <span
                    className="text-sm font-bold text-koma-foreground"
                    style={{ fontFamily: 'var(--koma-font-display)' }}
                  >
                    Itens e preço
                  </span>
                </div>

                {form.tipo === 'desconto_item' && (
                  <div className="space-y-3">
                    {renderProductSelect(0, 'Produto em oferta')}
                    {selectedSlots[0] && (
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-koma-border bg-koma-card px-3 py-2 text-xs">
                        <span className="text-koma-muted">
                          Preço normal:{' '}
                          <strong className="text-koma-foreground tabular-nums">
                            {money(selectedSlots[0].product.preco)}
                          </strong>
                        </span>
                        {previewDiscountPercent != null && previewDiscountPercent > 0 && (
                          <span
                            className="rounded-full border px-2.5 py-0.5 text-xs font-bold tabular-nums"
                            style={{
                              background: 'var(--koma-success-bg)',
                              borderColor: 'var(--koma-success-border)',
                              color: 'var(--koma-success-text)',
                            }}
                          >
                            {previewDiscountPercent}% OFF
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {form.tipo === 'compre_ganhe' && (
                  <div className="space-y-4">
                    <div className="space-y-2.5 rounded-xl border border-koma-border bg-koma-card p-3">
                      <span className="block text-xs font-bold text-koma-foreground">
                        O cliente compra
                      </span>
                      <div className="space-y-2">
                        <span className="block text-xs font-semibold text-koma-secondary">
                          Quantidade para comprar
                        </span>
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Atalhos de quantidade para comprar">
                            {BUY_QTY_PILLS.map((qty) => {
                              const active = mainBuyQty === qty;
                              return (
                                <button
                                  key={qty}
                                  type="button"
                                  aria-pressed={active}
                                  onClick={() => handleSlotQuantityChange(0, qty, 20)}
                                  className="min-h-11 min-w-11 rounded-xl border px-3 text-xs font-bold tabular-nums transition"
                                  style={
                                    active
                                      ? {
                                          background: 'var(--koma-success-bg)',
                                          borderColor: 'var(--koma-success-border)',
                                          color: 'var(--koma-success-text)',
                                        }
                                      : {
                                          background: 'var(--koma-surface-panel)',
                                          borderColor: 'var(--koma-border-default)',
                                          color: 'var(--koma-text-primary)',
                                        }
                                  }
                                >
                                  {qty}×
                                </button>
                              );
                            })}
                          </div>
                          {renderQuantityStepper(0, mainBuyQty, 20, 'quantidade para comprar')}
                        </div>
                      </div>
                      {renderProductSelect(0, 'Produto principal')}
                    </div>

                    <div className="space-y-3 rounded-xl border border-koma-border bg-koma-card p-3">
                      <span className="block text-xs font-bold text-koma-foreground">
                        E ganha de brinde
                      </span>
                      <div className="grid gap-2 sm:grid-cols-2" role="group" aria-label="Origem do brinde">
                        <button
                          type="button"
                          aria-pressed={form.giftSource === 'produto_cardapio'}
                          onClick={() => handleGiftSourceChange('produto_cardapio')}
                          className="min-h-11 rounded-xl border px-3 py-2 text-left text-xs font-semibold transition"
                          style={
                            form.giftSource === 'produto_cardapio'
                              ? {
                                  background: 'var(--koma-success-bg)',
                                  borderColor: 'var(--koma-success-border)',
                                  color: 'var(--koma-success-text)',
                                }
                              : {
                                  background: 'var(--koma-surface-panel)',
                                  borderColor: 'var(--koma-border-default)',
                                  color: 'var(--koma-text-primary)',
                                }
                          }
                        >
                          <span className="block font-bold">Produto do cardápio</span>
                          <span className="mt-0.5 block text-xs opacity-80">
                            Usa um item já cadastrado e mantém baixa normal.
                          </span>
                        </button>
                        <button
                          type="button"
                          aria-pressed={form.giftSource === 'brinde_simples'}
                          onClick={() => handleGiftSourceChange('brinde_simples')}
                          className="min-h-11 rounded-xl border px-3 py-2 text-left text-xs font-semibold transition"
                          style={
                            form.giftSource === 'brinde_simples'
                              ? {
                                  background: 'var(--koma-success-bg)',
                                  borderColor: 'var(--koma-success-border)',
                                  color: 'var(--koma-success-text)',
                                }
                              : {
                                  background: 'var(--koma-surface-panel)',
                                  borderColor: 'var(--koma-border-default)',
                                  color: 'var(--koma-text-primary)',
                                }
                          }
                        >
                          <span className="block font-bold">Brinde simples por nome</span>
                          <span className="mt-0.5 block text-xs opacity-80">
                            Digite o brinde sem precisar criar produto extra.
                          </span>
                        </button>
                      </div>

                      {form.giftSource === 'produto_cardapio' ? (
                        <div className="space-y-3">
                          {renderProductSelect(1, 'Produto de brinde')}
                          <div className="space-y-1.5">
                            <span className="block text-xs font-semibold text-koma-secondary">
                              Quantidade de brinde
                            </span>
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Atalhos de quantidade de brinde">
                                {GIFT_QTY_PILLS.map((qty) => {
                                  const active = giftBuyQty === qty;
                                  return (
                                    <button
                                      key={qty}
                                      type="button"
                                      aria-pressed={active}
                                      onClick={() => handleSlotQuantityChange(1, qty, 5)}
                                      className="min-h-11 min-w-11 rounded-xl border px-3 text-xs font-bold tabular-nums transition"
                                      style={
                                        active
                                          ? {
                                              background: 'var(--koma-success-bg)',
                                              borderColor: 'var(--koma-success-border)',
                                              color: 'var(--koma-success-text)',
                                            }
                                          : {
                                              background: 'var(--koma-surface-panel)',
                                              borderColor: 'var(--koma-border-default)',
                                              color: 'var(--koma-text-primary)',
                                            }
                                      }
                                    >
                                      {qty}×
                                    </button>
                                  );
                                })}
                              </div>
                              {renderQuantityStepper(1, giftBuyQty, 5, 'quantidade de brinde')}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <label className="block text-xs font-semibold text-koma-secondary">
                          Nome do brinde
                          <input
                            value={form.brindeNome}
                            onChange={(e) => handleBrindeNomeChange(e.target.value)}
                            maxLength={90}
                            placeholder="Ex: Refrigerante lata, Sobremesa, Molho especial"
                            className="mt-1 min-h-11 w-full rounded-xl border border-koma-border bg-koma-input px-3 text-sm text-koma-foreground"
                          />
                          <span className="mt-1 block text-xs font-normal text-koma-muted">
                            O brinde aparece no cardápio, na comanda da cozinha e no cupom.
                          </span>
                        </label>
                      )}
                    </div>
                  </div>
                )}

                {form.tipo === 'combo' && (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-koma-secondary tabular-nums">
                        Itens do combo ({form.slotIds.length} de 4)
                      </span>
                      {form.slotIds.length < 4 && (
                        <button
                          type="button"
                          onClick={addComboSlot}
                          className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-koma-border bg-koma-card px-3 text-xs font-semibold text-koma-foreground transition hover:bg-koma-raised"
                        >
                          <Plus size={14} aria-hidden="true" /> Adicionar item ao combo
                        </button>
                      )}
                    </div>
                    <div className="space-y-2.5">
                      {form.slotIds.map((_, index) =>
                        renderProductSelect(index, `Produto ${index + 1}`, {
                          canRemove: index >= 2,
                          showQtyStepper: true,
                        }),
                      )}
                    </div>
                  </div>
                )}

                {/* Preço + publicação + nome/descrição */}
                <div className="grid gap-3 border-t border-koma-border pt-3 sm:grid-cols-2">
                  <label className="text-xs font-semibold text-koma-secondary">
                    {form.tipo === 'desconto_item'
                      ? 'Preço promocional (R$)'
                      : form.tipo === 'compre_ganhe'
                        ? 'Preço da oferta (R$)'
                        : 'Preço do combo (R$)'}
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={form.preco}
                      onChange={(e) => {
                        setPriceManuallyEdited(true);
                        setForm((f) => ({ ...f, preco: e.target.value }));
                      }}
                      placeholder="0,00"
                      className="mt-1 min-h-11 w-full rounded-xl border border-koma-border bg-koma-input px-3 text-sm font-bold text-koma-foreground tabular-nums"
                    />
                    {suggestedBuyGetPrice != null && (
                      <span className="mt-1 flex flex-wrap items-center gap-2 text-xs font-normal text-koma-muted tabular-nums">
                        <span>
                          Sugestão ({mainBuyQty}× {money(Number(mainProductForBuyGet?.preco || 0))}):{' '}
                          <strong className="text-koma-foreground">{money(suggestedBuyGetPrice)}</strong>
                        </span>
                        {Math.abs(previewPrice - suggestedBuyGetPrice) > 0.005 && (
                          <button
                            type="button"
                            onClick={() => {
                              setPriceManuallyEdited(false);
                              setForm((f) => ({ ...f, preco: suggestedBuyGetPrice.toFixed(2) }));
                            }}
                            className="font-semibold text-koma-secondary underline hover:text-koma-foreground"
                          >
                            Usar sugestão
                          </button>
                        )}
                      </span>
                    )}
                  </label>

                  <label className="flex min-h-11 cursor-pointer items-center gap-2.5 self-start rounded-xl border border-koma-border bg-koma-card px-3.5 py-2.5 text-xs font-semibold text-koma-foreground sm:mt-5">
                    <input
                      type="checkbox"
                      checked={form.ativo}
                      onChange={(e) => setForm((f) => ({ ...f, ativo: e.target.checked }))}
                    />
                    <span>Habilitar oferta no cardápio</span>
                  </label>

                  <label className="text-xs font-semibold text-koma-secondary sm:col-span-2">
                    Nome da promoção
                    <input
                      value={form.nome}
                      onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))}
                      maxLength={90}
                      className="mt-1 min-h-11 w-full rounded-xl border border-koma-border bg-koma-input px-3 text-sm text-koma-foreground"
                      placeholder={
                        form.tipo === 'compre_ganhe'
                          ? 'Ex: Comprando 5 unidades, ganha 1 brinde'
                          : form.tipo === 'desconto_item'
                            ? 'Ex: Oferta especial do dia'
                            : 'Ex: Combo Almoço Completo'
                      }
                    />
                  </label>

                  <label className="text-xs font-semibold text-koma-secondary sm:col-span-2">
                    Descrição curta (opcional)
                    <input
                      value={form.descricao}
                      onChange={(e) => setForm((f) => ({ ...f, descricao: e.target.value }))}
                      maxLength={240}
                      className="mt-1 min-h-11 w-full rounded-xl border border-koma-border bg-koma-input px-3 text-sm text-koma-foreground"
                      placeholder="Explique o que está incluso para o cliente"
                    />
                  </label>

                  <div className="space-y-2 sm:col-span-2">
                    <span className="block text-xs font-semibold text-koma-secondary">
                      Foto ou arte da promoção (opcional)
                    </span>
                    <div className="flex flex-wrap items-center gap-3">
                      {form.imagemUrl ? (
                        <>
                          <img
                            src={form.imagemUrl}
                            alt="Prévia da foto da promoção"
                            className="h-14 w-20 rounded-lg border border-koma-border object-cover"
                          />
                          <button
                            type="button"
                            onClick={() => setForm((f) => ({ ...f, imagemUrl: '' }))}
                            className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-koma-border bg-koma-card px-3 text-xs font-semibold text-koma-secondary hover:text-koma-foreground"
                          >
                            <Trash2 size={14} aria-hidden="true" />
                            Remover foto
                          </button>
                        </>
                      ) : (
                        <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-xl border border-koma-border bg-koma-card px-3 text-xs font-semibold text-koma-foreground hover:bg-koma-panel">
                          {uploadingImage ? (
                            <LoaderCircle size={14} className="animate-spin" aria-hidden="true" />
                          ) : (
                            <ImagePlus size={14} aria-hidden="true" />
                          )}
                          <span>{uploadingImage ? 'Enviando...' : 'Enviar foto ou arte'}</span>
                          <input
                            type="file"
                            accept="image/*"
                            disabled={uploadingImage}
                            className="sr-only"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              e.target.value = '';
                              if (file) void uploadPromotionImage(file);
                            }}
                          />
                        </label>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Passo 3: Quando vale */}
              <div className="space-y-3 rounded-xl border border-koma-border bg-koma-panel p-3.5 sm:p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="grid h-6 w-6 place-items-center rounded-full border border-koma-border bg-koma-card text-xs font-bold text-koma-foreground tabular-nums">
                      3
                    </span>
                    <span
                      className="inline-flex items-center gap-1.5 text-sm font-bold text-koma-foreground"
                      style={{ fontFamily: 'var(--koma-font-display)' }}
                    >
                      <CalendarClock size={15} aria-hidden="true" /> Quando vale
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5" role="group" aria-label="Atalhos de agendamento">
                    {SCHEDULE_PRESETS.map((preset) => {
                      const active = activeSchedulePreset === preset.id;
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          aria-pressed={active}
                          onClick={() => applySchedulePreset(preset.id)}
                          className="min-h-11 rounded-xl border px-3 text-xs font-semibold transition"
                          style={
                            active
                              ? {
                                  background: 'var(--koma-success-bg)',
                                  borderColor: 'var(--koma-success-border)',
                                  color: 'var(--koma-success-text)',
                                }
                              : {
                                  background: 'var(--koma-surface-card)',
                                  borderColor: 'var(--koma-border-default)',
                                  color: 'var(--koma-text-secondary)',
                                }
                          }
                        >
                          {preset.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-xs font-semibold text-koma-secondary">
                    Início programado (opcional)
                    <input
                      type="datetime-local"
                      value={form.inicio}
                      onChange={(e) => {
                        setActiveSchedulePreset(null);
                        setForm((f) => ({ ...f, inicio: e.target.value }));
                      }}
                      className="mt-1 min-h-11 w-full min-w-0 rounded-xl border border-koma-border bg-koma-input px-3 text-sm text-koma-foreground tabular-nums"
                    />
                  </label>
                  <label className="text-xs font-semibold text-koma-secondary">
                    Encerramento (opcional)
                    <input
                      type="datetime-local"
                      value={form.fim}
                      onChange={(e) => {
                        setActiveSchedulePreset(null);
                        setForm((f) => ({ ...f, fim: e.target.value }));
                      }}
                      className="mt-1 min-h-11 w-full min-w-0 rounded-xl border border-koma-border bg-koma-input px-3 text-sm text-koma-foreground tabular-nums"
                    />
                  </label>
                  <label className="text-xs font-semibold text-koma-secondary sm:col-span-2">
                    Fuso horário da campanha
                    <select
                      value={form.fuso}
                      onChange={(e) => setForm((f) => ({ ...f, fuso: e.target.value }))}
                      className="mt-1 min-h-11 w-full rounded-xl border border-koma-border bg-koma-input px-3 text-sm text-koma-foreground"
                    >
                      {Array.from(
                        new Set([form.fuso, 'America/Fortaleza', 'America/Sao_Paulo', 'America/Manaus', 'America/Rio_Branco']),
                      ).map((zone) => (
                        <option key={zone} value={zone}>
                          {zone}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <p className="text-xs text-koma-muted">
                  Sem início, a oferta habilitada entra no ar ao salvar. Sem encerramento, permanece válida até ser pausada.
                </p>
              </div>
            </div>

            {/* Coluna direita: Prévia sticky no topo do cardápio + botão salvar */}
            <aside
              aria-label="Prévia da oferta no cardápio online"
              className="space-y-3 rounded-2xl border border-koma-border bg-koma-panel p-4 lg:sticky lg:top-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-bold text-koma-secondary">
                  <Eye size={14} aria-hidden="true" /> Prévia no topo do cardápio
                </span>
                {previewDiscountPercent != null && previewDiscountPercent > 0 && (
                  <span
                    className="rounded-full border px-2 py-0.5 text-xs font-bold tabular-nums"
                    style={{
                      background: 'var(--koma-success-bg)',
                      borderColor: 'var(--koma-success-border)',
                      color: 'var(--koma-success-text)',
                    }}
                  >
                    {previewDiscountPercent}% OFF
                  </span>
                )}
              </div>

              <div className="space-y-2.5 rounded-xl border border-koma-border bg-koma-card p-3.5">
                {form.imagemUrl && (
                  <img
                    src={form.imagemUrl}
                    alt={form.nome.trim() || 'Foto da promoção'}
                    className="h-28 w-full rounded-lg border border-koma-border object-cover"
                  />
                )}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="rounded-full border border-koma-border bg-koma-panel px-2.5 py-0.5 text-xs font-semibold text-koma-secondary">
                    {getPromotionTypeLabel(form.tipo)}
                  </span>
                  <span
                    className="rounded-full border px-2 py-0.5 text-xs font-semibold"
                    style={
                      form.ativo
                        ? {
                            background: 'var(--koma-success-bg)',
                            borderColor: 'var(--koma-success-border)',
                            color: 'var(--koma-success-text)',
                          }
                        : {
                            background: 'var(--koma-surface-panel)',
                            borderColor: 'var(--koma-border-default)',
                            color: 'var(--koma-text-muted)',
                          }
                    }
                  >
                    {form.ativo ? 'Publicada' : 'Pausada'}
                  </span>
                </div>

                <strong
                  className="block text-sm font-bold leading-snug text-koma-foreground"
                  style={{ fontFamily: 'var(--koma-font-display)' }}
                >
                  {form.nome.trim() || 'Nome da oferta aparecerá aqui'}
                </strong>

                {previewItemsSummary && (
                  <p className="rounded-lg border border-koma-border bg-koma-panel px-2.5 py-1.5 text-xs font-semibold text-koma-secondary tabular-nums">
                    {previewItemsSummary}
                  </p>
                )}

                {form.descricao.trim() && (
                  <p className="text-xs leading-relaxed text-koma-muted">{form.descricao.trim()}</p>
                )}

                <div className="flex items-end justify-between gap-2 border-t border-koma-border pt-2.5">
                  <div className="min-w-0 tabular-nums">
                    {previewSubtotal != null && hasValidPreviewPrice && previewSubtotal > previewPrice && (
                      <span className="block text-xs text-koma-muted line-through">
                        De {money(previewSubtotal)}
                      </span>
                    )}
                    <strong
                      className="block text-base font-bold"
                      style={{ color: hasValidPreviewPrice ? 'var(--koma-success-text)' : 'var(--koma-text-muted)' }}
                    >
                      {hasValidPreviewPrice ? money(previewPrice) : 'Informe o preço'}
                    </strong>
                    {previewSavings != null && previewSavings > 0 && (
                      <span className="block text-xs font-semibold text-koma-secondary">
                        Economia de {money(previewSavings)}
                      </span>
                    )}
                  </div>
                  <span
                    className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold"
                    style={{
                      background: 'var(--koma-action-bg)',
                      color: 'var(--koma-action-text)',
                    }}
                  >
                    {form.tipo === 'desconto_item' ? 'Aproveitar' : 'Montar'}
                    <ArrowRight size={13} aria-hidden="true" />
                  </span>
                </div>
              </div>

              <p className="text-xs leading-relaxed text-koma-muted">
                O servidor confirma o preço da oferta no checkout. Adicionais pagos e entrega são cobrados à parte.
              </p>

              <button
                type="button"
                disabled={saving}
                onClick={() => void submit()}
                className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition disabled:opacity-50"
                style={{
                  background: 'var(--koma-action-bg)',
                  color: 'var(--koma-action-text)',
                }}
              >
                {saving ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Save className="h-4 w-4" aria-hidden="true" />
                )}
                {editing ? 'Salvar alterações' : 'Cadastrar promoção'}
              </button>
            </aside>
          </div>
        </section>
      )}

      {promotions.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed border-koma-border bg-koma-card px-5 py-6 text-center">
          <img
            src="/brand/cashier/promotions-empty-v1.svg"
            alt=""
            aria-hidden="true"
            width={160}
            height={120}
            className="mb-3 h-24 w-auto"
          />
          <p className="text-sm font-bold text-koma-foreground">Nenhuma promoção cadastrada</p>
          <p className="mt-1 max-w-sm text-xs text-koma-muted">
            Crie uma oferta Compre e Ganhe, monte um combo com preço fechado ou aplique desconto em 1 item.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2" aria-label="Ofertas cadastradas">
          {promotions.map((p) => {
            const tipo = inferPromotionType(p);
            const qtys = normalizeSlotQuantities(p.componentes.length, p.quantidades);
            const itemsSummary = formatPromotionItemsSummary(
              p.componentes.map((slot, index) => ({
                nome: productById.get(slot?.[0] || '')?.nome || '',
                qty: qtys[index] ?? 1,
              })),
              p.brinde_nome,
            );
            const statusKey = p.status || (p.ativo ? 'ativa' : 'pausada');
            const statusLabel = {
              agendada: 'Agendada',
              ativa: 'Ativa',
              pausada: 'Pausada',
              encerrada: 'Encerrada',
            }[statusKey];
            const statusStyle =
              statusKey === 'ativa'
                ? {
                    background: 'var(--koma-success-bg)',
                    borderColor: 'var(--koma-success-border)',
                    color: 'var(--koma-success-text)',
                  }
                : statusKey === 'agendada'
                  ? {
                      background: 'var(--koma-info-bg)',
                      borderColor: 'var(--koma-info-border)',
                      color: 'var(--koma-info-text)',
                    }
                  : {
                      background: 'var(--koma-surface-panel)',
                      borderColor: 'var(--koma-border-default)',
                      color: 'var(--koma-text-muted)',
                    };

            return (
              <article key={p.id} className="flex flex-col gap-3 rounded-xl border border-koma-border bg-koma-card p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 space-y-1">
                    <span className="inline-block rounded-full border border-koma-border bg-koma-panel px-2.5 py-0.5 text-xs font-semibold text-koma-secondary">
                      {getPromotionTypeLabel(tipo)}
                    </span>
                    <h3
                      className="text-sm font-bold text-koma-foreground"
                      style={{ fontFamily: 'var(--koma-font-display)' }}
                    >
                      {p.nome}
                    </h3>
                  </div>
                  <span
                    className="shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-semibold"
                    style={statusStyle}
                  >
                    {statusLabel}
                  </span>
                </div>
                {itemsSummary && (
                  <p className="rounded-lg border border-koma-border bg-koma-panel px-2.5 py-1.5 text-xs font-semibold text-koma-secondary tabular-nums">
                    Inclui: {itemsSummary}
                  </p>
                )}
                {(p.inicio_em || p.fim_em) && (
                  <p className="text-xs text-koma-muted tabular-nums">
                    {p.inicio_em
                      ? 'De ' + campaignLocalTime(p.inicio_em, p.fuso_horario || 'America/Fortaleza').replace('T', ' ')
                      : 'Sem início definido'}
                    {p.fim_em
                      ? ' até ' + campaignLocalTime(p.fim_em, p.fuso_horario || 'America/Fortaleza').replace('T', ' ')
                      : ' · sem término'}
                  </p>
                )}
                {p.descricao && <p className="line-clamp-2 text-xs text-koma-muted">{p.descricao}</p>}
                <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-koma-border pt-3">
                  <strong className="text-base font-bold text-koma-foreground tabular-nums">{money(p.preco)}</strong>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => edit(p)}
                      className="min-h-11 rounded-xl border border-koma-border bg-koma-panel px-3 text-xs font-semibold text-koma-foreground hover:bg-koma-raised disabled:opacity-50"
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      disabled={saving || p.status === 'encerrada'}
                      onClick={() => void toggle(p)}
                      aria-label={p.ativo ? 'Pausar ' + p.nome : 'Publicar ' + p.nome}
                      className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-koma-border bg-koma-panel px-3 text-xs font-semibold text-koma-foreground hover:bg-koma-raised disabled:opacity-50"
                    >
                      {p.ativo ? <ToggleRight size={18} aria-hidden="true" /> : <ToggleLeft size={18} aria-hidden="true" />}
                      {p.ativo ? 'Pausar' : 'Publicar'}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
