import React, { useState } from 'react';
import clsx from 'clsx';
import { Edit3, Trash2, Plus } from 'lucide-react';
import { CategoriaModal, DeleteCategoryModal, CategoryData } from './CategoriaModal';

interface CardapioCategoriasTabProps {
  apiCategorias: any[];
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
  fetchCategorias: () => Promise<void>;
  showToast?: (message: string, type?: 'success' | 'error') => void;
}

export function CardapioCategoriasTab({
  apiCategorias,
  apiBaseUrl,
  authHeaders,
  fetchCategorias,
  showToast
}: CardapioCategoriasTabProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<CategoryData | null>(null);

  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deletingCategory, setDeletingCategory] = useState<CategoryData | null>(null);

  const handleOpenCreate = () => {
    setEditingCategory(null);
    setModalOpen(true);
  };

  const handleOpenEdit = (cat: CategoryData) => {
    setEditingCategory(cat);
    setModalOpen(true);
  };

  const handleOpenDelete = (cat: CategoryData) => {
    setDeletingCategory(cat);
    setDeleteModalOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!deletingCategory) return;
    try {
      const res = await fetch(`${apiBaseUrl}/produtos/categorias/${deletingCategory.id}`, {
        method: 'DELETE',
        headers: authHeaders
      });

      if (res.ok) {
        if (showToast) showToast('Categoria excluída com sucesso!', 'success');
        await fetchCategorias();
      } else {
        const errData = await res.json().catch(() => ({}));
        if (showToast) showToast(`Erro: ${errData.detail || 'Falha ao excluir.'}`, 'error');
      }
    } catch (e) {
      console.error(e);
      if (showToast) showToast('Erro de conexão ao excluir categoria.', 'error');
    }
  };

  return (
    <div className={clsx('space-y-4', 'animate-fade-in', 'text-left')}>
      {/* Header */}
      <div className={clsx('flex', 'justify-between', 'items-center')}>
        <div>
          <span className={clsx('font-serif', 'font-bold', 'text-gray-300', 'text-base', 'block')}>Categorias do Cardápio</span>
          <span className={clsx('text-[9px]', 'text-gray-500')}>{apiCategorias.length} categorias cadastradas</span>
        </div>
        <button
          onClick={handleOpenCreate}
          className={clsx('flex', 'items-center', 'gap-1.5', 'px-3', 'py-1.5', 'bg-[#10b981]', 'hover:bg-[#059669]', 'text-[#121214]', 'rounded-xl', 'text-[9px]', 'font-bold', 'uppercase', 'tracking-wider', 'transition-all', 'cursor-pointer', 'shadow-md')}
        >
          <Plus size={12} />
          Nova Categoria
        </button>
      </div>

      {/* Categories Table */}
      <div className={clsx('bg-[#121214]/50', 'border', 'border-[#27272A]', 'rounded-3xl', 'overflow-hidden')}>
        <div className={clsx('overflow-x-auto')}>
          <table className={clsx('w-full', 'text-left', 'border-collapse', 'font-sans', 'text-[11px]')}>
            <thead>
              <tr className={clsx('border-b', 'border-[#27272A]', 'bg-[#18181B]/50', 'text-gray-400', 'font-bold', 'uppercase', 'tracking-wider')}>
                <th className={clsx('p-4')}>Nome</th>
                <th className={clsx('p-4')}>Impressão</th>
                <th className={clsx('p-4', 'text-right')}>Ações</th>
              </tr>
            </thead>
            <tbody className={clsx('divide-y', 'divide-[#27272A]/40')}>
              {apiCategorias.map((cat) => (
                <tr key={cat.id} className={clsx('hover:bg-[#1C1C1F]/30', 'transition-colors', 'text-white')}>
                  <td className={clsx('p-4', 'font-semibold')}>{cat.nome}</td>
                  <td className={clsx('p-4')}>
                    <span className={clsx('px-2.5', 'py-1', 'text-[9px]', 'font-bold', 'rounded-lg', 'border', 
                      cat.destino_impressao === 'COZINHA' 
                        ? 'bg-orange-500/10 text-orange-400 border-orange-500/20' 
                        : cat.destino_impressao === 'BAR' 
                          ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' 
                          : 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20'
                    )}>
                      {cat.destino_impressao === 'COZINHA' ? '🍳 Cozinha' : cat.destino_impressao === 'BAR' ? '🍹 Bar' : '🚫 Não Imprime'}
                    </span>
                  </td>
                  <td className={clsx('p-4', 'text-right')}>
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        onClick={() => handleOpenEdit(cat)}
                        className="flex items-center gap-1 px-2.5 py-1.5 border border-zinc-800 hover:border-zinc-700 bg-zinc-900/60 hover:bg-zinc-800 text-gray-300 hover:text-white rounded-xl transition-all cursor-pointer font-semibold text-[10px]"
                      >
                        <Edit3 size={11} />
                        Editar
                      </button>
                      <button
                        onClick={() => handleOpenDelete(cat)}
                        className="flex items-center gap-1 px-2.5 py-1.5 border border-red-900/40 hover:border-red-600/30 bg-red-950/30 hover:bg-red-900/40 text-red-400 hover:text-red-300 rounded-xl transition-all cursor-pointer font-semibold text-[10px]"
                      >
                        <Trash2 size={11} />
                        Excluir
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {apiCategorias.length === 0 && (
                <tr>
                  <td colSpan={3} className="p-8 text-center text-gray-500 text-xs italic">
                    Nenhuma categoria cadastrada. Clique em "Nova Categoria" acima para criar a primeira.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Categoria Modal (Create & Edit) */}
      <CategoriaModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        categoryToEdit={editingCategory}
        apiBaseUrl={apiBaseUrl}
        authHeaders={authHeaders}
        onSuccess={fetchCategorias}
        showToast={showToast}
      />

      {/* Delete Category Confirmation Modal */}
      <DeleteCategoryModal
        isOpen={deleteModalOpen}
        categoryName={deletingCategory?.nome || ''}
        onClose={() => setDeleteModalOpen(false)}
        onConfirm={handleDeleteConfirm}
      />
    </div>
  );
}
