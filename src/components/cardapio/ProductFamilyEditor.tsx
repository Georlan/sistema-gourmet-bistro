import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import type { Product, CardapioMenu } from '../../types';
import type { CatalogCategory } from '../../catalog/catalog';
import { snapshotFetch as fetch } from '../../utils/snapshotFetch';

type Axis = 'tamanho' | 'sabor' | 'outra';
type Variant = {
  key: string;
  produto_id: string | null;
  rotulo: string;
  preco: string;
  ativo: boolean;
};
type CustomizationGroup = { id: string; nome: string; tipo: string; opcoes: Array<{ nome: string; preco_adicional: number; ativo: boolean }> };
type Family = {
  id: string;
  nome: string;
  descricao: string;
  eixo: Axis;
  categoria_id: string;
  cardapio_id: string | null;
  imagem: string;
  variantes: Array<{ produto_id: string; rotulo: string; preco: number; ativo: boolean }>;
  grupo_ids?: string[];
};
interface Props {
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
  products: Product[];
  categories: CatalogCategory[];
  menus?: CardapioMenu[];
  selectedMenuId?: string | null;
  familyId?: string | null;
  onSaved: () => Promise<void>;
  onClose: () => void;
}

function emptyVariant(): Variant {
  return { key: crypto.randomUUID(), produto_id: null, rotulo: '', preco: '', ativo: true };
}
function moneyInputToNumber(value: string): number {
  return Number(value.replace(',', '.'));
}
function toMoneyInput(value: number): string {
  return Number(value).toFixed(2).replace('.', ',');
}

export default function ProductFamilyEditor({
  apiBaseUrl, authHeaders, products, categories, menus, selectedMenuId, familyId, onSaved, onClose,
}: Props) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [axis, setAxis] = useState<Axis>('tamanho');
  const [categoryId, setCategoryId] = useState(categories[0]?.id || '');
  const [menuId, setMenuId] = useState(selectedMenuId || '');
  const [image, setImage] = useState('');
  const [variants, setVariants] = useState<Variant[]>([emptyVariant(), emptyVariant()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [groups, setGroups] = useState<CustomizationGroup[]>([]);
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [groupsLoaded, setGroupsLoaded] = useState(false);
  const authorization = authHeaders.Authorization || authHeaders.authorization || '';

  useEffect(() => {
    let canceled = false;
    setBusy(true);
    setGroupsLoaded(false);
    fetch(`${apiBaseUrl}/cardapio/modificadores/grupos`, { headers: { Authorization: authorization } })
      .then(async response => {
        if (!response.ok) throw new Error('Não foi possível carregar complementos e adicionais.');
        const data = await response.json() as CustomizationGroup[];
        if (!canceled) { setGroups(data); setGroupsLoaded(true); }
      })
      .catch(failure => { if (!canceled) setError(failure instanceof Error ? failure.message : 'Erro ao carregar grupos.'); });
    if (!familyId) { setBusy(false); return () => { canceled = true; }; }
    fetch(`${apiBaseUrl}/produto-familias`, { headers: { Authorization: authorization } })
      .then(async (response) => {
        if (!response.ok) throw new Error('Não foi possível carregar os tamanhos e sabores.');
        const families = await response.json() as Family[];
        const selected = families.find(family => family.id === familyId);
        if (!selected) throw new Error('Este produto com variações não foi encontrado.');
        if (canceled) return;
        setName(selected.nome);
        setDescription(selected.descricao || '');
        setAxis(selected.eixo);
        setCategoryId(selected.categoria_id);
        setMenuId(selected.cardapio_id || '');
        setImage(selected.imagem || '');
        setGroupIds(selected.grupo_ids || []);
        setVariants(selected.variantes.map(v => ({
          key: v.produto_id,
          produto_id: v.produto_id,
          rotulo: v.rotulo,
          preco: toMoneyInput(v.preco),
          ativo: v.ativo,
        })));
      })
      .catch((failure: unknown) => { if (!canceled) setError(failure instanceof Error ? failure.message : 'Erro de conexão.'); })
      .finally(() => { if (!canceled) setBusy(false); });
    return () => { canceled = true; };
  }, [familyId, apiBaseUrl, authorization]);

  const usableProducts = useMemo(
    () => products.filter(product =>
      !product.familia_id
      && !product.marmitaria_tamanho
      && !product.somente_promocao
      && product.categoria_id === categoryId
      && (product.cardapio_id || '') === menuId
    ),
    [products, categoryId, menuId],
  );
  const updateVariant = (key: string, patch: Partial<Variant>) =>
    setVariants(current => current.map(variant => variant.key === key ? { ...variant, ...patch } : variant));

  const handleSave = async () => {
    if (busy || !groupsLoaded) return;
    setError('');
    const checked = variants.map(variant => ({ ...variant, rotulo: variant.rotulo.trim(), preco: moneyInputToNumber(variant.preco) }));
    if (!name.trim() || !categoryId || checked.length < 1 || checked.some(variant =>
      !variant.rotulo || !variant.preco && variant.preco !== 0 || !Number.isFinite(variant.preco) || variant.preco < 0
    )) {
      setError('Preencha o produto, a categoria, o nome e o preço de cada variação.');
      return;
    }
    if (new Set(checked.map(variant => variant.rotulo.toLocaleLowerCase('pt-BR'))).size !== checked.length) {
      setError('Use nomes diferentes para as variações.');
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(
        familyId ? `${apiBaseUrl}/produto-familias/${encodeURIComponent(familyId)}` : `${apiBaseUrl}/produto-familias`,
        {
          method: familyId ? 'PUT' : 'POST',
          headers: { ...authHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            nome: name.trim(), descricao: description.trim(), eixo: axis,
            categoria_id: categoryId, cardapio_id: menuId || null,
            imagem: image, grupo_ids: groupIds,
            variantes: checked.map(variant => ({
              produto_id: variant.produto_id, rotulo: variant.rotulo,
              preco: variant.preco, ativo: variant.ativo,
            })),
          }),
        },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof body.detail === 'string' ? body.detail : 'Não foi possível salvar.');
      await onSaved();
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Falha ao salvar as variações.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex justify-center bg-black/85 backdrop-blur-sm sm:items-center sm:p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="family-editor-title"
        className="flex h-[100dvh] w-full max-w-2xl flex-col overflow-hidden bg-koma-card text-koma-foreground shadow-2xl sm:h-auto sm:max-h-[calc(100dvh-2rem)] sm:rounded-2xl sm:border sm:border-koma-border">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-koma-border p-4">
          <div>
            <h2 id="family-editor-title" className="text-base font-black">{familyId ? 'Editar produto e variações' : 'Novo produto com variações'}</h2>
            <p className="mt-1 text-xs text-koma-muted">Cadastre uma vez. Cada tamanho ou sabor terá o próprio preço.</p>
          </div>
          <button type="button" aria-label="Fechar editor" onClick={onClose} className="grid h-11 w-11 place-items-center rounded-xl border border-koma-border"><X size={18}/></button>
        </header>
        <div className="flex-1 space-y-5 overflow-y-auto p-4 pb-12 text-sm">
          <div className="space-y-2">
            <label className="block font-bold" htmlFor="family-name">Nome que o cliente verá</label>
            <input id="family-name" value={name} onChange={event=>setName(event.target.value)} placeholder="Ex.: Batata Frita Tradicional"
              className="h-11 w-full rounded-xl border border-koma-border bg-koma-panel px-3 text-base"/>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="space-y-2 font-semibold">Categoria
              <select value={categoryId} onChange={event=>setCategoryId(event.target.value)} disabled={Boolean(familyId)}
                className="h-11 w-full rounded-xl border border-koma-border bg-koma-panel px-3 text-sm">
                {categories.map(category=><option key={category.id} value={category.id}>{category.nome}</option>)}
              </select>
            </label>
            <label className="space-y-2 font-semibold">O que varia?
              <select value={axis} onChange={event=>setAxis(event.target.value as Axis)}
                className="h-11 w-full rounded-xl border border-koma-border bg-koma-panel px-3 text-sm">
                <option value="tamanho">Tamanho</option>
                <option value="sabor">Sabor</option>
                <option value="outra">Outra opção</option>
              </select>
            </label>
            {menus && menus.length > 0 && (
              <label className="space-y-2 font-semibold">Cardápio operacional
                <select value={menuId} onChange={event=>setMenuId(event.target.value)} disabled={Boolean(familyId)}
                  className="h-11 w-full rounded-xl border border-koma-border bg-koma-panel px-3 text-sm">
                  <option value="">Sem cardápio específico</option>
                  {menus.map(menu=><option key={menu.id} value={menu.id}>{menu.nome}</option>)}
                </select>
              </label>
            )}
          </div>
          <label className="block space-y-2 font-semibold">Descrição curta para o cliente
            <textarea value={description} onChange={event=>setDescription(event.target.value)} rows={2}
              className="w-full rounded-xl border border-koma-border bg-koma-panel p-3 text-sm"/>
          </label>
          <section className="space-y-3 rounded-xl border border-koma-border bg-koma-panel p-3">
            <div>
              <h3 className="font-black">Tamanhos, sabores ou versões</h3>
              <p className="mt-1 text-xs text-koma-muted">Cada opção pode ter seu preço e disponibilidade. O cliente vê um único produto.</p>
            </div>
            {variants.map((variant, index) => (
              <div key={variant.key} className="space-y-2 rounded-lg border border-koma-border bg-koma-card p-3">
                <div className="flex items-center justify-between">
                  <strong className="text-xs">Opção {index+1}</strong>
                  {variant.produto_id ? (
                    <span className="text-[10px] text-koma-muted">Código preservado</span>
                  ) : (
                    <button type="button" disabled={variants.length <= 1} onClick={()=>setVariants(current=>current.filter(row=>row.key!==variant.key))}
                      className="inline-flex min-h-9 items-center gap-1 text-xs text-rose-500 disabled:opacity-40" aria-label={`Remover opção ${index+1}`}><Trash2 size={13}/> Remover</button>
                  )}
                </div>
                {!variant.produto_id && usableProducts.length > 0 && (
                  <label className="block space-y-1 text-xs text-koma-muted">Aproveitar item já cadastrado (opcional)
                    <select value="" onChange={event=>{
                      const selected = usableProducts.find(product=>product.id===event.target.value);
                      if(selected) updateVariant(variant.key,{produto_id:selected.id,rotulo:variant.rotulo||selected.nome,preco:toMoneyInput(selected.preco),ativo:selected.ativo!==false});
                    }} className="h-10 w-full rounded-xl border border-koma-border bg-koma-card px-2 text-sm">
                      <option value="">Criar nova opção</option>
                      {usableProducts.filter(product=>!variants.some(item=>item.produto_id===product.id)).map(product=><option key={product.id} value={product.id}>{product.nome} — R$ {toMoneyInput(product.preco)}</option>)}
                    </select>
                  </label>
                )}
                <div className="grid grid-cols-[minmax(0,1fr)_108px] gap-2">
                  <label className="space-y-1 text-xs font-semibold">{axis==='tamanho'?'Tamanho':axis==='sabor'?'Sabor':'Nome da opção'}
                    <input value={variant.rotulo} onChange={event=>updateVariant(variant.key,{rotulo:event.target.value})}
                      placeholder={axis==='tamanho'?'Ex.: Média (300 g)':axis==='sabor'?'Ex.: Frango':'Ex.: Com molho'}
                      className="h-11 w-full rounded-lg border border-koma-border bg-koma-raised px-2 text-sm"/>
                  </label>
                  <label className="space-y-1 text-xs font-semibold">Preço (R$)
                    <input inputMode="decimal" value={variant.preco} onChange={event=>updateVariant(variant.key,{preco:event.target.value})}
                      placeholder="0,00" className="h-11 w-full rounded-lg border border-koma-border bg-koma-raised px-2 text-sm"/>
                  </label>
                </div>
                <label className="inline-flex min-h-9 items-center gap-2 text-xs">
                  <input type="checkbox" checked={variant.ativo} onChange={event=>updateVariant(variant.key,{ativo:event.target.checked})}/>
                  Disponível para venda
                </label>
              </div>
            ))}
            <button type="button" onClick={()=>setVariants(current=>[...current,emptyVariant()])}
              className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-emerald-500/50 font-bold text-emerald-500">
              <Plus size={16}/> Adicionar {axis==='tamanho'?'tamanho':axis==='sabor'?'sabor':'opção'}
            </button>
          </section>
          <section className="space-y-3 rounded-xl border border-koma-border bg-koma-panel p-3">
            <h3 className="font-black">Personalizações deste produto</h3>
            <p className="text-xs text-koma-muted">Associe as escolhas incluídas no preço ou os adicionais cobrados. Elas aparecerão em todos os tamanhos ou sabores deste produto.</p>
            {groups.length === 0 && <p className="text-xs text-koma-muted">Sem grupos cadastrados. Crie primeiro uma escolha ou adicional na aba Complementos.</p>}
            {groups.map(group => {
              const activeOptions = group.opcoes.filter(option => option.ativo);
              const hasCharge = activeOptions.some(option => Number(option.preco_adicional) > 0);
              const amount = activeOptions.length;
              return (
                <label key={group.id} className="flex min-h-11 items-center gap-3 rounded-lg border border-koma-border bg-koma-card p-3">
                  <input type="checkbox" checked={groupIds.includes(group.id)} onChange={event => setGroupIds(previous => event.target.checked ? [...previous, group.id] : previous.filter(id => id !== group.id))}/>
                  <span className="min-w-0 flex-1">
                    <strong className="block text-sm">{group.nome}</strong>
                    <span className="text-xs text-koma-muted">{hasCharge ? 'Contém adicionais pagos' : 'Escolhas incluídas no preço'} · {amount} {amount === 1 ? 'opção' : 'opções'}</span>
                  </span>
                </label>
              );
            })}
          </section>
          {error && <p role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs font-semibold text-rose-400">{error}</p>}
        </div>
        <footer className="flex shrink-0 gap-2 border-t border-koma-border bg-koma-card p-3 pb-[calc(.75rem+env(safe-area-inset-bottom))]">
          <button type="button" disabled={busy} onClick={onClose} className="min-h-11 flex-1 rounded-xl border border-koma-border font-bold">Cancelar</button>
          <button type="button" disabled={busy || !groupsLoaded} onClick={()=>void handleSave()} className="min-h-11 flex-1 rounded-xl bg-emerald-500 font-black text-emerald-950 disabled:opacity-60">
            {busy?'Salvando...':'Salvar produto'}
          </button>
        </footer>
      </div>
    </div>
  );
}
