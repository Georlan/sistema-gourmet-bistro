import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Distribuidor,
  EntradaEstoque,
  FichaTecnicaProduto,
  Insumo,
  MovimentacaoEstoque,
  SessaoContagemEstoque,
} from '../../../types';

import { inventoryResources, inventoryResourcesForTab, type InventoryResource } from './inventoryResources';

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

  const setters = useMemo(() => ({
    insumos: setEstoqueInsumos,
    notas: setNotasEntrada,
    distribuidores: setDistribuidores,
    entradas: setEntradasEstoque,
    movimentacoes: setMovimentacoesEstoque,
    contagens: setSessoesContagemEstoque,
    fichas: setFichasTecnicas,
  }), []);
  const requests = useRef(new Map<InventoryResource, AbortController>());

  const refreshInventory = useCallback(async (...resources: InventoryResource[]) => {
    await Promise.all([...new Set(resources)].map(async (resource) => {
      requests.current.get(resource)?.abort();
      const controller = new AbortController();
      requests.current.set(resource, controller);
      try {
        const response = await fetch(`${apiBaseUrl}/estoque/${inventoryResources[resource]}`, {
          headers: authHeaders, signal: controller.signal,
        });
        if (!response.ok) throw new Error(`INVENTORY_HTTP_${response.status}`);
        const data = await response.json();
        if (!controller.signal.aborted && Array.isArray(data)) setters[resource](data);
      } catch (error) {
        if (!controller.signal.aborted) console.error('Error fetching inventory:', resource, error);
      } finally {
        if (requests.current.get(resource) === controller) requests.current.delete(resource);
      }
    }));
  }, [apiBaseUrl, authHeaders, setters]);

  useEffect(() => {
    if (activeTab === 'estoque') void refreshInventory(...inventoryResourcesForTab(activeSubTab));
    return () => {
      for (const controller of requests.current.values()) controller.abort();
      requests.current.clear();
    };
  }, [activeTab, activeSubTab, refreshInventory]);

  return {
    estoqueInsumos, notasEntrada, distribuidores, entradasEstoque,
    movimentacoesEstoque, sessoesContagemEstoque, fichasTecnicas,
    setFichasTecnicas, estoqueInsights, refreshInventory,
  };
}
