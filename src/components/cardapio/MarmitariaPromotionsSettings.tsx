import { useEffect, useState } from 'react';
import { Gift, LoaderCircle, Plus, Save, ToggleLeft, ToggleRight } from 'lucide-react';

type CatalogProduct = { id: string; nome: string; preco: number; ativo: boolean; tamanho?: string | null; somente_promocao?: boolean };
type Promotion = {
  id: string;
  nome: string;
  descricao: string;
  preco: number;
  componentes: string[][];
  ativo: boolean;
};

const empty = () => ({ nome: '', descricao: '', preco: '', primeiro: '', segundo: '', ativo: false });
const money = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

export default function MarmitariaPromotionsSettings({
  apiBaseUrl, authHeaders,
}: { apiBaseUrl: string; authHeaders: Record<string, string> }) {
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [categories, setCategories] = useState<Array<{ id: string; nome: string }>>([]);
  const [drinkName, setDrinkName] = useState('Pitulinha');
  const [drinkPrice, setDrinkPrice] = useState('');
  const [creatingDrink, setCreatingDrink] = useState(false);
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [available, setAvailable] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');

  const api = `${apiBaseUrl}/api/cardapio-digital/promocoes`;
  const load = async () => {
    setLoading(true);
    try {
      const response = await fetch(api, { headers: authHeaders, cache: 'no-store' });
      if (response.status === 403) { setAvailable(false); return; }
      if (!response.ok) throw new Error('Não foi possível carregar as promoções.');
      const data = await response.json();
      setAvailable(true);
      setProducts(Array.isArray(data.produtos) ? data.produtos : []);
      setCategories(Array.isArray(data.categorias) ? data.categorias : []);
      setPromotions(Array.isArray(data.promocoes) ? data.promocoes : []);
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Erro ao carregar as promoções.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [api, authHeaders.Authorization, authHeaders.authorization]);

  const template = (kind: 'duas' | 'bebida') => {
    const g = products.find((p) => p.tamanho?.toLowerCase() === 'g' && p.ativo);
    const m = products.find((p) => p.tamanho?.toLowerCase() === 'm' && p.ativo);
    const drink = products.find((p) => /pitulinha|pithulinha|pituchulinha|pitchulinha/i.test(p.nome) && p.ativo);
    setEditing(null);
    setForm({
      nome: kind === 'duas' ? 'Quentinha G + Quentinha M' : 'Quentinha G + Pitulinha',
      descricao: kind === 'duas' ? 'Monte uma quentinha G e outra M.' : 'Monte sua quentinha G e escolha a bebida.',
      preco: kind === 'duas' ? '22.00' : '16.00',
      primeiro: g?.id ?? '',
      segundo: (kind === 'duas' ? m : drink)?.id ?? '',
      ativo: false,
    });
    setNotice(!g || !(kind === 'duas' ? m : drink)
      ? 'Confira os componentes: o produto precisa existir e estar ativo antes de publicar.'
      : 'Modelo preparado. Confira e salve para cadastrar a promoção.');
  };
  const createExclusiveDrink = async () => {
    const name = drinkName.trim();
    const price = Number(drinkPrice);
    if (name.length < 2 || !drinkPrice.trim() || !Number.isFinite(price) || price <= 0) {
      setNotice('Informe o nome da bebida e seu preço de referência. O preço do combo é configurado separadamente.');
      return;
    }
    if (products.some(p => p.nome.trim().toLocaleLowerCase('pt-BR') === name.toLocaleLowerCase('pt-BR'))) {
      setNotice('Esta bebida já existe. Selecione o produto no combo ou marque-o como exclusivo em Cardápio → Produtos.');
      return;
    }
    setCreatingDrink(true);
    try {
      let beveragesCategory = categories.find(category => /^(bebidas?|refrigerantes?)$/i.test(category.nome.trim()));
      if (!beveragesCategory) {
        const response = await fetch(`${apiBaseUrl}/produtos/categorias`, {
          method: 'POST', headers: { ...authHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: `cat-bebidas-${crypto.randomUUID().slice(0, 8)}`,
            nome: 'Bebidas',
            destino_impressao: 'BAR',
          }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Não foi possível criar a categoria Bebidas.');
        beveragesCategory = { id: data.id, nome: data.nome };
      }
      const response = await fetch(`${apiBaseUrl}/produtos/`, {
        method: 'POST', headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: `bebida-combo-${crypto.randomUUID().slice(0, 12)}`,
          nome: name, categoria_id: beveragesCategory.id,
          preco: price, descricao: 'Bebida disponível somente na promoção.',
          ativo: true, somente_promocao: true,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Não foi possível cadastrar a bebida.');
      await load();
      setForm(current => ({ ...current, segundo: String(data.id) }));
      setNotice(`${name} cadastrada apenas para combos. Revise os itens e o preço antes de publicar a oferta.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Falha ao cadastrar bebida.');
    } finally { setCreatingDrink(false); }
  };

  const edit = (p: Promotion) => {
    setEditing(p.id);
    setForm({
      nome: p.nome, descricao: p.descricao || '', preco: String(p.preco),
      primeiro: p.componentes?.[0]?.[0] || '',
      segundo: p.componentes?.[1]?.[0] || '',
      ativo: p.ativo,
    });
  };
  const submit = async () => {
    if (!form.primeiro || !form.segundo || form.primeiro === form.segundo) {
      setNotice('Selecione dois produtos diferentes para a promoção.'); return;
    }
    if (form.nome.trim().length < 4 || !Number.isFinite(Number(form.preco)) || Number(form.preco) < 0) {
      setNotice('Preencha o nome e o preço correto da promoção.'); return;
    }
    setSaving(true);
    try {
      const response = await fetch(editing ? `${api}/${encodeURIComponent(editing)}` : api, {
        method: editing ? 'PUT' : 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome: form.nome, descricao: form.descricao, preco: Number(form.preco),
          componentes: [[form.primeiro], [form.segundo]], ativo: form.ativo,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Não foi possível salvar a promoção.');
      setEditing(null);
      setForm(empty());
      setNotice('Promoção salva. Se estiver ativa, aparecerá automaticamente no cardápio online.');
      await load();
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Erro ao salvar.'); }
    finally { setSaving(false); }
  };
  const toggle = async (p: Promotion) => {
    setSaving(true);
    try {
      const response = await fetch(`${api}/${encodeURIComponent(p.id)}`, {
        method: 'PUT', headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome: p.nome, descricao: p.descricao || '', preco: p.preco,
          componentes: p.componentes, ativo: !p.ativo }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Não foi possível alterar.');
      setNotice(p.ativo ? 'Promoção pausada no cardápio.' : 'Promoção publicada no cardápio.');
      await load();
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Erro ao alterar.'); }
    finally { setSaving(false); }
  };

  if (loading && !available) return <div className="p-3 text-xs text-koma-muted">Carregando promoções...</div>;
  if (!available) return null;
  return (
    <section className="space-y-4 rounded-2xl border border-koma-border bg-koma-panel p-4 sm:p-5" aria-label="Promoções da marmitaria">
      <div className="flex items-center gap-3">
        <Gift className="h-5 w-5 text-emerald-500" aria-hidden="true" />
        <div>
          <h2 className="text-sm font-black text-koma-foreground">Promoções</h2>
          <p className="text-xs text-koma-muted">Monte ofertas com produtos que já existem. Ativar publica automaticamente no cardápio online.</p>
        </div>
      </div>
      {promotions.map((p) => (
        <div key={p.id} className="flex items-center justify-between gap-2 rounded-xl border border-koma-border bg-koma-card p-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-koma-foreground">{p.nome}</p>
            <p className="text-xs text-koma-muted">{money(p.preco)} · {p.ativo ? 'Ativa' : 'Pausada'}</p>
          </div>
          <div className="flex gap-2">
            <button type="button" disabled={saving} onClick={() => edit(p)} className="min-h-11 rounded-xl border border-koma-border px-3 text-xs font-bold">Editar</button>
            <button type="button" disabled={saving} onClick={() => void toggle(p)} aria-label={p.ativo ? `Pausar ${p.nome}` : `Ativar ${p.nome}`} className="grid min-h-11 min-w-11 place-items-center rounded-xl border border-koma-border">
              {p.ativo ? <ToggleRight className="text-emerald-500" /> : <ToggleLeft />}
            </button>
          </div>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => template('duas')} className="min-h-11 rounded-xl border border-emerald-500/30 px-3 text-xs font-bold">G + M · R$ 22</button>
        <button type="button" onClick={() => template('bebida')} className="min-h-11 rounded-xl border border-emerald-500/30 px-3 text-xs font-bold">G + Pitulinha · R$ 16</button>
        <button type="button" onClick={() => { setEditing(null); setForm(empty()); }} className="min-h-11 rounded-xl border border-koma-border px-3 text-xs font-bold"><Plus className="mr-1 inline h-3 w-3" /> Nova oferta</button>
      </div>
      <section className="space-y-3 rounded-xl border border-koma-border bg-koma-card p-3" aria-label="Cadastrar bebida exclusiva de promoção">
        <strong className="text-sm text-koma-foreground">Bebida exclusiva do combo</strong>
        <p className="text-xs text-koma-muted">Cadastre a Pitulinha uma única vez. Ela não aparece como bebida avulsa, mas entra no estoque e na comanda quando vendida na promoção.</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-xs text-koma-muted">Nome da bebida
            <input value={drinkName} onChange={event => setDrinkName(event.target.value)} maxLength={90}
              className="mt-1 min-h-11 w-full rounded-xl border border-koma-border bg-koma-panel px-3 text-sm text-koma-foreground" />
          </label>
          <label className="text-xs text-koma-muted">Preço de referência (R$)
            <input type="number" min="0.01" step="0.01" value={drinkPrice}
              onChange={event => setDrinkPrice(event.target.value)}
              placeholder="Informe o valor"
              className="mt-1 min-h-11 w-full rounded-xl border border-koma-border bg-koma-panel px-3 text-sm text-koma-foreground" />
          </label>
        </div>
        <button type="button" disabled={saving || creatingDrink} onClick={() => void createExclusiveDrink()}
          className="min-h-11 rounded-xl border border-emerald-500/30 px-4 text-xs font-bold text-emerald-400 disabled:opacity-40">
          {creatingDrink ? 'Cadastrando bebida…' : 'Criar bebida apenas para promoções'}
        </button>
      </section>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-bold text-koma-muted sm:col-span-2">Nome da promoção
          <input value={form.nome} onChange={(e) => setForm(f => ({ ...f, nome: e.target.value }))} maxLength={90} className="mt-1 min-h-11 w-full rounded-xl border border-koma-border bg-koma-card px-3 text-sm text-koma-foreground" placeholder="Ex.: Quentinha G + M" />
        </label>
        <label className="text-xs font-bold text-koma-muted sm:col-span-2">Descrição
          <input value={form.descricao} onChange={(e) => setForm(f => ({ ...f, descricao: e.target.value }))} maxLength={240} className="mt-1 min-h-11 w-full rounded-xl border border-koma-border bg-koma-card px-3 text-sm text-koma-foreground" placeholder="O que está incluso" />
        </label>
        {(['primeiro', 'segundo'] as const).map((key, index) => (
          <label key={key} className="text-xs font-bold text-koma-muted">Etapa {index + 1} · Produto
            <select value={form[key]} onChange={(e) => setForm(f => ({ ...f, [key]: e.target.value }))} className="mt-1 min-h-11 w-full rounded-xl border border-koma-border bg-koma-card px-3 text-sm text-koma-foreground">
              <option value="">Selecione</option>
              {products.filter(p => p.ativo).map(p => <option key={p.id} value={p.id}>{p.nome} · {money(p.preco)}</option>)}
            </select>
          </label>
        ))}
        <label className="text-xs font-bold text-koma-muted">Preço do conjunto
          <input type="number" min="0" step="0.01" value={form.preco} onChange={e => setForm(f => ({ ...f, preco: e.target.value }))} className="mt-1 min-h-11 w-full rounded-xl border border-koma-border bg-koma-card px-3 text-sm text-koma-foreground" />
        </label>
        <label className="flex min-h-11 items-center gap-2 self-end text-xs font-bold text-koma-foreground">
          <input type="checkbox" checked={form.ativo} onChange={e => setForm(f => ({ ...f, ativo: e.target.checked }))} /> Publicar agora
        </label>
      </div>
      {form.primeiro && form.segundo && (() => {
        const first = products.find(p => p.id === form.primeiro);
        const second = products.find(p => p.id === form.segundo);
        if (!first || !second) return null;
        const subtotal = Number(first.preco) + Number(second.preco);
        const savings = subtotal - Number(form.preco || subtotal);
        const symbolic = first.somente_promocao || second.somente_promocao;
        return <p className="text-xs font-bold text-koma-muted">Valor de referência dos dois itens: {money(subtotal)}.
          {form.preco && savings > 0 ? ` Economia configurada: ${money(savings)}.`
            : form.preco && savings < 0 && symbolic
              ? ' Um componente é exclusivo e pode ter preço simbólico; vale o preço configurado para o conjunto.'
              : form.preco ? ' Valor do conjunto conferido.' : ' Informe o preço final desejado para o combo.'}
        </p>;
      })()}
      <p className="text-xs leading-relaxed text-koma-muted">O preço da oferta é confirmado pelo servidor. Adicionais pagos e entrega são cobrados à parte. Ao criar, a oferta pode permanecer pausada até a data desejada.</p>
      {notice && <p role="status" className="text-xs font-bold text-amber-400">{notice}</p>}
      <button type="button" disabled={saving} onClick={() => void submit()} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-black text-white disabled:opacity-50">
        {saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        {editing ? 'Salvar alterações' : 'Cadastrar promoção'}
      </button>
    </section>
  );
}
