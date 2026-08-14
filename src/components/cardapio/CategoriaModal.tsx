import React, { useState, useEffect } from 'react';
import clsx from 'clsx';
import { X, Printer, Utensils, Wine, Ban, Check, Loader2 } from 'lucide-react';

export interface CategoryData {
  id: string;
  nome: string;
  destino_impressao: 'COZINHA' | 'BAR' | 'NENHUM' | string;
}

interface CategoriaModalProps {
  isOpen: boolean;
  onClose: () => void;
  categoryToEdit?: CategoryData | null;
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
  onSuccess: () => Promise<void>;
  showToast?: (message: string, type?: 'success' | 'error') => void;
}

export function CategoriaModal({
  isOpen,
  onClose,
  categoryToEdit,
  apiBaseUrl,
  authHeaders,
  onSuccess,
  showToast
}: CategoriaModalProps) {
  const isEditing = Boolean(categoryToEdit);
  const [nome, setNome] = useState('');
  const [id, setId] = useState('');
  const [destino, setDestino] = useState<'COZINHA' | 'BAR' | 'NENHUM'>('COZINHA');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (isOpen) {
      setErrorMsg('');
      if (categoryToEdit) {
        setNome(categoryToEdit.nome || '');
        setId(categoryToEdit.id || '');
        const dest = (categoryToEdit.destino_impressao || 'COZINHA').toUpperCase();
        setDestino(dest === 'BAR' ? 'BAR' : dest === 'NENHUM' ? 'NENHUM' : 'COZINHA');
      } else {
        setNome('');
        setId('');
        setDestino('COZINHA');
      }
    }
  }, [isOpen, categoryToEdit]);

  // Auto-generate ID slug from Name when creating
  const handleNomeChange = (val: string) => {
    setNome(val);
    if (!isEditing) {
      const generatedId = val
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
      setId(generatedId);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nome.trim()) {
      setErrorMsg('Digite um nome para a categoria.');
      return;
    }

    const generatedId = id.trim() || nome.trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || `cat_${Date.now()}`;

    const categoryId = isEditing ? categoryToEdit!.id : generatedId;
    if (!categoryId) {
      setErrorMsg('Informe o nome da categoria.');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg('');

    try {
      if (isEditing) {
        // PUT update
        const res = await fetch(`${apiBaseUrl}/produtos/categorias/${categoryId}`, {
          method: 'PUT',
          headers: {
            ...authHeaders,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            nome: nome.trim(),
            destino_impressao: destino
          })
        });

        if (res.ok) {
          if (showToast) showToast('Categoria atualizada com sucesso!', 'success');
          await onSuccess();
          onClose();
        } else {
          const errData = await res.json().catch(() => ({}));
          setErrorMsg(errData.detail || 'Falha ao atualizar categoria.');
        }
      } else {
        // POST create
        const res = await fetch(`${apiBaseUrl}/produtos/categorias`, {
          method: 'POST',
          headers: {
            ...authHeaders,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            id: categoryId,
            nome: nome.trim(),
            destino_impressao: destino
          })
        });

        if (res.ok) {
          if (showToast) showToast('Categoria criada com sucesso!', 'success');
          await onSuccess();
          onClose();
        } else {
          const errData = await res.json().catch(() => ({}));
          setErrorMsg(errData.detail || 'Falha ao criar categoria.');
        }
      }
    } catch (err) {
      console.error(err);
      setErrorMsg('Erro de conexão com o servidor.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fade-in">
      <div className="relative w-full max-w-lg bg-koma-dialog border border-koma-border rounded-3xl shadow-2xl overflow-hidden text-left font-sans">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-koma-border bg-koma-raised">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-[#10b981]/10 text-[#10b981] border border-[#10b981]/20">
              <Printer size={18} />
            </div>
            <div>
              <h3 className="font-serif text-base font-bold text-koma-foreground leading-tight">
                {isEditing ? 'Editar Categoria' : 'Nova Categoria'}
              </h3>
              <p className="text-[10px] text-koma-subtle">
                {isEditing ? 'Atualize as configurações de impressão e exibição' : 'Cadastre uma nova categoria para o cardápio'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-koma-subtle hover:text-koma-foreground rounded-xl bg-koma-card hover:bg-zinc-700 transition-colors cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {errorMsg && (
            <div className="p-3 bg-red-950/40 border border-red-900/50 rounded-xl text-red-400 text-xs font-medium">
              {errorMsg}
            </div>
          )}

          {/* Nome Input */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold text-koma-secondary uppercase tracking-wider block">
              Nome da Categoria
            </label>
            <input
              type="text"
              value={nome}
              onChange={(e) => handleNomeChange(e.target.value)}
              placeholder="Ex: Hambúrgueres Bovinos, Bebidas, Sobremesas..."
              className="w-full bg-koma-input border border-koma-border rounded-xl px-3.5 py-2.5 text-xs text-koma-foreground placeholder:text-gray-500 focus:outline-none focus:border-[#10b981] transition-colors font-medium"
              autoFocus
              required
            />
          </div>



          {/* Destino de Impressão Cards */}
          <div className="space-y-2 pt-1">
            <label className="text-[11px] font-bold text-koma-secondary uppercase tracking-wider block">
              Destino de Impressão de Pedidos
            </label>
            <p className="text-[10px] text-koma-subtle leading-normal">
              Escolha para onde os itens desta categoria serão enviados ao imprimir a via de preparação:
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
              {/* Option: COZINHA */}
              <button
                type="button"
                onClick={() => setDestino('COZINHA')}
                className={clsx(
                  'relative p-3 rounded-2xl border text-left transition-all cursor-pointer flex flex-col justify-between gap-2',
                  destino === 'COZINHA'
                    ? 'bg-orange-500/15 border-orange-500/50 shadow-lg shadow-orange-950/20'
                    : 'bg-koma-raised/60 border-koma-border hover:bg-koma-raised hover:border-gray-700'
                )}
              >
                <div className="flex justify-between items-center">
                  <div className={clsx('p-1.5 rounded-lg', destino === 'COZINHA' ? 'bg-orange-500/20 text-orange-400' : 'bg-koma-raised text-koma-subtle')}>
                    <Utensils size={15} />
                  </div>
                  {destino === 'COZINHA' && (
                    <div className="w-4 h-4 rounded-full bg-orange-500 text-black flex items-center justify-center">
                      <Check size={10} strokeWidth={3} />
                    </div>
                  )}
                </div>
                <div>
                  <span className={clsx('font-bold text-xs block', destino === 'COZINHA' ? 'text-orange-400' : 'text-koma-foreground')}>
                    Cozinha
                  </span>
                  <span className="text-[9px] text-koma-subtle block leading-tight mt-0.5">
                    Imprime na via da Cozinha
                  </span>
                </div>
              </button>

              {/* Option: BAR */}
              <button
                type="button"
                onClick={() => setDestino('BAR')}
                className={clsx(
                  'relative p-3 rounded-2xl border text-left transition-all cursor-pointer flex flex-col justify-between gap-2',
                  destino === 'BAR'
                    ? 'bg-blue-500/15 border-blue-500/50 shadow-lg shadow-blue-950/20'
                    : 'bg-koma-raised/60 border-koma-border hover:bg-koma-raised hover:border-gray-700'
                )}
              >
                <div className="flex justify-between items-center">
                  <div className={clsx('p-1.5 rounded-lg', destino === 'BAR' ? 'bg-blue-500/20 text-blue-400' : 'bg-koma-raised text-koma-subtle')}>
                    <Wine size={15} />
                  </div>
                  {destino === 'BAR' && (
                    <div className="w-4 h-4 rounded-full bg-blue-500 text-black flex items-center justify-center">
                      <Check size={10} strokeWidth={3} />
                    </div>
                  )}
                </div>
                <div>
                  <span className={clsx('font-bold text-xs block', destino === 'BAR' ? 'text-blue-400' : 'text-koma-foreground')}>
                    Bar
                  </span>
                  <span className="text-[9px] text-koma-subtle block leading-tight mt-0.5">
                    Imprime na via do Bar
                  </span>
                </div>
              </button>

              {/* Option: NENHUM */}
              <button
                type="button"
                onClick={() => setDestino('NENHUM')}
                className={clsx(
                  'relative p-3 rounded-2xl border text-left transition-all cursor-pointer flex flex-col justify-between gap-2',
                  destino === 'NENHUM'
                    ? 'bg-zinc-500/15 border-zinc-400/50 shadow-lg'
                    : 'bg-koma-raised/60 border-koma-border hover:bg-koma-raised hover:border-gray-700'
                )}
              >
                <div className="flex justify-between items-center">
                  <div className={clsx('p-1.5 rounded-lg', destino === 'NENHUM' ? 'bg-zinc-700 text-koma-secondary' : 'bg-koma-raised text-koma-subtle')}>
                    <Ban size={15} />
                  </div>
                  {destino === 'NENHUM' && (
                    <div className="w-4 h-4 rounded-full bg-zinc-400 text-black flex items-center justify-center">
                      <Check size={10} strokeWidth={3} />
                    </div>
                  )}
                </div>
                <div>
                  <span className={clsx('font-bold text-xs block', destino === 'NENHUM' ? 'text-koma-secondary' : 'text-koma-foreground')}>
                    Não Imprime
                  </span>
                  <span className="text-[9px] text-koma-subtle block leading-tight mt-0.5">
                    Sem via física de preparo
                  </span>
                </div>
              </button>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-koma-border">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 bg-koma-raised hover:bg-koma-card text-koma-secondary rounded-xl text-xs font-bold transition-all cursor-pointer border border-koma-border"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex items-center gap-2 px-5 py-2 bg-[#10b981] hover:bg-[#059669] text-zinc-950 rounded-xl text-xs font-bold uppercase tracking-wider transition-all cursor-pointer shadow-lg disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  <span>Salvando...</span>
                </>
              ) : (
                <span>{isEditing ? 'Salvar Alterações' : 'Criar Categoria'}</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface DeleteCategoryModalProps {
  isOpen: boolean;
  categoryName: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

export function DeleteCategoryModal({
  isOpen,
  categoryName,
  onClose,
  onConfirm
}: DeleteCategoryModalProps) {
  const [isDeleting, setIsDeleting] = useState(false);

  if (!isOpen) return null;

  const handleConfirm = async () => {
    setIsDeleting(true);
    try {
      await onConfirm();
    } finally {
      setIsDeleting(false);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fade-in">
      <div className="relative w-full max-w-md bg-koma-dialog border border-red-900/40 rounded-3xl shadow-2xl p-6 text-left space-y-4 font-sans">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-red-950/60 border border-red-900/60 text-red-400">
            <Ban size={22} />
          </div>
          <div>
            <h3 className="font-serif text-base font-bold text-koma-foreground">Excluir Categoria</h3>
            <p className="text-[10px] text-koma-subtle">Confirmação de exclusão permanente</p>
          </div>
        </div>

        <p className="text-xs text-koma-secondary leading-relaxed">
          Tem certeza que deseja excluir a categoria <strong className="text-koma-foreground font-bold">"{categoryName}"</strong>?
        </p>

        <div className="flex items-center justify-end gap-2.5 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isDeleting}
            className="px-4 py-2 bg-koma-raised hover:bg-koma-card text-koma-secondary rounded-xl text-xs font-bold transition-all cursor-pointer border border-koma-border"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isDeleting}
            className="flex items-center gap-1.5 px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-xl text-xs font-bold transition-all cursor-pointer shadow-lg disabled:opacity-50"
          >
            {isDeleting ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                <span>Excluindo...</span>
              </>
            ) : (
              <span>Sim, Excluir</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
