import { useRef, useState } from 'react';
import { ContagemEstoqueModal } from '../../estoque/ContagemEstoqueModal';
import { EntradaManualModal } from '../../estoque/EntradaManualModal';
import { EstoqueContagemTab } from '../../estoque/EstoqueContagemTab';
import { EstoqueHistoricoTab } from '../../estoque/EstoqueHistoricoTab';
import { FichaTecnicaModal } from '../../estoque/FichaTecnicaModal';
import { MovimentacaoEstoqueModal } from '../../estoque/MovimentacaoEstoqueModal';
import type { CashierNotice } from '../cashierContracts';
import { useCashierInventoryData } from './useCashierInventoryData';

type BoundaryProps = Pick<
  ReturnType<typeof useCashierInventoryData>,
  'refreshInventory' | 'setFichasTecnicas'
> & { apiBaseUrl: string; authHeaders: Record<string, string>; showToast: CashierNotice };

/** Owns stock operation forms, XML upload and mutations; all views share the inventory snapshot. */
export function useCashierInventoryOperations({
  apiBaseUrl,
  authHeaders,
  refreshInventory,
  setFichasTecnicas,
  showToast,
}: BoundaryProps) {
  const [showFichaTecnicaModal, setShowFichaTecnicaModal] = useState(false);

  const [showEntradaManualModal, setShowEntradaManualModal] = useState<boolean>(false);

  const [showMovimentacaoModal, setShowMovimentacaoModal] = useState<boolean>(false);

  const [showContagemModal, setShowContagemModal] = useState<boolean>(false);

  const [selectedContagemId, setSelectedContagemId] = useState<string | null>(null);

  const [xmlUploadState, setXmlUploadState] = useState<{
    loading: boolean;
    result: any | null;
    error: string | null;
    isDragging: boolean;
  }>({ loading: false, result: null, error: null, isDragging: false });

  const xmlFileInputRef = useRef<HTMLInputElement>(null);

  const uploadXml: NonNullable<React.ComponentProps<typeof EstoqueHistoricoTab>['onUploadXmlFile']> = async (
    file: File,
  ) => {
    if (!file || !file.name.endsWith('.xml')) {
      setXmlUploadState((s) => ({
        ...s,
        error: 'Por favor, selecione um arquivo .xml válido.',
        result: null,
      }));
      return;
    }
    setXmlUploadState((s) => ({ ...s, loading: true, error: null, result: null }));
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetch(`${apiBaseUrl}/estoque/importar-xml`, {
        method: 'POST',
        headers: authHeaders,
        body: formData,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.detail || 'Erro ao importar XML.');
      setXmlUploadState((s) => ({ ...s, loading: false, result: json }));
      // The data owner controls reads; mutations name only the affected resources.
      void refreshInventory('insumos', 'notas', 'entradas', 'distribuidores');
    } catch (err: any) {
      setXmlUploadState((s) => ({
        ...s,
        loading: false,
        error: err.message || 'Erro desconhecido.',
      }));
    }
  };

  const refreshHistory: NonNullable<React.ComponentProps<typeof EstoqueHistoricoTab>['onRefresh']> = () => {
    void refreshInventory('entradas', 'movimentacoes', 'notas');
  };

  const refreshCounts: NonNullable<
    React.ComponentProps<typeof EstoqueContagemTab>['onRefreshContagens']
  > = () => {
    void refreshInventory('contagens');
  };

  const saveRecipe: NonNullable<React.ComponentProps<typeof FichaTecnicaModal>['onSave']> = async (
    produtoId,
    itens,
  ) => {
    try {
      const response = await fetch(`${apiBaseUrl}/estoque/fichas-tecnicas/${produtoId}`, {
        method: 'PUT',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ itens }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || 'Não foi possível salvar a ficha técnica.');
      setFichasTecnicas((current) => {
        const remaining = current.filter((item) => item.produto_id !== produtoId);
        return [...remaining, data].sort((left, right) =>
          left.produto_nome.localeCompare(right.produto_nome, 'pt-BR'),
        );
      });
      showToast('Ficha técnica salva. As próximas vendas já baixarão o estoque.');
      return true;
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Erro ao salvar ficha técnica.', 'error');
      return false;
    }
  };

  const registerEntry: NonNullable<React.ComponentProps<typeof EntradaManualModal>['onSubmit']> = async (
    payload,
  ) => {
    const res = await fetch(`${apiBaseUrl}/estoque/entradas/manual`, {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.detail || 'Erro ao gravar entrada manual.');
    showToast('Entrada manual gravada com sucesso!');
    void refreshInventory('insumos', 'entradas', 'movimentacoes');
  };

  const registerMovement: NonNullable<
    React.ComponentProps<typeof MovimentacaoEstoqueModal>['onSubmit']
  > = async (payload) => {
    const res = await fetch(`${apiBaseUrl}/estoque/movimentacoes`, {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.detail || 'Erro ao salvar movimentação.');
    showToast('Movimentação de estoque gravada!');
    void refreshInventory('insumos', 'movimentacoes');
  };

  const saveCountDraft: NonNullable<
    React.ComponentProps<typeof ContagemEstoqueModal>['onSaveDraft']
  > = async (payload) => {
    const url = selectedContagemId
      ? `${apiBaseUrl}/estoque/contagens/${selectedContagemId}`
      : `${apiBaseUrl}/estoque/contagens`;
    const method = selectedContagemId ? 'PUT' : 'POST';
    const res = await fetch(url, {
      method,
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.detail || 'Erro ao salvar rascunho de contagem.');
    showToast('Rascunho de contagem salvo com sucesso!');
    void refreshInventory('contagens');
  };

  const confirmCount: NonNullable<React.ComponentProps<typeof ContagemEstoqueModal>['onConfirm']> = async (
    payload,
  ) => {
    const url = selectedContagemId
      ? `${apiBaseUrl}/estoque/contagens/${selectedContagemId}`
      : `${apiBaseUrl}/estoque/contagens`;
    const method = selectedContagemId ? 'PUT' : 'POST';
    const res = await fetch(url, {
      method,
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.detail || 'Erro ao confirmar contagem.');
    showToast('Contagem confirmada e estoques ajustados!');
    void refreshInventory('insumos', 'movimentacoes', 'contagens');
  };
  return {
    showFichaTecnicaModal,
    setShowFichaTecnicaModal,
    showEntradaManualModal,
    setShowEntradaManualModal,
    showMovimentacaoModal,
    setShowMovimentacaoModal,
    showContagemModal,
    setShowContagemModal,
    selectedContagemId,
    setSelectedContagemId,
    xmlUploadState,
    setXmlUploadState,
    xmlFileInputRef,
    uploadXml,
    refreshHistory,
    refreshCounts,
    saveRecipe,
    registerEntry,
    registerMovement,
    saveCountDraft,
    confirmCount,
  };
}
