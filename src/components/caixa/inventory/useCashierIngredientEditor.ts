import { useState } from 'react';

type BoundaryProps = {
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
  refreshEstoqueData: () => void;
};

/** Owns ingredient drafts and save/adjust actions; retained across inventory navigation. */
export function useCashierIngredientEditor({ apiBaseUrl, authHeaders, refreshEstoqueData }: BoundaryProps) {
  const [showNewInsumoModal, setShowNewInsumoModal] = useState(false);

  const [showEditInsumoModal, setShowEditInsumoModal] = useState(false);

  const [showAjusteInsumoModal, setShowAjusteInsumoModal] = useState(false);

  const [selectedInsumo, setSelectedInsumo] = useState<any>(null);

  const [insumoFormNome, setInsumoFormNome] = useState('');

  const [insumoFormMinimo, setInsumoFormMinimo] = useState<number>(10);

  const [insumoFormMaximo, setInsumoFormMaximo] = useState<number>(50);

  const [insumoFormUnidade, setInsumoFormUnidade] = useState('un');

  const [insumoFormCusto, setInsumoFormCusto] = useState<number>(0);

  const [ajusteQtd, setAjusteQtd] = useState<number>(0);

  const [ajusteTipo, setAjusteTipo] = useState<'ENTRADA' | 'SAIDA'>('ENTRADA');

  const [ajusteJustificativa, setAjusteJustificativa] = useState('');

  const handleSaveInsumo = async (isNew: boolean) => {
    try {
      const url = isNew
        ? `${apiBaseUrl}/estoque/insumos`
        : `${apiBaseUrl}/estoque/insumos/${selectedInsumo.id}`;
      const method = isNew ? 'POST' : 'PUT';
      const body: any = {
        nome: insumoFormNome,
        estoque_minimo: Number(insumoFormMinimo),
        estoque_maximo: Number(insumoFormMaximo),
        unidade_medida: insumoFormUnidade,
        preco_medio_custo: Number(insumoFormCusto),
      };

      const res = await fetch(url, {
        method,
        headers: {
          ...authHeaders,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        alert(isNew ? 'Ingrediente cadastrado com sucesso!' : 'Ingrediente atualizado com sucesso!');
        setShowNewInsumoModal(false);
        setShowEditInsumoModal(false);
        refreshEstoqueData();
      } else {
        const err = await res.json();
        alert(err.detail || 'Erro ao salvar ingrediente.');
      }
    } catch (e) {
      console.error(e);
      alert('Erro de conexão ao salvar ingrediente.');
    }
  };

  const handleAjustarEstoque = async () => {
    try {
      const res = await fetch(`${apiBaseUrl}/estoque/insumos/${selectedInsumo.id}/ajustar`, {
        method: 'POST',
        headers: {
          ...authHeaders,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          quantidade: Number(ajusteQtd),
          tipo: ajusteTipo,
          justificativa: ajusteJustificativa,
        }),
      });

      if (res.ok) {
        alert('Ajuste de estoque realizado com sucesso!');
        setShowAjusteInsumoModal(false);
        refreshEstoqueData();
      } else {
        const err = await res.json();
        alert(err.detail || 'Erro ao ajustar estoque.');
      }
    } catch (e) {
      console.error(e);
      alert('Erro de conexão ao ajustar estoque.');
    }
  };
  return {
    showNewInsumoModal,
    setShowNewInsumoModal,
    showEditInsumoModal,
    setShowEditInsumoModal,
    showAjusteInsumoModal,
    setShowAjusteInsumoModal,
    selectedInsumo,
    setSelectedInsumo,
    insumoFormNome,
    setInsumoFormNome,
    insumoFormMinimo,
    setInsumoFormMinimo,
    insumoFormMaximo,
    setInsumoFormMaximo,
    insumoFormUnidade,
    setInsumoFormUnidade,
    insumoFormCusto,
    setInsumoFormCusto,
    ajusteQtd,
    setAjusteQtd,
    ajusteTipo,
    setAjusteTipo,
    ajusteJustificativa,
    setAjusteJustificativa,
    handleSaveInsumo,
    handleAjustarEstoque,
  };
}
