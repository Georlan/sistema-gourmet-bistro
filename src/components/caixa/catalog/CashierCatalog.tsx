import { snapshotFetch as fetch } from '../../../utils/snapshotFetch';

import { MAX_IMAGE_UPLOAD_SOURCE_BYTES, prepareImageUpload } from '../../../utils/imageUpload';
import { buildMultipartUploadHeaders } from '../../../utils/multipartUpload';
import { CheckCircle2, Image as ImageIcon, Plus, RefreshCw, Trash2, Upload, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CatalogCategory } from '../../../catalog/catalog';
import { Product, CardapioMenu } from '../../../types';
import {
  getEffectiveProductPrice,
  normalizeProductBadge,
  PRODUCT_BADGE_OPTIONS,
  type ProductBadge,
} from '../../../domain/productMerchandising';
import { CardapioCategoriasTab } from '../../cardapio/CardapioCategoriasTab';
import { CardapioProdutosTab } from '../../cardapio/CardapioProdutosTab';
import { CategoriaModal } from '../../cardapio/CategoriaModal';
import ComplementosTab from '../../cardapio/ComplementosTab';
import MoneyInput from '../../MoneyInput';
import MarmitariaTamanhos from '../../cardapio/MarmitariaTamanhos';
import { OperationalBanner } from '../../shared/OperationalBanner';
import { usePublicMenuSlug } from '../online-menu/usePublicMenuSlug';
import type { CaixaPanelProps, CashierNotice, CashierTab } from '../cashierContracts';
import CashierPromotionsHub from './CashierPromotionsHub';

interface Props {
  catalogReady: boolean;
  restauranteConfig: CaixaPanelProps['restauranteConfig'];
  onRefreshCategorias: CaixaPanelProps['onRefreshCategorias'];
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
  activeTab: string;
  activeSubTab: string;
  setActiveTab?: (tab: CashierTab) => void;
  setActiveSubTab: (tab: string) => void;
  showToast: CashierNotice;
  apiProdutos: Product[];
  apiCategorias: CatalogCategory[];
  suggestedProductCode: string;
  hasOnlineMenu: boolean;
  hasPrinting: boolean;
  hasLoyalty?: boolean;
  hasCoupons?: boolean;
  fetchProdutos: () => Promise<void>;
  fetchCategorias: () => Promise<void>;
  cardapios?: CardapioMenu[];
  cardapioAtivoId?: string | null;
  cardapiosAtivosIds?: string[];
  cardapioAtivoNome?: string | null;
}

interface ProductCustomizationGroup {
  id: string;
  nome: string;
  min_selecoes: number;
  max_selecoes: number;
  opcoes: { id: string; nome: string; preco_adicional: number; ativo: boolean }[];
  produto_ids: string[];
  categoria_ids: string[];
}

interface FamilyVariantDraft {
  produto_id?: string;
  rotulo: string;
  preco: number | '';
  ativo: boolean;
}
interface CatalogProductFamily {
  id: string;
  nome: string;
  descricao: string;
  eixo: 'sabor' | 'tamanho' | 'outra';
  categoria_id: string;
  cardapio_id: string | null;
  imagem: string;
  variantes: { produto_id: string; rotulo: string; preco: number; ativo: boolean }[];
}
const PRODUCT_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
const PRODUCT_IMAGE_MAX_SIZE = MAX_IMAGE_UPLOAD_SOURCE_BYTES;

export default function CashierCatalog({
  apiBaseUrl,
  authHeaders,
  activeTab,
  activeSubTab,
  setActiveTab,
  setActiveSubTab,
  showToast,
  apiProdutos,
  apiCategorias,
  suggestedProductCode,
  hasOnlineMenu,
  hasPrinting,
  hasLoyalty = false,
  hasCoupons = false,
  fetchProdutos,
  fetchCategorias,
  catalogReady,
  restauranteConfig,
  onRefreshCategorias,
  cardapios,
  cardapioAtivoId,
  cardapiosAtivosIds,
  cardapioAtivoNome,
}: Props) {
  const isMarmitaria = restauranteConfig?.operation_profile === 'marmitaria';
  const authorization = authHeaders.Authorization || authHeaders.authorization;
  const configuredSlug = usePublicMenuSlug(
    apiBaseUrl, authorization, restauranteConfig?.restaurante_id ?? null, hasOnlineMenu,
  );
  const [focusMarmitaId, setFocusMarmitaId] = useState<string | null>(null);
  const [showProductType, setShowProductType] = useState(false);
  const [showMarmitaCreate, setShowMarmitaCreate] = useState(false);
  const [creatingType, setCreatingType] = useState(false);
  const [showProductModal, setShowProductModal] = useState(false);
  // One editor and one draft: tabs only organize the existing fields.
  const [productEditorTab, setProductEditorTab] = useState<'produto' | 'variacoes' | 'adicionais' | 'mais'>('produto');
  useEffect(() => {
    if (showProductModal) setProductEditorTab('produto');
  }, [showProductModal]);

  const [showCategoryModal, setShowCategoryModal] = useState(false);

  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [hasVariants, setHasVariants] = useState(false);
  const [variantAxis, setVariantAxis] = useState<'sabor' | 'tamanho'>('sabor');
  const [variantRows, setVariantRows] = useState<FamilyVariantDraft[]>([]);
  const [editingFamilyId, setEditingFamilyId] = useState<string | null>(null);
  const [familyImage, setFamilyImage] = useState('');
  const [loadingFamily, setLoadingFamily] = useState(false);
  const [familyError, setFamilyError] = useState('');
  const [existingVariantId, setExistingVariantId] = useState('');

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
  const [prodFormSomentePromocao, setProdFormSomentePromocao] = useState(false);
  const [prodFormDestaque, setProdFormDestaque] = useState(false);
  const [prodFormSelo, setProdFormSelo] = useState<ProductBadge | ''>('');
  const [prodFormPrecoPromocional, setProdFormPrecoPromocional] = useState<number | ''>('');
  const [isLoading, setIsLoading] = useState(false);
  const [optimisticOverrides, setOptimisticOverrides] = useState<Record<string, Partial<Product>>>({});
  const [customizationGroups, setCustomizationGroups] = useState<ProductCustomizationGroup[]>([]);
  const [selectedCustomizationIds, setSelectedCustomizationIds] = useState<string[]>([]);
  const [previousCustomizationIds, setPreviousCustomizationIds] = useState<string[]>([]);
  const [inheritedCustomizationIds, setInheritedCustomizationIds] = useState<string[]>([]);
  const [loadingCustomizations, setLoadingCustomizations] = useState(false);
  const [customizationError, setCustomizationError] = useState('');
  const [customizationsLoaded, setCustomizationsLoaded] = useState(false);

  const cacheScopeKey = `${apiBaseUrl}|${authorization || ''}`;
  const customizationGroupsCacheRef = useRef<{ key: string; data: ProductCustomizationGroup[] } | null>(null);
  const productFamiliesCacheRef = useRef<{ key: string; data: CatalogProductFamily[] } | null>(null);

  const invalidateCatalogCaches = () => {
    customizationGroupsCacheRef.current = null;
    productFamiliesCacheRef.current = null;
  };

  useEffect(() => {
    setOptimisticOverrides({});
  }, [apiProdutos]);

  const [selectedCardapioId, setSelectedCardapioId] = useState<string | null>(
    () => cardapioAtivoId || (cardapios && cardapios.length > 0 ? cardapios[0].id : null),
  );
  const [isPublishingMenu, setIsPublishingMenu] = useState(false);
  const [prodFormCardapioId, setProdFormCardapioId] = useState<string>('');

  useEffect(() => {
    if (cardapios && cardapios.length > 0) {
      if (!selectedCardapioId || !cardapios.some((c) => c.id === selectedCardapioId)) {
        setSelectedCardapioId(cardapioAtivoId || cardapios[0].id);
      }
    }
  }, [cardapios, cardapioAtivoId]);

  // Carrega os grupos quando o editor é aberto, reutilizando o cache em memória
  // até ser invalidado por uma mutação ou troca de tenant/auth.
  useEffect(() => {
    if (!showProductModal || isMarmitaria) return;
    let cancelled = false;
    setLoadingCustomizations(true);
    setCustomizationsLoaded(false);
    setCustomizationError('');
    const headers = authorization ? { Authorization: authorization } : authHeaders;
    const cachedGroups = customizationGroupsCacheRef.current?.key === cacheScopeKey
      ? customizationGroupsCacheRef.current.data
      : null;

    const groupsPromise: Promise<ProductCustomizationGroup[]> = cachedGroups
      ? Promise.resolve(cachedGroups)
      : fetch(`${apiBaseUrl}/cardapio/modificadores/grupos`, { headers }).then(async (response) => {
          if (!response.ok) throw new Error('Não foi possível carregar as personalizações.');
          const data = await response.json();
          const normalized = Array.isArray(data) ? data : [];
          customizationGroupsCacheRef.current = { key: cacheScopeKey, data: normalized };
          return normalized;
        });

    const linksPromise: Promise<{ grupo_ids?: string[]; grupos_diretos?: string[]; grupos_herdados?: string[] } | null> =
      hasVariants && editingFamilyId
        ? fetch(`${apiBaseUrl}/produto-familias/${encodeURIComponent(editingFamilyId)}/personalizacoes`, { headers })
            .then(async (response) => {
              if (!response.ok) throw new Error('Não foi possível carregar as personalizações.');
              return response.json();
            })
        : !hasVariants && editingProduct?.id
          ? fetch(`${apiBaseUrl}/produtos/${encodeURIComponent(editingProduct.id)}/personalizacoes`, { headers })
              .then(async (response) => {
                if (!response.ok) throw new Error('Não foi possível carregar as personalizações.');
                return response.json();
              })
          : Promise.resolve(null);

    Promise.all([groupsPromise, linksPromise]).then(([groups, links]) => {
      if (cancelled) return;
      setCustomizationGroups(groups);
      const direct = hasVariants ? (links?.grupo_ids || []) : (links?.grupos_diretos || []);
      setPreviousCustomizationIds(direct);
      setSelectedCustomizationIds(direct);
      setInheritedCustomizationIds(hasVariants ? [] : (links?.grupos_herdados || []));
      setCustomizationsLoaded(true);
    }).catch((error) => {
      if (!cancelled) setCustomizationError(error instanceof Error ? error.message : 'Erro ao carregar personalizações.');
    }).finally(() => { if (!cancelled) setLoadingCustomizations(false); });
    return () => { cancelled = true; };
    // A autorização é a identidade de leitura; mudanças no formulário não disparam novas consultas.
  }, [showProductModal, editingProduct?.id, editingFamilyId, hasVariants, apiBaseUrl, authorization, cacheScopeKey, isMarmitaria]);

  // Existing families load into the same editor; reuse cached families when available.
  useEffect(() => {
    if (!showProductModal || !editingFamilyId || isMarmitaria) return;
    let cancelled = false;
    setLoadingFamily(true);
    setFamilyError('');
    const headers = authorization ? { Authorization: authorization } : authHeaders;
    const cachedFamilies = productFamiliesCacheRef.current?.key === cacheScopeKey
      ? productFamiliesCacheRef.current.data
      : null;

    const applyFamily = (families: CatalogProductFamily[]) => {
      const family = families.find((item) => item.id === editingFamilyId);
      if (!family) throw new Error('Produto com variações não encontrado. Atualize o cardápio.');
      if (cancelled) return;
      setProdFormNome(family.nome);
      setProdFormDescricao(family.descricao || '');
      setProdFormCategoriaId(family.categoria_id);
      setProdFormCardapioId(family.cardapio_id || '');
      setVariantAxis(family.eixo === 'tamanho' ? 'tamanho' : 'sabor');
      setFamilyImage(family.imagem || '');
      setVariantRows(family.variantes.map((variant) => ({
        produto_id: variant.produto_id,
        rotulo: variant.rotulo,
        preco: variant.preco,
        ativo: variant.ativo,
      })));
    };

    const familiesPromise: Promise<CatalogProductFamily[]> = cachedFamilies
      ? Promise.resolve(cachedFamilies)
      : fetch(`${apiBaseUrl}/produto-familias`, { headers }).then(async (response) => {
          if (!response.ok) throw new Error('Não foi possível carregar os sabores ou tamanhos.');
          const data = await response.json() as CatalogProductFamily[];
          const normalized = Array.isArray(data) ? data : [];
          productFamiliesCacheRef.current = { key: cacheScopeKey, data: normalized };
          return normalized;
        });

    familiesPromise
      .then(applyFamily)
      .catch((error) => { if (!cancelled) setFamilyError(error instanceof Error ? error.message : 'Não foi possível carregar o produto.'); })
      .finally(() => { if (!cancelled) setLoadingFamily(false); });
    return () => { cancelled = true; };
  }, [showProductModal, editingFamilyId, isMarmitaria, apiBaseUrl, authorization, cacheScopeKey]);

  const handlePublishCardapio = async (targetMenuId: string, targetMenuNome: string) => {
    if (isPublishingMenu) return;
    setIsPublishingMenu(true);
    try {
      const response = await fetch(`${apiBaseUrl}/produtos/menus/${targetMenuId}/publicar`, {
        method: 'POST',
        headers: authHeaders,
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || 'Não foi possível publicar o cardápio.');
      }
      showToast(`Cardápio "${targetMenuNome}" publicado com sucesso! Agora ativo no PDV e Cardápio Digital.`);
      await fetchProdutos();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erro ao publicar cardápio.', 'error');
    } finally {
      setIsPublishingMenu(false);
    }
  };

  const activeMenuIds = cardapiosAtivosIds?.length ? cardapiosAtivosIds : cardapioAtivoId ? [cardapioAtivoId] : [];
  const toggleAdditionalMenu = async (id: string) => {
    if (isPublishingMenu) return;
    const next = activeMenuIds.includes(id) ? activeMenuIds.filter((value) => value !== id) : [...activeMenuIds, id];
    if (!next.length) { showToast('Mantenha ao menos um cardápio ativo.', 'error'); return; }
    setIsPublishingMenu(true);
    try {
      const response = await fetch(`${apiBaseUrl}/produtos/menus/ativos`, { method: 'PUT', headers: { ...authHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify(next) });
      if (!response.ok) throw new Error('Não foi possível atualizar os cardápios ativos.');
      await fetchProdutos();
      showToast('Cardápios ativos atualizados.');
    } catch (err) { showToast(err instanceof Error ? err.message : 'Erro ao atualizar cardápios.', 'error'); }
    finally { setIsPublishingMenu(false); }
  };

  const [familyLabels, setFamilyLabels] = useState<Record<string, string>>({});
  // Reuse the family API that already powers the editor and prime the in-memory cache.
  useEffect(() => {
    if (activeSubTab !== 'produtos' || isMarmitaria) return;
    if (!apiProdutos.some((product) => Boolean(product.familia_id))) {
      setFamilyLabels({});
      productFamiliesCacheRef.current = null;
      return;
    }
    let cancelled = false;
    const headers = authorization ? { Authorization: authorization } : authHeaders;
    fetch(`${apiBaseUrl}/produto-familias`, { headers })
      .then(async (response) => {
        if (!response.ok) throw new Error('Famílias indisponíveis.');
        const families = await response.json() as CatalogProductFamily[];
        const normalized = Array.isArray(families) ? families : [];
        productFamiliesCacheRef.current = { key: cacheScopeKey, data: normalized };
        if (!cancelled) setFamilyLabels(Object.fromEntries(
          normalized.map((family) => [family.id, family.nome]),
        ));
      })
      .catch(() => {
        if (!cancelled) setFamilyLabels({});
      });
    return () => { cancelled = true; };
    // Refreshing the canonical catalog also refreshes the family labels and cache.
  }, [activeSubTab, apiBaseUrl, apiProdutos, authorization, cacheScopeKey, isMarmitaria]);

  const handleToggleHighlight = async (product: Product, destaque: boolean) => {
    setOptimisticOverrides((current) => ({
      ...current,
      [product.id]: { ...current[product.id], destaque },
    }));
    try {
      const response = await fetch(`${apiBaseUrl}/produtos/${product.id}`, {
        method: 'PUT',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ destaque }),
      });
      if (!response.ok) {
        setOptimisticOverrides((current) => {
          const next = { ...current };
          delete next[product.id];
          return next;
        });
        showToast('Não foi possível atualizar o destaque.', 'error');
        return;
      }
      await fetchProdutos();
      showToast(destaque ? 'Produto marcado como destaque.' : 'Destaque removido.');
    } catch {
      setOptimisticOverrides((current) => {
        const next = { ...current };
        delete next[product.id];
        return next;
      });
      showToast('Erro de conexão ao atualizar o destaque.', 'error');
    }
  };

  const handleQuickPriceUpdate = async (product: Product, novoPreco: number): Promise<boolean> => {
    if (!Number.isFinite(novoPreco) || novoPreco < 0) {
      showToast('Informe um preço válido.', 'error');
      return false;
    }
    setOptimisticOverrides((current) => ({
      ...current,
      [product.id]: { ...current[product.id], preco: novoPreco },
    }));
    try {
      const response = await fetch(`${apiBaseUrl}/produtos/${product.id}`, {
        method: 'PUT',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ preco: novoPreco }),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        setOptimisticOverrides((current) => {
          const next = { ...current };
          delete next[product.id];
          return next;
        });
        showToast(errorData.detail || 'Não foi possível atualizar o preço.', 'error');
        return false;
      }
      await fetchProdutos();
      showToast('Preço atualizado.');
      return true;
    } catch {
      setOptimisticOverrides((current) => {
        const next = { ...current };
        delete next[product.id];
        return next;
      });
      showToast('Erro de conexão ao atualizar o preço.', 'error');
      return false;
    }
  };

  const displayedProdutos = useMemo(() => {
    const base = !cardapios || cardapios.length === 0 || !selectedCardapioId
      ? apiProdutos
      : apiProdutos.filter((p) => p.cardapio_id === selectedCardapioId);
    if (Object.keys(optimisticOverrides).length === 0) return base;
    return base.map((product) => (
      optimisticOverrides[product.id]
        ? { ...product, ...optimisticOverrides[product.id] }
        : product
    ));
  }, [apiProdutos, cardapios, optimisticOverrides, selectedCardapioId]);

  const activeSelectedMenu = cardapios?.find((c) => c.id === selectedCardapioId);
  const isSelectedMenuPublished = Boolean(
    selectedCardapioId && activeMenuIds.includes(selectedCardapioId),
  );

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
      setProdFormImageError('A foto deve ter no máximo 20 MB.');
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

  const isMarmitaCategory = (category: CatalogCategory) => /^(marmitas?|quentinhas?)$/i.test(category.nome.trim()) || Boolean(category.marmitaria_tamanho);
  const isMarmita = (product: Product) => Boolean(product.marmitaria_tamanho) || apiCategorias.some(category => category.id === product.categoria_id && isMarmitaCategory(category));
  const startProduct = () => {
    setEditingProduct(null);
    setHasVariants(false);
    setEditingFamilyId(null);
    setVariantRows([]);
    setVariantAxis('sabor');
    setFamilyImage('');
    setFamilyError('');
    setExistingVariantId('');
    setProdFormId(suggestedProductCode);
    setProdFormNome('');
    setProdFormPreco('');
    setProdFormCategoriaId((isMarmitaria ? apiCategorias.find(category => !isMarmitaCategory(category)) : apiCategorias[0])?.id || '');
    setProdFormDescricao('');
    resetProductImageState('');
    setProdFormAtivo(true);
    setProdFormSomentePromocao(false);
    setProdFormDestaque(false);
    setProdFormSelo('');
    setProdFormPrecoPromocional('');
    setProdFormCardapioId(selectedCardapioId || activeMenuIds[0] || cardapios?.[0]?.id || '');
    setShowProductModal(true);
  };

  const editProductDetails = (product: Product) => {
    setEditingProduct(product);
    setHasVariants(Boolean(product.familia_id));
    setEditingFamilyId(product.familia_id || null);
    setVariantRows([]);
    setVariantAxis('sabor');
    setFamilyImage('');
    setFamilyError('');
    setExistingVariantId('');
    setProdFormId(product.id);
    setProdFormNome(product.nome);
    setProdFormPreco(Number(product.preco) || 0);
    setProdFormCategoriaId(product.categoria_id || '');
    setProdFormDescricao(product.descricao || '');
    const gallery = product.imagens_galeria || [];
    resetProductImageState(product.imagem || gallery[0] || '');
    setProdFormAtivo(product.ativo !== false);
    setProdFormSomentePromocao(product.somente_promocao === true);
    setProdFormDestaque(product.destaque === true);
    setProdFormSelo(normalizeProductBadge(product.selo) ?? '');
    setProdFormPrecoPromocional(
      product.preco_promocional != null && Number(product.preco_promocional) > 0
        ? Number(product.preco_promocional)
        : '',
    );
    setProdFormCardapioId(product.cardapio_id || '');
    setShowProductModal(true);
  };

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
              { label: 'produtos', value: displayedProdutos.length },
              { label: 'disponíveis', value: displayedProdutos.filter((item) => item.ativo !== false).length },
              {
                label: displayedProdutos.filter((item) => item.ativo === false).length === 1 ? 'pausado' : 'pausados',
                value: displayedProdutos.filter((item) => item.ativo === false).length,
              },
              { label: 'categorias', value: apiCategorias.length },
            ]}
          />
          {cardapios && cardapios.length > 0 && (
            <div className="rounded-2xl border border-koma-border bg-koma-card p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0">
                <span className="text-xs font-bold text-koma-secondary uppercase tracking-wider shrink-0 mr-1">
                  Cardápios:
                </span>
                {cardapios.map((menu) => {
                  const isSelected = menu.id === selectedCardapioId;
                  const isPublished = activeMenuIds.includes(menu.id);
                  const itemCount = apiProdutos.filter((p) => p.cardapio_id === menu.id).length;
                  return (
                    <button
                      key={menu.id}
                      type="button"
                      onClick={() => setSelectedCardapioId(menu.id)}
                      className={`relative flex min-h-11 items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all border cursor-pointer ${
                        isSelected
                          ? 'border-transparent font-bold'
                          : 'bg-koma-panel border-koma-border text-koma-secondary hover:text-koma-foreground hover:bg-koma-raised'
                      }`}
                      style={
                        isSelected
                          ? {
                              background: 'var(--kc-chrome-selected, var(--koma-action-bg))',
                              color: 'var(--kc-chrome-on-selected, var(--koma-action-text))',
                            }
                          : undefined
                      }
                    >
                      <span>{menu.nome}</span>
                      <span className="text-xs px-1.5 py-0.5 rounded-full bg-koma-panel/80 text-koma-muted tabular-nums">
                        {itemCount}
                      </span>
                      {isPublished && (
                        <span
                          className="flex h-2 w-2 rounded-full"
                          style={{ background: 'var(--koma-success-text)' }}
                          title="Cardápio ativo no momento"
                        />
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {activeSelectedMenu && activeMenuIds.length > 0 && (!isSelectedMenuPublished || activeMenuIds.length > 1) && (
                  <button type="button" disabled={isPublishingMenu} onClick={() => toggleAdditionalMenu(activeSelectedMenu.id)} className="min-h-11 rounded-xl border border-koma-border bg-koma-panel px-3 py-2 text-xs font-semibold text-koma-foreground hover:bg-koma-raised">
                    {isSelectedMenuPublished ? `Retirar ${activeSelectedMenu.nome} dos ativos` : `Ativar ${activeSelectedMenu.nome} junto`}
                  </button>
                )}
                {activeSelectedMenu && (
                  isSelectedMenuPublished ? (
                    <div
                      className="inline-flex min-h-11 items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold"
                      style={{
                        background: 'var(--koma-success-bg)',
                        borderColor: 'var(--koma-success-border)',
                        color: 'var(--koma-success-text)',
                      }}
                    >
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ background: 'var(--koma-success-text)' }}
                      />
                      <span>{activeSelectedMenu.nome} está ativo</span>
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={isPublishingMenu}
                      onClick={() => handlePublishCardapio(activeSelectedMenu.id, activeSelectedMenu.nome)}
                      className="inline-flex min-h-11 items-center gap-1.5 px-3.5 py-1.5 rounded-xl disabled:opacity-50 text-xs font-semibold transition-colors cursor-pointer"
                      style={{
                        background: 'var(--koma-action-bg)',
                        color: 'var(--koma-action-text)',
                      }}
                    >
                      {isPublishingMenu ? (
                        <RefreshCw size={13} className="animate-spin" />
                      ) : (
                        <CheckCircle2 size={13} />
                      )}
                      <span>Publicar {activeSelectedMenu.nome}</span>
                    </button>
                  )
                )}
              </div>
            </div>
          )}
          <CardapioProdutosTab
            produtos={displayedProdutos}
            categorias={apiCategorias}
            familyLabels={familyLabels}
            onOpenPromotions={() => setActiveSubTab('promocoes')}
            catalogReady={catalogReady || apiProdutos.length > 0 || apiCategorias.length > 0}
            previewUrl={
              hasOnlineMenu && configuredSlug
                ? `${window.location.origin}/c/${encodeURIComponent(configuredSlug)}`
                : undefined
            }
            onCreateProduct={() => isMarmitaria ? setShowProductType(true) : startProduct()}
            onCreateCategory={() => setShowCategoryModal(true)}
            onEditProduct={(product) => {
              editProductDetails(product);
            }}
            onDuplicateProduct={(product) => {
              if (isMarmitaria && isMarmita(product)) { showToast('Cada tamanho tem um único cadastro. Edite a marmita existente na lista de produtos.', 'error'); return; }
              setEditingProduct(null);
              setHasVariants(false);
              setEditingFamilyId(null);
              setVariantRows([]);
              setFamilyImage('');
              setFamilyError('');
              setExistingVariantId('');
              setProdFormId(suggestedProductCode);
              setProdFormNome(`${product.nome} (Cópia)`);
              setProdFormPreco(Number(product.preco) || 0);
              setProdFormCategoriaId(product.categoria_id || '');
              setProdFormDescricao(product.descricao || '');
              resetProductImageState('');
              setProdFormAtivo(true);
              setProdFormSomentePromocao(false);
              setProdFormDestaque(false);
              setProdFormSelo('');
              setProdFormPrecoPromocional('');
              setProdFormCardapioId(product.cardapio_id || '');
              setShowProductModal(true);
            }}
            onRemoveProduct={async (product) => {
              if (product.familia_id) {
                showToast('Esta opção pertence a um produto com sabores ou tamanhos. Edite o produto principal para alterar sua disponibilidade.', 'error');
                return;
              }
              if (!confirm(`Remover "${product.nome}" dos canais de venda? O histórico das vendas será preservado.`))
                return;
              try {
                const response = await fetch(`${apiBaseUrl}/produtos/${product.id}`, {
                  method: 'DELETE',
                  headers: authHeaders,
                });
                if (!response.ok) throw new Error('Não foi possível remover o produto.');
                invalidateCatalogCaches();
                await fetchProdutos();
                showToast('Produto removido dos canais de venda.');
              } catch (error) {
                showToast(error instanceof Error ? error.message : 'Erro ao remover produto.', 'error');
              }
            }}
            onToggleProduct={async (product, ativo) => {
              setOptimisticOverrides((current) => ({
                ...current,
                [product.id]: { ...current[product.id], ativo },
              }));
              const response = await fetch(`${apiBaseUrl}/produtos/${product.id}`, {
                method: 'PUT',
                headers: { ...authHeaders, 'Content-Type': 'application/json' },
                body: JSON.stringify({ ativo }),
              });
              if (!response.ok) {
                setOptimisticOverrides((current) => {
                  const next = { ...current };
                  delete next[product.id];
                  return next;
                });
                showToast('Não foi possível atualizar a disponibilidade.', 'error');
                return;
              }
              await fetchProdutos();
              showToast(ativo ? 'Produto publicado.' : 'Produto pausado.');
            }}
            onToggleHighlight={handleToggleHighlight}
            onQuickPriceUpdate={handleQuickPriceUpdate}
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
            description={hasPrinting
              ? "Escolha quais categorias imprimem na cozinha, no bar ou não precisam de via de preparo."
              : "Escolha quais categorias aparecem na Cozinha, no Bar ou seguem direto sem uma etapa de preparo."}
            metrics={[
              { label: 'categorias', value: apiCategorias.length },
              {
                label: 'cozinha',
                value: apiCategorias.filter((category) => category.destino_impressao === 'COZINHA').length,
              },
              { label: 'bar', value: apiCategorias.filter((category) => category.destino_impressao === 'BAR').length },
              {
                label: hasPrinting ? 'não imprimir' : 'sem preparo',
                value: apiCategorias.filter((category) => category.destino_impressao === 'NENHUM').length,
              },
            ]}
          />
          <CardapioCategoriasTab
            apiCategorias={apiCategorias}
            apiProdutos={apiProdutos}
            apiBaseUrl={apiBaseUrl}
            authHeaders={authHeaders}
            hasPrinting={hasPrinting}
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
            marmitariaCadastro={isMarmitaria}
            onShowNotification={(msg, type) => showToast(msg, type === 'error' ? 'error' : 'success')}
            onGroupsChanged={() => {
              customizationGroupsCacheRef.current = null;
            }}
          />
        </div>
      )}
      {activeTab === 'cardapio' && activeSubTab === 'promocoes' && (
        <CashierPromotionsHub
          apiBaseUrl={apiBaseUrl}
          authHeaders={authHeaders}
          produtos={apiProdutos}
          hasCoupons={hasCoupons}
          hasLoyalty={hasLoyalty}
          onNavigate={
            setActiveTab
              ? (tab, subTab) => {
                  setActiveTab(tab);
                  setActiveSubTab(subTab);
                }
              : undefined
          }
        />
      )}
      {showProductType && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
        <div role="dialog" aria-modal="true" aria-label="Novo produto" className="w-full max-w-md rounded-2xl border border-koma-border bg-koma-card p-5 space-y-4">
          <h3 className="font-bold">O que você quer adicionar?</h3>
          <div className="grid gap-3">
            <button disabled={creatingType} type="button" className="rounded-xl border border-koma-border p-3 text-left" onClick={() => { setFocusMarmitaId(null); setShowProductType(false); setShowMarmitaCreate(true); }}>Marmita<span className="block text-sm text-koma-muted">Escolha P, M ou G, informe o preço e defina a composição deste tamanho.</span></button>
            {(['Sobremesas', 'Bebidas'] as const).map(kind => <button key={kind} disabled={creatingType} type="button" className="rounded-xl border border-koma-border p-3 text-left" onClick={async () => {
              setCreatingType(true);
              try {
                let category = apiCategorias.find(item => item.nome.trim().toLocaleLowerCase('pt-BR') === kind.toLocaleLowerCase('pt-BR'));
                if (!category) {
                  const response = await fetch(`${apiBaseUrl}/produtos/categorias`, { method: 'POST', headers: { ...authHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: kind.toLowerCase(), nome: kind, destino_impressao: 'NENHUM' }) });
                  const data = await response.json().catch(() => null);
                  if (!response.ok) throw new Error(data?.detail || 'Não foi possível preparar a categoria. Tente novamente.');
                  category = data;
                  await fetchCategorias();
                }
                startProduct();
                setProdFormCategoriaId(category!.id);
                setShowProductType(false);
              } catch (error) { showToast(error instanceof Error ? error.message : 'Falha ao preparar produto.', 'error'); }
              finally { setCreatingType(false); }
            }}>{kind === 'Sobremesas' ? 'Sobremesa' : 'Bebida'}<span className="block text-sm text-koma-muted">{kind === 'Sobremesas' ? 'Pudim, bolo e outras sobremesas.' : 'Sucos, refrigerantes e outras bebidas.'}</span></button>)}
          </div>
          <button disabled={creatingType} type="button" onClick={() => setShowProductType(false)}>Cancelar</button>
        </div>
      </div>}
      {showMarmitaCreate && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
        <div role="dialog" aria-modal="true" aria-label="Nova marmita" className="w-full max-w-xl max-h-[90dvh] overflow-y-auto rounded-2xl border border-koma-border bg-koma-card p-4 space-y-3">
          <MarmitariaTamanhos createOnly={!focusMarmitaId} apiBaseUrl={apiBaseUrl} authHeaders={authHeaders} notify={showToast} focusProductId={focusMarmitaId} onFocusHandled={() => setFocusMarmitaId(null)} catalogVersion={JSON.stringify(apiProdutos.map(product => [product.id, product.nome, product.preco, product.ativo]))} onSaved={async () => { await Promise.all([fetchProdutos(), fetchCategorias()]); setShowMarmitaCreate(false); }} />
          <button type="button" onClick={() => setShowMarmitaCreate(false)}>Fechar</button>
        </div>
      </div>}
      {showProductModal && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowProductModal(false);
          }}
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-0 sm:p-4 overflow-hidden cursor-pointer"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="product-modal-title"
            className="cashier-product-modal w-full h-[100dvh] sm:h-auto max-w-xl max-h-[100dvh] sm:max-h-[calc(100dvh-2rem)] overflow-y-auto bg-koma-card border-0 sm:border border-koma-border rounded-none sm:rounded-3xl px-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))] pt-0 sm:p-6 space-y-4 text-left shadow-2xl relative animate-scale-in cursor-default"
          >
            <div className="sticky top-0 z-20 -mx-4 flex min-h-16 items-center justify-between border-b border-koma-border bg-koma-card px-4 py-3 sm:static sm:mx-0 sm:min-h-0 sm:bg-transparent sm:px-0 sm:pb-2 sm:pt-0">
              <div>
                <div className="flex items-center gap-2">
                  <h3
                    id="product-modal-title"
                    className="text-base font-bold text-koma-foreground"
                    style={{ fontFamily: 'var(--koma-font-display)' }}
                  >
                    {editingProduct ? 'Editar produto' : 'Novo produto'}
                  </h3>
                  {editingProduct && (
                    <span className="rounded-full border border-koma-border bg-koma-raised px-2 py-0.5 font-mono text-xs text-koma-muted">
                      #{editingProduct.id}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-koma-muted">
                  As alterações aparecem no caixa, atendimento e cardápio online.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowProductModal(false)}
                aria-label="Fechar"
                className="grid h-11 w-11 place-items-center rounded-xl border border-koma-border text-koma-subtle hover:text-koma-foreground transition-colors cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            {!isMarmitaria && (
              <div role="tablist" aria-label="Seções do produto"
                className="sticky top-16 z-10 -mx-4 grid grid-cols-4 gap-1 border-b border-koma-border bg-koma-card px-4 py-2 sm:top-0 sm:mx-0 sm:px-0">
                {([
                  ['produto', 'Produto'],
                  ['variacoes', 'Variações'],
                  ['adicionais', 'Adicionais'],
                  ['mais', 'Mais'],
                ] as const).map(([tab, label]) => (
                  <button key={tab} type="button" role="tab" aria-selected={productEditorTab === tab}
                    onClick={() => setProductEditorTab(tab)}
                    className={`min-h-11 rounded-lg border px-1 text-xs font-bold transition-colors ${productEditorTab === tab
                      ? 'border-transparent'
                      : 'border-transparent text-koma-secondary hover:bg-koma-raised'}`}
                    style={
                      productEditorTab === tab
                        ? {
                            background: 'var(--kc-chrome-selected, var(--koma-action-bg))',
                            color: 'var(--kc-chrome-on-selected, var(--koma-action-text))',
                          }
                        : undefined
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const submitter = (e.nativeEvent as SubmitEvent).submitter;
                const openComposition = submitter instanceof HTMLButtonElement && submitter.value === 'composition';
                if (isLoading) return;
                // Hidden tabs cannot rely on native required-field validation.
                // Validate the basic draft before any request, then show its tab.
                if (!prodFormNome.trim() || !prodFormCategoriaId || (!hasVariants && prodFormPreco === '')) {
                  setProductEditorTab('produto');
                  showToast('Informe nome, categoria e preço antes de salvar.', 'error');
                  return;
                }
                const regularPriceNum = Number(prodFormPreco || 0);
                const hasPromoPriceInput = prodFormPrecoPromocional !== '' && prodFormPrecoPromocional !== null;
                const promoPriceNum = hasPromoPriceInput ? Number(prodFormPrecoPromocional) : null;
                if (!hasVariants && hasPromoPriceInput) {
                  if (!Number.isFinite(promoPriceNum) || promoPriceNum! <= 0 || promoPriceNum! >= regularPriceNum) {
                    setProductEditorTab('produto');
                    showToast('O preço promocional deve ser maior que zero e menor que o preço de venda.', 'error');
                    return;
                  }
                }
                setIsLoading(true);
                try {
                  const preparedImage = prodFormImageFile
                    ? await prepareImageUpload(prodFormImageFile, 'products') : null;
                  const payload = {
                    nome: prodFormNome.trim(),
                    categoria_id: prodFormCategoriaId,
                    preco: regularPriceNum,
                    preco_promocional: !hasVariants ? promoPriceNum : null,
                    destaque: prodFormDestaque,
                    selo: prodFormSelo || null,
                    descricao: prodFormDescricao.trim(),
                    imagem: prodFormImageRemoveRequested ? prodFormOriginalImagem : prodFormImagem.trim(),
                    imagens_galeria: [],
                    ativo: prodFormAtivo,
                    somente_promocao: prodFormSomentePromocao,
                    cardapio_id: prodFormCardapioId || null,
                  };

                  if (hasVariants && !isMarmitaria) {
                    if (loadingFamily || familyError || loadingCustomizations || !customizationsLoaded || customizationError) {
                      showToast(familyError || customizationError || 'Conclua o carregamento das opções antes de salvar.', 'error');
                      return;
                    }
                    const labels = variantRows.map(row => row.rotulo.trim().toLocaleLowerCase('pt-BR'));
                    if (!variantRows.length || variantRows.some(row => !row.rotulo.trim() || Number(row.preco) <= 0)
                      || new Set(labels).size !== labels.length) {
                      setProductEditorTab('variacoes');
                      showToast('Informe nome e preço válido para cada opção, sem repetir nomes.', 'error');
                      return;
                    }
                    // A family is only presentation. Each variant is a real
                    // sellable SKU with independent price, inventory and order ID.
                    const familyPayload = {
                      nome: payload.nome,
                      descricao: payload.descricao,
                      eixo: variantAxis,
                      categoria_id: payload.categoria_id,
                      cardapio_id: payload.cardapio_id,
                      imagem: familyImage,
                      variantes: variantRows.map(row => ({
                        ...(row.produto_id ? { produto_id: row.produto_id } : {}),
                        rotulo: row.rotulo.trim(),
                        preco: Number(row.preco),
                        ativo: row.ativo,
                      })),
                      grupo_ids: selectedCustomizationIds,
                      grupos_anteriores: previousCustomizationIds,
                    };
                    const familyResponse = await fetch(
                      `${apiBaseUrl}/produto-familias${editingFamilyId ? `/${encodeURIComponent(editingFamilyId)}` : ''}`,
                      {
                        method: editingFamilyId ? 'PUT' : 'POST',
                        headers: { ...authHeaders, 'Content-Type': 'application/json' },
                        body: JSON.stringify(familyPayload),
                      },
                    );
                    const family = await familyResponse.json().catch(() => ({}));
                    if (!familyResponse.ok) {
                      showToast(family.detail || 'Não foi possível salvar os sabores ou tamanhos.', 'error');
                      return;
                    }
                    // The family and shared choices commit together. If an
                    // optional photo upload fails, retry updates the same IDs.
                    setEditingFamilyId(String(family.id));
                    setPreviousCustomizationIds(family.grupo_ids || selectedCustomizationIds);
                    setVariantRows((family.variantes || []).map((variant: {
                      produto_id: string; rotulo: string; preco: number; ativo: boolean;
                    }) => ({
                      produto_id: variant.produto_id, rotulo: variant.rotulo,
                      preco: variant.preco, ativo: variant.ativo,
                    })));
                    const firstSkuId = family.variantes?.[0]?.produto_id;
                    if (firstSkuId && (preparedImage || prodFormImageRemoveRequested)) {
                      const formData = new FormData();
                      if (preparedImage) formData.append('file', preparedImage);
                      const imageResponse = await fetch(
                        `${apiBaseUrl}/api/cardapio-digital/assets/product/${encodeURIComponent(firstSkuId)}`,
                        {
                          method: preparedImage ? 'POST' : 'DELETE',
                          headers: buildMultipartUploadHeaders(authHeaders),
                          ...(preparedImage ? { body: formData } : {}),
                        },
                      );
                      const imageData = await imageResponse.json().catch(() => ({}));
                      if (!imageResponse.ok) {
                        await fetchProdutos();
                        showToast(imageData.detail || 'Opções salvas, mas a foto não foi atualizada. Tente novamente.', 'error');
                        return;
                      }
                      resetProductImageState(String(imageData.imagem || ''));
                    }
                    invalidateCatalogCaches();
                    await fetchProdutos();
                    setShowProductModal(false);
                    showToast('Produto e opções salvos. Cada opção tem seu próprio preço.');
                    return;
                  }

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

                  // Um cadastro, dois recursos: o SKU é salvo primeiro; os vínculos
                  // diretos são atualizados com verificação de concorrência.
                  // Se a segunda etapa falhar, mantemos o editor aberto e editamos
                  // o produto recém-criado, evitando criar uma duplicata no retry.
                  const selected = [...selectedCustomizationIds].sort();
                  const previous = [...previousCustomizationIds].sort();
                  const changedLinks = customizationsLoaded
                    && (selected.length !== previous.length
                      || selected.some((id, index) => id !== previous[index]));
                  if (changedLinks) {
                    const linkResponse = await fetch(
                      `${apiBaseUrl}/produtos/${encodeURIComponent(savedProductId)}/personalizacoes`,
                      {
                        method: 'PUT',
                        headers: { ...authHeaders, 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          grupo_ids: selected,
                          grupos_diretos_anteriores: previous,
                        }),
                      },
                    );
                    if (!linkResponse.ok) {
                      const errorPayload = await linkResponse.json().catch(() => ({}));
                      setEditingProduct(savedProduct);
                      setProdFormId(savedProductId);
                      await fetchProdutos();
                      showToast(
                        `Produto salvo, mas as personalizações não foram vinculadas: ${errorPayload.detail || 'Reabra o cadastro e tente novamente.'}`,
                        'error',
                      );
                      return;
                    }
                    setPreviousCustomizationIds(selected);
                    customizationGroupsCacheRef.current = null;
                  }

                  if (preparedImage) {
                    const formData = new FormData();
                    formData.append('file', preparedImage);
                    const imageResponse = await fetch(
                      `${apiBaseUrl}/api/cardapio-digital/assets/product/${encodeURIComponent(savedProductId)}`,
                      {
                        method: 'POST',
                        headers: buildMultipartUploadHeaders(authHeaders),
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
                  if (openComposition) { setFocusMarmitaId(savedProductId); setShowMarmitaCreate(true); }
                } catch (err) {
                  console.error(err);
                  showToast('Erro de conexão ao salvar produto.', 'error');
                } finally {
                  setIsLoading(false);
                }
              }}
              className={"space-y-5 text-xs"}
            >
              <div hidden={!isMarmitaria && productEditorTab !== 'produto'} className="space-y-5">
              {apiCategorias.length === 0 && (
                <div
                  className="flex items-center justify-between gap-3 rounded-xl border p-3 text-xs"
                  style={{
                    background: 'var(--koma-warning-bg)',
                    borderColor: 'var(--koma-warning-border)',
                    color: 'var(--koma-warning-text)',
                  }}
                >
                  <span>{isMarmitaria ? 'Crie uma categoria, como Sobremesas ou Bebidas, para este produto.' : 'Crie uma categoria antes de salvar o primeiro produto.'}</span>
                  <button
                    type="button"
                    onClick={() => setShowCategoryModal(true)}
                    className="shrink-0 font-bold underline underline-offset-2"
                  >
                    Criar categoria
                  </button>
                </div>
              )}

              {isMarmitaria && <p className="text-sm text-koma-muted">{editingProduct && isMarmita(editingProduct) ? 'Edite preço, foto e descrição aqui. A quantidade de proteínas, guarnições e saladas é configurada nesta quentinha, em Produtos.' : 'Cadastre aqui sobremesas e bebidas. Todos aparecem na mesma lista de produtos.'}</p>}
              {isMarmitaria && editingProduct && isMarmita(editingProduct) && (
                <div className="space-y-2">
                  <button
                    type="submit"
                    name="nextAction"
                    value="composition"
                    disabled={isLoading}
                    className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition disabled:cursor-not-allowed disabled:opacity-50"
                    style={{
                      background: 'var(--koma-success-bg)',
                      borderColor: 'var(--koma-success-border)',
                      color: 'var(--koma-success-text)',
                    }}
                  >
                    <span>
                      <strong className="block text-sm">Salvar e configurar composição da quentinha</strong>
                      <span aria-hidden="true" className="mt-0.5 block text-xs font-medium text-koma-muted">Defina os limites de proteínas, guarnições e saladas deste tamanho.</span>
                    </span>
                    <span aria-hidden="true" className="text-lg font-black">→</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setFocusMarmitaId(editingProduct.id);
                      setShowProductModal(false);
                      setShowMarmitaCreate(true);
                    }}
                    disabled={isLoading}
                    className="block w-full text-right text-xs font-semibold underline underline-offset-2"
                    style={{ color: 'var(--koma-success-text)' }}
                  >
                    Abrir composição diretamente sem salvar dados básicos
                  </button>
                </div>
              )}
              <div className="space-y-1.5">
                <label
                  htmlFor="product-name"
                  className="text-xs font-bold text-koma-secondary block"
                >
                  Nome do produto
                </label>
                <input
                  type="text"
                  id="product-name"
                  readOnly={isMarmitaria && Boolean(editingProduct) && isMarmita(editingProduct)}
                  required={isMarmitaria || productEditorTab === 'produto'}
                  placeholder={isMarmitaria ? 'Ex: Pudim ou refrigerante' : 'Ex: Cheeseburger Duplo'}
                  value={prodFormNome}
                  onChange={(e) => setProdFormNome(e.target.value)}
                  className="min-h-11 w-full px-3 py-2 bg-koma-input border border-koma-border rounded-xl text-base sm:text-xs text-koma-foreground focus:outline-none focus:border-koma-border-strong"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {!hasVariants && <div className="space-y-1.5">
                  <label
                    htmlFor="product-price"
                    className="text-xs font-bold text-koma-secondary block"
                  >
                    Preço de venda
                  </label>
                  <MoneyInput
                    id="product-price"
                    required={isMarmitaria || productEditorTab === 'produto'}
                    placeholder="25.90"
                    value={prodFormPreco}
                    onValueChange={setProdFormPreco}
                    className="min-h-11 w-full px-3 py-2 bg-koma-input border border-koma-border rounded-xl text-sm text-koma-foreground tabular-nums focus:outline-none focus:border-koma-border-strong"
                  />
                </div>}
                <div className="space-y-1.5">
                  <label
                    htmlFor="product-category"
                    className="text-xs font-bold text-koma-secondary block"
                  >
                    Categoria
                  </label>
                  <div className="flex gap-1.5">
                    <select
                      id="product-category"
                      disabled={Boolean(editingFamilyId) || (isMarmitaria && Boolean(editingProduct) && isMarmita(editingProduct))}
                      required={isMarmitaria || productEditorTab === 'produto'}
                      value={prodFormCategoriaId}
                      onChange={(e) => setProdFormCategoriaId(e.target.value)}
                      className="min-h-11 flex-1 px-3 py-2 bg-koma-input border border-koma-border rounded-xl text-sm text-koma-foreground focus:outline-none focus:border-koma-border-strong"
                    >
                      <option value="" disabled>
                        Selecione...
                      </option>
                      {apiCategorias.filter(cat => !isMarmitaria || !isMarmitaCategory(cat) || editingProduct?.categoria_id === cat.id).map((cat) => (
                        <option key={cat.id} value={cat.id}>
                          {cat.nome}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => setShowCategoryModal(true)}
                      disabled={Boolean(editingFamilyId)}
                      title="Criar nova categoria"
                      aria-label="Criar nova categoria"
                      className="inline-flex min-h-11 items-center gap-1 px-3 border rounded-xl font-bold text-xs cursor-pointer transition-colors"
                      style={{
                        background: 'var(--koma-success-bg)',
                        borderColor: 'var(--koma-success-border)',
                        color: 'var(--koma-success-text)',
                      }}
                    >
                      <Plus size={14} /> Nova
                    </button>
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="product-description"
                  className="text-xs font-bold text-koma-secondary block"
                >
                  Descrição para o cliente
                </label>
                <textarea
                  id="product-description"
                  placeholder={isMarmitaria ? 'Ex: Pudim caseiro, fatia individual.' : 'Hambúrguer bovino 150g, queijo cheddar derretido...'}
                  value={prodFormDescricao}
                  onChange={(e) => setProdFormDescricao(e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 bg-koma-input border border-koma-border rounded-xl text-base sm:text-xs text-koma-foreground focus:outline-none focus:border-koma-border-strong"
                />
                <p className="text-xs text-koma-muted">
                  {isMarmitaria ? 'Descreva o produto que o cliente vai receber.' : 'Use uma frase curta com os principais ingredientes. Ela também ajuda na busca.'}
                </p>
              </div>

              <section
                aria-label="Vitrine e preço promocional"
                className="space-y-3 rounded-xl border border-koma-border bg-koma-panel p-3"
              >
                <div>
                  <strong className="block text-xs font-bold text-koma-foreground">Vitrine e preço promocional</strong>
                  <p className="mt-0.5 text-xs text-koma-muted">
                    Destaque este item no cardápio, adicione um selo ou defina um desconto direto (De / Por).
                  </p>
                </div>

                <div className="flex items-center justify-between gap-3 rounded-xl border border-koma-border bg-koma-card px-3 py-2.5">
                  <span className="min-w-0">
                    <strong className="block text-xs font-semibold text-koma-foreground">Destaque no cardápio</strong>
                    <span className="mt-0.5 block text-xs text-koma-muted">
                      Sinaliza o produto como destaque nas vitrines e filtros.
                    </span>
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={prodFormDestaque}
                    aria-label="Destaque no cardápio"
                    onClick={() => setProdFormDestaque((current) => !current)}
                    className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors"
                    style={
                      prodFormDestaque
                        ? { background: 'var(--koma-action-bg)', borderColor: 'var(--koma-action-bg)' }
                        : { background: 'var(--koma-surface-raised)', borderColor: 'var(--koma-border-default)' }
                    }
                  >
                    <span
                      className={`inline-block h-4 w-4 rounded-full transition-transform ${
                        prodFormDestaque ? 'translate-x-6' : 'translate-x-1'
                      }`}
                      style={{ background: 'var(--koma-surface-card)' }}
                    />
                  </button>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label
                      htmlFor="product-badge"
                      className="block text-xs font-semibold text-koma-secondary"
                    >
                      Selo de vitrine
                    </label>
                    <select
                      id="product-badge"
                      value={prodFormSelo}
                      onChange={(event) => setProdFormSelo(event.target.value as ProductBadge | '')}
                      className="min-h-11 w-full rounded-xl border border-koma-border bg-koma-input px-3 text-sm text-koma-foreground outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--koma-focus-ring)]"
                    >
                      {PRODUCT_BADGE_OPTIONS.map((option) => (
                        <option key={option.value || 'nenhum'} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {!hasVariants && (
                    <div className="space-y-1.5">
                      <label
                        htmlFor="product-promo-price"
                        className="block text-xs font-semibold text-koma-secondary"
                      >
                        Preço promocional (Por R$)
                      </label>
                      <MoneyInput
                        id="product-promo-price"
                        placeholder="Opcional"
                        value={prodFormPrecoPromocional}
                        onValueChange={setProdFormPrecoPromocional}
                        className="min-h-11 w-full rounded-xl border border-koma-border bg-koma-input px-3 text-sm text-koma-foreground tabular-nums outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--koma-focus-ring)]"
                      />
                    </div>
                  )}
                </div>

                {!hasVariants && prodFormPrecoPromocional !== '' && (() => {
                  const base = Number(prodFormPreco || 0);
                  const promo = Number(prodFormPrecoPromocional);
                  const resolution = getEffectiveProductPrice(base, promo);
                  if (!resolution.hasDiscount) {
                    return (
                      <p
                        role="alert"
                        className="rounded-lg border px-2.5 py-1.5 text-xs font-semibold"
                        style={{
                          background: 'var(--koma-danger-bg)',
                          borderColor: 'var(--koma-danger-border)',
                          color: 'var(--koma-danger-text)',
                        }}
                      >
                        O preço promocional precisa ser menor que o preço de venda.
                      </p>
                    );
                  }
                  return (
                    <p
                      className="rounded-lg border px-2.5 py-1.5 text-xs font-semibold tabular-nums"
                      style={{
                        background: 'var(--koma-success-bg)',
                        borderColor: 'var(--koma-success-border)',
                        color: 'var(--koma-success-text)',
                      }}
                    >
                      Desconto ativo: -{resolution.discountPercent}% (de{' '}
                      {base.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} por{' '}
                      {promo.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })})
                    </p>
                  );
                })()}
              </section>

              </div>
              <div hidden={isMarmitaria || productEditorTab !== 'variacoes'} className="space-y-5">
              {!isMarmitaria && (
                <section aria-label="Sabores e tamanhos do produto" className="space-y-3 rounded-xl border border-koma-border bg-koma-panel p-3">
                  <label className="flex min-h-11 items-center justify-between gap-3 text-xs font-bold text-koma-foreground">
                    <span>Este produto tem sabores ou tamanhos?</span>
                    <input type="checkbox" role="switch" aria-label="Este produto tem sabores ou tamanhos?"
                      checked={hasVariants} disabled={Boolean(editingFamilyId) || isLoading}
                      onChange={event => {
                        const enabled = event.target.checked;
                        setHasVariants(enabled);
                        setVariantRows(enabled
                          ? [{ ...(editingProduct?.id ? { produto_id: editingProduct.id } : {}),
                              rotulo: editingProduct ? editingProduct.nome : '',
                              preco: editingProduct ? Number(editingProduct.preco) : '', ativo: true }]
                          : []);
                        setExistingVariantId('');
                      }} />
                  </label>
                  {editingFamilyId && <p className="text-xs text-koma-muted">As opções estão vinculadas a este produto. Edite-as sem alterar os pedidos anteriores.</p>}
                  {loadingFamily && <p className="text-xs text-koma-muted">Carregando sabores e tamanhos…</p>}
                  {familyError && <p role="alert" className="text-xs" style={{ color: 'var(--koma-danger-text)' }}>{familyError}</p>}
                  {hasVariants && !loadingFamily && (
                    <>
                      <div className="flex gap-2" aria-label="Tipo de variação">
                        {(['sabor', 'tamanho'] as const).map(axis => (
                          <button key={axis} type="button" aria-pressed={variantAxis === axis}
                            onClick={() => setVariantAxis(axis)}
                            className={`min-h-11 flex-1 rounded-xl border px-3 text-xs font-bold transition-colors ${variantAxis === axis
                              ? 'border-transparent'
                              : 'border-koma-border bg-koma-card text-koma-secondary hover:text-koma-foreground'}`}
                            style={
                              variantAxis === axis
                                ? {
                                    background: 'var(--kc-chrome-selected, var(--koma-action-bg))',
                                    color: 'var(--kc-chrome-on-selected, var(--koma-action-text))',
                                  }
                                : undefined
                            }
                          >
                            {axis === 'sabor' ? 'Sabores' : 'Tamanhos'}
                          </button>
                        ))}
                      </div>
                      <div className="space-y-2">
                        {variantRows.map((row, index) => (
                          <div key={row.produto_id || `novo-${index}`} className="flex flex-col gap-2 rounded-xl border border-koma-border bg-koma-card p-2 sm:flex-row sm:items-center">
                            <label className="min-w-0 flex-1 text-xs font-bold text-koma-muted">
                              {variantAxis === 'sabor' ? 'Sabor' : 'Tamanho'} {index + 1}
                              <input required={productEditorTab === 'variacoes'} value={row.rotulo} aria-label={`Nome da opção ${index + 1}`}
                                onChange={event => setVariantRows(rows => rows.map((v, i) => i === index ? { ...v, rotulo: event.target.value } : v))}
                                placeholder={variantAxis === 'sabor' ? 'Carne de Sol' : 'Média · 300 g'}
                                className="mt-1 h-11 w-full rounded-lg border border-koma-border bg-koma-input px-3 text-sm font-normal text-koma-foreground" />
                            </label>
                            <label className="w-full text-xs font-bold text-koma-muted sm:w-32">
                              Preço
                              <MoneyInput id={`variant-price-${index}`} value={row.preco} required={productEditorTab === 'variacoes'}
                                onValueChange={value => setVariantRows(rows => rows.map((v, i) => i === index ? { ...v, preco: value } : v))}
                                className="mt-1 h-11 w-full rounded-lg border border-koma-border bg-koma-input px-3 text-sm text-koma-foreground tabular-nums" />
                            </label>
                            <label className="flex items-center gap-2 text-xs text-koma-muted sm:pt-4">
                              <input type="checkbox" checked={row.ativo}
                                onChange={event => setVariantRows(rows => rows.map((v, i) => i === index ? { ...v, ativo: event.target.checked } : v))} />
                              À venda
                            </label>
                            {!row.produto_id && variantRows.length > 1 && (
                              <button type="button" aria-label={`Remover opção ${index + 1}`}
                                onClick={() => setVariantRows(rows => rows.filter((_, i) => i !== index))}
                                className="grid h-11 w-11 place-items-center self-end rounded-lg hover:bg-koma-raised sm:self-auto"
                                style={{ color: 'var(--koma-danger-text)' }}>
                                <Trash2 size={15} />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                      <button type="button" className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-koma-border bg-koma-card text-xs font-bold text-koma-secondary hover:text-koma-foreground"
                        onClick={() => setVariantRows(rows => [...rows, { rotulo: '', preco: '', ativo: true }])}>
                        <Plus size={15} /> Adicionar {variantAxis === 'sabor' ? 'sabor' : 'tamanho'}
                      </button>
                      {apiProdutos.some(product => !product.familia_id && !product.marmitaria_tamanho
                        && !product.somente_promocao && product.categoria_id === prodFormCategoriaId
                        && (product.cardapio_id || null) === (prodFormCardapioId || null)
                        && !variantRows.some(row => row.produto_id === product.id)
                        && product.id !== editingProduct?.id) && (
                        <details className="rounded-xl border border-koma-border px-3 py-2">
                          <summary className="cursor-pointer text-xs font-bold text-koma-secondary">Vincular produto já cadastrado</summary>
                          <p className="mt-2 text-xs text-koma-muted">Mantém o cadastro, estoque e histórico do produto existente.</p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <select aria-label="Selecionar produto existente" value={existingVariantId}
                              onChange={event => setExistingVariantId(event.target.value)}
                              className="min-h-11 min-w-0 flex-1 rounded-xl border border-koma-border bg-koma-input px-2 text-sm text-koma-foreground">
                              <option value="">Escolha um produto…</option>
                              {apiProdutos.filter(product => !product.familia_id && !product.marmitaria_tamanho
                                && !product.somente_promocao && product.categoria_id === prodFormCategoriaId
                                && (product.cardapio_id || null) === (prodFormCardapioId || null)
                                && !variantRows.some(row => row.produto_id === product.id)
                                && product.id !== editingProduct?.id).map(product => (
                                <option key={product.id} value={product.id}>{product.nome} · R$ {Number(product.preco).toFixed(2).replace('.', ',')}</option>
                              ))}
                            </select>
                            <button type="button" disabled={!existingVariantId}
                              onClick={() => {
                                const product = apiProdutos.find(item => item.id === existingVariantId);
                                if (!product) return;
                                const linked = {
                                  produto_id: product.id, rotulo: product.nome,
                                  preco: Number(product.preco), ativo: product.ativo !== false,
                                };
                                // An empty starter row is a prompt, not a
                                // mandatory extra SKU when reusing existing items.
                                setVariantRows(rows => rows.length === 1
                                  && !rows[0].produto_id && !rows[0].rotulo.trim() && rows[0].preco === ''
                                  ? [linked] : [...rows, linked]);
                                setExistingVariantId('');
                              }}
                              className="min-h-11 rounded-xl px-3 text-xs font-bold disabled:opacity-50"
                              style={{
                                background: 'var(--koma-action-bg)',
                                color: 'var(--koma-action-text)',
                              }}>
                              Vincular
                            </button>
                          </div>
                        </details>
                      )}
                      <p className="text-xs text-koma-muted">Cada opção possui preço próprio. O cliente verá somente um produto com suas escolhas.</p>
                    </>
                  )}
                </section>
              )}

              </div>
              <div hidden={!isMarmitaria && productEditorTab !== 'mais'} className="space-y-5">
              {cardapios && cardapios.length > 0 && (
                <div className="space-y-1.5">
                  <label
                    htmlFor="product-cardapio"
                    className="text-xs font-bold text-koma-secondary block"
                  >
                    Cardápio Operacional
                  </label>
                  <select
                    id="product-cardapio"
                    value={prodFormCardapioId}
                    disabled={Boolean(editingFamilyId)}
                    onChange={(e) => setProdFormCardapioId(e.target.value)}
                    className="min-h-11 w-full px-3 py-2 bg-koma-input border border-koma-border rounded-xl text-sm text-koma-foreground focus:outline-none focus:border-koma-border-strong"
                  >
                    <option value="">Sem cardápio específico</option>
                    {cardapios.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nome} {activeMenuIds.includes(c.id) ? '(Ativo no momento)' : ''}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-koma-muted">
                    Cada produto pertence exclusivamente a um cardápio operacional.
                  </p>
                </div>
              )}


              {!hasVariants && !(isMarmitaria && editingProduct && isMarmita(editingProduct)) && (
                <label className="flex items-start gap-3 rounded-xl border border-koma-border bg-koma-card p-3 text-xs text-koma-foreground">
                  <input type="checkbox" checked={prodFormSomentePromocao}
                    onChange={event => setProdFormSomentePromocao(event.target.checked)}
                    aria-label="Vender somente em promoções" />
                  <span><strong className="block">Vender somente em promoções</strong>
                    <span className="mt-1 block text-koma-muted">Para itens disponíveis apenas em conjuntos. Não aparecerá como produto avulso no cardápio online.</span>
                  </span>
                </label>
              )}

              {!hasVariants && !editingProduct && (
                <details className="group overflow-hidden rounded-xl border border-koma-border bg-koma-panel">
                  <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-3 text-xs font-bold text-koma-secondary">
                    <span>Mais opções</span>
                    <span className="text-xs font-medium text-koma-muted group-open:hidden">Código e ajustes avançados</span>
                    <span className="hidden text-xs font-medium text-koma-muted group-open:inline">Ocultar</span>
                  </summary>
                  <div className="space-y-1.5 border-t border-koma-border p-3">
                    <label
                      htmlFor="product-code"
                      className="text-xs font-bold text-koma-secondary block"
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
                      className="min-h-11 w-full px-3 py-2 bg-koma-input border border-koma-border rounded-xl text-sm text-koma-foreground focus:outline-none focus:border-koma-border-strong"
                    />
                    <p className="text-xs leading-relaxed text-koma-muted">
                      O KÔMA já sugere um código. Altere apenas se sua operação usa código curto, etiqueta ou leitura no PDV.
                    </p>
                  </div>
                </details>
              )}

              </div>
              <div hidden={!isMarmitaria && productEditorTab !== 'produto'} className="space-y-5">
              <section className="rounded-xl border border-koma-border bg-koma-panel p-3">
                <div className="mb-3">
                  <strong className="block text-xs text-koma-foreground">Foto do produto <span className="font-normal text-koma-muted">(opcional)</span></strong>
                  <p className="mt-1 text-xs leading-relaxed text-koma-muted">
                    Use uma única foto. Clique em adicionar ou trocar para escolher um arquivo do seu dispositivo.
                  </p>
                </div>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <button
                    type="button"
                    onClick={() => productImageInputRef.current?.click()}
                    disabled={isLoading}
                    className="grid h-24 w-full shrink-0 place-items-center overflow-hidden rounded-xl border border-dashed border-koma-border bg-koma-raised transition hover:border-koma-border-strong sm:h-32 sm:w-44"
                    aria-label={productImagePreview ? 'Trocar foto do produto' : 'Adicionar foto do produto'}
                  >
                    {productImagePreview ? (
                      <img src={productImagePreview} alt="Prévia do produto" className="h-full w-full object-cover" />
                    ) : (
                      <span className="flex flex-col items-center gap-2 text-koma-muted">
                        <ImageIcon size={24} />
                        <span className="text-xs font-bold">Adicionar foto</span>
                      </span>
                    )}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-koma-muted">PNG, JPG ou WEBP · até 20 MB · otimização automática</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => productImageInputRef.current?.click()}
                        disabled={isLoading}
                        className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-koma-border bg-koma-card px-3 py-2 text-xs font-bold text-koma-secondary transition hover:bg-koma-raised disabled:opacity-50"
                      >
                        {productImagePreview ? <RefreshCw size={14} /> : <Upload size={14} />}
                        {productImagePreview ? 'Trocar foto' : 'Adicionar foto'}
                      </button>
                      {productImagePreview && (
                        <button
                          type="button"
                          onClick={removeProductImageLocally}
                          disabled={isLoading}
                          className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold transition disabled:opacity-50"
                          style={{
                            background: 'var(--koma-danger-bg)',
                            borderColor: 'var(--koma-danger-border)',
                            color: 'var(--koma-danger-text)',
                          }}
                        >
                          <Trash2 size={14} /> Remover foto
                        </button>
                      )}
                    </div>
                    {prodFormImageFile && (
                      <p className="mt-2 truncate text-xs font-semibold" style={{ color: 'var(--koma-success-text)' }}>
                        {prodFormImageFile.name}
                      </p>
                    )}
                    {prodFormImageError && (
                      <p className="mt-2 text-xs font-semibold" style={{ color: 'var(--koma-danger-text)' }}>
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

              </div>
              <div hidden={isMarmitaria || productEditorTab !== 'adicionais'} className="space-y-5">
              {!isMarmitaria && (
                <section aria-label="Personalizações deste produto" className="space-y-3 rounded-xl border border-koma-border bg-koma-panel p-3">
                  <div className="space-y-1">
                    <h4 className="text-sm font-bold text-koma-foreground">{hasVariants ? 'Personalizações compartilhadas' : 'O cliente pode personalizar?'}</h4>
                    <p className="text-xs text-koma-muted">
                      {hasVariants ? 'As escolhas marcadas valem para todos os sabores ou tamanhos. Cada opção mantém seu preço próprio.' :
                        'Escolha o que aparece neste produto. Opções grátis não aumentam o preço; adicionais pagos somam ao total.'}
                    </p>
                  </div>
                  {loadingCustomizations && <p className="text-xs text-koma-muted">Carregando escolhas e adicionais…</p>}
                  {customizationError && <p role="alert" className="text-xs" style={{ color: 'var(--koma-danger-text)' }}>{customizationError} {hasVariants ? 'Reabra o produto antes de salvar.' : 'O produto simples pode ser salvo sem alterar seus vínculos.'}</p>}
                  {!loadingCustomizations && customizationsLoaded && customizationGroups.length === 0 && (
                    <p className="text-xs text-koma-muted">Ainda não há escolhas cadastradas. Crie grupos reutilizáveis na aba Complementos.</p>
                  )}
                  {customizationsLoaded && (
                    <div className="space-y-2">
                      {customizationGroups.map(group => {
                        const inherited = inheritedCustomizationIds.includes(group.id);
                        const selected = selectedCustomizationIds.includes(group.id);
                        const anyPaid = group.opcoes.some(option => option.ativo !== false && Number(option.preco_adicional) > 0);
                        return (
                          <label key={group.id} className="flex min-h-12 items-start gap-3 rounded-xl border border-koma-border bg-koma-card px-3 py-2.5 text-xs cursor-pointer">
                            <input
                              type="checkbox"
                              className="mt-0.5"
                              checked={selected || inherited}
                              disabled={isLoading || inherited}
                              onChange={event => setSelectedCustomizationIds(ids =>
                                event.target.checked ? [...ids, group.id] : ids.filter(id => id !== group.id)
                              )}
                              aria-label={`Associar ${group.nome} ao produto`}
                            />
                            <span className="min-w-0 space-y-1">
                              <strong className="block text-koma-foreground">{group.nome}</strong>
                              <span className="block text-koma-muted">
                                {anyPaid ? 'Contém adicionais pagos' : 'Escolhas incluídas no preço'}
                                {' · '}
                                {group.min_selecoes > 0 ? 'Obrigatória' : 'Opcional'}
                              </span>
                              <span className="block text-koma-secondary leading-relaxed">
                                {inherited ? 'Já vinculada pela categoria — altere em Complementos.' :
                                  group.opcoes.filter(option => option.ativo !== false).slice(0,4).map(option => option.nome).join(', ') || 'Sem opções disponíveis'}
                              </span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                  <p className="text-xs text-koma-muted">Para criar novas escolhas ou definir limites de múltiplas seleções, use Cardápio → Complementos.</p>
                </section>
              )}

              </div>
              <div hidden={!isMarmitaria && productEditorTab !== 'produto'} className="space-y-5">
              {!hasVariants && <div className="flex items-center justify-between gap-3 rounded-xl border border-koma-border bg-koma-panel p-3">
                <span>
                  <strong className="block text-xs text-koma-foreground">Produto à venda</strong>
                  <span className="mt-0.5 block text-xs text-koma-muted">
                    {prodFormAtivo
                      ? 'O produto aparece normalmente nos canais de venda.'
                      : 'Pausado: continua cadastrado e pode ser reativado a qualquer momento.'}
                  </span>
                </span>
                <div className="flex shrink-0 items-center gap-2">
                  <span
                    className="text-xs font-bold"
                    style={{ color: prodFormAtivo ? 'var(--koma-success-text)' : 'var(--koma-danger-text)' }}
                  >
                    {prodFormAtivo ? 'À venda' : 'Pausado'}
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={prodFormAtivo}
                    aria-label="Produto à venda"
                    onClick={() => setProdFormAtivo((current) => !current)}
                    className="relative inline-flex h-6 w-11 items-center rounded-full border transition-colors"
                    style={
                      prodFormAtivo
                        ? { background: 'var(--koma-action-bg)', borderColor: 'var(--koma-action-bg)' }
                        : { background: 'var(--koma-surface-raised)', borderColor: 'var(--koma-border-default)' }
                    }
                  >
                    <span
                      className={`inline-block h-4 w-4 rounded-full shadow-sm transition-transform ${prodFormAtivo ? 'translate-x-6' : 'translate-x-1'}`}
                      style={{ background: 'var(--koma-surface-card)' }}
                    />
                  </button>
                </div>
              </div>}

              </div>

              <div className="fixed inset-x-0 bottom-0 z-20 flex gap-2 border-t border-koma-border bg-koma-card p-3 pb-[calc(.75rem+env(safe-area-inset-bottom))] sm:sticky sm:-mx-1 sm:bottom-0 sm:rounded-xl sm:border sm:p-2">
                <button
                  type="button"
                  onClick={() => setShowProductModal(false)}
                  className="flex-1 min-h-11 py-2 bg-koma-card hover:bg-koma-raised border border-koma-border text-koma-foreground rounded-xl font-bold cursor-pointer transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isLoading || apiCategorias.length === 0 || (hasVariants && (loadingFamily || loadingCustomizations || !customizationsLoaded || Boolean(familyError) || Boolean(customizationError)))}
                  className="flex-1 min-h-11 py-2 rounded-xl font-bold cursor-pointer transition-colors disabled:opacity-50"
                  style={{
                    background: 'var(--koma-action-bg)',
                    color: 'var(--koma-action-text)',
                  }}
                >
                  {isLoading ? 'Salvando…' : editingProduct || editingFamilyId ? 'Salvar alterações' : 'Criar produto'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      <CategoriaModal
        isOpen={showCategoryModal}
        suggestedName={isMarmitaria ? 'Sobremesas' : undefined}
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
