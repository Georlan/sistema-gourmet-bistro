import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { Edit3, FileUp, Link2, PackageOpen, Plus, Search, SlidersHorizontal, X } from 'lucide-react';
import type { FichaTecnicaProduto, Insumo } from '../../types';
import { KomaEmptyState } from '../shared/KomaEmptyState';

type StockFilter = 'todos' | 'baixo' | 'normal' | 'negativo';

interface EstoqueIngredientesTabProps {
  insumos: Insumo[];
  fichasTecnicas: FichaTecnicaProduto[];
  onCreate: () => void;
  onEdit: (insumo: Insumo) => void;
  onAdjust: (insumo: Insumo) => void;
  onImportXml: () => void;
  onOpenRecipes: () => void;
}

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export function EstoqueIngredientesTab({
  insumos,
  fichasTecnicas,
  onCreate,
  onEdit,
  onAdjust,
  onImportXml,
  onOpenRecipes,
}: EstoqueIngredientesTabProps) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<StockFilter>('todos');
  const linkedIngredientIds = useMemo(
    () => new Set(fichasTecnicas.flatMap(ficha => ficha.itens.map(item => item.insumo_id))),
    [fichasTecnicas],
  );
  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('pt-BR');
    return insumos.filter(insumo => {
      const current = Number(insumo.estoque_atual || 0);
      const minimum = Number(insumo.estoque_minimo || 0);
      if (filter === 'baixo' && !(current <= minimum && current >= 0)) return false;
      if (filter === 'normal' && current <= minimum) return false;
      if (filter === 'negativo' && current >= 0) return false;
      return !term || insumo.nome.toLocaleLowerCase('pt-BR').includes(term);
    });
  }, [filter, insumos, search]);

  const clearFilters = () => {
    setSearch('');
    setFilter('todos');
  };

  return (
    <div className="space-y-3.5 text-left animate-fade-in">
      {insumos.length > 0 && <section className="koma-toolbar">
        <div className="koma-toolbar__search">
          <Search size={14} aria-hidden="true" />
          <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar ingrediente…" aria-label="Buscar ingredientes" />
          {search && <button type="button" onClick={() => setSearch('')} aria-label="Limpar busca"><X size={13} /></button>}
        </div>
        <select className="koma-toolbar__select" value={filter} onChange={event => setFilter(event.target.value as StockFilter)} aria-label="Filtrar ingredientes por situação">
          <option value="todos">Todas as situações</option>
          <option value="baixo">Precisam de reposição</option>
          <option value="negativo">Saldo negativo</option>
          <option value="normal">Estoque normal</option>
        </select>
        <div className="koma-toolbar__actions">
          <button type="button" onClick={onOpenRecipes} className="koma-btn-secondary"><Link2 size={14} /> Fichas técnicas</button>
          <button type="button" onClick={onImportXml} className="koma-btn-secondary"><FileUp size={14} /> Importar NF-e</button>
          <button type="button" onClick={onCreate} className="koma-btn-success"><Plus size={14} /> Novo ingrediente</button>
        </div>
      </section>}

      {filtered.length === 0 ? (
        <KomaEmptyState
          icon={PackageOpen}
          title={insumos.length === 0 ? 'Cadastre os ingredientes da operação' : 'Nenhum ingrediente encontrado'}
          description={insumos.length === 0
            ? 'Comece importando uma NF-e ou cadastrando manualmente. Depois, vincule os ingredientes aos produtos nas fichas técnicas.'
            : 'Ajuste a busca ou a situação selecionada.'}
          action={insumos.length === 0
            ? <div className="mt-3 flex flex-wrap justify-center gap-2">
                <button type="button" onClick={onImportXml} className="koma-btn-success inline-flex items-center gap-2 px-4 py-2 text-xs font-bold"><FileUp size={14} /> Importar NF-e</button>
                <button type="button" onClick={onCreate} className="koma-btn-secondary inline-flex items-center gap-2 px-4 py-2 text-xs font-bold"><Plus size={14} /> Cadastrar manualmente</button>
              </div>
            : { label: 'Limpar filtros', onClick: clearFilters, variant: 'secondary' }}
        />
      ) : (
        <section className="overflow-hidden rounded-2xl border border-koma-border bg-koma-panel" aria-label="Ingredientes em estoque">
          <header className="flex items-center justify-between gap-3 border-b border-koma-border bg-koma-raised/40 px-3 py-2.5 sm:px-4">
            <p className="text-[10px] text-koma-muted"><strong className="font-mono text-koma-foreground">{filtered.length}</strong> de {insumos.length} ingredientes · <strong>{linkedIngredientIds.size}</strong> usados em fichas técnicas</p>
          </header>
          <div className="hidden grid-cols-[minmax(14rem,1fr)_8rem_8rem_8rem_7rem] items-center gap-3 border-b border-koma-border bg-koma-raised/20 px-4 py-2 text-[9px] font-extrabold uppercase tracking-[0.08em] text-koma-muted lg:grid">
            <span>Ingrediente</span><span>Saldo atual</span><span>Mínimo</span><span>Custo médio</span><span className="text-right">Ações</span>
          </div>
          {filtered.map(insumo => {
            const current = Number(insumo.estoque_atual || 0);
            const minimum = Number(insumo.estoque_minimo || 0);
            const negative = current < 0;
            const low = current <= minimum;
            return (
              <article key={insumo.id} className={clsx('grid gap-3 border-b border-koma-border px-3 py-3 last:border-b-0 hover:bg-koma-raised/50 sm:px-4 lg:grid-cols-[minmax(14rem,1fr)_8rem_8rem_8rem_7rem] lg:items-center', low && 'bg-amber-500/5')}>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate text-xs font-bold text-koma-foreground">{insumo.nome}</h2>
                    <span className={clsx('koma-status-badge', negative ? 'koma-badge-danger' : low ? 'koma-badge-warning' : 'koma-badge-success')}>{negative ? 'Corrigir saldo' : low ? 'Repor' : 'Em dia'}</span>
                    {linkedIngredientIds.has(insumo.id) && <span className="koma-status-badge koma-badge-info"><Link2 size={10} /> Em uso</span>}
                  </div>
                  <p className="mt-1 text-[9px] text-koma-muted lg:hidden">Atual {current.toFixed(2)} {insumo.unidade_medida} · mínimo {minimum.toFixed(2)} · {currency.format(Number(insumo.preco_medio_custo || 0))}</p>
                </div>
                <strong className={clsx('hidden font-mono text-xs lg:block', low ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300')}>{current.toFixed(2)} <span className="text-[9px] text-koma-muted">{insumo.unidade_medida}</span></strong>
                <span className="hidden font-mono text-[10px] text-koma-secondary lg:block">{minimum.toFixed(2)} {insumo.unidade_medida}</span>
                <span className="hidden font-mono text-[10px] text-koma-secondary lg:block">{currency.format(Number(insumo.preco_medio_custo || 0))}</span>
                <div className="flex items-center justify-end gap-0.5">
                  <button type="button" onClick={() => onAdjust(insumo)} className="inline-flex min-h-8 items-center gap-1 rounded-lg px-2 text-[9px] font-bold text-koma-secondary hover:bg-koma-raised hover:text-koma-foreground"><SlidersHorizontal size={13} /> Ajustar</button>
                  <button type="button" onClick={() => onEdit(insumo)} className="rounded-lg p-2 text-koma-muted hover:bg-koma-raised hover:text-koma-foreground" aria-label={`Editar ${insumo.nome}`} title="Editar ingrediente"><Edit3 size={13} /></button>
                </div>
              </article>
            );
          })}
        </section>
      )}
    </div>
  );
}
