import { useEffect, useMemo, useState } from 'react';
import {
  Distribuidor,
  EntradaEstoque,
  FichaTecnicaProduto,
  Insumo,
  MovimentacaoEstoque,
  SessaoContagemEstoque,
} from '../../../types';

type BoundaryProps = {
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
  activeTab: string;
  activeSubTab: string;
};

/** Owns inventory snapshots, refresh and derived insights; active views share this single snapshot. */
export function useCashierInventoryData({ apiBaseUrl, authHeaders, activeTab, activeSubTab }: BoundaryProps) {
  const [estoqueInsumos, setEstoqueInsumos] = useState<Insumo[]>([]);

  const [notasEntrada, setNotasEntrada] = useState<
    {
      id: string;
      numero_nota: string;
      chave_acesso: string;
      data_emissao: string;
      valor_total: number;
      distribuidor: { nome_fantasia: string; cnpj: string } | null;
    }[]
  >([]);

  const [distribuidores, setDistribuidores] = useState<Distribuidor[]>([]);

  const [entradasEstoque, setEntradasEstoque] = useState<EntradaEstoque[]>([]);

  const [movimentacoesEstoque, setMovimentacoesEstoque] = useState<MovimentacaoEstoque[]>([]);

  const [sessoesContagemEstoque, setSessoesContagemEstoque] = useState<SessaoContagemEstoque[]>([]);

  const [fichasTecnicas, setFichasTecnicas] = useState<FichaTecnicaProduto[]>([]);

  const estoqueInsights = useMemo(() => {
    const low = estoqueInsumos.filter(
      (item) => Number(item.estoque_atual || 0) <= Number(item.estoque_minimo || 0),
    ).length;
    const negative = estoqueInsumos.filter((item) => Number(item.estoque_atual || 0) < 0).length;
    const activeProducts = fichasTecnicas.filter((item) => item.produto_ativo).length;
    const linkedProducts = fichasTecnicas.filter(
      (item) => item.produto_ativo && item.itens.length > 0,
    ).length;
    const inventoryValue = estoqueInsumos.reduce(
      (sum, item) => sum + Math.max(0, Number(item.estoque_atual || 0)) * Number(item.preco_medio_custo || 0),
      0,
    );
    const drafts = sessoesContagemEstoque.filter((item) => item.status === 'rascunho').length;
    return { low, negative, activeProducts, linkedProducts, inventoryValue, drafts };
  }, [estoqueInsumos, fichasTecnicas, sessoesContagemEstoque]);

  const refreshEstoqueData = () => {
    fetch(`${apiBaseUrl}/estoque/insumos`, { headers: authHeaders })
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) setEstoqueInsumos(data);
      })
      .catch((err) => console.error('Error fetching insumos:', err));

    fetch(`${apiBaseUrl}/estoque/distribuidores`, { headers: authHeaders })
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) setDistribuidores(data);
      })
      .catch((err) => console.error('Error fetching distribuidores:', err));

    fetch(`${apiBaseUrl}/estoque/fichas-tecnicas`, { headers: authHeaders })
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) setFichasTecnicas(data);
      })
      .catch((err) => console.error('Error fetching fichas tecnicas:', err));
  };

  useEffect(() => {
    if (activeTab === 'estoque') {
      fetch(`${apiBaseUrl}/estoque/insumos`, { headers: authHeaders })
        .then((res) => res.json())
        .then((data) => {
          if (Array.isArray(data)) setEstoqueInsumos(data);
        })
        .catch((err) => console.error('Error fetching insumos:', err));

      fetch(`${apiBaseUrl}/estoque/notas`, { headers: authHeaders })
        .then((res) => res.json())
        .then((data) => {
          if (Array.isArray(data)) setNotasEntrada(data);
        })
        .catch((err) => console.error('Error fetching notas:', err));

      fetch(`${apiBaseUrl}/estoque/distribuidores`, { headers: authHeaders })
        .then((res) => res.json())
        .then((data) => {
          if (Array.isArray(data)) setDistribuidores(data);
        })
        .catch((err) => console.error('Error fetching distribuidores:', err));

      fetch(`${apiBaseUrl}/estoque/entradas`, { headers: authHeaders })
        .then((res) => res.json())
        .then((data) => {
          if (Array.isArray(data)) setEntradasEstoque(data);
        })
        .catch((err) => console.error('Error fetching entradas:', err));

      fetch(`${apiBaseUrl}/estoque/movimentacoes`, { headers: authHeaders })
        .then((res) => res.json())
        .then((data) => {
          if (Array.isArray(data)) setMovimentacoesEstoque(data);
        })
        .catch((err) => console.error('Error fetching movimentacoes:', err));

      fetch(`${apiBaseUrl}/estoque/contagens`, { headers: authHeaders })
        .then((res) => res.json())
        .then((data) => {
          if (Array.isArray(data)) setSessoesContagemEstoque(data);
        })
        .catch((err) => console.error('Error fetching contagens:', err));

      fetch(`${apiBaseUrl}/estoque/fichas-tecnicas`, { headers: authHeaders })
        .then((res) => res.json())
        .then((data) => {
          if (Array.isArray(data)) setFichasTecnicas(data);
        })
        .catch((err) => console.error('Error fetching fichas tecnicas:', err));
    }
  }, [activeTab, activeSubTab, apiBaseUrl, authHeaders.Authorization]);
  return {
    estoqueInsumos,
    setEstoqueInsumos,
    notasEntrada,
    setNotasEntrada,
    distribuidores,
    setDistribuidores,
    entradasEstoque,
    setEntradasEstoque,
    movimentacoesEstoque,
    setMovimentacoesEstoque,
    sessoesContagemEstoque,
    setSessoesContagemEstoque,
    fichasTecnicas,
    setFichasTecnicas,
    estoqueInsights,
    refreshEstoqueData,
  };
}
