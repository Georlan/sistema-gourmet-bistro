
import { Plus, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { CatalogCategory } from '../../../catalog/catalog';
import { Product } from '../../../types';
import { CardapioCategoriasTab } from '../../cardapio/CardapioCategoriasTab';
import { CardapioProdutosTab } from '../../cardapio/CardapioProdutosTab';
import { CategoriaModal } from '../../cardapio/CategoriaModal';
import ComplementosTab from '../../cardapio/ComplementosTab';
import MoneyInput from '../../MoneyInput';
import { OperationalBanner } from '../../shared/OperationalBanner';
import type { CaixaPanelProps, CashierNotice } from '../cashierContracts';

interface Props {
  catalogReady: boolean;
  restauranteConfig: CaixaPanelProps['restauranteConfig'];
  onRefreshCategorias: CaixaPanelProps['onRefreshCategorias'];
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
  activeTab: string;
  activeSubTab: string;
  setActiveSubTab: (tab: string) => void;
  showToast: CashierNotice;
  apiProdutos: Product[];
  apiCategorias: CatalogCategory[];
  suggestedProductCode: string;
  hasOnlineMenu: boolean;
  fetchProdutos: () => Promise<void>;
  fetchCategorias: () => Promise<void>;
}

export default function CashierCatalog({
  apiBaseUrl,
  authHeaders,
  activeTab,
  activeSubTab,
  setActiveSubTab,
  showToast,
  apiProdutos,
  apiCategorias,
  suggestedProductCode,
  hasOnlineMenu,
  fetchProdutos,
  fetchCategorias,
  catalogReady,
  restauranteConfig,
  onRefreshCategorias,
}: Props) {
  const [showProductModal, setShowProductModal] = useState(false);

  const [showCategoryModal, setShowCategoryModal] = useState(false);

  const [editingProduct, setEditingProduct] = useState<any>(null);

  const [cardapioCategoryFocus, setCardapioCategoryFocus] = useState<string | null>(null);

  const [prodFormId, setProdFormId] = useState('');

  const [prodFormNome, setProdFormNome] = useState('');

  const [prodFormPreco, setProdFormPreco] = useState<number | ''>('');

  const [prodFormCategoriaId, setProdFormCategoriaId] = useState('');

  const [prodFormDescricao, setProdFormDescricao] = useState('');

  const [prodFormImagem, setProdFormImagem] = useState('');

  const [prodFormImagem2, setProdFormImagem2] = useState('');

  const [prodFormImagem3, setProdFormImagem3] = useState('');

  const [prodFormAtivo, setProdFormAtivo] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  useEffect(() => {
    if (activeTab === 'cardapio') {
      fetchProdutos();
    }
  }, [activeTab, activeSubTab]);
  return (
    <>
      {activeTab === 'cardapio' && activeSubTab === 'produtos' && (
        <div className="space-y-4">
          <OperationalBanner
            id="menu-products-heading"
            eyebrow="CATÁLOGO"
            title="Produtos"
            accent="fáceis de controlar"
            description="Escolha uma categoria e pause um item ou o grupo inteiro sem procurar em listas longas."
            metrics={[
              { label: 'produtos', value: apiProdutos.length },
              { label: 'disponíveis', value: apiProdutos.filter((item) => item.ativo !== false).length },
              {
                label: apiProdutos.filter((item) => item.ativo === false).length === 1 ? 'pausado' : 'pausados',
                value: apiProdutos.filter((item) => item.ativo === false).length,
                valueClassName: apiProdutos.some((item) => item.ativo === false)
                  ? 'text-rose-600 dark:text-rose-300'
                  : undefined,
              },
              { label: 'categorias', value: apiCategorias.length },
            ]}
          />
          <CardapioProdutosTab
            produtos={apiProdutos}
            categorias={apiCategorias}
            catalogReady={catalogReady || apiProdutos.length > 0 || apiCategorias.length > 0}
            previewUrl={
              hasOnlineMenu && restauranteConfig?.restaurante_id
                ? `${window.location.origin}/cardapio?restaurante_id=${encodeURIComponent(String(restauranteConfig.restaurante_id))}`
                : undefined
            }
            onCreateProduct={() => {
              setEditingProduct(null);
              setProdFormId(suggestedProductCode);
              setProdFormNome('');
              setProdFormPreco('');
              setProdFormCategoriaId(apiCategorias[0]?.id || '');
              setProdFormDescricao('');
              setProdFormImagem('');
              setProdFormImagem2('');
              setProdFormImagem3('');
              setProdFormAtivo(true);
              setShowProductModal(true);
            }}
            onEditProduct={(product) => {
              setEditingProduct(product);
              setProdFormId(product.id);
              setProdFormNome(product.nome);
              setProdFormPreco(Number(product.preco) || 0);
              setProdFormCategoriaId(product.categoria_id || '');
              setProdFormDescricao(product.descricao || '');
              const gallery = product.imagens_galeria || [];
              setProdFormImagem(product.imagem || gallery[0] || '');
              setProdFormImagem2(gallery[1] || '');
              setProdFormImagem3(gallery[2] || '');
              setProdFormAtivo(product.ativo !== false);
              setShowProductModal(true);
            }}
            onDuplicateProduct={(product) => {
              setEditingProduct(null);
              setProdFormId(suggestedProductCode);
              setProdFormNome(`${product.nome} (Cópia)`);
              setProdFormPreco(Number(product.preco) || 0);
              setProdFormCategoriaId(product.categoria_id || '');
              setProdFormDescricao(product.descricao || '');
              const gallery = product.imagens_galeria || [];
              setProdFormImagem(product.imagem || gallery[0] || '');
              setProdFormImagem2(gallery[1] || '');
              setProdFormImagem3(gallery[2] || '');
              setProdFormAtivo(true);
              setShowProductModal(true);
            }}
            onRemoveProduct={async (product) => {
              if (!confirm(`Remover "${product.nome}" dos canais de venda? O histórico das vendas será preservado.`))
                return;
              try {
                const response = await fetch(`${apiBaseUrl}/produtos/${product.id}`, {
                  method: 'DELETE',
                  headers: authHeaders,
                });
                if (!response.ok) throw new Error('Não foi possível remover o produto.');
                await fetchProdutos();
                showToast('Produto removido dos canais de venda.');
              } catch (error) {
                showToast(error instanceof Error ? error.message : 'Erro ao remover produto.', 'error');
              }
            }}
            onToggleProduct={async (product, ativo) => {
              const response = await fetch(`${apiBaseUrl}/produtos/${product.id}`, {
                method: 'PUT',
                headers: { ...authHeaders, 'Content-Type': 'application/json' },
                body: JSON.stringify({ ativo }),
              });
              if (!response.ok) {
                showToast('Não foi possível atualizar a disponibilidade.', 'error');
                return;
              }
              await fetchProdutos();
              showToast(ativo ? 'Produto publicado.' : 'Produto pausado.');
            }}
            onSetCategoryAvailability={async (productIds, ativo) => {
              const response = await fetch(`${apiBaseUrl}/produtos/disponibilidade`, {
                method: 'PATCH',
                headers: { ...authHeaders, 'Content-Type': 'application/json' },
                body: JSON.stringify({ produto_ids: productIds, ativo }),
              });
              if (!response.ok) {
                showToast('Não foi possível atualizar a categoria.', 'error');
                return;
              }
              await fetchProdutos();
              showToast(ativo ? 'Produtos disponibilizados.' : 'Produtos pausados.');
            }}
            focusCategoryId={cardapioCategoryFocus}
            onFocusCategoryHandled={() => setCardapioCategoryFocus(null)}
          />
        </div>
      )}
      {activeTab === 'cardapio' && activeSubTab === 'categorias' && (
        <div className="space-y-4">
          <OperationalBanner
            id="menu-categories-heading"
            eyebrow="FLUXO DE PREPARO"
            title="Cada pedido"
            accent="vai ao lugar certo"
            description="Escolha quais categorias imprimem na cozinha, no bar ou não precisam de via de preparo."
            metrics={[
              { label: 'categorias', value: apiCategorias.length },
              {
                label: 'cozinha',
                value: apiCategorias.filter((category) => category.destino_impressao === 'COZINHA').length,
              },
              { label: 'bar', value: apiCategorias.filter((category) => category.destino_impressao === 'BAR').length },
              {
                label: 'não imprimir',
                value: apiCategorias.filter((category) => category.destino_impressao === 'NENHUM').length,
              },
            ]}
          />
          <CardapioCategoriasTab
            apiCategorias={apiCategorias}
            apiProdutos={apiProdutos}
            apiBaseUrl={apiBaseUrl}
            authHeaders={authHeaders}
            fetchCategorias={fetchCategorias}
            showToast={showToast}
            onManageProducts={(categoryId) => {
              setCardapioCategoryFocus(categoryId);
              setActiveSubTab('produtos');
            }}
          />
        </div>
      )}
      {activeTab === 'cardapio' && ['complementos', 'adicionais', 'modificadores'].includes(activeSubTab) && (
        <div className="space-y-4">
          <ComplementosTab
            apiBaseUrl={apiBaseUrl}
            authHeaders={authHeaders}
            produtos={apiProdutos}
            onShowNotification={(msg, type) => showToast(msg, type === 'error' ? 'error' : 'success')}
          />
        </div>
      )}
      {showProductModal && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowProductModal(false);
          }}
          className={"fixed inset-0 bg-black/85 backdrop-blur-xs z-50 flex items-center justify-center p-2 sm:p-4 overflow-hidden cursor-pointer"}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="product-modal-title"
            className={"w-full max-w-xl max-h-[calc(100dvh-1rem)] sm:max-h-[calc(100dvh-2rem)] overflow-y-auto bg-koma-card border border-koma-border rounded-3xl p-5 sm:p-6 space-y-4 text-left shadow-2xl relative animate-scale-in cursor-default"}
          >
            <div className={"flex justify-between items-center pb-2 border-b border-koma-border"}>
              <div>
                <div className="flex items-center gap-2">
                  <h3 id="product-modal-title" className="text-base font-bold text-koma-foreground">
                    {editingProduct ? 'Editar produto' : 'Novo produto'}
                  </h3>
                  {editingProduct && (
                    <span className="rounded-full border border-koma-border bg-koma-raised px-2 py-0.5 font-mono text-[9px] text-koma-muted">
                      #{editingProduct.id}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-[10px] text-koma-muted">
                  As alterações aparecem no caixa, atendimento e cardápio online.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowProductModal(false)}
                aria-label="Fechar"
                className={"p-1 text-koma-subtle hover:text-koma-foreground transition-colors cursor-pointer border border-transparent"}
              >
                <X size={16} />
              </button>
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (isLoading) return;
                setIsLoading(true);
                try {
                  const galeriaUrls = [prodFormImagem, prodFormImagem2, prodFormImagem3]
                    .map((u) => u.trim())
                    .filter(Boolean);
                  const payload = {
                    nome: prodFormNome.trim(),
                    categoria_id: prodFormCategoriaId,
                    preco: Number(prodFormPreco || 0),
                    descricao: prodFormDescricao.trim(),
                    imagem: galeriaUrls[0] || prodFormImagem || '',
                    imagens_galeria: galeriaUrls,
                    ativo: prodFormAtivo,
                  };

                  let res;
                  if (editingProduct) {
                    res = await fetch(`${apiBaseUrl}/produtos/${editingProduct.id}`, {
                      method: 'PUT',
                      headers: { ...authHeaders, 'Content-Type': 'application/json' },
                      body: JSON.stringify(payload),
                    });
                  } else {
                    res = await fetch(`${apiBaseUrl}/produtos/`, {
                      method: 'POST',
                      headers: { ...authHeaders, 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        id: prodFormId,
                        ...payload,
                      }),
                    });
                  }

                  if (res.ok) {
                    await fetchProdutos();
                    setShowProductModal(false);
                    showToast(editingProduct ? 'Produto atualizado.' : 'Produto criado.');
                  } else {
                    const errData = await res.json().catch(() => ({}));
                    showToast(errData.detail || 'Não foi possível salvar o produto.', 'error');
                  }
                } catch (err) {
                  console.error(err);
                  showToast('Erro de conexão ao salvar produto.', 'error');
                } finally {
                  setIsLoading(false);
                }
              }}
              className={"space-y-5 text-xs"}
            >
              {apiCategorias.length === 0 && (
                <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 text-[10px] text-amber-800 dark:text-amber-200">
                  <span>Crie uma categoria antes de salvar o primeiro produto.</span>
                  <button
                    type="button"
                    onClick={() => setShowCategoryModal(true)}
                    className="shrink-0 font-bold underline underline-offset-2"
                  >
                    Criar categoria
                  </button>
                </div>
              )}
              {!editingProduct && (
                <div className="space-y-1.5">
                  <label
                    htmlFor="product-code"
                    className={"text-[10px] font-bold text-koma-secondary block"}
                  >
                    Código do produto
                  </label>
                  <input
                    type="text"
                    id="product-code"
                    required
                    placeholder="Ex.: 001"
                    value={prodFormId}
                    onChange={(e) => setProdFormId(e.target.value)}
                    className={"w-full px-3 py-2 bg-koma-panel border border-koma-border rounded-xl text-koma-foreground focus:outline-none focus:border-[#10b981]"}
                  />
                  <p className="text-[9px] leading-relaxed text-koma-muted">
                    Sugerimos o próximo código livre. Você pode trocar agora; depois de criado, ele não muda.
                  </p>
                </div>
              )}

              <div className="space-y-1.5">
                <label
                  htmlFor="product-name"
                  className={"text-[10px] font-bold text-koma-secondary block"}
                >
                  Nome do produto
                </label>
                <input
                  type="text"
                  id="product-name"
                  required
                  placeholder="Ex: Cheeseburger Duplo"
                  value={prodFormNome}
                  onChange={(e) => setProdFormNome(e.target.value)}
                  className={"w-full px-3 py-2 bg-koma-panel border border-koma-border rounded-xl text-koma-foreground focus:outline-none focus:border-[#10b981]"}
                />
              </div>

              <div className={"grid grid-cols-1 sm:grid-cols-2 gap-3"}>
                <div className="space-y-1.5">
                  <label
                    htmlFor="product-price"
                    className={"text-[10px] font-bold text-koma-secondary block"}
                  >
                    Preço de venda
                  </label>
                  <MoneyInput
                    id="product-price"
                    required
                    placeholder="25.90"
                    value={prodFormPreco}
                    onValueChange={setProdFormPreco}
                    className={"w-full px-3 py-2 bg-koma-panel border border-koma-border rounded-xl text-koma-foreground focus:outline-none focus:border-[#10b981] font-mono text-[11px]"}
                  />
                </div>
                <div className="space-y-1.5">
                  <label
                    htmlFor="product-category"
                    className={"text-[10px] font-bold text-koma-secondary block"}
                  >
                    Categoria
                  </label>
                  <div className={"flex gap-1.5"}>
                    <select
                      id="product-category"
                      required
                      value={prodFormCategoriaId}
                      onChange={(e) => setProdFormCategoriaId(e.target.value)}
                      className={"flex-1 px-3 py-2 bg-koma-panel border border-koma-border rounded-xl text-koma-foreground focus:outline-none focus:border-[#10b981]"}
                    >
                      <option value="" disabled>
                        Selecione...
                      </option>
                      {apiCategorias.map((cat) => (
                        <option key={cat.id} value={cat.id}>
                          {cat.nome}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => setShowCategoryModal(true)}
                      title="Criar nova categoria"
                      aria-label="Criar nova categoria"
                      className={"inline-flex items-center gap-1 px-2.5 bg-emerald-500/15 hover:bg-[#10b981]/20 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30 rounded-xl font-bold text-[9px] cursor-pointer transition-colors"}
                    >
                      <Plus size={13} /> Nova
                    </button>
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="product-description"
                  className={"text-[10px] font-bold text-koma-secondary block"}
                >
                  Descrição para o cliente
                </label>
                <textarea
                  id="product-description"
                  placeholder="Hambúrguer bovino 150g, queijo cheddar derretido..."
                  value={prodFormDescricao}
                  onChange={(e) => setProdFormDescricao(e.target.value)}
                  rows={2}
                  className={"w-full px-3 py-2 bg-koma-panel border border-koma-border rounded-xl text-koma-foreground focus:outline-none focus:border-[#10b981]"}
                />
                <p className="text-[9px] text-koma-muted">
                  Use uma frase curta com os principais ingredientes. Ela também ajuda na busca.
                </p>
              </div>

              <details className="group overflow-hidden rounded-xl border border-koma-border bg-koma-panel">
                <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between px-3 text-[10px] font-bold text-koma-secondary">
                  <span>
                    Fotos do produto
                    <span className="ml-1 font-normal text-koma-muted">
                      {[prodFormImagem, prodFormImagem2, prodFormImagem3].filter((url) => url.trim()).length > 0
                        ? `(${[prodFormImagem, prodFormImagem2, prodFormImagem3].filter((url) => url.trim()).length} adicionada${[prodFormImagem, prodFormImagem2, prodFormImagem3].filter((url) => url.trim()).length === 1 ? '' : 's'})`
                        : '(opcional)'}
                    </span>
                  </span>
                  <span className="text-[9px] font-medium text-koma-muted group-open:hidden">
                    {[prodFormImagem, prodFormImagem2, prodFormImagem3].some((url) => url.trim())
                      ? 'Ver fotos'
                      : 'Adicionar fotos'}
                  </span>
                  <span className="hidden text-[9px] font-medium text-koma-muted group-open:inline">Ocultar</span>
                </summary>
                <div className="space-y-2 border-t border-koma-border p-3">
                  <p className="text-[9px] leading-relaxed text-koma-muted">
                    Cole o endereço de até três fotos. A primeira será a imagem principal.
                  </p>
                  <input
                    type="text"
                    placeholder="Foto principal: https://…"
                    value={prodFormImagem}
                    onChange={(e) => setProdFormImagem(e.target.value)}
                    className={"w-full px-3 py-2 bg-koma-panel border border-koma-border rounded-xl text-koma-foreground text-xs focus:outline-none focus:border-[#10b981]"}
                  />
                  <input
                    type="text"
                    placeholder="Segunda foto: https://…"
                    value={prodFormImagem2}
                    onChange={(e) => setProdFormImagem2(e.target.value)}
                    className={"w-full px-3 py-2 bg-koma-panel border border-koma-border rounded-xl text-koma-foreground text-xs focus:outline-none focus:border-[#10b981]"}
                  />
                  <input
                    type="text"
                    placeholder="Terceira foto: https://…"
                    value={prodFormImagem3}
                    onChange={(e) => setProdFormImagem3(e.target.value)}
                    className={"w-full px-3 py-2 bg-koma-panel border border-koma-border rounded-xl text-koma-foreground text-xs focus:outline-none focus:border-[#10b981]"}
                  />
                </div>
              </details>

              <label
                htmlFor="prod-form-ativo"
                className={"flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-koma-border bg-koma-panel p-3"}
              >
                <span>
                  <strong className="block text-[10px] text-koma-foreground">Disponível para venda</strong>
                  <span className="mt-0.5 block text-[9px] text-koma-muted">
                    Desative para manter o produto cadastrado sem oferecê-lo nos canais de venda.
                  </span>
                </span>
                <input
                  type="checkbox"
                  id="prod-form-ativo"
                  checked={prodFormAtivo}
                  onChange={(e) => setProdFormAtivo(e.target.checked)}
                  className={"rounded border-koma-border text-emerald-500 focus:ring-emerald-500 h-4 w-4 bg-koma-card"}
                />
              </label>

              <div className={"flex gap-2 pt-2"}>
                <button
                  type="button"
                  onClick={() => setShowProductModal(false)}
                  className={"flex-1 py-2 bg-koma-card hover:bg-koma-raised border border-koma-border text-koma-foreground rounded-xl font-bold cursor-pointer transition-colors"}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isLoading || apiCategorias.length === 0}
                  className={"flex-1 py-2 bg-[#10b981] hover:bg-[#059669] text-[#121214] rounded-xl font-bold cursor-pointer transition-colors disabled:opacity-50"}
                >
                  {isLoading ? 'Salvando…' : editingProduct ? 'Salvar alterações' : 'Criar produto'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      <CategoriaModal
        isOpen={showCategoryModal}
        onClose={() => setShowCategoryModal(false)}
        apiBaseUrl={apiBaseUrl}
        authHeaders={authHeaders}
        onSuccess={async (category) => {
          if (onRefreshCategorias) {
            await onRefreshCategorias();
          } else {
            await fetchCategorias();
          }
          setProdFormCategoriaId(category.id);
        }}
        showToast={showToast}
      />
    </>
  );
}
