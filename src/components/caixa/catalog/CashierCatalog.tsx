
import { Image as ImageIcon, Plus, RefreshCw, Trash2, Upload, X } from 'lucide-react';
import { useRef, useState } from 'react';
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

const PRODUCT_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
const PRODUCT_IMAGE_MAX_SIZE = 5 * 1024 * 1024;

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
  const [prodFormOriginalImagem, setProdFormOriginalImagem] = useState('');
  const [prodFormImageFile, setProdFormImageFile] = useState<File | null>(null);
  const [prodFormImagePreview, setProdFormImagePreview] = useState('');
  const [prodFormImageRemoveRequested, setProdFormImageRemoveRequested] = useState(false);
  const [prodFormImageError, setProdFormImageError] = useState('');
  const productImageInputRef = useRef<HTMLInputElement | null>(null);

  const [prodFormAtivo, setProdFormAtivo] = useState(true);
  const [isLoading, setIsLoading] = useState(false);

  const resetProductImageState = (url = '') => {
    setProdFormImagem(url);
    setProdFormOriginalImagem(url);
    setProdFormImageFile(null);
    setProdFormImagePreview('');
    setProdFormImageRemoveRequested(false);
    setProdFormImageError('');
    if (productImageInputRef.current) productImageInputRef.current.value = '';
  };

  const selectProductImage = (file: File) => {
    const normalizedType = file.type.toLowerCase();
    if (!PRODUCT_IMAGE_TYPES.includes(normalizedType)) {
      setProdFormImageError('Use uma imagem PNG, JPG ou WEBP.');
      return;
    }
    if (file.size > PRODUCT_IMAGE_MAX_SIZE) {
      setProdFormImageError('A foto deve ter no máximo 5 MB.');
      return;
    }

    setProdFormImageError('');
    setProdFormImageFile(file);
    setProdFormImageRemoveRequested(false);
    const reader = new FileReader();
    reader.onload = () => setProdFormImagePreview(String(reader.result || ''));
    reader.onerror = () => {
      setProdFormImageFile(null);
      setProdFormImagePreview('');
      setProdFormImageError('Não foi possível ler essa imagem.');
    };
    reader.readAsDataURL(file);
  };

  const removeProductImageLocally = () => {
    setProdFormImageFile(null);
    setProdFormImagePreview('');
    setProdFormImagem('');
    setProdFormImageRemoveRequested(Boolean(prodFormOriginalImagem));
    setProdFormImageError('');
    if (productImageInputRef.current) productImageInputRef.current.value = '';
  };

  const productImagePreview = prodFormImagePreview
    || (!prodFormImageRemoveRequested ? prodFormImagem : '');

  return (
    <>
      {activeTab === 'cardapio' && activeSubTab === 'produtos' && (
        <div className="space-y-4">
          <OperationalBanner
            id="menu-products-heading"
            eyebrow="CATÁLOGO"
            title="Produtos"
            accent="fáceis de controlar"
            description="Selecione produtos para pausar, reajustar preços ou mover de categoria sem abrir item por item."
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
              resetProductImageState('');
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
              resetProductImageState(product.imagem || gallery[0] || '');
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
              resetProductImageState('');
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
            onBatchEdit={async (productIds, update) => {
              const response = await fetch(`${apiBaseUrl}/produtos/edicao-lote`, {
                method: 'PATCH',
                headers: { ...authHeaders, 'Content-Type': 'application/json' },
                body: JSON.stringify({ produto_ids: productIds, ...update }),
              });
              const payload = await response.json().catch(() => ({}));
              if (!response.ok) {
                showToast(payload.detail || 'Não foi possível editar os produtos selecionados.', 'error');
                return false;
              }
              await fetchProdutos();
              if (update.reajuste_percentual !== undefined) {
                const prefix = update.reajuste_percentual > 0 ? '+' : '';
                showToast(`Preços reajustados em ${prefix}${update.reajuste_percentual}%.`);
              } else {
                showToast('Produtos movidos de categoria.');
              }
              return true;
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
                  const payload = {
                    nome: prodFormNome.trim(),
                    categoria_id: prodFormCategoriaId,
                    preco: Number(prodFormPreco || 0),
                    descricao: prodFormDescricao.trim(),
                    imagem: prodFormImageRemoveRequested ? prodFormOriginalImagem : prodFormImagem.trim(),
                    imagens_galeria: [],
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
                        id: prodFormId.trim() || suggestedProductCode,
                        ...payload,
                      }),
                    });
                  }

                  const savedProduct = await res.json().catch(() => ({}));
                  if (!res.ok) {
                    showToast(savedProduct.detail || 'Não foi possível salvar o produto.', 'error');
                    return;
                  }

                  const savedProductId = String(
                    savedProduct.id || editingProduct?.id || prodFormId.trim() || suggestedProductCode,
                  );

                  if (prodFormImageFile) {
                    const formData = new FormData();
                    formData.append('file', prodFormImageFile);
                    const uploadHeaders = { ...authHeaders };
                    delete uploadHeaders['Content-Type'];
                    const imageResponse = await fetch(
                      `${apiBaseUrl}/api/cardapio-digital/assets/product/${encodeURIComponent(savedProductId)}`,
                      {
                        method: 'POST',
                        headers: uploadHeaders,
                        body: formData,
                      },
                    );
                    const imagePayload = await imageResponse.json().catch(() => ({}));
                    if (!imageResponse.ok) {
                      await fetchProdutos();
                      setEditingProduct(savedProduct);
                      setProdFormId(savedProductId);
                      showToast(
                        imagePayload.detail || 'Produto salvo, mas não foi possível enviar a foto. Tente novamente.',
                        'error',
                      );
                      return;
                    }
                    setProdFormImagem(String(imagePayload.imagem || ''));
                    setProdFormOriginalImagem(String(imagePayload.imagem || ''));
                    setProdFormImageFile(null);
                    setProdFormImagePreview('');
                    setProdFormImageRemoveRequested(false);
                  } else if (prodFormImageRemoveRequested && prodFormOriginalImagem) {
                    const imageResponse = await fetch(
                      `${apiBaseUrl}/api/cardapio-digital/assets/product/${encodeURIComponent(savedProductId)}`,
                      {
                        method: 'DELETE',
                        headers: authHeaders,
                      },
                    );
                    const imagePayload = await imageResponse.json().catch(() => ({}));
                    if (!imageResponse.ok) {
                      await fetchProdutos();
                      setEditingProduct(savedProduct);
                      setProdFormId(savedProductId);
                      showToast(
                        imagePayload.detail || 'Produto salvo, mas não foi possível remover a foto. Tente novamente.',
                        'error',
                      );
                      return;
                    }
                    resetProductImageState('');
                  }

                  await fetchProdutos();
                  setShowProductModal(false);
                  showToast(editingProduct ? 'Produto atualizado.' : 'Produto criado.');
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

              {!editingProduct && (
                <details className="group overflow-hidden rounded-xl border border-koma-border bg-koma-panel">
                  <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between px-3 text-[10px] font-bold text-koma-secondary">
                    <span>Mais opções</span>
                    <span className="text-[9px] font-medium text-koma-muted group-open:hidden">Código e ajustes avançados</span>
                    <span className="hidden text-[9px] font-medium text-koma-muted group-open:inline">Ocultar</span>
                  </summary>
                  <div className="space-y-1.5 border-t border-koma-border p-3">
                    <label
                      htmlFor="product-code"
                      className={"text-[10px] font-bold text-koma-secondary block"}
                    >
                      Código de busca / PDV
                    </label>
                    <input
                      type="text"
                      id="product-code"
                      aria-label="Código do produto"
                      placeholder="Ex.: 001"
                      value={prodFormId}
                      onChange={(e) => setProdFormId(e.target.value)}
                      className={"w-full px-3 py-2 bg-koma-panel border border-koma-border rounded-xl text-koma-foreground focus:outline-none focus:border-[#10b981]"}
                    />
                    <p className="text-[9px] leading-relaxed text-koma-muted">
                      O KÔMA já sugere um código. Altere apenas se sua operação usa código curto, etiqueta ou leitura no PDV.
                    </p>
                  </div>
                </details>
              )}

              <section className="rounded-xl border border-koma-border bg-koma-panel p-3">
                <div className="mb-3">
                  <strong className="block text-[10px] text-koma-foreground">Foto do produto <span className="font-normal text-koma-muted">(opcional)</span></strong>
                  <p className="mt-1 text-[9px] leading-relaxed text-koma-muted">
                    Use uma única foto. Clique em adicionar ou trocar para escolher um arquivo do seu dispositivo.
                  </p>
                </div>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <button
                    type="button"
                    onClick={() => productImageInputRef.current?.click()}
                    disabled={isLoading}
                    className="grid h-32 w-full shrink-0 place-items-center overflow-hidden rounded-xl border border-dashed border-koma-border bg-koma-raised transition hover:border-emerald-500/50 sm:w-44"
                    aria-label={productImagePreview ? 'Trocar foto do produto' : 'Adicionar foto do produto'}
                  >
                    {productImagePreview ? (
                      <img src={productImagePreview} alt="Prévia do produto" className="h-full w-full object-cover" />
                    ) : (
                      <span className="flex flex-col items-center gap-2 text-koma-muted">
                        <ImageIcon size={24} />
                        <span className="text-[9px] font-bold">Adicionar foto</span>
                      </span>
                    )}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="text-[9px] text-koma-muted">PNG, JPG ou WEBP · até 5 MB</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => productImageInputRef.current?.click()}
                        disabled={isLoading}
                        className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-koma-border bg-koma-card px-3 py-2 text-[9px] font-bold text-koma-secondary transition hover:bg-koma-raised disabled:opacity-50"
                      >
                        {productImagePreview ? <RefreshCw size={12} /> : <Upload size={12} />}
                        {productImagePreview ? 'Trocar foto' : 'Adicionar foto'}
                      </button>
                      {productImagePreview && (
                        <button
                          type="button"
                          onClick={removeProductImageLocally}
                          disabled={isLoading}
                          className="inline-flex min-h-9 items-center gap-1.5 rounded-xl px-3 py-2 text-[9px] font-bold text-rose-600 transition hover:bg-rose-500/10 dark:text-rose-300 disabled:opacity-50"
                        >
                          <Trash2 size={12} /> Remover foto
                        </button>
                      )}
                    </div>
                    {prodFormImageFile && (
                      <p className="mt-2 truncate text-[9px] font-semibold text-emerald-600 dark:text-emerald-300">
                        {prodFormImageFile.name}
                      </p>
                    )}
                    {prodFormImageError && (
                      <p className="mt-2 text-[9px] font-semibold text-rose-600 dark:text-rose-300">
                        {prodFormImageError}
                      </p>
                    )}
                  </div>
                </div>
                <input
                  ref={productImageInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/jpg,image/webp"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) selectProductImage(file);
                    event.currentTarget.value = '';
                  }}
                />
              </section>

              <div className="flex items-center justify-between gap-3 rounded-xl border border-koma-border bg-koma-panel p-3">
                <span>
                  <strong className="block text-[10px] text-koma-foreground">Produto à venda</strong>
                  <span className="mt-0.5 block text-[9px] text-koma-muted">
                    {prodFormAtivo
                      ? 'O produto aparece normalmente nos canais de venda.'
                      : 'Pausado: continua cadastrado e pode ser reativado a qualquer momento.'}
                  </span>
                </span>
                <div className="flex shrink-0 items-center gap-2">
                  <span className={`text-[9px] font-bold ${prodFormAtivo ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'}`}>
                    {prodFormAtivo ? 'À venda' : 'Pausado'}
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={prodFormAtivo}
                    aria-label="Produto à venda"
                    onClick={() => setProdFormAtivo((current) => !current)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full border transition-colors ${prodFormAtivo
                      ? 'border-emerald-500 bg-emerald-500'
                      : 'border-koma-border bg-koma-raised'}`}
                  >
                    <span
                      className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${prodFormAtivo ? 'translate-x-6' : 'translate-x-1'}`}
                    />
                  </button>
                </div>
              </div>

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