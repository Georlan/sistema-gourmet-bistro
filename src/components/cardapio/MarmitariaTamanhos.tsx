import { useEffect, useRef, useState } from 'react';
import MoneyInput from '../MoneyInput';
import type { GrupoModificador } from './ComplementosTab';

type Regra = { grupo_id: string; minimo: number; maximo: number; modo_selecao: 'porcoes' | 'tipos' };
type Tamanho = { id?: string; tamanho: 'P' | 'M' | 'G' | null; nome: string; preco: number; ativo: boolean; configurado?: boolean; regras: Regra[] };
const inputClass = 'w-full rounded-xl border border-koma-border bg-koma-card px-3 py-2 text-sm text-koma-foreground';
interface Props {
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
  grupos?: GrupoModificador[];
  mode?: 'products' | 'choices';
  onConfigureChoices?: (id: string) => void;
  onSaved?: () => Promise<void>;
  notify?: (message: string, type?: 'success' | 'error') => void;
  focusProductId?: string | null;
  onFocusHandled?: () => void;
  catalogVersion?: string;
  onEditDetails?: (id: string) => void;
}

export default function MarmitariaTamanhos({ apiBaseUrl, authHeaders, grupos = [], mode = 'products', onConfigureChoices, onSaved, notify, focusProductId, onFocusHandled, catalogVersion, onEditDetails }: Props) {
  const [enabled, setEnabled] = useState(false);
  const [sizes, setSizes] = useState<Tamanho[]>([]);
  const [editing, setEditing] = useState<Tamanho | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const panelRef = useRef<HTMLElement>(null);
  const authKey = JSON.stringify(authHeaders);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetch(`${apiBaseUrl}/cardapio/marmitaria/tamanhos`, { headers: JSON.parse(authKey), signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('Não foi possível carregar as marmitas. Atualize a página para tentar novamente.');
        const data = await response.json();
        if (controller.signal.aborted) return;
        setEnabled(data.enabled === true);
        setSizes(Array.isArray(data.tamanhos) ? data.tamanhos : []);
        setError('');
      }).catch(err => { if (!controller.signal.aborted) setError(err.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [apiBaseUrl, authKey, catalogVersion]);

  useEffect(() => {
    if (!focusProductId || loading) return;
    const size = sizes.find(item => item.id === focusProductId);
    if (size) {
      setError('');
      setEditing({ ...size, regras: size.regras.map(rule => ({ ...rule })) });
      panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else notify?.('Este produto não foi reconhecido como tamanho de marmita.', 'error');
    onFocusHandled?.();
  }, [focusProductId, loading, sizes, onFocusHandled, notify]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editing || saving) return;
    setSaving(true);
    setError('');
    try {
      const { id, tamanho, nome, preco, ativo, regras } = editing;
      const response = await fetch(`${apiBaseUrl}/cardapio/marmitaria/tamanhos${id ? `/${encodeURIComponent(id)}` : ''}`, {
        method: id ? 'PUT' : 'POST', headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ tamanho, nome, preco, ativo, regras }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(typeof data?.detail === 'string' ? data.detail : 'Confira preço e quantidade de escolhas.');
      setSizes(previous => [...previous.filter(size => size.id !== data.id), data]);
      setEditing(null);
      notify?.(mode === 'choices' ? 'Escolhas da marmita salvas.' : 'Marmita salva.', 'success');
      await onSaved?.();
    } catch (err) { setError(err instanceof Error ? err.message : 'Falha ao salvar marmita.'); }
    finally { setSaving(false); }
  };

  if (loading && !enabled) return <p className="text-sm text-koma-muted">Carregando marmitas…</p>;
  if (!enabled) return error ? <p role="alert" className="text-sm text-amber-500">{error}</p> : null;
  const updateRule = (index: number, update: Partial<Regra>) => {
    if (editing) setEditing({ ...editing, regras: editing.regras.map((rule, i) => i === index ? { ...rule, ...update } : rule) });
  };
  return <section ref={panelRef} className="rounded-2xl border border-koma-border bg-koma-card p-4 space-y-4" aria-label={mode === 'choices' ? 'Escolhas das marmitas' : 'Cadastro de marmitas'}>
    <div><h3 className="font-bold text-koma-foreground">{mode === 'choices' ? 'Escolhas por tamanho' : 'Marmitas'}</h3>
      <p className="text-sm text-koma-muted">{mode === 'choices' ? 'Defina o que o cliente pode escolher depois de selecionar a marmita no cardápio online.' : 'Cadastre P, M e G e configure o preço. As proteínas, guarnições e saladas ficam na aba Complementos.'}</p></div>
    {mode === 'products' && <div className="grid grid-cols-3 gap-2">
      {(['P', 'M', 'G'] as const).map(tamanho => {
        const size = sizes.find(item => item.tamanho === tamanho);
        return <button key={tamanho} type="button" disabled={saving || !!editing || loading}
          aria-label={size ? `Configurar marmita ${tamanho}` : `Cadastrar marmita ${tamanho}`}
          className="rounded-xl border border-koma-border p-3 text-koma-foreground disabled:opacity-50"
          onClick={() => { setError(''); setEditing(size ? { ...size, regras: size.regras.map(rule => ({ ...rule })) } : { tamanho, nome: `Marmita ${tamanho}`, preco: 0, ativo: false, regras: [] }); }}>
          <strong className="block">{tamanho}</strong><span className="text-xs">{size ? size.preco.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : 'Cadastrar'}</span>
        </button>;
      })}
    </div>}
    {mode === 'choices' && sizes.length === 0 && <p className="text-sm text-koma-muted">Cadastre primeiro os tamanhos na aba Produtos.</p>}
    {sizes.map(size => <div key={size.id} className="rounded-xl border border-koma-border p-3 space-y-1">
      <div className="flex items-center justify-between gap-2"><strong>{size.nome}</strong>
        <button type="button" className="text-sm font-bold text-emerald-500" disabled={saving || !!editing || loading} aria-label={`Configurar ${size.nome}`} onClick={() => { setError(''); setEditing({ ...size, regras: size.regras.map(rule => ({ ...rule })) }); }}>Configurar</button></div>
      {mode === 'products' && size.id && onEditDetails && <button type="button" disabled={saving || !!editing} className="text-xs text-koma-muted underline" onClick={() => onEditDetails(size.id!)}>Foto e descrição de {size.nome}</button>}
      <p className="text-sm text-koma-muted">{size.preco.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} · {size.ativo ? 'Disponível' : 'Pausada'}{!size.configurado ? ' · Confira as escolhas' : ''}</p>
      {mode === 'products' && size.id && onConfigureChoices && <button type="button" disabled={saving || !!editing || loading} className="text-sm font-bold text-emerald-500" onClick={() => onConfigureChoices(size.id!)}>Configurar escolhas de {size.nome}</button>}
      {mode === 'choices' && size.regras.map(rule => <p key={rule.grupo_id} className="text-sm text-koma-muted">{grupos.find(group => group.id === rule.grupo_id)?.nome || 'Grupo removido'}: {rule.minimo === rule.maximo ? `escolha ${rule.maximo}` : `de ${rule.minimo} até ${rule.maximo}`} · {rule.modo_selecao === 'porcoes' ? 'pode repetir' : 'opções diferentes'}</p>)}
    </div>)}
    {error && !editing && <p role="alert" className="text-sm text-rose-500">{error}</p>}
    {editing && <form onSubmit={save} className="space-y-4 rounded-xl border border-koma-border p-3" aria-label="Configurar marmita">
      <fieldset disabled={saving} className="space-y-4">
        <p className="font-bold">{editing.tamanho ? `Marmita ${editing.tamanho}` : editing.nome}</p>
        {mode === 'products' && <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">Nome no cardápio<input required maxLength={100} className={inputClass} value={editing.nome} onChange={event => setEditing({ ...editing, nome: event.target.value })} /></label>
          <label className="text-sm">Preço (R$)<MoneyInput required aria-label="Preço da marmita" className={inputClass} value={editing.preco} onValueChange={price => setEditing({ ...editing, preco: price === '' ? 0 : price })} /></label>
        </div>}
        {mode === 'choices' && <>
        <p className="text-sm text-koma-muted">Defina quantas proteínas, guarnições e outras opções o cliente pode escolher.</p>
        {editing.regras.map((rule, index) => <div key={index} className="space-y-2 rounded-xl bg-koma-raised p-3">
          <label className="block text-sm">Opções<select required className={inputClass} aria-label={`Grupo ${index + 1}`} value={rule.grupo_id} onChange={event => updateRule(index, { grupo_id: event.target.value })}>
            <option value="">Selecione proteínas, guarnições, saladas…</option>{grupos.filter(group => group.id === rule.grupo_id || !editing.regras.some(item => item.grupo_id === group.id)).map(group => <option key={group.id} value={group.id}>{group.nome}</option>)}
          </select></label>
          <label className="block text-sm">Quantidade de escolhas<input aria-label={`Quantidade do grupo ${index + 1}`} type="number" required min={1} max={100} step={1} className={inputClass} value={rule.maximo} onChange={event => { const count = Number(event.target.value); updateRule(index, { maximo: count, minimo: rule.minimo === 0 ? 0 : count }); }} /></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" aria-label={`Obrigatório grupo ${index + 1}`} checked={rule.minimo > 0} onChange={event => updateRule(index, { minimo: event.target.checked ? rule.maximo : 0 })} />Escolha obrigatória</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" aria-label={`Permitir repetir grupo ${index + 1}`} checked={rule.modo_selecao === 'porcoes'} onChange={event => updateRule(index, { modo_selecao: event.target.checked ? 'porcoes' : 'tipos' })} />Permitir repetir a mesma opção</label>
          {rule.minimo > 0 && rule.minimo !== rule.maximo && <p className="text-xs text-koma-muted">Regra existente: de {rule.minimo} até {rule.maximo} escolhas. Alterar a quantidade passa a exigir esse total.</p>}
          <button type="button" className="text-sm text-rose-500" onClick={() => setEditing({ ...editing, ativo: editing.regras.length > 1 && editing.ativo, regras: editing.regras.filter((_, i) => i !== index) })}>Remover estas escolhas</button>
        </div>)}
        <button type="button" className="text-sm font-bold text-emerald-500" disabled={editing.regras.length >= grupos.length || editing.regras.length >= 20} onClick={() => setEditing({ ...editing, regras: [...editing.regras, { grupo_id: '', minimo: 1, maximo: 1, modo_selecao: 'tipos' }] })}>Adicionar escolhas</button>
        {grupos.length === 0 && <p className="text-sm text-amber-500">Cadastre as proteínas, guarnições e saladas abaixo para configurar as escolhas deste tamanho.</p>}
        </>}
        {mode === 'products' && editing.regras.length === 0 && <p className="text-sm text-koma-muted">Salve o preço e configure as escolhas na aba Complementos antes de colocar a marmita à venda.</p>}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={editing.regras.length === 0 && !editing.ativo} checked={editing.ativo} onChange={event => setEditing({ ...editing, ativo: event.target.checked })} />Disponível para venda</label>
        <p className="text-xs text-koma-muted">Pausar uma opção vale para todos os tamanhos que usam essa opção.</p>
        {error && <p role="alert" className="text-sm text-rose-500">{error}</p>}
        <div className="flex gap-3"><button type="submit" className="rounded-xl bg-emerald-500 px-4 py-2 font-bold text-black">{saving ? 'Salvando…' : mode === 'choices' ? 'Salvar escolhas' : 'Salvar marmita'}</button><button type="button" onClick={() => { setEditing(null); setError(''); }}>Cancelar</button></div>
      </fieldset>
    </form>}
  </section>;
}
