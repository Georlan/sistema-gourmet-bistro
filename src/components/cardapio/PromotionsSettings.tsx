import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarClock,
  Eye,
  Gift,
  Layers,
  LoaderCircle,
  Percent,
  Plus,
  Save,
  ToggleLeft,
  ToggleRight,
  Trash2,
} from 'lucide-react';
import { campaignInstant, campaignLocalTime } from '../../utils/promotionSchedule';
import {
  buildBuyGetSuggestion,
  buildComboSuggestion,
  buildItemDiscountSuggestion,
  buildSchedulePreset,
  buildSimpleGiftSuggestion,
  getPromotionTypeLabel,
  inferPromotionType,
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
  ativo: boolean;
  inicio_em?: string | null;
  fim_em?: string | null;
  fuso_horario?: string;
  status?: 'agendada' | 'ativa' | 'pausada' | 'encerrada';
};

type PromotionFormState = {
  tipo: PromotionType;
  giftSource: GiftSourceMode;
  brindeNome: string;
  slotIds: string[];
  nome: string;
  descricao: string;
  preco: string;
  ativo: boolean;
  inicio: string;
  fim: string;
  fuso: string;
};

const createEmptyForm = (tipo: PromotionType = 'compre_ganhe'): PromotionFormState => ({
  tipo,
  giftSource: 'brinde_simples',
  brindeNome: '',
  slotIds: tipo === 'combo' ? ['', ''] : [''],
  nome: '',
  descricao: '',
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

const PROMOTION_TYPES: ReadonlyArray<{
  id: PromotionType;
  title: string;
  description: string;
}> = [
  {
    id: 'compre_ganhe',
    title: 'Compre e ganhe',
    description: 'Escolha o item principal e informe o brinde sem precisar cadastrar produto oculto.',
  },
  {
    id: 'combo',
    title: 'Combo promocional',
    description: 'Combine de 2 a 4 itens do cardápio com um preço fechado especial.',
  },
  {
    id: 'desconto_item',
    title: 'Desconto agendado',
    description: 'Aplique preço promocional em 1 produto com início e fim programados.',
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
  const [editing, setEditing] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [available, setAvailable] = useState(false);
  const [saving, setSaving] = useState(false);
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

    if (nextForm.tipo === 'compre_ganhe') {
      const mainProduct = productById.get(nextForm.slotIds[0] || '');
      if (nextForm.giftSource === 'brinde_simples') {
        suggestion = buildSimpleGiftSuggestion(mainProduct, nextForm.brindeNome);
      } else {
        const giftProduct = productById.get(nextForm.slotIds[1] || '');
        suggestion = buildBuyGetSuggestion(mainProduct, giftProduct);
      }
    } else if (nextForm.tipo === 'desconto_item') {
      suggestion = buildItemDiscountSuggestion(productById.get(nextForm.slotIds[0] || ''));
    } else {
      const chosen = nextForm.slotIds
        .map((id) => productById.get(id))
        .filter((p): p is CatalogProduct => Boolean(p));
      suggestion = buildComboSuggestion(chosen);
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
    setForm((current) => {
      const firstId = current.slotIds[0] || '';
      const secondId = current.slotIds[1] || '';
      let nextSlots: string[];
      if (nextType === 'combo') {
        nextSlots = [firstId, secondId];
      } else if (nextType === 'compre_ganhe') {
        nextSlots = current.giftSource === 'produto_cardapio' ? [firstId, secondId] : [firstId];
      } else {
        nextSlots = [firstId];
      }
      const next: PromotionFormState = {
        ...current,
        tipo: nextType,
        slotIds: nextSlots,
        brindeNome: nextType === 'compre_ganhe' ? current.brindeNome : '',
      };
      return applyAutoSuggestion(next, nextType === 'compre_ganhe');
    });
  };

  const handleGiftSourceChange = (nextSource: GiftSourceMode) => {
    setForm((current) => {
      const firstId = current.slotIds[0] || '';
      const secondId = current.slotIds[1] || '';
      const next: PromotionFormState = {
        ...current,
        giftSource: nextSource,
        slotIds: nextSource === 'produto_cardapio' ? [firstId, secondId] : [firstId],
        brindeNome: nextSource === 'brinde_simples' ? current.brindeNome : '',
      };
      return applyAutoSuggestion(next, true);
    });
  };

  const handleSlotChange = (index: number, value: string) => {
    setForm((current) => {
      const nextSlots = [...current.slotIds];
      nextSlots[index] = value;
      const next: PromotionFormState = { ...current, slotIds: nextSlots };
      const shouldForcePrice =
        current.tipo === 'compre_ganhe' && index === 0;
      if (shouldForcePrice) {
        const mainProduct = productById.get(value);
        if (mainProduct && Number.isFinite(Number(mainProduct.preco)) && Number(mainProduct.preco) > 0) {
          next.preco = Number(mainProduct.preco).toFixed(2);
        }
      }
      return applyAutoSuggestion(next, shouldForcePrice);
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
      return { ...current, slotIds: [...current.slotIds, ''] };
    });
  };

  const removeComboSlot = (index: number) => {
    setForm((current) => {
      if (current.slotIds.length <= 2) return current;
      const nextSlots = current.slotIds.filter((_, i) => i !== index);
      return applyAutoSuggestion({ ...current, slotIds: nextSlots }, false);
    });
  };

  const applySchedulePreset = (preset: ScheduleQuickPreset) => {
    const { inicio, fim } = buildSchedulePreset(preset, form.fuso);
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

    setShowEditor(true);
    setEditing(p.id);
    setAutoSuggestedText(null);
    setNotice('');
    setForm({
      tipo,
      giftSource,
      brindeNome: p.brinde_nome?.trim() || '',
      slotIds,
      nome: p.nome,
      descricao: p.descricao || '',
      preco: String(p.preco),
      ativo: p.ativo,
      inicio: campaignLocalTime(p.inicio_em, p.fuso_horario || 'America/Fortaleza'),
      fim: campaignLocalTime(p.fim_em, p.fuso_horario || 'America/Fortaleza'),
      fuso: p.fuso_horario || 'America/Fortaleza',
    });
  };

  const submit = async () => {
    const numericPrice = Number(form.preco);
    if (form.nome.trim().length < 4 || !form.preco.trim() || !Number.isFinite(numericPrice) || numericPrice <= 0) {
      setNoticeTone('warning');
      setNotice('Preencha o nome (mínimo 4 caracteres) e um preço válido para a promoção.');
      return;
    }

    let finalSlotIds: string[] = [];
    let brindeNomePayload: string | null = null;

    if (form.tipo === 'compre_ganhe') {
      const mainId = form.slotIds[0] || '';
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
        brindeNomePayload = cleanGift;
      } else {
        const giftId = form.slotIds[1] || '';
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
      }
    } else if (form.tipo === 'desconto_item') {
      const itemId = form.slotIds[0] || '';
      if (!itemId) {
        setNoticeTone('warning');
        setNotice('Selecione o produto que receberá o desconto agendado.');
        return;
      }
      finalSlotIds = [itemId];
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
          ativo: form.ativo,
          inicio_em: campaignInstant(form.inicio, form.fuso),
          fim_em: campaignInstant(form.fim, form.fuso),
          fuso_horario: form.fuso,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof data.detail === 'string' ? data.detail : 'Não foi possível salvar a promoção.');
      }
      setEditing(null);
      setForm(createEmptyForm('compre_ganhe'));
      setAutoSuggestedText(null);
      setShowEditor(false);
      setNoticeTone('success');
      setNotice('Promoção salva. Se estiver ativa, aparecerá automaticamente no cardápio online.');
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
          ativo: !p.ativo,
          inicio_em: p.inicio_em || null,
          fim_em: p.fim_em || null,
          fuso_horario: p.fuso_horario || 'America/Fortaleza',
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
    setForm(createEmptyForm('compre_ganhe'));
    setNotice('');
    setShowEditor(true);
  };

  const cancelEditor = () => {
    setEditing(null);
    setAutoSuggestedText(null);
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

  const selectedProducts = form.slotIds
    .map((id) => productById.get(id))
    .filter((p): p is CatalogProduct => Boolean(p));

  const previewPrice = Number(form.preco);
  const hasValidPreviewPrice = Boolean(form.preco.trim()) && Number.isFinite(previewPrice) && previewPrice > 0;

  let previewSubtotal: number | null = null;
  if (form.tipo === 'combo' && selectedProducts.length >= 2) {
    previewSubtotal = selectedProducts.reduce((sum, item) => sum + Number(item.preco), 0);
  } else if (form.tipo === 'compre_ganhe' && form.giftSource === 'produto_cardapio' && selectedProducts.length >= 2) {
    previewSubtotal = selectedProducts.reduce((sum, item) => sum + Number(item.preco), 0);
  } else if (form.tipo === 'desconto_item' && selectedProducts[0]) {
    previewSubtotal = Number(selectedProducts[0].preco);
  }

  const previewSavings =
    previewSubtotal != null && hasValidPreviewPrice && previewSubtotal > previewPrice
      ? previewSubtotal - previewPrice
      : null;
  const previewDiscountPercent =
    previewSavings != null && previewSubtotal && previewSubtotal > 0
      ? Math.round((previewSavings / previewSubtotal) * 100)
      : null;

  const previewIncludedItems: string[] = selectedProducts.map((p) => p.nome);
  if (form.tipo === 'compre_ganhe' && form.giftSource === 'brinde_simples' && form.brindeNome.trim()) {
    previewIncludedItems.push(`Brinde: ${form.brindeNome.trim()}`);
  }

  const renderProductSelect = (
    slotIndex: number,
    label: string,
    canRemove = false,
  ) => {
    const selectedId = form.slotIds[slotIndex] || '';
    return (
      <div key={`slot-${slotIndex}`} className="flex items-end gap-2">
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
        {canRemove && (
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
            <span className="rounded-full border border-koma-border bg-koma-card px-2 py-0.5 text-xs font-semibold text-koma-muted tabular-nums">
              {promotions.length}
            </span>
          </div>
          <p className="mt-1 text-xs text-koma-muted">
            Crie ofertas Compre e Ganhe, combos de 2 a 4 itens ou descontos agendados para o cardápio online.
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
          className="rounded-xl border px-3 py-2 text-xs font-semibold"
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
          className="space-y-4 rounded-xl border border-koma-border bg-koma-card p-3 sm:p-4"
          aria-label={editing ? 'Editar promoção' : 'Cadastrar promoção'}
        >
          <div className="flex items-center justify-between gap-3">
            <h3
              className="text-sm font-bold text-koma-foreground"
              style={{ fontFamily: 'var(--koma-font-display)' }}
            >
              {editing ? 'Editar promoção' : 'Nova promoção'}
            </h3>
            <button
              type="button"
              onClick={cancelEditor}
              className="min-h-11 rounded-xl border border-koma-border bg-koma-panel px-3 text-xs font-semibold text-koma-secondary hover:bg-koma-raised"
            >
              Cancelar
            </button>
          </div>

          <div className="space-y-2" role="group" aria-label="Tipo de oferta">
            <span className="block text-xs font-semibold text-koma-secondary">Tipo de oferta</span>
            <div className="grid gap-2 md:grid-cols-3">
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
                    className="flex min-h-11 flex-col items-start rounded-xl border px-3.5 py-2.5 text-left transition"
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
                    <span className="inline-flex items-center gap-1.5 text-xs font-bold">
                      <Icon size={14} aria-hidden="true" /> {option.title}
                    </span>
                    <span className="mt-0.5 text-[11px] opacity-85">{option.description}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {form.tipo === 'compre_ganhe' && (
            <div className="space-y-3 rounded-xl border border-koma-border bg-koma-panel p-3">
              {renderProductSelect(0, 'Produto principal (Compre X)')}

              <div className="space-y-2">
                <span className="block text-xs font-semibold text-koma-secondary">Origem do brinde</span>
                <div className="grid gap-2 sm:grid-cols-2" role="group" aria-label="Origem do brinde">
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
                            background: 'var(--koma-surface-card)',
                            borderColor: 'var(--koma-border-default)',
                            color: 'var(--koma-text-primary)',
                          }
                    }
                  >
                    <span className="block font-bold">Brinde simples (digitar nome)</span>
                    <span className="mt-0.5 block text-[11px] opacity-80">
                      Sem cadastrar produto extra no cardápio.
                    </span>
                  </button>
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
                            background: 'var(--koma-surface-card)',
                            borderColor: 'var(--koma-border-default)',
                            color: 'var(--koma-text-primary)',
                          }
                    }
                  >
                    <span className="block font-bold">Produto do cardápio</span>
                    <span className="mt-0.5 block text-[11px] opacity-80">
                      Usa um item já cadastrado e mantém baixa normal.
                    </span>
                  </button>
                </div>
              </div>

              {form.giftSource === 'brinde_simples' ? (
                <label className="block text-xs font-semibold text-koma-secondary">
                  Nome do brinde (Ganhe Y)
                  <input
                    value={form.brindeNome}
                    onChange={(e) => handleBrindeNomeChange(e.target.value)}
                    maxLength={90}
                    placeholder="Ex: Refrigerante lata, Sobremesa, Molho especial"
                    className="mt-1 min-h-11 w-full rounded-xl border border-koma-border bg-koma-input px-3 text-sm text-koma-foreground"
                  />
                  <span className="mt-1 block text-[11px] font-normal text-koma-muted">
                    O brinde aparece automaticamente no cardápio, na comanda da cozinha e no cupom.
                  </span>
                </label>
              ) : (
                renderProductSelect(1, 'Brinde do cardápio (Ganhe Y)')
              )}
            </div>
          )}

          {form.tipo === 'combo' && (
            <div className="space-y-3 rounded-xl border border-koma-border bg-koma-panel p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold text-koma-foreground">
                  Itens do combo ({form.slotIds.length} de 4)
                </span>
                {form.slotIds.length < 4 && (
                  <button
                    type="button"
                    onClick={addComboSlot}
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-koma-border bg-koma-card px-3 text-xs font-semibold text-koma-foreground transition hover:bg-koma-raised"
                  >
                    <Plus size={14} aria-hidden="true" /> Adicionar produto ao combo
                  </button>
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {form.slotIds.map((_, index) =>
                  renderProductSelect(index, `Produto ${index + 1}`, index >= 2),
                )}
              </div>
            </div>
          )}

          {form.tipo === 'desconto_item' && (
            <div className="space-y-2 rounded-xl border border-koma-border bg-koma-panel p-3">
              {renderProductSelect(0, 'Produto em oferta')}
              {selectedProducts[0] && (
                <p className="text-xs text-koma-muted tabular-nums">
                  Preço regular atual: <strong className="text-koma-foreground">{money(selectedProducts[0].preco)}</strong>
                </p>
              )}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-semibold text-koma-secondary sm:col-span-2">
              Nome da promoção
              <input
                value={form.nome}
                onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))}
                maxLength={90}
                className="mt-1 min-h-11 w-full rounded-xl border border-koma-border bg-koma-input px-3 text-sm text-koma-foreground"
                placeholder={
                  form.tipo === 'compre_ganhe'
                    ? 'Ex: Compre Burger Clássico e ganhe Refrigerante lata'
                    : form.tipo === 'desconto_item'
                      ? 'Ex: Happy Hour — Pizza Grande com desconto'
                      : 'Ex: Combo Almoço Completo'
                }
              />
            </label>
            <label className="text-xs font-semibold text-koma-secondary sm:col-span-2">
              Descrição
              <input
                value={form.descricao}
                onChange={(e) => setForm((f) => ({ ...f, descricao: e.target.value }))}
                maxLength={240}
                className="mt-1 min-h-11 w-full rounded-xl border border-koma-border bg-koma-input px-3 text-sm text-koma-foreground"
                placeholder="Explique o que está incluso para o cliente"
              />
            </label>
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
                onChange={(e) => setForm((f) => ({ ...f, preco: e.target.value }))}
                className="mt-1 min-h-11 w-full rounded-xl border border-koma-border bg-koma-input px-3 text-sm text-koma-foreground tabular-nums"
              />
            </label>
            <label className="flex min-h-11 cursor-pointer items-center gap-2.5 self-end rounded-xl border border-koma-border bg-koma-panel px-3 text-xs font-semibold text-koma-foreground">
              <input
                type="checkbox"
                checked={form.ativo}
                onChange={(e) => setForm((f) => ({ ...f, ativo: e.target.checked }))}
              />
              Habilitar oferta
            </label>
          </div>

          <div className="space-y-3 rounded-xl border border-koma-border bg-koma-panel p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-koma-foreground">
                <CalendarClock size={14} aria-hidden="true" /> Agendamento rápido
              </span>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Atalhos de agendamento">
                {SCHEDULE_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => applySchedulePreset(preset.id)}
                    className="min-h-11 rounded-xl border border-koma-border bg-koma-card px-3 text-xs font-semibold text-koma-secondary transition hover:bg-koma-raised hover:text-koma-foreground"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-semibold text-koma-secondary">
                Início programado (opcional)
                <input
                  type="datetime-local"
                  value={form.inicio}
                  onChange={(e) => setForm((f) => ({ ...f, inicio: e.target.value }))}
                  className="mt-1 min-h-11 w-full min-w-0 rounded-xl border border-koma-border bg-koma-input px-3 text-sm text-koma-foreground tabular-nums"
                />
              </label>
              <label className="text-xs font-semibold text-koma-secondary">
                Encerramento (opcional)
                <input
                  type="datetime-local"
                  value={form.fim}
                  onChange={(e) => setForm((f) => ({ ...f, fim: e.target.value }))}
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

          {(previewIncludedItems.length > 0 || form.nome.trim()) && (
            <aside
              aria-label="Prévia da oferta no cardápio online"
              className="rounded-xl border border-koma-border bg-koma-panel p-3.5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-koma-muted">
                  <Eye size={13} aria-hidden="true" /> Prévia no cardápio online
                </span>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="rounded-full border border-koma-border bg-koma-card px-2 py-0.5 text-[11px] font-semibold text-koma-secondary">
                    {getPromotionTypeLabel(form.tipo)}
                  </span>
                  {previewSavings != null && previewSavings > 0 && (
                    <span
                      className="rounded-full border px-2 py-0.5 text-[11px] font-semibold tabular-nums"
                      style={{
                        background: 'var(--koma-success-bg)',
                        borderColor: 'var(--koma-success-border)',
                        color: 'var(--koma-success-text)',
                      }}
                    >
                      Economia de {money(previewSavings)}
                      {previewDiscountPercent && previewDiscountPercent > 0 ? ` (${previewDiscountPercent}% OFF)` : ''}
                    </span>
                  )}
                </div>
              </div>
              <div className="mt-2.5 rounded-xl border border-koma-border bg-koma-card p-3">
                <strong
                  className="block text-sm font-bold text-koma-foreground"
                  style={{ fontFamily: 'var(--koma-font-display)' }}
                >
                  {form.nome.trim() || 'Nome da oferta'}
                </strong>
                {form.descricao.trim() && (
                  <p className="mt-1 text-xs text-koma-muted">{form.descricao.trim()}</p>
                )}
                {previewIncludedItems.length > 0 && (
                  <p className="mt-2 text-xs text-koma-secondary">
                    Inclui: {previewIncludedItems.join(' + ')}
                  </p>
                )}
                <div className="mt-2.5 flex flex-wrap items-baseline gap-2 border-t border-koma-border pt-2">
                  {previewSubtotal != null && hasValidPreviewPrice && previewSubtotal > previewPrice && (
                    <span className="text-xs text-koma-muted line-through tabular-nums">
                      De {money(previewSubtotal)}
                    </span>
                  )}
                  <strong className="text-base font-bold text-koma-foreground tabular-nums">
                    {hasValidPreviewPrice ? money(previewPrice) : 'Informe o preço'}
                  </strong>
                </div>
              </div>
            </aside>
          )}

          <p className="text-xs leading-relaxed text-koma-muted">
            O servidor confirma o preço da oferta. Adicionais pagos e entrega são cobrados à parte.
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
            Crie uma oferta Compre e Ganhe, monte um combo promocional ou agende um desconto por tempo limitado.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2" aria-label="Ofertas cadastradas">
          {promotions.map((p) => {
            const tipo = inferPromotionType(p);
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
                    <span className="inline-block rounded-full border border-koma-border bg-koma-panel px-2 py-0.5 text-[11px] font-semibold text-koma-secondary">
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
                    className="shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold"
                    style={statusStyle}
                  >
                    {statusLabel}
                  </span>
                </div>
                {p.brinde_nome && (
                  <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-koma-secondary">
                    <Gift size={13} aria-hidden="true" /> Brinde incluso: {p.brinde_nome}
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
