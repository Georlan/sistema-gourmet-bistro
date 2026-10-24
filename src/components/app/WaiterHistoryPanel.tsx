import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ChevronRight, X } from 'lucide-react';
import { API_BASE_URL } from '../../config/api';
import { formatBackendTime } from '../../utils/dateTime';

type Entry = { id: string; pedido: string | null; mesa_id: number; mesa_nome: string; horario: string; itens_count: number };
type HistoryItem = { id: string; nome: string; preco: number; cliente: string; observacao: string; status: string; modificadores: Array<{ nome: string; preco: number }> };
type Detail = Entry & { itens: HistoryItem[] };
const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Fortaleza' }).format(new Date());
const money = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function WaiterHistoryPanel({ getAuthHeaders, onClose }: { getAuthHeaders: () => Record<string, string>; onClose: () => void }) {
  const [day, setDay] = useState(today);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const hasMorePage = useRef(false);
  const listRequest = useRef<AbortController | null>(null);
  const loadRef = useRef<(after?: string) => Promise<void>>(async () => {});
  const backRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';backRef.current?.focus();
    return () => { document.body.style.overflow = overflow;if (previous?.isConnected) previous.focus();else document.getElementById('open-sidebar-btn')?.focus(); };
  }, []);

  useEffect(() => {
    hasMorePage.current = false;setEntries([]);setCursor(null);setSelected(null);setDetail(null);
    const load = async (after?: string) => {
      listRequest.current?.abort();const controller = new AbortController();listRequest.current = controller;
      setLoading(true);setError('');
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        const params = new URLSearchParams({ dia: day });if (after) params.set('antes', after);
        const response = await fetch(`${API_BASE_URL}/garcom/historico?${params}`, { headers: getAuthHeaders(), signal: controller.signal });
        if (!response.ok) throw new Error();
        const data = await response.json();if (controller.signal.aborted) return;
        setEntries(current => {
          const rows: Entry[] = [...current, ...data.items];
          return [...new Map(rows.map(entry => [entry.id, entry])).values()].sort((a, b) => b.horario.localeCompare(a.horario) || b.id.localeCompare(a.id));
        });
        if (after || !hasMorePage.current) setCursor(data.next_cursor);
        if (after) hasMorePage.current = true;
      } catch {
        if (listRequest.current === controller) setError('Não foi possível carregar o histórico.');
      } finally {
        clearTimeout(timer);if (listRequest.current === controller) setLoading(false);
      }
    };
    loadRef.current = load;void load();
    const refresh = () => { void load();setRevision(value => value + 1); };
    window.addEventListener('koma_orders_updated', refresh);
    return () => { listRequest.current?.abort();window.removeEventListener('koma_orders_updated', refresh); };
  }, [day, getAuthHeaders]);

  useEffect(() => {
    if (!selected) { setDetail(null);return; }
    const controller = new AbortController();setError('');
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true;controller.abort(); }, 8000);
    fetch(`${API_BASE_URL}/garcom/historico/${encodeURIComponent(selected)}`, { headers: getAuthHeaders(), signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error();return response.json(); })
      .then(data => { if (!controller.signal.aborted) setDetail(data); })
      .catch(() => { if (!controller.signal.aborted || timedOut) setError('Não foi possível carregar este pedido.'); })
      .finally(() => clearTimeout(timer));
    return () => { clearTimeout(timer);controller.abort(); };
  }, [selected, revision, getAuthHeaders]);

  return <div className="kw-history-overlay" role="dialog" aria-modal="true" aria-label="Meu histórico"
    onKeyDown={event => {
      if (event.key === 'Escape') { if (selected) setSelected(null);else onClose(); }
      if (event.key === 'Tab') {
        const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input')].filter(node => node.getClientRects().length > 0);
        const first=controls[0],last=controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault();last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault();first?.focus(); }
      }
    }}>
    <button className="kw-history-backdrop" tabIndex={-1} aria-label="Fechar histórico" onClick={onClose} />
    <section className="kw-history-panel">
      <header className="kw-history-header"><button ref={backRef} className="kw-icon-button" aria-label={selected ? 'Voltar ao histórico' : 'Voltar ao salão'} onClick={() => selected ? setSelected(null) : onClose()}><ArrowLeft size={18} /></button>
        <h2>{selected ? detail?.pedido ? `Pedido ${detail.pedido}` : 'Detalhes do pedido' : 'Meu histórico'}</h2>
        <button className="kw-icon-button" aria-label="Fechar" onClick={onClose}><X size={18} /></button>
      </header>
      <div className="kw-history-body">
        {!selected && <label className="kw-history-date"><span>{day === today() ? 'Hoje' : 'Data'}</span><input aria-label="Data do histórico" type="date" value={day} max={today()} onChange={event => { if (event.target.value) setDay(event.target.value); }} /></label>}
        {error && <p role="alert">{error} <button onClick={() => selected ? setRevision(value => value + 1) : void loadRef.current()}>Tentar novamente</button></p>}
        {selected ? detail ? <div className="kw-history-detail">
          <div className="kw-history-context"><strong>{detail.mesa_nome}</strong><time>{formatBackendTime(detail.horario)}</time></div>
          {detail.itens.map(item => <article key={item.id} className="kw-history-item"><div><strong>{item.nome}</strong><span>{money(item.preco)}</span></div>
            {item.cliente && item.cliente.toLocaleLowerCase('pt-BR') !== 'consumo geral' && <p>{item.cliente}</p>}
            {item.modificadores.length > 0 && <p>{item.modificadores.map(modifier => modifier.nome).join(' · ')}</p>}
            {item.observacao && <p>{item.observacao}</p>}
            {item.status === 'cancelado' && <p className="text-rose-400">Cancelado</p>}
          </article>)}
          <div className="kw-history-total"><span>Total dos itens ativos</span><strong>{money(detail.itens.filter(item => item.status !== 'cancelado').reduce((sum, item) => sum + item.preco, 0))}</strong></div>
        </div> : !error && <p role="status">Carregando pedido…</p> : <>
          {entries.map(entry => <button id={`history-entry-${entry.id}`} key={entry.id} className="kw-history-entry" onClick={() => { setDetail(null);setSelected(entry.id); }}>
            <time>{formatBackendTime(entry.horario)}</time><span><strong>{entry.mesa_nome}</strong><span>{entry.pedido ? `Pedido ${entry.pedido}` : 'Pedido sem número'} · {entry.itens_count} {entry.itens_count === 1 ? 'item' : 'itens'}</span></span><ChevronRight size={17} />
          </button>)}
          {loading && <p role="status">Carregando histórico…</p>}
          {!loading && !error && entries.length === 0 && <p>Nenhum pedido seu nesta data.</p>}
          {cursor && <button className="kw-history-more" disabled={loading} onClick={() => void loadRef.current(cursor)}>Ver mais</button>}
        </>}
      </div>
    </section>
  </div>;
}
