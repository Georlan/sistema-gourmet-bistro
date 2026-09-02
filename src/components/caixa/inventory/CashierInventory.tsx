import { Product } from '../../../types';
import { ContagemEstoqueModal } from '../../estoque/ContagemEstoqueModal';
import { EntradaManualModal } from '../../estoque/EntradaManualModal';
import { EstoqueContagemTab } from '../../estoque/EstoqueContagemTab';
import { EstoqueFornecedoresTab } from '../../estoque/EstoqueFornecedoresTab';
import { EstoqueHistoricoTab } from '../../estoque/EstoqueHistoricoTab';
import { EstoqueIngredientesTab } from '../../estoque/EstoqueIngredientesTab';
import { FichaTecnicaModal } from '../../estoque/FichaTecnicaModal';
import { MovimentacaoEstoqueModal } from '../../estoque/MovimentacaoEstoqueModal';
import { OperationalBanner } from '../../shared/OperationalBanner';
import type { CashierNotice } from '../cashierContracts';
import { formatCompactCurrency } from '../cashierPresentation';
import { CashierIngredientDialogs } from './CashierIngredientDialogs';
import { CashierStockAdjustmentDialog } from './CashierStockAdjustmentDialog';
import { CashierSupplierDialogs } from './CashierSupplierDialogs';
import { StockRecipeCoveragePanel } from './StockRecipeCoveragePanel';
import { StockReplenishmentWorkspace } from './StockReplenishmentWorkspace';
import { useCashierIngredientEditor } from './useCashierIngredientEditor';
import { useCashierInventoryData } from './useCashierInventoryData';
import { useCashierInventoryOperations } from './useCashierInventoryOperations';
import { useCashierSupplierEditor } from './useCashierSupplierEditor';

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
  const {
    estoqueInsumos,
    notasEntrada,
    distribuidores,
    entradasEstoque,
    movimentacoesEstoque,
    sessoesContagemEstoque,
    fichasTecnicas,
    setFichasTecnicas,
    estoqueInsights,
    refreshInventory,
  } = useCashierInventoryData({ apiBaseUrl, authHeaders, activeTab, activeSubTab });

  const {
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
  } = useCashierInventoryOperations({
    refreshInventory,
    apiBaseUrl,
    authHeaders,
    setFichasTecnicas,
    showToast,
  });

  const {
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
  } = useCashierIngredientEditor({ apiBaseUrl, authHeaders, refreshInventory });

  const {
    showNewDistModal,
    setShowNewDistModal,
    showEditDistModal,
    setShowEditDistModal,
    selectedDist,
    setSelectedDist,
    distFormNomeFantasia,
    setDistFormNomeFantasia,
    distFormRazaoSocial,
    setDistFormRazaoSocial,
    distFormCnpj,
    setDistFormCnpj,
    distFormLeadTime,
    setDistFormLeadTime,
    handleSaveDistribuidor,
    handleDeleteDistribuidor,
  } = useCashierSupplierEditor({ apiBaseUrl, authHeaders, refreshInventory });

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
                    {
                      label: 'valor em estoque',
                      value: formatCompactCurrency(estoqueInsights.inventoryValue),
                    },
                  ]
            }
          />
          <StockRecipeCoveragePanel
            products={apiProdutos}
            fichas={fichasTecnicas}
            insumos={estoqueInsumos}
            onEdit={() => setShowFichaTecnicaModal(true)}
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
                        value: movimentacoesEstoque.filter((item) => item.origem === 'venda_automatica')
                          .length,
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
              onUploadXmlFile={uploadXml}
              xmlUploadState={xmlUploadState}
              onResetXmlState={() => setXmlUploadState((s) => ({ ...s, result: null, error: null }))}
              xmlFileInputRef={xmlFileInputRef}
              onRefresh={refreshHistory}
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
                      valueClassName:
                        estoqueInsights.drafts > 0 ? 'text-amber-600 dark:text-amber-300' : undefined,
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
            onRefreshContagens={refreshCounts}
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
          <StockReplenishmentWorkspace
            insumos={estoqueInsumos}
            fornecedores={distribuidores}
            onRegisterEntry={() => setShowEntradaManualModal(true)}
            onImportXml={() => {
              setActiveSubTab('historico');
              window.setTimeout(() => xmlFileInputRef.current?.click(), 0);
            }}
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
      <CashierIngredientDialogs
        showNewInsumoModal={showNewInsumoModal}
        setShowNewInsumoModal={setShowNewInsumoModal}
        insumoFormNome={insumoFormNome}
        insumoFormUnidade={insumoFormUnidade}
        handleSaveInsumo={handleSaveInsumo}
        setInsumoFormNome={setInsumoFormNome}
        setInsumoFormUnidade={setInsumoFormUnidade}
        insumoFormMinimo={insumoFormMinimo}
        setInsumoFormMinimo={setInsumoFormMinimo}
        insumoFormMaximo={insumoFormMaximo}
        setInsumoFormMaximo={setInsumoFormMaximo}
        insumoFormCusto={insumoFormCusto}
        setInsumoFormCusto={setInsumoFormCusto}
        showEditInsumoModal={showEditInsumoModal}
        selectedInsumo={selectedInsumo}
        setShowEditInsumoModal={setShowEditInsumoModal}
      />

      <CashierStockAdjustmentDialog
        showAjusteInsumoModal={showAjusteInsumoModal}
        selectedInsumo={selectedInsumo}
        setShowAjusteInsumoModal={setShowAjusteInsumoModal}
        ajusteQtd={ajusteQtd}
        handleAjustarEstoque={handleAjustarEstoque}
        setAjusteTipo={setAjusteTipo}
        ajusteTipo={ajusteTipo}
        setAjusteQtd={setAjusteQtd}
        ajusteJustificativa={ajusteJustificativa}
        setAjusteJustificativa={setAjusteJustificativa}
      />
      <CashierSupplierDialogs
        showNewDistModal={showNewDistModal}
        setShowNewDistModal={setShowNewDistModal}
        distFormNomeFantasia={distFormNomeFantasia}
        handleSaveDistribuidor={handleSaveDistribuidor}
        setDistFormNomeFantasia={setDistFormNomeFantasia}
        distFormRazaoSocial={distFormRazaoSocial}
        setDistFormRazaoSocial={setDistFormRazaoSocial}
        distFormCnpj={distFormCnpj}
        setDistFormCnpj={setDistFormCnpj}
        distFormLeadTime={distFormLeadTime}
        setDistFormLeadTime={setDistFormLeadTime}
        showEditDistModal={showEditDistModal}
        selectedDist={selectedDist}
        setShowEditDistModal={setShowEditDistModal}
        showToast={showToast}
      />

      {showFichaTecnicaModal && (
        <FichaTecnicaModal
          produtos={apiProdutos}
          insumos={estoqueInsumos}
          fichas={fichasTecnicas}
          onClose={() => setShowFichaTecnicaModal(false)}
          onSave={saveRecipe}
        />
      )}
      {showEntradaManualModal && (
        <EntradaManualModal
          distribuidores={distribuidores}
          insumos={estoqueInsumos}
          onClose={() => setShowEntradaManualModal(false)}
          onSubmit={registerEntry}
        />
      )}
      {showMovimentacaoModal && (
        <MovimentacaoEstoqueModal
          insumos={estoqueInsumos}
          onClose={() => setShowMovimentacaoModal(false)}
          onSubmit={registerMovement}
        />
      )}
      {showContagemModal && (
        <ContagemEstoqueModal
          insumos={estoqueInsumos}
          existingSessao={
            selectedContagemId ? sessoesContagemEstoque.find((s) => s.id === selectedContagemId) : null
          }
          onClose={() => {
            setShowContagemModal(false);
            setSelectedContagemId(null);
          }}
          onSaveDraft={saveCountDraft}
          onConfirm={confirmCount}
        />
      )}
    </>
  );
}
