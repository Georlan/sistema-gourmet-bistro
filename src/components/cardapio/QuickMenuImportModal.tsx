import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  inferCategoryPrintDestination,
  parseMenuImportText,
  slugifyCategoryId,
  type ParsedMenuItem,
} from '../../domain/menuImportParser';
import type { CatalogCategory } from '../../catalog/catalog';

interface QuickMenuImportModalProps {
  open: boolean;
  onClose: () => void;
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
  existingCategories: CatalogCategory[];
  activeCardapioId?: string | null;
  onImported: () => Promise<void> | void;
}

const MAX_IMPORT_FILE_BYTES = 1024 * 1024; // 1 MB

export function QuickMenuImportModal({
  open,
  onClose,
  apiBaseUrl,
  authHeaders,
  existingCategories,
  activeCardapioId,
  onImported,
}: QuickMenuImportModalProps) {
  const [step, setStep] = useState<'input' | 'preview' | 'done'>('input');
  const [rawText, setRawText] = useState('');
  const [defaultCategory, setDefaultCategory] = useState('Geral');
  const [items, setItems] = useState<ParsedMenuItem[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [onlyNeedsReview, setOnlyNeedsReview] = useState(false);
  const [bulkCategoryName, setBulkCategoryName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [importedCount, setImportedCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const selectedItems = useMemo(() => items.filter((item) => item.selected), [items]);
  const reviewPendingCount = useMemo(
    () => items.filter((item) => item.selected && (item.needsReview || !item.nome.trim())).length,
    [items],
  );
  const visibleItems = useMemo(
    () => (onlyNeedsReview ? items.filter((item) => item.needsReview || item.preco <= 0 || !item.nome.trim()) : items),
    [items, onlyNeedsReview],
  );

  if (!open) return null;

  const resetAll = () => {
    setStep('input');
    setRawText('');
    setItems([]);
    setWarnings([]);
    setOnlyNeedsReview(false);
    setBulkCategoryName('');
    setError('');
    setImportedCount(0);
  };

  const handleClose = () => {
    if (submitting) return;
    resetAll();
    onClose();
  };

  const handleParse = () => {
    setError('');
    const parsed = parseMenuImportText(rawText, defaultCategory.trim() || 'Geral');
    if (parsed.items.length === 0) {
      setError('Nenhum produto identificado. Cole uma lista com nomes e preços ou um arquivo CSV.');
      return;
    }
    setItems(parsed.items);
    setWarnings(parsed.warnings);
    setStep('preview');
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    setError('');
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_IMPORT_FILE_BYTES) {
      setError('O arquivo excede o limite seguro de 1 MB.');
      event.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const content = String(reader.result || '');
      setRawText(content);
      const parsed = parseMenuImportText(content, defaultCategory.trim() || 'Geral');
      if (parsed.items.length > 0) {
        setItems(parsed.items);
        setWarnings(parsed.warnings);
        setStep('preview');
      } else {
        setError('Arquivo lido, mas nenhum item foi reconhecido. Confira o formato.');
      }
    };
    reader.onerror = () => {
      setError('Não foi possível ler o arquivo selecionado.');
    };
    reader.readAsText(file, 'utf-8');
    event.target.value = '';
  };

  const updateItem = (clientId: string, patch: Partial<ParsedMenuItem>) => {
    setItems((current) =>
      current.map((item) => {
        if (item.clientId !== clientId) return item;
        const next = { ...item, ...patch };
        if (patch.categoriaNome !== undefined) {
          const matched = existingCategories.find(
            (cat) => cat.nome.trim().toLowerCase() === patch.categoriaNome!.trim().toLowerCase(),
          );
          next.categoriaId = matched ? matched.id : slugifyCategoryId(patch.categoriaNome);
          next.destinoImpressao = (matched?.destino_impressao as 'COZINHA' | 'BAR' | 'NENHUM')
            || inferCategoryPrintDestination(patch.categoriaNome);
        }
        if (patch.preco !== undefined || patch.nome !== undefined) {
          next.needsReview = !Number.isFinite(next.preco) || next.preco < 0 || !next.nome.trim();
        }
        return next;
      }),
    );
  };

  const applyBulkCategory = () => {
    const clean = bulkCategoryName.trim();
    if (!clean) return;
    const matched = existingCategories.find(
      (cat) => cat.nome.trim().toLowerCase() === clean.toLowerCase(),
    );
    const nextCatId = matched ? matched.id : slugifyCategoryId(clean);
    const nextDest = (matched?.destino_impressao as 'COZINHA' | 'BAR' | 'NENHUM')
      || inferCategoryPrintDestination(clean);

    setItems((current) =>
      current.map((item) =>
        item.selected
          ? { ...item, categoriaNome: clean, categoriaId: nextCatId, destinoImpressao: nextDest }
          : item,
      ),
    );
    setBulkCategoryName('');
  };

  const addManualRow = () => {
    const catName = defaultCategory.trim() || 'Geral';
    const catId = slugifyCategoryId(catName);
    const uid = `manual-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setItems((current) => [
      ...current,
      {
        clientId: uid,
        id: `imp-${uid}`,
        nome: '',
        preco: 0,
        categoriaNome: catName,
        categoriaId: catId,
        destinoImpressao: inferCategoryPrintDestination(catName),
        descricao: '',
        needsReview: true,
        reviewReason: 'Novo item manual',
        selected: true,
      },
    ]);
  };

  const handlePublish = async () => {
    setError('');
    const toPublish = items.filter((item) => item.selected && item.nome.trim().length > 0);
    if (toPublish.length === 0) {
      setError('Marque ao menos um produto com nome válido para publicar.');
      return;
    }
    const invalidPrice = toPublish.find((item) => !Number.isFinite(item.preco) || item.preco < 0);
    if (invalidPrice) {
      setError(`Corrija o preço de "${invalidPrice.nome}" antes de publicar.`);
      return;
    }

    setSubmitting(true);
    try {
      const categoriesMap = new Map<string, { id: string; nome: string; destino_impressao: string }>();
      for (const item of toPublish) {
        const existing = existingCategories.find((c) => c.id === item.categoriaId);
        if (!categoriesMap.has(item.categoriaId)) {
          categoriesMap.set(item.categoriaId, {
            id: item.categoriaId,
            nome: existing?.nome || item.categoriaNome || 'Geral',
            destino_impressao: existing?.destino_impressao || item.destinoImpressao || 'COZINHA',
          });
        }
      }

      const response = await fetch(`${apiBaseUrl}/produtos/importar`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'merge',
          ...(activeCardapioId ? { cardapio_id: activeCardapioId } : {}),
          categories: Array.from(categoriesMap.values()),
          products: toPublish.map((item) => ({
            id: item.id,
            nome: item.nome.trim(),
            preco: Math.round(item.preco * 100) / 100,
            categoria_id: item.categoriaId,
            descricao: item.descricao.trim(),
            ativo: true,
          })),
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.detail || 'Não foi possível publicar os produtos importados.');
      }
      const createdList = Array.isArray(body) ? body : toPublish;
      setImportedCount(createdList.length);
      await onImported();
      setStep('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao publicar cardápio.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-2 sm:p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) handleClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="quick-import-title"
        className="flex max-h-[92dvh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-koma-border bg-koma-card text-koma-foreground shadow-2xl"
      >
        <header className="flex items-center justify-between gap-3 border-b border-koma-border bg-koma-panel px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2.5 min-w-0">
            <FileSpreadsheet size={18} className="shrink-0 text-emerald-500" />
            <div className="min-w-0">
              <h2 id="quick-import-title" className="truncate text-sm font-bold sm:text-base">
                Importar cardápio em massa
              </h2>
              <p className="text-[11px] text-koma-muted">
                Cole texto do WhatsApp, planilha (Excel/Sheets) ou envie CSV. Produtos existentes são preservados.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Fechar importação em massa"
            className="grid min-h-11 min-w-11 shrink-0 place-items-center rounded-xl border border-koma-border bg-koma-card text-koma-muted hover:text-koma-foreground cursor-pointer"
          >
            <X size={18} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
          {error && (
            <div role="alert" className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-xs font-semibold text-rose-500">
              {error}
            </div>
          )}

          {step === 'input' && (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                <label className="block space-y-1 text-xs">
                  <span className="font-semibold text-koma-secondary">Categoria padrão para itens sem grupo</span>
                  <input
                    type="text"
                    value={defaultCategory}
                    onChange={(e) => setDefaultCategory(e.target.value)}
                    placeholder="Ex.: Lanches"
                    className="min-h-11 w-full rounded-xl border border-koma-border bg-koma-input px-3 text-xs text-koma-foreground outline-none focus:border-koma-border-strong"
                  />
                </label>

                <div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,.tsv,.txt,text/csv,text/plain"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-koma-border bg-koma-raised px-4 text-xs font-bold text-koma-foreground hover:bg-koma-panel cursor-pointer"
                  >
                    <Upload size={15} /> Enviar CSV / TSV / TXT
                  </button>
                </div>
              </div>

              <label className="block space-y-1.5 text-xs">
                <span className="font-semibold text-koma-secondary">
                  Cole aqui o cardápio (WhatsApp, lista com preços ou células do Excel)
                </span>
                <textarea
                  rows={10}
                  value={rawText}
                  onChange={(e) => setRawText(e.target.value)}
                  placeholder={`Exemplo WhatsApp:\n*HAMBÚRGUERES*\nX-Burguer - R$ 22,00\nX-Bacon (Pão, carne 160g, bacon) - R$ 27,50\n\nBEBIDAS:\nCoca-Cola Lata - R$ 6,00`}
                  className="w-full rounded-xl border border-koma-border bg-koma-input p-3 font-mono text-xs text-koma-foreground outline-none focus:border-koma-border-strong"
                />
              </label>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                <span className="text-[11px] text-koma-muted">
                  Nenhum preço ou ingrediente é inventado: linhas sem valor ficam marcadas para você revisar.
                </span>
                <button
                  type="button"
                  onClick={handleParse}
                  disabled={!rawText.trim()}
                  className="inline-flex min-h-11 items-center gap-2 rounded-xl px-5 text-xs font-bold disabled:opacity-40 cursor-pointer"
                  style={{ background: 'var(--koma-action-bg)', color: 'var(--koma-action-text)' }}
                >
                  Estruturar prévia
                </button>
              </div>
            </div>
          )}

          {step === 'preview' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-koma-border bg-koma-panel p-3">
                <div className="flex flex-wrap items-center gap-3 text-xs">
                  <strong className="text-koma-foreground">{selectedItems.length} de {items.length} selecionados</strong>
                  {reviewPendingCount > 0 && (
                    <button
                      type="button"
                      onClick={() => setOnlyNeedsReview((v) => !v)}
                      className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 text-[11px] font-bold text-amber-400 cursor-pointer"
                    >
                      <AlertTriangle size={13} />
                      {reviewPendingCount} para revisar {onlyNeedsReview ? '(ver todos)' : '(filtrar)'}
                    </button>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    value={bulkCategoryName}
                    onChange={(e) => setBulkCategoryName(e.target.value)}
                    placeholder="Categoria p/ marcados..."
                    list="koma-existing-categories"
                    className="min-h-10 rounded-lg border border-koma-border bg-koma-input px-3 text-xs text-koma-foreground outline-none"
                  />
                  <datalist id="koma-existing-categories">
                    {existingCategories.map((cat) => (
                      <option key={cat.id} value={cat.nome} />
                    ))}
                  </datalist>
                  <button
                    type="button"
                    onClick={applyBulkCategory}
                    disabled={!bulkCategoryName.trim() || selectedItems.length === 0}
                    className="min-h-10 rounded-lg border border-koma-border bg-koma-raised px-3 text-xs font-bold text-koma-foreground disabled:opacity-40 cursor-pointer"
                  >
                    Aplicar categoria
                  </button>
                  <button
                    type="button"
                    onClick={addManualRow}
                    className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-koma-border bg-koma-card px-3 text-xs font-semibold text-koma-foreground cursor-pointer"
                  >
                    <Plus size={14} /> Linha
                  </button>
                </div>
              </div>

              {warnings.length > 0 && (
                <div className="rounded-xl border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                  {warnings.map((w) => <p key={w}>{w}</p>)}
                </div>
              )}

              <div className="space-y-2">
                {visibleItems.map((item) => (
                  <div
                    key={item.clientId}
                    className={`grid grid-cols-1 gap-2 rounded-xl border p-3 sm:grid-cols-[auto_1.5fr_0.8fr_1fr_auto] sm:items-center ${
                      item.needsReview
                        ? 'border-amber-500/50 bg-amber-500/5'
                        : 'border-koma-border bg-koma-panel'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={item.selected}
                      onChange={(e) => updateItem(item.clientId, { selected: e.target.checked })}
                      aria-label={`Importar ${item.nome || 'item'}`}
                      className="h-5 w-5 accent-[var(--koma-action-bg)]"
                    />
                    <div className="space-y-1">
                      <input
                        type="text"
                        value={item.nome}
                        onChange={(e) => updateItem(item.clientId, { nome: e.target.value })}
                        placeholder="Nome do produto"
                        aria-label="Nome do produto"
                        className="min-h-10 w-full rounded-lg border border-koma-border bg-koma-input px-2.5 text-xs font-semibold text-koma-foreground outline-none"
                      />
                      <input
                        type="text"
                        value={item.descricao}
                        onChange={(e) => updateItem(item.clientId, { descricao: e.target.value })}
                        placeholder="Descrição opcional"
                        aria-label="Descrição do produto"
                        className="min-h-9 w-full rounded-lg border border-koma-border bg-koma-card px-2.5 text-[11px] text-koma-secondary outline-none"
                      />
                    </div>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={item.preco}
                      onChange={(e) => updateItem(item.clientId, { preco: Number(e.target.value) || 0 })}
                      aria-label={`Preço de ${item.nome}`}
                      className="min-h-10 w-full rounded-lg border border-koma-border bg-koma-input px-2.5 text-xs font-bold tabular-nums text-koma-foreground outline-none"
                    />
                    <input
                      type="text"
                      value={item.categoriaNome}
                      onChange={(e) => updateItem(item.clientId, { categoriaNome: e.target.value })}
                      list="koma-existing-categories"
                      aria-label={`Categoria de ${item.nome}`}
                      className="min-h-10 w-full rounded-lg border border-koma-border bg-koma-input px-2.5 text-xs text-koma-foreground outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setItems((current) => current.filter((row) => row.clientId !== item.clientId))}
                      aria-label={`Remover ${item.nome || 'linha'} da importação`}
                      className="grid min-h-10 min-w-10 place-items-center rounded-lg border border-koma-border text-rose-500 hover:bg-rose-500/10 cursor-pointer"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {step === 'done' && (
            <div className="py-8 text-center space-y-3">
              <CheckCircle2 size={36} className="mx-auto text-emerald-500" />
              <h3 className="text-base font-bold text-koma-foreground">
                {importedCount} {importedCount === 1 ? 'produto publicado' : 'produtos publicados'} no cardápio
              </h3>
              <p className="text-xs text-koma-muted">
                Os produtos existentes foram preservados e as novas categorias já estão disponíveis para edição em lote.
              </p>
            </div>
          )}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-koma-border bg-koma-panel px-4 py-3 sm:px-6">
          {step === 'preview' ? (
            <>
              <button
                type="button"
                disabled={submitting}
                onClick={() => setStep('input')}
                className="min-h-11 rounded-xl border border-koma-border bg-koma-card px-4 text-xs font-semibold text-koma-foreground cursor-pointer"
              >
                Voltar e editar texto
              </button>
              <button
                type="button"
                disabled={submitting || selectedItems.length === 0}
                onClick={() => void handlePublish()}
                className="inline-flex min-h-11 items-center gap-2 rounded-xl px-5 text-xs font-bold disabled:opacity-40 cursor-pointer"
                style={{ background: 'var(--koma-action-bg)', color: 'var(--koma-action-text)' }}
              >
                {submitting && <RefreshCw size={14} className="animate-spin" />}
                {submitting ? 'Publicando…' : `Publicar ${selectedItems.length} item(ns)`}
              </button>
            </>
          ) : step === 'done' ? (
            <button
              type="button"
              onClick={handleClose}
              className="ml-auto min-h-11 rounded-xl px-5 text-xs font-bold cursor-pointer"
              style={{ background: 'var(--koma-action-bg)', color: 'var(--koma-action-text)' }}
            >
              Concluir
            </button>
          ) : (
            <button
              type="button"
              onClick={handleClose}
              className="ml-auto min-h-11 rounded-xl border border-koma-border bg-koma-card px-4 text-xs font-semibold text-koma-foreground cursor-pointer"
            >
              Cancelar
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
