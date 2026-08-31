import clsx from 'clsx';
import { X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Distribuidor,
  EntradaEstoque,
  FichaTecnicaProduto,
  Insumo,
  MovimentacaoEstoque,
  Product,
  SessaoContagemEstoque,
} from '../../../types';
import { ContagemEstoqueModal } from '../../estoque/ContagemEstoqueModal';
import { EntradaManualModal } from '../../estoque/EntradaManualModal';
import { EstoqueContagemTab } from '../../estoque/EstoqueContagemTab';
import { EstoqueFornecedoresTab } from '../../estoque/EstoqueFornecedoresTab';
import { EstoqueHistoricoTab } from '../../estoque/EstoqueHistoricoTab';
import { EstoqueIngredientesTab } from '../../estoque/EstoqueIngredientesTab';
import { FichaTecnicaModal } from '../../estoque/FichaTecnicaModal';
import { MovimentacaoEstoqueModal } from '../../estoque/MovimentacaoEstoqueModal';
import MoneyInput from '../../MoneyInput';
import { OperationalBanner } from '../../shared/OperationalBanner';
import type { CashierNotice } from '../cashierContracts';
import { formatCompactCurrency } from '../cashierPresentation';

interface Props {
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
  activeTab: string;
  activeSubTab: string;
  setActiveSubTab: (tab: string) => void;
  showToast: CashierNotice;
  apiProdutos: Product[];
  isLoading: boolean;
}

export default function CashierInventory({
  apiBaseUrl,
  authHeaders,
  activeTab,
  activeSubTab,
  setActiveSubTab,
  showToast,
  apiProdutos,
  isLoading,
}: Props) {
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

  const [showFichaTecnicaModal, setShowFichaTecnicaModal] = useState(false);

  const estoqueInsights = useMemo(() => {
    const low = estoqueInsumos.filter(
      (item) => Number(item.estoque_atual || 0) <= Number(item.estoque_minimo || 0),
    ).length;
    const negative = estoqueInsumos.filter((item) => Number(item.estoque_atual || 0) < 0).length;
    const activeProducts = fichasTecnicas.filter((item) => item.produto_ativo).length;
    const linkedProducts = fichasTecnicas.filter((item) => item.produto_ativo && item.itens.length > 0).length;
    const inventoryValue = estoqueInsumos.reduce(
      (sum, item) => sum + Math.max(0, Number(item.estoque_atual || 0)) * Number(item.preco_medio_custo || 0),
      0,
    );
    const drafts = sessoesContagemEstoque.filter((item) => item.status === 'rascunho').length;
    return { low, negative, activeProducts, linkedProducts, inventoryValue, drafts };
  }, [estoqueInsumos, fichasTecnicas, sessoesContagemEstoque]);

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

  const [showNewDistModal, setShowNewDistModal] = useState(false);

  const [showEditDistModal, setShowEditDistModal] = useState(false);

  const [selectedDist, setSelectedDist] = useState<any>(null);

  const [distFormNomeFantasia, setDistFormNomeFantasia] = useState('');

  const [distFormRazaoSocial, setDistFormRazaoSocial] = useState('');

  const [distFormCnpj, setDistFormCnpj] = useState('');

  const [distFormLeadTime, setDistFormLeadTime] = useState<number>(3);

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

  const handleSaveInsumo = async (isNew: boolean) => {
    try {
      const url = isNew ? `${apiBaseUrl}/estoque/insumos` : `${apiBaseUrl}/estoque/insumos/${selectedInsumo.id}`;
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

  const handleSaveDistribuidor = async (isNew: boolean) => {
    try {
      const url = isNew
        ? `${apiBaseUrl}/estoque/distribuidores`
        : `${apiBaseUrl}/estoque/distribuidores/${selectedDist.id}`;
      const method = isNew ? 'POST' : 'PUT';
      const body: any = {
        nome_fantasia: distFormNomeFantasia,
        razao_social: distFormRazaoSocial || null,
        cnpj: distFormCnpj || null,
        lead_time_dias: Number(distFormLeadTime),
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
        alert(isNew ? 'Distribuidor cadastrado com sucesso!' : 'Distribuidor atualizado com sucesso!');
        setShowNewDistModal(false);
        setShowEditDistModal(false);
        refreshEstoqueData();
      } else {
        const err = await res.json();
        alert(err.detail || 'Erro ao salvar distribuidor.');
      }
    } catch (e) {
      console.error(e);
      alert('Erro de conexão ao salvar distribuidor.');
    }
  };

  const handleDeleteDistribuidor = async (distId: string) => {
    if (!confirm('Deseja realmente excluir este distribuidor?')) return;
    try {
      const res = await fetch(`${apiBaseUrl}/estoque/distribuidores/${distId}`, {
        method: 'DELETE',
        headers: authHeaders,
      });
      if (res.ok) {
        alert('Distribuidor excluído com sucesso!');
        refreshEstoqueData();
      } else {
        const err = await res.json();
        alert(err.detail || 'Erro ao excluir distribuidor.');
      }
    } catch (e) {
      console.error(e);
      alert('Erro de conexão.');
    }
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
  return (
    <>
      {activeTab === 'estoque' && activeSubTab === 'insumos' && (
        <div className="space-y-4">
          <OperationalBanner
            id="stock-ingredients-heading"
            eyebrow={estoqueInsumos.length === 0 ? 'PRIMEIROS PASSOS' : 'ESTOQUE CONECTADO'}
            title={estoqueInsumos.length === 0 ? 'Estoque' : 'Reposição'}
            accent={
              estoqueInsumos.length === 0
                ? 'pronto para configurar'
                : estoqueInsights.low > 0
                  ? 'pede atenção'
                  : 'em dia'
            }
            description={
              estoqueInsumos.length === 0
                ? 'Importe uma NF-e ou cadastre o primeiro ingrediente para começar o controle.'
                : estoqueInsights.linkedProducts > 0
                  ? 'Vendas com ficha técnica já baixam ingredientes automaticamente.'
                  : 'Monte fichas técnicas para ativar a baixa automática nas vendas.'
            }
            metrics={
              estoqueInsumos.length === 0
                ? []
                : [
                    { label: 'ingredientes', value: estoqueInsumos.length },
                    {
                      label: 'para repor',
                      value: estoqueInsights.low,
                      valueClassName:
                        estoqueInsights.low > 0
                          ? 'text-amber-600 dark:text-amber-300'
                          : 'text-emerald-600 dark:text-emerald-300',
                    },
                    {
                      label: 'produtos integrados',
                      value: `${estoqueInsights.linkedProducts}/${estoqueInsights.activeProducts}`,
                    },
                    { label: 'valor em estoque', value: formatCompactCurrency(estoqueInsights.inventoryValue) },
                  ]
            }
          />
          <EstoqueIngredientesTab
            insumos={estoqueInsumos}
            fichasTecnicas={fichasTecnicas}
            onOpenRecipes={() => setShowFichaTecnicaModal(true)}
            onImportXml={() => {
              setActiveSubTab('historico');
              window.setTimeout(() => xmlFileInputRef.current?.click(), 0);
            }}
            onCreate={() => {
              setInsumoFormNome('');
              setInsumoFormMinimo(10);
              setInsumoFormMaximo(50);
              setInsumoFormUnidade('un');
              setInsumoFormCusto(0);
              setShowNewInsumoModal(true);
            }}
            onAdjust={(insumo) => {
              setSelectedInsumo(insumo);
              setAjusteQtd(0);
              setAjusteTipo('ENTRADA');
              setAjusteJustificativa('');
              setShowAjusteInsumoModal(true);
            }}
            onEdit={(insumo) => {
              setSelectedInsumo(insumo);
              setInsumoFormNome(insumo.nome);
              setInsumoFormMinimo(insumo.estoque_minimo);
              setInsumoFormMaximo(insumo.estoque_maximo);
              setInsumoFormUnidade(insumo.unidade_medida);
              setInsumoFormCusto(insumo.preco_medio_custo);
              setShowEditInsumoModal(true);
            }}
          />
        </div>
      )}
      {activeTab === 'estoque' &&
        ['historico', 'entradas', 'xml', 'notas_entrada', 'movimentacoes'].includes(activeSubTab) && (
          <div className="space-y-4">
            <OperationalBanner
              id="stock-history-heading"
              eyebrow="HISTÓRICO DO ESTOQUE"
              title="Tudo que mudou"
              accent="em um só lugar"
              description="Compras, vendas, perdas, ajustes e inventários aparecem em uma única linha do tempo."
              metrics={
                movimentacoesEstoque.length === 0 && entradasEstoque.length === 0
                  ? []
                  : [
                      { label: 'movimentos', value: movimentacoesEstoque.length },
                      { label: 'entradas', value: entradasEstoque.length },
                      {
                        label: 'baixas por venda',
                        value: movimentacoesEstoque.filter((item) => item.origem === 'venda_automatica').length,
                      },
                      {
                        label: 'perdas',
                        value: movimentacoesEstoque.filter((item) => item.tipo === 'perda').length,
                        valueClassName: movimentacoesEstoque.some((item) => item.tipo === 'perda')
                          ? 'text-amber-600 dark:text-amber-300'
                          : undefined,
                      },
                    ]
              }
            />
            <EstoqueHistoricoTab
              entradas={entradasEstoque}
              notasEntradaXml={notasEntrada}
              movimentacoes={movimentacoesEstoque}
              insumos={estoqueInsumos}
              isLoading={isLoading}
              onOpenNovaEntradaModal={() => setShowEntradaManualModal(true)}
              onOpenNovaMovimentacaoModal={() => setShowMovimentacaoModal(true)}
              onUploadXmlFile={async (file: File) => {
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
                  // Refresh all estoque data
                  fetch(`${apiBaseUrl}/estoque/insumos`, { headers: authHeaders })
                    .then((r) => r.json())
                    .then((d) => {
                      if (Array.isArray(d)) setEstoqueInsumos(d);
                    });
                  fetch(`${apiBaseUrl}/estoque/notas`, { headers: authHeaders })
                    .then((r) => r.json())
                    .then((d) => {
                      if (Array.isArray(d)) setNotasEntrada(d);
                    });
                  fetch(`${apiBaseUrl}/estoque/entradas`, { headers: authHeaders })
                    .then((r) => r.json())
                    .then((d) => {
                      if (Array.isArray(d)) setEntradasEstoque(d);
                    });
                  fetch(`${apiBaseUrl}/estoque/distribuidores`, { headers: authHeaders })
                    .then((r) => r.json())
                    .then((d) => {
                      if (Array.isArray(d)) setDistribuidores(d);
                    });
                } catch (err: any) {
                  setXmlUploadState((s) => ({ ...s, loading: false, error: err.message || 'Erro desconhecido.' }));
                }
              }}
              xmlUploadState={xmlUploadState}
              onResetXmlState={() => setXmlUploadState((s) => ({ ...s, result: null, error: null }))}
              xmlFileInputRef={xmlFileInputRef}
              onRefresh={() => {
                fetch(`${apiBaseUrl}/estoque/entradas`, { headers: authHeaders })
                  .then((r) => r.json())
                  .then((d) => {
                    if (Array.isArray(d)) setEntradasEstoque(d);
                  });
                fetch(`${apiBaseUrl}/estoque/movimentacoes`, { headers: authHeaders })
                  .then((r) => r.json())
                  .then((d) => {
                    if (Array.isArray(d)) setMovimentacoesEstoque(d);
                  });
                fetch(`${apiBaseUrl}/estoque/notas`, { headers: authHeaders })
                  .then((r) => r.json())
                  .then((d) => {
                    if (Array.isArray(d)) setNotasEntrada(d);
                  });
              }}
            />
          </div>
        )}
      {activeTab === 'estoque' && ['inventario', 'contagem'].includes(activeSubTab) && (
        <div className="space-y-4">
          <OperationalBanner
            id="stock-inventory-heading"
            eyebrow="CONFERÊNCIA"
            title={sessoesContagemEstoque.length === 0 ? 'Faça a primeira' : 'Estoque real'}
            accent={sessoesContagemEstoque.length === 0 ? 'conferência' : 'sob controle'}
            description={
              sessoesContagemEstoque.length === 0
                ? 'Compare o estoque físico com o saldo do sistema e registre as diferenças com segurança.'
                : 'Conte fisicamente, salve como rascunho e aplique as diferenças somente ao confirmar.'
            }
            metrics={
              sessoesContagemEstoque.length === 0
                ? []
                : [
                    { label: 'inventários', value: sessoesContagemEstoque.length },
                    {
                      label: 'rascunhos',
                      value: estoqueInsights.drafts,
                      valueClassName: estoqueInsights.drafts > 0 ? 'text-amber-600 dark:text-amber-300' : undefined,
                    },
                    { label: 'ingredientes', value: estoqueInsumos.length },
                  ]
            }
          />
          <EstoqueContagemTab
            contagens={sessoesContagemEstoque}
            isLoading={isLoading}
            onOpenNovaContagemModal={(sessaoId?: string) => {
              setSelectedContagemId(sessaoId || null);
              setShowContagemModal(true);
            }}
            onRefreshContagens={() => {
              fetch(`${apiBaseUrl}/estoque/contagens`, { headers: authHeaders })
                .then((r) => r.json())
                .then((d) => {
                  if (Array.isArray(d)) setSessoesContagemEstoque(d);
                });
            }}
          />
        </div>
      )}
      {activeTab === 'estoque' && activeSubTab === 'fornecedores' && (
        <div className="space-y-4">
          <OperationalBanner
            id="stock-suppliers-heading"
            eyebrow="COMPRAS"
            title="Reposição"
            accent="mais previsível"
            description="Mantenha contatos e prazos de entrega organizados; fornecedores de NF-e entram automaticamente."
            metrics={
              distribuidores.length === 0
                ? []
                : [
                    { label: 'fornecedores', value: distribuidores.length },
                    { label: 'com CNPJ', value: distribuidores.filter((item) => Boolean(item.cnpj)).length },
                    ...(distribuidores.length > 0
                      ? [
                          {
                            label: 'prazo médio',
                            value: `${Math.round(distribuidores.reduce((sum, item) => sum + Number(item.lead_time_dias || 0), 0) / distribuidores.length)} dias`,
                          },
                        ]
                      : []),
                  ]
            }
          />
          <EstoqueFornecedoresTab
            fornecedores={distribuidores}
            onCreate={() => {
              setDistFormNomeFantasia('');
              setDistFormRazaoSocial('');
              setDistFormCnpj('');
              setDistFormLeadTime(3);
              setShowNewDistModal(true);
            }}
            onEdit={(fornecedor) => {
              setSelectedDist(fornecedor);
              setDistFormNomeFantasia(fornecedor.nome_fantasia || '');
              setDistFormRazaoSocial(fornecedor.razao_social || '');
              setDistFormCnpj(fornecedor.cnpj || '');
              setDistFormLeadTime(fornecedor.lead_time_dias ?? 3);
              setShowEditDistModal(true);
            }}
            onDelete={(fornecedor) => void handleDeleteDistribuidor(fornecedor.id)}
          />
        </div>
      )}
      {showNewInsumoModal && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowNewInsumoModal(false);
          }}
          className={clsx(
            'fixed',
            'inset-0',
            'bg-black/85',
            'backdrop-blur-xs',
            'z-50',
            'flex',
            'items-center',
            'justify-center',
            'p-4',
            'overflow-y-auto',
            'cursor-pointer',
          )}
        >
          <div
            className={clsx(
              'w-full',
              'max-w-md',
              'bg-koma-dialog',
              'border',
              'border-koma-border',
              'rounded-3xl',
              'p-6',
              'space-y-4',
              'text-left',
              'shadow-2xl',
              'relative',
              'animate-scale-in',
              'my-8',
            )}
          >
            <div className={clsx('flex', 'justify-between', 'items-center', 'pb-2', 'border-b', 'border-koma-border')}>
              <h3 className={clsx('font-serif', 'text-sm', 'font-bold', 'text-koma-foreground')}>
                Cadastrar Novo Ingrediente
              </h3>
              <button
                type="button"
                onClick={() => setShowNewInsumoModal(false)}
                className={clsx(
                  'p-1',
                  'text-koma-subtle',
                  'hover:text-koma-foreground',
                  'transition-colors',
                  'cursor-pointer',
                  'border',
                  'border-transparent',
                )}
              >
                <X size={16} />
              </button>
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!insumoFormNome.trim() || !insumoFormUnidade.trim()) {
                  alert('Preencha os campos obrigatórios!');
                  return;
                }
                await handleSaveInsumo(true);
              }}
              className="space-y-4"
            >
              <div className="space-y-1">
                <label
                  className={clsx(
                    'text-[10px]',
                    'font-bold',
                    'text-koma-subtle',
                    'uppercase',
                    'tracking-wider',
                    'block',
                  )}
                >
                  Nome do Ingrediente:
                </label>
                <input
                  type="text"
                  required
                  placeholder="ex: Contra Filé"
                  value={insumoFormNome}
                  onChange={(e) => setInsumoFormNome(e.target.value)}
                  className={clsx(
                    'w-full',
                    'px-3',
                    'py-2',
                    'bg-koma-input',
                    'border',
                    'border-koma-border',
                    'rounded-xl',
                    'text-koma-foreground',
                    'focus:outline-none',
                    'focus:border-[#10b981]',
                  )}
                />
              </div>

              <div className={clsx('grid', 'grid-cols-3', 'gap-4')}>
                <div className="space-y-1">
                  <label
                    className={clsx(
                      'text-[10px]',
                      'font-bold',
                      'text-koma-subtle',
                      'uppercase',
                      'tracking-wider',
                      'block',
                    )}
                  >
                    Unidade:
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="ex: kg, un, l"
                    value={insumoFormUnidade}
                    onChange={(e) => setInsumoFormUnidade(e.target.value)}
                    className={clsx(
                      'w-full',
                      'px-3',
                      'py-2',
                      'bg-koma-input',
                      'border',
                      'border-koma-border',
                      'rounded-xl',
                      'text-koma-foreground',
                      'focus:outline-none',
                      'focus:border-[#10b981]',
                    )}
                  />
                </div>

                <div className="space-y-1">
                  <label
                    className={clsx(
                      'text-[10px]',
                      'font-bold',
                      'text-koma-subtle',
                      'uppercase',
                      'tracking-wider',
                      'block',
                    )}
                  >
                    Mínimo:
                  </label>
                  <input
                    type="number"
                    required
                    value={insumoFormMinimo}
                    onChange={(e) => setInsumoFormMinimo(Number(e.target.value))}
                    className={clsx(
                      'w-full',
                      'px-3',
                      'py-2',
                      'bg-koma-input',
                      'border',
                      'border-koma-border',
                      'rounded-xl',
                      'text-koma-foreground',
                      'focus:outline-none',
                      'focus:border-[#10b981]',
                      'font-mono',
                    )}
                  />
                </div>

                <div className="space-y-1">
                  <label
                    className={clsx(
                      'text-[10px]',
                      'font-bold',
                      'text-koma-subtle',
                      'uppercase',
                      'tracking-wider',
                      'block',
                    )}
                  >
                    Máximo:
                  </label>
                  <input
                    type="number"
                    required
                    value={insumoFormMaximo}
                    onChange={(e) => setInsumoFormMaximo(Number(e.target.value))}
                    className={clsx(
                      'w-full',
                      'px-3',
                      'py-2',
                      'bg-koma-input',
                      'border',
                      'border-koma-border',
                      'rounded-xl',
                      'text-koma-foreground',
                      'focus:outline-none',
                      'focus:border-[#10b981]',
                      'font-mono',
                    )}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label
                  className={clsx(
                    'text-[10px]',
                    'font-bold',
                    'text-koma-subtle',
                    'uppercase',
                    'tracking-wider',
                    'block',
                  )}
                >
                  Preço de Custo Médio (R$):
                </label>
                <MoneyInput
                  required
                  value={insumoFormCusto}
                  onValueChange={(value) => setInsumoFormCusto(Number(value || 0))}
                  className={clsx(
                    'w-full',
                    'px-3',
                    'py-2',
                    'bg-koma-input',
                    'border',
                    'border-koma-border',
                    'rounded-xl',
                    'text-koma-foreground',
                    'focus:outline-none',
                    'focus:border-[#10b981]',
                    'font-mono',
                    'text-xs',
                  )}
                />
              </div>

              <div className={clsx('flex', 'gap-2', 'pt-2')}>
                <button
                  type="button"
                  onClick={() => setShowNewInsumoModal(false)}
                  className={clsx(
                    'flex-1',
                    'py-2',
                    'border',
                    'border-koma-border',
                    'hover:border-koma-border',
                    'bg-koma-raised',
                    'text-koma-subtle',
                    'hover:text-koma-foreground',
                    'rounded-xl',
                    'text-[10px]',
                    'font-bold',
                    'uppercase',
                    'tracking-wider',
                    'transition-colors',
                    'cursor-pointer',
                  )}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className={clsx(
                    'flex-1',
                    'py-2',
                    'bg-[#10b981]',
                    'hover:bg-[#059669]',
                    'text-zinc-950',
                    'rounded-xl',
                    'text-[10px]',
                    'font-bold',
                    'uppercase',
                    'tracking-wider',
                    'transition-colors',
                    'cursor-pointer',
                  )}
                >
                  Criar Ingrediente
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {showEditInsumoModal && selectedInsumo && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowEditInsumoModal(false);
          }}
          className={clsx(
            'fixed',
            'inset-0',
            'bg-black/85',
            'backdrop-blur-xs',
            'z-50',
            'flex',
            'items-center',
            'justify-center',
            'p-4',
            'overflow-y-auto',
            'cursor-pointer',
          )}
        >
          <div
            className={clsx(
              'w-full',
              'max-w-md',
              'bg-koma-dialog',
              'border',
              'border-koma-border',
              'rounded-3xl',
              'p-6',
              'space-y-4',
              'text-left',
              'shadow-2xl',
              'relative',
              'animate-scale-in',
              'my-8',
            )}
          >
            <div className={clsx('flex', 'justify-between', 'items-center', 'pb-2', 'border-b', 'border-koma-border')}>
              <h3 className={clsx('font-serif', 'text-sm', 'font-bold', 'text-koma-foreground')}>Editar Ingrediente</h3>
              <button
                type="button"
                onClick={() => setShowEditInsumoModal(false)}
                className={clsx(
                  'p-1',
                  'text-koma-subtle',
                  'hover:text-koma-foreground',
                  'transition-colors',
                  'cursor-pointer',
                  'border',
                  'border-transparent',
                )}
              >
                <X size={16} />
              </button>
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!insumoFormNome.trim() || !insumoFormUnidade.trim()) {
                  alert('Preencha os campos obrigatórios!');
                  return;
                }
                await handleSaveInsumo(false);
              }}
              className="space-y-4"
            >
              <div className="space-y-1">
                <label
                  className={clsx(
                    'text-[10px]',
                    'font-bold',
                    'text-koma-subtle',
                    'uppercase',
                    'tracking-wider',
                    'block',
                  )}
                >
                  Nome do Ingrediente:
                </label>
                <input
                  type="text"
                  required
                  value={insumoFormNome}
                  onChange={(e) => setInsumoFormNome(e.target.value)}
                  className={clsx(
                    'w-full',
                    'px-3',
                    'py-2',
                    'bg-koma-input',
                    'border',
                    'border-koma-border',
                    'rounded-xl',
                    'text-koma-foreground',
                    'focus:outline-none',
                    'focus:border-[#10b981]',
                  )}
                />
              </div>

              <div className={clsx('grid', 'grid-cols-3', 'gap-4')}>
                <div className="space-y-1">
                  <label
                    className={clsx(
                      'text-[10px]',
                      'font-bold',
                      'text-koma-subtle',
                      'uppercase',
                      'tracking-wider',
                      'block',
                    )}
                  >
                    Unidade:
                  </label>
                  <input
                    type="text"
                    required
                    value={insumoFormUnidade}
                    onChange={(e) => setInsumoFormUnidade(e.target.value)}
                    className={clsx(
                      'w-full',
                      'px-3',
                      'py-2',
                      'bg-koma-input',
                      'border',
                      'border-koma-border',
                      'rounded-xl',
                      'text-koma-foreground',
                      'focus:outline-none',
                      'focus:border-[#10b981]',
                    )}
                  />
                </div>

                <div className="space-y-1">
                  <label
                    className={clsx(
                      'text-[10px]',
                      'font-bold',
                      'text-koma-subtle',
                      'uppercase',
                      'tracking-wider',
                      'block',
                    )}
                  >
                    Mínimo:
                  </label>
                  <input
                    type="number"
                    required
                    value={insumoFormMinimo}
                    onChange={(e) => setInsumoFormMinimo(Number(e.target.value))}
                    className={clsx(
                      'w-full',
                      'px-3',
                      'py-2',
                      'bg-koma-input',
                      'border',
                      'border-koma-border',
                      'rounded-xl',
                      'text-koma-foreground',
                      'focus:outline-none',
                      'focus:border-[#10b981]',
                      'font-mono',
                    )}
                  />
                </div>

                <div className="space-y-1">
                  <label
                    className={clsx(
                      'text-[10px]',
                      'font-bold',
                      'text-koma-subtle',
                      'uppercase',
                      'tracking-wider',
                      'block',
                    )}
                  >
                    Máximo:
                  </label>
                  <input
                    type="number"
                    required
                    value={insumoFormMaximo}
                    onChange={(e) => setInsumoFormMaximo(Number(e.target.value))}
                    className={clsx(
                      'w-full',
                      'px-3',
                      'py-2',
                      'bg-koma-input',
                      'border',
                      'border-koma-border',
                      'rounded-xl',
                      'text-koma-foreground',
                      'focus:outline-none',
                      'focus:border-[#10b981]',
                      'font-mono',
                    )}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label
                  className={clsx(
                    'text-[10px]',
                    'font-bold',
                    'text-koma-subtle',
                    'uppercase',
                    'tracking-wider',
                    'block',
                  )}
                >
                  Preço de Custo Médio (R$):
                </label>
                <MoneyInput
                  required
                  value={insumoFormCusto}
                  onValueChange={(value) => setInsumoFormCusto(Number(value || 0))}
                  className={clsx(
                    'w-full',
                    'px-3',
                    'py-2',
                    'bg-koma-input',
                    'border',
                    'border-koma-border',
                    'rounded-xl',
                    'text-koma-foreground',
                    'focus:outline-none',
                    'focus:border-[#10b981]',
                    'font-mono',
                    'text-xs',
                  )}
                />
              </div>

              <div className={clsx('flex', 'gap-2', 'pt-2')}>
                <button
                  type="button"
                  onClick={() => setShowEditInsumoModal(false)}
                  className={clsx(
                    'flex-1',
                    'py-2',
                    'border',
                    'border-koma-border',
                    'hover:border-koma-border',
                    'bg-koma-raised',
                    'text-koma-subtle',
                    'hover:text-koma-foreground',
                    'rounded-xl',
                    'text-[10px]',
                    'font-bold',
                    'uppercase',
                    'tracking-wider',
                    'transition-colors',
                    'cursor-pointer',
                  )}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className={clsx(
                    'flex-1',
                    'py-2',
                    'bg-[#10b981]',
                    'hover:bg-[#059669]',
                    'text-zinc-950',
                    'rounded-xl',
                    'text-[10px]',
                    'font-bold',
                    'uppercase',
                    'tracking-wider',
                    'transition-colors',
                    'cursor-pointer',
                  )}
                >
                  Salvar Alterações
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {showAjusteInsumoModal && selectedInsumo && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowAjusteInsumoModal(false);
          }}
          className={clsx(
            'fixed',
            'inset-0',
            'bg-black/85',
            'backdrop-blur-xs',
            'z-50',
            'flex',
            'items-center',
            'justify-center',
            'p-4',
            'overflow-y-auto',
            'cursor-pointer',
          )}
        >
          <div
            className={clsx(
              'w-full',
              'max-w-md',
              'bg-koma-dialog',
              'border',
              'border-koma-border',
              'rounded-3xl',
              'p-6',
              'space-y-4',
              'text-left',
              'shadow-2xl',
              'relative',
              'animate-scale-in',
              'my-8',
            )}
          >
            <div className={clsx('flex', 'justify-between', 'items-center', 'pb-2', 'border-b', 'border-koma-border')}>
              <h3 className={clsx('font-serif', 'text-sm', 'font-bold', 'text-koma-foreground')}>
                Ajustar Estoque: {selectedInsumo.nome}
              </h3>
              <button
                type="button"
                onClick={() => setShowAjusteInsumoModal(false)}
                className={clsx(
                  'p-1',
                  'text-koma-subtle',
                  'hover:text-koma-foreground',
                  'transition-colors',
                  'cursor-pointer',
                  'border',
                  'border-transparent',
                )}
              >
                <X size={16} />
              </button>
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (ajusteQtd <= 0) {
                  alert('A quantidade do ajuste deve ser maior que zero!');
                  return;
                }
                await handleAjustarEstoque();
              }}
              className="space-y-4"
            >
              <div className="space-y-1">
                <label
                  className={clsx(
                    'text-[10px]',
                    'font-bold',
                    'text-koma-subtle',
                    'uppercase',
                    'tracking-wider',
                    'block',
                  )}
                >
                  Tipo de Ajuste:
                </label>
                <div className={clsx('grid', 'grid-cols-2', 'gap-2')}>
                  <button
                    type="button"
                    onClick={() => setAjusteTipo('ENTRADA')}
                    className={clsx(
                      'py-2 rounded-xl text-[10px] font-bold uppercase tracking-wider border transition-all cursor-pointer',
                      ajusteTipo === 'ENTRADA'
                        ? 'bg-emerald-500/10 border-emerald-500 text-emerald-400 font-bold'
                        : 'bg-koma-raised border-koma-border text-koma-subtle hover:text-koma-foreground font-bold',
                    )}
                  >
                    Entrada (+)
                  </button>
                  <button
                    type="button"
                    onClick={() => setAjusteTipo('SAIDA')}
                    className={clsx(
                      'py-2 rounded-xl text-[10px] font-bold uppercase tracking-wider border transition-all cursor-pointer',
                      ajusteTipo === 'SAIDA'
                        ? 'bg-red-500/10 border-red-500/60 text-red-400 font-bold'
                        : 'bg-koma-raised border-koma-border text-koma-subtle hover:text-koma-foreground font-bold',
                    )}
                  >
                    Saída (-)
                  </button>
                </div>
              </div>

              <div className="space-y-1">
                <label
                  className={clsx(
                    'text-[10px]',
                    'font-bold',
                    'text-koma-subtle',
                    'uppercase',
                    'tracking-wider',
                    'block',
                  )}
                >
                  Quantidade ({selectedInsumo.unidade_medida}):
                </label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={ajusteQtd}
                  onChange={(e) => setAjusteQtd(Number(e.target.value))}
                  className={clsx(
                    'w-full',
                    'px-3',
                    'py-2',
                    'bg-koma-input',
                    'border',
                    'border-koma-border',
                    'rounded-xl',
                    'text-koma-foreground',
                    'focus:outline-none',
                    'focus:border-[#10b981]',
                    'font-mono',
                    'text-xs',
                  )}
                />
              </div>

              <div className="space-y-1">
                <label
                  className={clsx(
                    'text-[10px]',
                    'font-bold',
                    'text-koma-subtle',
                    'uppercase',
                    'tracking-wider',
                    'block',
                  )}
                >
                  Justificativa:
                </label>
                <input
                  type="text"
                  required
                  placeholder="ex: Ajuste de inventário / Perda por validade"
                  value={ajusteJustificativa}
                  onChange={(e) => setAjusteJustificativa(e.target.value)}
                  className={clsx(
                    'w-full',
                    'px-3',
                    'py-2',
                    'bg-koma-input',
                    'border',
                    'border-koma-border',
                    'rounded-xl',
                    'text-koma-foreground',
                    'focus:outline-none',
                    'focus:border-[#10b981]',
                  )}
                />
              </div>

              <div className={clsx('flex', 'gap-2', 'pt-2')}>
                <button
                  type="button"
                  onClick={() => setShowAjusteInsumoModal(false)}
                  className={clsx(
                    'flex-1',
                    'py-2',
                    'border',
                    'border-koma-border',
                    'hover:border-koma-border',
                    'bg-koma-raised',
                    'text-koma-subtle',
                    'hover:text-koma-foreground',
                    'rounded-xl',
                    'text-[10px]',
                    'font-bold',
                    'uppercase',
                    'tracking-wider',
                    'transition-colors',
                    'cursor-pointer',
                  )}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className={clsx(
                    'flex-1',
                    'py-2',
                    'bg-[#10b981]',
                    'hover:bg-[#059669]',
                    'text-zinc-950',
                    'rounded-xl',
                    'text-[10px]',
                    'font-bold',
                    'uppercase',
                    'tracking-wider',
                    'transition-colors',
                    'cursor-pointer',
                  )}
                >
                  Confirmar Ajuste
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {showNewDistModal && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowNewDistModal(false);
          }}
          className={clsx(
            'fixed',
            'inset-0',
            'bg-black/85',
            'backdrop-blur-xs',
            'z-50',
            'flex',
            'items-center',
            'justify-center',
            'p-4',
            'overflow-y-auto',
            'cursor-pointer',
          )}
        >
          <div
            className={clsx(
              'w-full',
              'max-w-md',
              'bg-koma-card',
              'border',
              'border-koma-border',
              'rounded-3xl',
              'p-6',
              'space-y-4',
              'text-left',
              'shadow-2xl',
              'relative',
              'animate-scale-in',
              'my-8',
            )}
          >
            <div className={clsx('flex', 'justify-between', 'items-center', 'pb-2', 'border-b', 'border-koma-border')}>
              <h3 className={clsx('font-serif', 'text-sm', 'font-bold', 'text-koma-foreground')}>
                Cadastrar Novo Fornecedor
              </h3>
              <button
                type="button"
                onClick={() => setShowNewDistModal(false)}
                className={clsx(
                  'p-1',
                  'text-koma-subtle',
                  'hover:text-koma-foreground',
                  'transition-colors',
                  'cursor-pointer',
                  'border',
                  'border-transparent',
                )}
              >
                <X size={16} />
              </button>
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!distFormNomeFantasia.trim()) {
                  alert('Preencha os campos obrigatórios!');
                  return;
                }
                await handleSaveDistribuidor(true);
              }}
              className="space-y-4"
            >
              <div className="space-y-1">
                <label
                  className={clsx(
                    'text-[10px]',
                    'font-bold',
                    'text-koma-subtle',
                    'uppercase',
                    'tracking-wider',
                    'block',
                  )}
                >
                  Nome Fantasia:
                </label>
                <input
                  type="text"
                  required
                  placeholder="ex: Ambev"
                  value={distFormNomeFantasia}
                  onChange={(e) => setDistFormNomeFantasia(e.target.value)}
                  className={clsx(
                    'w-full',
                    'px-3',
                    'py-2',
                    'bg-koma-panel',
                    'border',
                    'border-koma-border',
                    'rounded-xl',
                    'text-koma-foreground',
                    'focus:outline-none',
                    'focus:border-[#10b981]',
                  )}
                />
              </div>

              <div className="space-y-1">
                <label
                  className={clsx(
                    'text-[10px]',
                    'font-bold',
                    'text-koma-subtle',
                    'uppercase',
                    'tracking-wider',
                    'block',
                  )}
                >
                  Razão Social:
                </label>
                <input
                  type="text"
                  placeholder="ex: Companhia de Bebidas das Américas"
                  value={distFormRazaoSocial}
                  onChange={(e) => setDistFormRazaoSocial(e.target.value)}
                  className={clsx(
                    'w-full',
                    'px-3',
                    'py-2',
                    'bg-koma-panel',
                    'border',
                    'border-koma-border',
                    'rounded-xl',
                    'text-koma-foreground',
                    'focus:outline-none',
                    'focus:border-[#10b981]',
                  )}
                />
              </div>

              <div className={clsx('grid', 'grid-cols-2', 'gap-4')}>
                <div className="space-y-1">
                  <label
                    className={clsx(
                      'text-[10px]',
                      'font-bold',
                      'text-koma-subtle',
                      'uppercase',
                      'tracking-wider',
                      'block',
                    )}
                  >
                    CNPJ:
                  </label>
                  <input
                    type="text"
                    placeholder="00.000.000/0000-00"
                    value={distFormCnpj}
                    onChange={(e) => setDistFormCnpj(e.target.value)}
                    className={clsx(
                      'w-full',
                      'px-3',
                      'py-2',
                      'bg-koma-panel',
                      'border',
                      'border-koma-border',
                      'rounded-xl',
                      'text-koma-foreground',
                      'focus:outline-none',
                      'focus:border-[#10b981]',
                      'font-mono',
                      'text-xs',
                    )}
                  />
                </div>

                <div className="space-y-1">
                  <label
                    className={clsx(
                      'text-[10px]',
                      'font-bold',
                      'text-koma-subtle',
                      'uppercase',
                      'tracking-wider',
                      'block',
                    )}
                  >
                    Lead Time (dias):
                  </label>
                  <input
                    type="number"
                    required
                    value={distFormLeadTime}
                    onChange={(e) => setDistFormLeadTime(Number(e.target.value))}
                    className={clsx(
                      'w-full',
                      'px-3',
                      'py-2',
                      'bg-koma-panel',
                      'border',
                      'border-koma-border',
                      'rounded-xl',
                      'text-koma-foreground',
                      'focus:outline-none',
                      'focus:border-[#10b981]',
                      'font-mono',
                    )}
                  />
                </div>
              </div>

              <div className={clsx('flex', 'gap-2', 'pt-2')}>
                <button
                  type="button"
                  onClick={() => setShowNewDistModal(false)}
                  className={clsx(
                    'flex-1',
                    'py-2',
                    'border',
                    'border-koma-border',
                    'hover:border-koma-border',
                    'bg-zinc-955',
                    'text-koma-subtle',
                    'hover:text-koma-foreground',
                    'rounded-xl',
                    'text-[10px]',
                    'font-bold',
                    'uppercase',
                    'tracking-wider',
                    'transition-colors',
                    'cursor-pointer',
                  )}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className={clsx(
                    'flex-1',
                    'py-2',
                    'bg-[#10b981]',
                    'hover:bg-[#059669]',
                    'text-[#121214]',
                    'rounded-xl',
                    'text-[10px]',
                    'font-bold',
                    'uppercase',
                    'tracking-wider',
                    'transition-colors',
                    'cursor-pointer',
                  )}
                >
                  Salvar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {showEditDistModal && selectedDist && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowEditDistModal(false);
          }}
          className={clsx(
            'fixed',
            'inset-0',
            'bg-black/85',
            'backdrop-blur-xs',
            'z-50',
            'flex',
            'items-center',
            'justify-center',
            'p-4',
            'overflow-y-auto',
            'cursor-pointer',
          )}
        >
          <div
            className={clsx(
              'w-full',
              'max-w-md',
              'bg-koma-card',
              'border',
              'border-koma-border',
              'rounded-3xl',
              'p-6',
              'space-y-4',
              'text-left',
              'shadow-2xl',
              'relative',
              'animate-scale-in',
              'my-8',
            )}
          >
            <div className={clsx('flex', 'justify-between', 'items-center', 'pb-2', 'border-b', 'border-koma-border')}>
              <h3 className={clsx('font-serif', 'text-sm', 'font-bold', 'text-koma-foreground')}>
                Editar Fornecedor: {selectedDist.nome_fantasia}
              </h3>
              <button
                type="button"
                onClick={() => setShowEditDistModal(false)}
                className={clsx(
                  'p-1',
                  'text-koma-subtle',
                  'hover:text-koma-foreground',
                  'transition-colors',
                  'cursor-pointer',
                  'border',
                  'border-transparent',
                )}
              >
                <X size={16} />
              </button>
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!distFormNomeFantasia.trim()) {
                  showToast('Preencha o nome fantasia!', 'info');
                  return;
                }
                await handleSaveDistribuidor(false);
              }}
              className="space-y-4"
            >
              <div className="space-y-1">
                <label
                  className={clsx(
                    'text-[10px]',
                    'font-bold',
                    'text-koma-subtle',
                    'uppercase',
                    'tracking-wider',
                    'block',
                  )}
                >
                  Nome Fantasia:
                </label>
                <input
                  type="text"
                  required
                  value={distFormNomeFantasia}
                  onChange={(e) => setDistFormNomeFantasia(e.target.value)}
                  className={clsx(
                    'w-full',
                    'px-3',
                    'py-2',
                    'bg-koma-panel',
                    'border',
                    'border-koma-border',
                    'rounded-xl',
                    'text-koma-foreground',
                    'focus:outline-none',
                    'focus:border-[#10b981]',
                  )}
                />
              </div>

              <div className="space-y-1">
                <label
                  className={clsx(
                    'text-[10px]',
                    'font-bold',
                    'text-koma-subtle',
                    'uppercase',
                    'tracking-wider',
                    'block',
                  )}
                >
                  Razão Social:
                </label>
                <input
                  type="text"
                  value={distFormRazaoSocial}
                  onChange={(e) => setDistFormRazaoSocial(e.target.value)}
                  className={clsx(
                    'w-full',
                    'px-3',
                    'py-2',
                    'bg-koma-panel',
                    'border',
                    'border-koma-border',
                    'rounded-xl',
                    'text-koma-foreground',
                    'focus:outline-none',
                    'focus:border-[#10b981]',
                  )}
                />
              </div>

              <div className={clsx('grid', 'grid-cols-2', 'gap-4')}>
                <div className="space-y-1">
                  <label
                    className={clsx(
                      'text-[10px]',
                      'font-bold',
                      'text-koma-subtle',
                      'uppercase',
                      'tracking-wider',
                      'block',
                    )}
                  >
                    CNPJ:
                  </label>
                  <input
                    type="text"
                    value={distFormCnpj}
                    onChange={(e) => setDistFormCnpj(e.target.value)}
                    className={clsx(
                      'w-full',
                      'px-3',
                      'py-2',
                      'bg-koma-panel',
                      'border',
                      'border-koma-border',
                      'rounded-xl',
                      'text-koma-foreground',
                      'focus:outline-none',
                      'focus:border-[#10b981]',
                      'font-mono',
                      'text-xs',
                    )}
                  />
                </div>

                <div className="space-y-1">
                  <label
                    className={clsx(
                      'text-[10px]',
                      'font-bold',
                      'text-koma-subtle',
                      'uppercase',
                      'tracking-wider',
                      'block',
                    )}
                  >
                    Lead Time (dias):
                  </label>
                  <input
                    type="number"
                    required
                    value={distFormLeadTime}
                    onChange={(e) => setDistFormLeadTime(Number(e.target.value))}
                    className={clsx(
                      'w-full',
                      'px-3',
                      'py-2',
                      'bg-koma-panel',
                      'border',
                      'border-koma-border',
                      'rounded-xl',
                      'text-koma-foreground',
                      'focus:outline-none',
                      'focus:border-[#10b981]',
                      'font-mono',
                    )}
                  />
                </div>
              </div>

              <div className={clsx('flex', 'gap-2', 'pt-2')}>
                <button
                  type="button"
                  onClick={() => setShowEditDistModal(false)}
                  className={clsx(
                    'flex-1',
                    'py-2',
                    'border',
                    'border-koma-border',
                    'hover:border-koma-border',
                    'bg-zinc-950',
                    'text-koma-subtle',
                    'hover:text-koma-foreground',
                    'rounded-xl',
                    'text-[10px]',
                    'font-bold',
                    'uppercase',
                    'tracking-wider',
                    'transition-colors',
                    'cursor-pointer',
                  )}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className={clsx(
                    'flex-1',
                    'py-2',
                    'bg-[#10b981]',
                    'hover:bg-[#059669]',
                    'text-[#121214]',
                    'rounded-xl',
                    'text-[10px]',
                    'font-bold',
                    'uppercase',
                    'tracking-wider',
                    'transition-colors',
                    'cursor-pointer',
                  )}
                >
                  Salvar Alterações
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {showFichaTecnicaModal && (
        <FichaTecnicaModal
          produtos={apiProdutos}
          insumos={estoqueInsumos}
          fichas={fichasTecnicas}
          onClose={() => setShowFichaTecnicaModal(false)}
          onSave={async (produtoId, itens) => {
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
          }}
        />
      )}
      {showEntradaManualModal && (
        <EntradaManualModal
          distribuidores={distribuidores}
          insumos={estoqueInsumos}
          onClose={() => setShowEntradaManualModal(false)}
          onSubmit={async (payload) => {
            const res = await fetch(`${apiBaseUrl}/estoque/entradas/manual`, {
              method: 'POST',
              headers: { ...authHeaders, 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.detail || 'Erro ao gravar entrada manual.');
            showToast('✓ Entrada manual gravada com sucesso!');
            // Refresh stock data
            fetch(`${apiBaseUrl}/estoque/insumos`, { headers: authHeaders })
              .then((r) => r.json())
              .then((d) => {
                if (Array.isArray(d)) setEstoqueInsumos(d);
              });
            fetch(`${apiBaseUrl}/estoque/entradas`, { headers: authHeaders })
              .then((r) => r.json())
              .then((d) => {
                if (Array.isArray(d)) setEntradasEstoque(d);
              });
            fetch(`${apiBaseUrl}/estoque/movimentacoes`, { headers: authHeaders })
              .then((r) => r.json())
              .then((d) => {
                if (Array.isArray(d)) setMovimentacoesEstoque(d);
              });
          }}
        />
      )}
      {showMovimentacaoModal && (
        <MovimentacaoEstoqueModal
          insumos={estoqueInsumos}
          onClose={() => setShowMovimentacaoModal(false)}
          onSubmit={async (payload) => {
            const res = await fetch(`${apiBaseUrl}/estoque/movimentacoes`, {
              method: 'POST',
              headers: { ...authHeaders, 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.detail || 'Erro ao salvar movimentação.');
            showToast('✓ Movimentação de estoque gravada!');
            // Refresh stock data
            fetch(`${apiBaseUrl}/estoque/insumos`, { headers: authHeaders })
              .then((r) => r.json())
              .then((d) => {
                if (Array.isArray(d)) setEstoqueInsumos(d);
              });
            fetch(`${apiBaseUrl}/estoque/movimentacoes`, { headers: authHeaders })
              .then((r) => r.json())
              .then((d) => {
                if (Array.isArray(d)) setMovimentacoesEstoque(d);
              });
          }}
        />
      )}
      {showContagemModal && (
        <ContagemEstoqueModal
          insumos={estoqueInsumos}
          existingSessao={selectedContagemId ? sessoesContagemEstoque.find((s) => s.id === selectedContagemId) : null}
          onClose={() => {
            setShowContagemModal(false);
            setSelectedContagemId(null);
          }}
          onSaveDraft={async (payload) => {
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
            showToast('✓ Rascunho de contagem salvo com sucesso!');
            fetch(`${apiBaseUrl}/estoque/contagens`, { headers: authHeaders })
              .then((r) => r.json())
              .then((d) => {
                if (Array.isArray(d)) setSessoesContagemEstoque(d);
              });
          }}
          onConfirm={async (payload) => {
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
            showToast('✓ Contagem confirmada e estoques ajustados!');
            fetch(`${apiBaseUrl}/estoque/insumos`, { headers: authHeaders })
              .then((r) => r.json())
              .then((d) => {
                if (Array.isArray(d)) setEstoqueInsumos(d);
              });
            fetch(`${apiBaseUrl}/estoque/movimentacoes`, { headers: authHeaders })
              .then((r) => r.json())
              .then((d) => {
                if (Array.isArray(d)) setMovimentacoesEstoque(d);
              });
            fetch(`${apiBaseUrl}/estoque/contagens`, { headers: authHeaders })
              .then((r) => r.json())
              .then((d) => {
                if (Array.isArray(d)) setSessoesContagemEstoque(d);
              });
          }}
        />
      )}
    </>
  );
}
