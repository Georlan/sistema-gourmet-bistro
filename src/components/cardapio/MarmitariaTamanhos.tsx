import { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import MoneyInput from '../MoneyInput';
import type { GrupoModificador } from './ComplementosTab';

type Regra = { grupo_id: string; minimo: number; maximo: number; modo_selecao: 'porcoes' | 'tipos' };
type Tamanho = { id?: string; tamanho: 'P' | 'M' | 'G' | null; nome: string; preco: number; ativo: boolean; configurado?: boolean; regras: Regra[] };
const inputClass = 'w-full rounded-xl border border-koma-border bg-koma-card px-3 py-2 text-sm text-koma-foreground';
interface Props {
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
  grupos?: GrupoModificador[];
  createOnly?: boolean;
  onSaved?: () => Promise<void>;
  notify?: (message: string, type?: 'success' | 'error') => void;
  focusProductId?: string | null;
  onFocusHandled?: () => void;
  catalogVersion?: string;
  onEditDetails?: (id: string) => void;
}

export default function MarmitariaTamanhos({ apiBaseUrl, authHeaders, grupos: gruposProp, createOnly = false, onSaved, notify, focusProductId, onFocusHandled, catalogVersion, onEditDetails }: Props) {
  const [enabled, setEnabled] = useState(false);
  const [sizes, setSizes] = useState<Tamanho[]>([]);
  const [loadedGroups, setLoadedGroups] = useState<GrupoModificador[]>([]);
  const grupos = gruposProp ?? loadedGroups;
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
    if (gruposProp !== undefined) return;
    const controller = new AbortController();
    fetch(`${apiBaseUrl}/cardapio/modificadores/grupos`, { headers: JSON.parse(authKey), signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('Não foi possível carregar os grupos de complementos.');
        const data = await response.json();
        if (!controller.signal.aborted) setLoadedGroups(Array.isArray(data) ? data : []);
      })
      .catch(err => {
        if (!controller.signal.aborted) notify?.(err instanceof Error ? err.message : 'Não foi possível carregar os grupos de complementos.', 'error');
      });
    return () => controller.abort();
  }, [apiBaseUrl, authKey, gruposProp, notify]);

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
      notify?.('Marmita salva com a composição deste tamanho.', 'success');
      await onSaved?.();
    } catch (err) { setError(err instanceof Error ? err.message : 'Falha ao salvar marmita.'); }
    finally { setSaving(false); }
  };

  if (loading && !enabled) return <p className="text-sm text-koma-muted">Carregando marmitas…</p>;
  if (!enabled) return error ? <p role="alert" className="text-sm text-amber-500">{error}</p> : null;
  const updateRule = (index: number, update: Partial<Regra>) => {
    if (editing) setEditing({ ...editing, regras: editing.regras.map((rule, i) => i === index ? { ...rule, ...update } : rule) });
  };
  return <section ref={panelRef} className="rounded-2xl border border-koma-border bg-koma-card p-4 space-y-4" aria-label="Cadastro de marmitas">
    <div><h3 className="font-bold text-koma-foreground">Marmitas</h3>
      <p className="text-sm text-koma-muted">Cadastre somente os tamanhos vendidos. Para cada tamanho, defina preço e quantas escolhas cada grupo permite. Os grupos e itens são cadastrados em Complementos.</p></div>
    <div className="grid grid-cols-3 gap-2">
      {(['P', 'M', 'G'] as const).map(tamanho => {
        const size = sizes.find(item => item.tamanho === tamanho);
        return <button key={tamanho} type="button" disabled={saving || !!editing || loading || (createOnly && !!size)}
          aria-label={size ? `Configurar marmita ${tamanho}` : `Cadastrar marmita ${tamanho}`}
          className="rounded-xl border border-koma-border p-3 text-koma-foreground disabled:opacity-50"
          onClick={() => { setError(''); setEditing(size ? { ...size, regras: size.regras.map(rule => ({ ...rule })) } : { tamanho, nome: `Marmita ${tamanho}`, preco: 0, ativo: true, regras: [] }); }}>
          <strong className="block">{tamanho}</strong><span className="text-xs">{size ? (createOnly ? 'Já cadastrada' : size.preco.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })) : 'Cadastrar'}</span>
        </button>;
      })}
    </div>
    {!createOnly && sizes.map(size => <div key={size.id} className="rounded-xl border border-koma-border p-3 space-y-1">
      <div className="flex items-center justify-between gap-2"><strong>{size.nome}</strong>
        <button type="button" className="text-sm font-bold text-emerald-500" disabled={saving || !!editing || loading} aria-label={`Configurar ${size.nome}`} onClick={() => { setError(''); setEditing({ ...size, regras: size.regras.map(rule => ({ ...rule })) }); }}>Configurar</button></div>
      {size.id && onEditDetails && <button type="button" disabled={saving || !!editing} className="text-xs text-koma-muted underline" onClick={() => onEditDetails(size.id!)}>Foto e descrição de {size.nome}</button>}
      <p className="text-sm text-koma-muted">{size.preco.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} · {size.ativo ? 'Disponível' : 'Pausada'}{!size.configurado ? ' · Confira a composição' : ''}</p>
      {size.regras.map(rule => <p key={rule.grupo_id} className="text-sm text-koma-muted">{grupos.find(group => group.id === rule.grupo_id)?.nome || 'Grupo removido'}: de {rule.minimo} até {rule.maximo} · {rule.modo_selecao === 'porcoes' ? 'pode repetir' : 'opções diferentes'}</p>)}
    </div>)}
    {error && !editing && <p role="alert" className="text-sm text-rose-500">{error}</p>}
    {editing && <form onSubmit={save} className="space-y-4 rounded-xl border border-koma-border p-3" aria-label="Configurar marmita">
      <fieldset disabled={saving} className="space-y-4">
        <p className="font-bold">{editing.tamanho ? `Marmita ${editing.tamanho}` : editing.nome}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">Nome no cardápio<input required maxLength={100} className={inputClass} value={editing.nome} onChange={event => setEditing({ ...editing, nome: event.target.value })} /></label>
          <label className="text-sm">Preço (R$)<MoneyInput required aria-label="Preço da marmita" className={inputClass} value={editing.preco} onValueChange={price => setEditing({ ...editing, preco: price === '' ? 0 : price })} /></label>
        </div>
        <div className="space-y-2">
          <div>
            <p className="text-sm font-bold text-koma-foreground">Composição deste tamanho</p>
            <p className="text-xs text-koma-muted">Escolha os grupos já cadastrados em Complementos e defina os limites somente para esta quentinha.</p>
          </div>
          {editing.regras.map((rule, index) => <div key={index} className="space-y-2 rounded-xl bg-koma-raised p-3">
            <label className="block text-sm">Grupo<select required className={inputClass} aria-label={`Grupo ${index + 1}`} value={rule.grupo_id} onChange={event => updateRule(index, { grupo_id: event.target.value })}>
              <option value="">Selecione proteínas, guarnições, saladas…</option>{grupos.filter(group => group.id === rule.grupo_id || !editing.regras.some(item => item.grupo_id === group.id)).map(group => <option key={group.id} value={group.id}>{group.nome}</option>)}
            </select></label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-sm">Mínimo<input aria-label={`Mínimo do grupo ${index + 1}`} type="number" required min={0} max={100} step={1} className={inputClass} value={rule.minimo} onChange={event => updateRule(index, { minimo: Number(event.target.value) })} /></label>
              <label className="block text-sm">Máximo<input aria-label={`Máximo do grupo ${index + 1}`} type="number" required min={1} max={100} step={1} className={inputClass} value={rule.maximo} onChange={event => updateRule(index, { maximo: Number(event.target.value) })} /></label>
            </div>
            <p className="text-[11px] leading-relaxed text-koma-muted">
              Mínimo 0 deixa o grupo opcional. O máximo é apenas o limite permitido e não obriga o cliente a completar essa quantidade.
            </p>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" aria-label={`Permitir repetir grupo ${index + 1}`} checked={rule.modo_selecao === 'porcoes'} onChange={event => updateRule(index, { modo_selecao: event.target.checked ? 'porcoes' : 'tipos' })} />Permitir repetir a mesma opção</label>
            <button type="button" className="text-sm text-rose-500" onClick={() => setEditing({ ...editing, ativo: editing.regras.length > 1 && editing.ativo, regras: editing.regras.filter((_, i) => i !== index) })}>Remover grupo desta quentinha</button>
          </div>)}
          <button
            type="button"
            className="group flex w-full items-center justify-between gap-3 rounded-xl border border-dashed border-emerald-500/40 bg-emerald-500/5 px-3 py-3 text-left transition hover:border-emerald-400 hover:bg-emerald-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={editing.regras.length >= grupos.length || editing.regras.length >= 20}
            onClick={() => setEditing({ ...editing, regras: [...editing.regras, { grupo_id: '', minimo: 0, maximo: 1, modo_selecao: 'tipos' }] })}
          >
            <span>
              <strong className="block text-sm text-emerald-500">{editing.regras.length === 0 ? 'Adicionar à composição' : 'Adicionar outro grupo à composição'}</strong>
              <span className="mt-0.5 block text-xs text-koma-muted">Escolha Proteínas, Guarnições, Saladas ou outro grupo já cadastrado.</span>
            </span>
            <Plus size={18} className="shrink-0 text-emerald-500 transition-transform group-hover:scale-110" />
          </button>
          {grupos.length === 0 && <p className="text-sm text-amber-500">Cadastre primeiro Proteínas, Guarnições, Saladas e suas opções na aba Complementos. Depois volte aqui para definir os limites deste tamanho.</p>}
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={editing.regras.length === 0 && !editing.ativo} checked={editing.ativo} onChange={event => setEditing({ ...editing, ativo: event.target.checked })} />Disponível para venda</label>
        <p className="text-xs text-koma-muted">Os limites acima valem apenas para esta quentinha. Pausar uma opção em Complementos vale para todos os tamanhos que usam essa opção.</p>
        {error && <p role="alert" className="text-sm text-rose-500">{error}</p>}
        <div className="flex gap-3"><button type="submit" className="rounded-xl bg-emerald-500 px-4 py-2 font-bold text-black">{saving ? 'Salvando…' : 'Salvar marmita'}</button><button type="button" onClick={() => { setEditing(null); setError(''); }}>Cancelar</button></div>
      </fieldset>
    </form>}
  </section>;
}
