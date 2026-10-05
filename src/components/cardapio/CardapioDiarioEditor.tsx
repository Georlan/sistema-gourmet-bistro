import { useEffect, useMemo, useState } from 'react';
import { Check, Search, CalendarDays, ArrowRight, RotateCcw } from 'lucide-react';
import clsx from 'clsx';
import type { GrupoModificador } from './ComplementosTab';

type Props = {
  grupos: GrupoModificador[];
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
  onSaved: () => Promise<void>;
  onReload: () => Promise<void>;
  onEditGroup: (group: GrupoModificador) => void;
  onDirtyChange: (dirty: boolean) => void;
};
const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');

/** Availability draft; never recreates options or edits composition/prices. */
export function CardapioDiarioEditor({ grupos, apiBaseUrl, authHeaders, onSaved, onReload, onEditGroup, onDirtyChange }: Props) {
  const original = useMemo(() => new Map(grupos.flatMap(g => g.opcoes.filter(o => o.id).map(o => [o.id!, o.ativo !== false] as const))), [grupos]);
  const [draft, setDraft] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('todos');
  const [review, setReview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const active = (id: string) => draft[id] ?? original.get(id) ?? false;
  const changes = grupos.flatMap(group => group.opcoes.filter(option => option.id && !option.opcao_origem_id && draft[option.id] != null && draft[option.id] !== original.get(option.id)).map(option => ({ id: option.id!, nome: option.nome, grupo: group.nome, ativo: draft[option.id!], ativo_anterior: original.get(option.id!)! })));
  useEffect(() => { onDirtyChange(changes.length > 0); }, [changes.length, onDirtyChange]);
  const groups = [...grupos].sort((a, b) => Number(Boolean(a.grupo_origem_id)) - Number(Boolean(b.grupo_origem_id)) || a.nome.localeCompare(b.nome, 'pt-BR'));
  const visible = groups.map(group => ({ ...group, opcoes: group.opcoes.filter(o =>
    (normalize(o.nome).includes(normalize(search)) || normalize(group.nome).includes(normalize(search)))
    && (filter === 'todos' || (o.id && active(o.opcao_origem_id || o.id) === (filter === 'disponiveis')))
  ).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' })) })).filter(g => g.opcoes.length > 0);
  const save = async () => {
    if (saving || !changes.length) return;
    setSaving(true); setError(''); setSaved(false);
    try {
      const response = await fetch(`${apiBaseUrl}/cardapio/modificadores/cardapio-diario`, { method: 'PATCH', headers: { ...authHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ opcoes: changes.map(({ id, ativo, ativo_anterior }) => ({ id, ativo, ativo_anterior })) }) });
      const json = await response.json().catch(() => null);
      if (!response.ok) throw new Error(typeof json?.detail === 'string' ? json.detail : 'Não foi possível salvar o cardápio do dia.');
      setDraft({}); setReview(false); setSaved(true);
      await onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível confirmar o salvamento. Atualize para conferir o estado atual.'); }
    finally { setSaving(false); }
  };
  const discard = () => { setDraft({}); setReview(false); setError(''); setSaved(false); };
  return <section aria-label="Cardápio do dia" className="space-y-5">
    <div className="rounded-2xl border border-koma-border bg-koma-panel p-4">
      <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300"><CalendarDays size={20} /><h2 className="text-lg font-bold">O que vamos servir?</h2></div>
      <p className="mt-2 text-sm text-koma-muted">Marque as opções disponíveis por grupo. Revise e salve quando terminar.</p>
      <p className="mt-1 text-xs text-koma-muted">A disponibilidade vale para todas as quentinhas e canais vinculados. Preços, tamanhos e pedidos registrados são preservados. Esta tela não agenda dias futuros.</p>
    </div>
    <div className="flex flex-wrap gap-3">
      <label className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-koma-border bg-koma-panel px-3"><Search size={16} className="text-koma-muted" /><input aria-label="Buscar opção do cardápio diário" value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar arroz, frango, salada…" className="w-full bg-transparent py-3 text-sm text-koma-foreground outline-none" /></label>
      <select aria-label="Filtrar opções do dia" value={filter} onChange={e => setFilter(e.target.value)} className="rounded-xl border border-koma-border bg-koma-panel p-3 text-sm text-koma-foreground"><option value="todos">Todas as opções</option><option value="disponiveis">Disponíveis</option><option value="pausadas">Pausadas</option></select>
    </div>
    {error && <div role="alert" className="rounded-xl border border-rose-500/40 bg-koma-panel p-4 text-sm text-koma-foreground">{error}<button disabled={saving} onClick={async () => { discard(); await onReload(); }} className="ml-3 underline">Descartar seleção e atualizar</button></div>}
    {saved && <p role="status" className="rounded-xl bg-emerald-500/10 p-4 text-sm text-emerald-700 dark:text-emerald-300">Cardápio do dia salvo. Adicionais vinculados acompanham a origem.</p>}
    <div className="space-y-3">
      {visible.map(group => {
        const automatic = Boolean(group.grupo_origem_id) && group.opcoes.every(option => Boolean(option.opcao_origem_id));
        return <section key={group.id} aria-label={`Opções de ${group.nome}`} className="rounded-2xl border border-koma-border bg-koma-panel p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h3 className="font-bold text-koma-foreground">{group.nome}</h3><span className="text-xs text-koma-muted">{group.opcoes.filter(o => o.id && active(o.opcao_origem_id || o.id)).length} {automatic ? 'disponíveis' : 'na seleção'}</span>{!automatic && <button type="button" disabled={saving || changes.length > 0} onClick={() => onEditGroup(group)} className="rounded-lg border border-koma-border px-3 py-1.5 text-xs font-semibold text-koma-foreground disabled:opacity-40">Cadastrar / editar</button>}{automatic && <span className="rounded-full bg-koma-raised px-2 py-1 text-xs text-koma-muted">Automático</span>}</div>
        {group.grupo_origem_id && <p className="mb-3 text-xs text-koma-muted">Disponibilidade automática: acompanha {grupos.find(g => g.id === group.grupo_origem_id)?.nome || 'a origem'}. Altere as opções no grupo de origem.</p>}
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">{group.opcoes.map(option => {
          const id = option.id || '';
          const checked = active(option.opcao_origem_id || id);
          const changed = !option.opcao_origem_id && draft[id] != null && draft[id] !== original.get(id);
          if (option.opcao_origem_id) return <article key={id || option.nome} aria-label={`${option.nome} — ${group.nome}`} className="flex items-center gap-3 rounded-lg border border-koma-border bg-koma-raised/30 px-3 py-2">
            <span aria-hidden="true" className={clsx('h-2 w-2 shrink-0 rounded-full', checked ? 'bg-emerald-500' : 'bg-koma-muted/40')} />
            <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-koma-foreground">{option.nome}</span><span className="mt-1 block text-xs text-koma-muted">{checked ? 'Disponível' : 'Pausado'}{option.preco_adicional > 0 ? ` · + ${Number(option.preco_adicional).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}` : ''}</span></span>
          </article>;
          return <label key={id || option.nome} className={clsx('flex items-center gap-3 rounded-lg border px-3 py-2 transition-colors', checked ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-koma-border bg-koma-raised/30', option.opcao_origem_id ? 'cursor-default' : 'cursor-pointer')}>
            <input type="checkbox" aria-label={`${option.nome} — ${group.nome}`} checked={checked} disabled={saving || review || !id || Boolean(option.opcao_origem_id)} onChange={e => { setDraft(d => ({ ...d, [id]: e.target.checked })); setSaved(false); }} className="h-4 w-4 shrink-0 accent-emerald-600" />
            <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-koma-foreground">{option.nome}</span><span className="mt-1 block text-xs text-koma-muted">{checked ? 'Disponível' : 'Pausado'}{changed ? ' · alteração pendente' : ''}{option.preco_adicional > 0 ? ` · + ${Number(option.preco_adicional).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}` : ''}</span></span>
            {checked && <Check size={16} className="shrink-0 text-emerald-700 dark:text-emerald-300" />}
          </label>;
        })}</div>
      </section>; })}
    </div>
    {!visible.length && <p className="rounded-xl border border-koma-border p-6 text-center text-koma-muted">Nenhuma opção nesta busca. Cadastre grupos e opções na aba Cadastros.</p>}
    {review && <section aria-label="Revisão do cardápio diário" className="rounded-2xl border border-emerald-500/40 bg-koma-panel p-5">
      <h3 className="font-bold text-koma-foreground">Conferir antes de salvar</h3><p className="mt-1 text-xs text-koma-muted">Somente as opções abaixo mudam. Adicionais vinculados acompanham a origem.</p>
      <ul className="my-4 divide-y divide-koma-border">{changes.map(c => <li key={c.id} className="flex flex-wrap justify-between gap-2 py-3 text-sm"><span className="text-koma-foreground">{c.nome}<small className="ml-2 text-koma-muted">{c.grupo}</small></span><strong className={c.ativo ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}>{c.ativo ? 'Disponibilizar' : 'Pausar'}</strong></li>)}</ul>
      <button disabled={saving} onClick={() => setReview(false)} className="text-sm font-bold text-koma-muted underline">Voltar à seleção</button>
    </section>}
    <div className={clsx("flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-koma-border bg-koma-panel p-4", changes.length > 0 && "sticky bottom-20 z-10 shadow-lg md:bottom-4")}>
      <span className="text-sm text-koma-foreground">{changes.length ? `${changes.length} alterações para revisar` : 'Nenhuma alteração pendente'}</span>
      <div className="flex flex-wrap gap-2"><button disabled={saving || !changes.length} onClick={discard} className="inline-flex items-center gap-2 rounded-xl border border-koma-border px-3 py-2 text-xs font-bold text-koma-muted disabled:opacity-40"><RotateCcw size={14} />Desfazer seleção</button><button disabled={saving || !changes.length} onClick={() => review ? void save() : setReview(true)} className="koma-btn-primary inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold disabled:opacity-40">{saving ? 'Salvando…' : review ? 'Salvar cardápio do dia' : 'Revisar alterações'}<ArrowRight size={14} /></button></div>
    </div>
  </section>;
}
