import { useEffect, useState } from 'react';
import MoneyInput from '../MoneyInput';
import type { GrupoModificador } from './ComplementosTab';

type Regra = { grupo_id: string; minimo: number; maximo: number; modo_selecao: 'porcoes' | 'tipos' };
type Tamanho = { id?: string; nome: string; preco: number; ativo: boolean; regras: Regra[] };
const emptySize = (): Tamanho => ({ nome: '', preco: 0, ativo: false, regras: [] });
const inputClass = 'w-full rounded-xl border border-koma-border bg-koma-card px-3 py-2 text-sm text-koma-foreground';

interface Props {
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
  grupos: GrupoModificador[];
  onSaved?: () => Promise<void>;
  notify?: (message: string, type?: 'success' | 'error') => void;
}

export default function MarmitariaTamanhos({ apiBaseUrl, authHeaders, grupos, onSaved, notify }: Props) {
  const [enabled, setEnabled] = useState(false);
  const [sizes, setSizes] = useState<Tamanho[]>([]);
  const [editing, setEditing] = useState<Tamanho | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${apiBaseUrl}/cardapio/marmitaria/tamanhos`, { headers: authHeaders, signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('Não foi possível carregar os tamanhos de marmita.');
        const data = await response.json();
        setEnabled(data.enabled === true);
        setSizes(Array.isArray(data.tamanhos) ? data.tamanhos : []);
      }).catch(err => { if (!controller.signal.aborted) setError(err.message); });
    return () => controller.abort();
  }, [apiBaseUrl]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editing || saving) return;
    setSaving(true);
    setError('');
    try {
      const { id, nome, preco, ativo, regras } = editing;
      const payload = { nome, preco, ativo, regras };
      const response = await fetch(`${apiBaseUrl}/cardapio/marmitaria/tamanhos${id ? `/${encodeURIComponent(id)}` : ''}`, {
        method: id ? 'PUT' : 'POST', headers: { ...authHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(typeof data?.detail === 'string' ? data.detail : 'Confira nome, preço e limites das escolhas.');
      setSizes(previous => [...previous.filter(size => size.id !== data.id), data]);
      setEditing(null);
      notify?.('Tamanho e composição salvos.', 'success');
      await onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao salvar tamanho.');
    } finally { setSaving(false); }
  };

  if (!enabled) return error ? <p role="alert" className="text-sm text-amber-500">{error}</p> : null;
  return <section className="rounded-2xl border border-koma-border bg-koma-card p-4 space-y-4" aria-label="Montagem por tamanho">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h3 className="font-bold text-koma-foreground">Tamanhos de marmita</h3>
        <p className="text-sm text-koma-muted">Configure o preço e as escolhas de cada tamanho. Cadastre as opções nos grupos abaixo uma única vez.</p></div>
      <button type="button" className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-bold text-black" disabled={saving || !!editing} onClick={() => { setError(''); setEditing(emptySize()); }}>Adicionar tamanho</button>
    </div>
    {sizes.length === 0 && !editing && <p className="text-sm text-koma-muted">Crie somente os tamanhos que você vende. Não é necessário ter P, M e G.</p>}
    {sizes.map(size => <div key={size.id} className="rounded-xl border border-koma-border p-3 space-y-1">
      <div className="flex items-center justify-between gap-2"><strong>{size.nome}</strong>
        <button type="button" className="text-sm font-bold text-emerald-500" disabled={saving || !!editing} aria-label={`Configurar ${size.nome}`} onClick={() => { setError(''); setEditing({ ...size, regras: size.regras.map(rule => ({ ...rule })) }); }}>Configurar</button></div>
      <p className="text-sm text-koma-muted">{size.preco.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} · {size.ativo ? 'Disponível' : 'Pausado'}</p>
      {size.regras.map(rule => <p key={rule.grupo_id} className="text-sm text-koma-muted">{grupos.find(group => group.id === rule.grupo_id)?.nome || 'Grupo removido'}: {rule.minimo === rule.maximo ? `escolha ${rule.minimo} ${rule.modo_selecao === "porcoes" ? "porções" : "tipos diferentes"}` : `de ${rule.minimo} até ${rule.maximo} ${rule.modo_selecao === "porcoes" ? "porções" : "tipos diferentes"}`}</p>)}
    </div>)}
    {error && !editing && <p role="alert" className="text-sm text-rose-500">{error}</p>}
    {editing && <form onSubmit={save} className="space-y-4 rounded-xl border border-koma-border p-3" aria-label="Configurar tamanho de marmita">
      <fieldset disabled={saving} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">Nome do tamanho<input required maxLength={100} className={inputClass} placeholder="Ex.: Marmita grande" value={editing.nome} onChange={event => setEditing({ ...editing, nome: event.target.value })} /></label>
          <label className="text-sm">Preço (R$)<MoneyInput required aria-label="Preço do tamanho" className={inputClass} value={editing.preco} onValueChange={price => setEditing({ ...editing, preco: price === '' ? 0 : price })} /></label>
        </div>
        <p className="text-sm text-koma-muted">Escolha os grupos usados neste tamanho. Mínimo e máximo iguais exigem exatamente essa quantidade. Decida por grupo se pode repetir ou se exige tipos diferentes.</p>
        {editing.regras.map((rule, index) => <div key={index} className="space-y-2 rounded-xl bg-koma-raised p-3">
          <label className="block text-sm">Grupo de escolhas<select required className={inputClass} aria-label={`Grupo ${index + 1}`} value={rule.grupo_id} onChange={event => setEditing({ ...editing, regras: editing.regras.map((item, i) => i === index ? { ...item, grupo_id: event.target.value } : item) })}>
            <option value="">Selecione proteínas, guarnições, saladas…</option>{grupos.filter(group => group.id === rule.grupo_id || !editing.regras.some(item => item.grupo_id === group.id)).map(group => <option key={group.id} value={group.id}>{group.nome}</option>)}
          </select></label>
          <label className="block text-sm">Como contar as escolhas<select aria-label={`Contagem do grupo ${index + 1}`} className={inputClass} value={rule.modo_selecao} onChange={event => setEditing({ ...editing, regras: editing.regras.map((item, i) => i === index ? { ...item, modo_selecao: event.target.value as Regra['modo_selecao'] } : item) })}>
            <option value="porcoes">Porções — pode repetir a mesma opção</option><option value="tipos">Tipos diferentes — uma escolha de cada</option>
          </select></label>
          <div className="grid grid-cols-2 gap-3">{(['minimo', 'maximo'] as const).map(field => <label key={field} className="text-sm">{field === 'minimo' ? 'Mínimo de escolhas' : 'Máximo de escolhas'}<input aria-label={`${field === 'minimo' ? 'Mínimo' : 'Máximo'} do grupo ${index + 1}`} type="number" required min={field === 'minimo' ? 0 : 1} max={100} step={1} className={inputClass} value={rule[field]} onChange={event => setEditing({ ...editing, regras: editing.regras.map((item, i) => i === index ? { ...item, [field]: Number(event.target.value) } : item) })} /></label>)}</div>
          <button type="button" className="text-sm text-rose-500" onClick={() => setEditing({ ...editing, regras: editing.regras.filter((_, i) => i !== index) })}>Remover grupo deste tamanho</button>
        </div>)}
        <button type="button" className="text-sm font-bold text-emerald-500" disabled={editing.regras.length >= grupos.length || editing.regras.length >= 20} onClick={() => setEditing({ ...editing, regras: [...editing.regras, { grupo_id: '', minimo: 0, maximo: 1, modo_selecao: 'porcoes' }] })}>Adicionar grupo de escolhas</button>
        {grupos.length === 0 && <p className="text-sm text-amber-500">Cadastre primeiro os grupos e opções abaixo, depois configure o tamanho.</p>}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={editing.ativo} onChange={event => setEditing({ ...editing, ativo: event.target.checked })} />Disponível para venda</label>
        <p className="text-xs text-koma-muted">Pausar uma opção no grupo abaixo vale para todos os tamanhos que usam esse grupo. Se faltar uma escolha obrigatória, pause o tamanho.</p>
        {error && <p role="alert" className="text-sm text-rose-500">{error}</p>}
        <div className="flex gap-3"><button type="submit" disabled={editing.regras.length === 0} className="rounded-xl bg-emerald-500 px-4 py-2 font-bold text-black">{saving ? 'Salvando…' : 'Salvar tamanho'}</button><button type="button" onClick={() => { setEditing(null); setError(''); }}>Cancelar</button></div>
      </fieldset>
    </form>}
  </section>;
}
