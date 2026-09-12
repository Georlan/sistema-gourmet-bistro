import React, { useCallback, useEffect, useState } from 'react';
import { superAdminFetch } from './superAdminApi';
type Signup = { id: string; restaurant_name: string; responsible_name: string; email: string; phone: string; plan: string; billing_cycle: string; status: string; inactive: boolean; updated_at: string; protocol: string | null };
const labels: Record<string, string> = { started: 'Cadastro iniciado', payment_pending: 'Pagamento pendente', payment_failed: 'Pagamento recusado', awaiting_release: 'Aguardando liberação', activated: 'Acesso liberado' };
export function SuperAdminSignupsTab({ globalSearch }: { globalSearch: string }) {
  const [items, setItems] = useState<Signup[]>([]);
  const [deliveryFailures, setDeliveryFailures] = useState<{ id: string; status: string; attempts: number; last_error?: string }[]>([]);
  const [error, setError] = useState('');
  const [successNotice, setSuccessNotice] = useState('');
  const [releasingProtocol, setReleasingProtocol] = useState<string | null>(null);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await superAdminFetch('/api/super-admin/signups', { signal });
      if (!response.ok) throw new Error('Não foi possível carregar as inscrições.');
      const data = await response.json(); setItems(data.items); setError('');
      const deliveryResponse = await superAdminFetch('/api/super-admin/signups/deliveries', { signal });
      if (deliveryResponse.ok) { const deliveries = await deliveryResponse.json(); setDeliveryFailures(deliveries.items.filter((item: { status: string; last_error?: string }) => item.status === 'failed' || item.last_error)); }
    } catch (e) { if (!signal?.aborted) setError(e instanceof Error ? e.message : 'Falha ao carregar inscrições.'); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, []);
  useEffect(() => {
    const controller = new AbortController(); void load(controller.signal);
    const timer = window.setInterval(() => { if (!document.hidden) void load(controller.signal); }, 60000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [load]);
  const visible = items.filter(item => (filter === 'all' || (filter === 'inactive' ? item.inactive : item.status === filter)) && `${item.restaurant_name} ${item.responsible_name} ${item.email} ${item.phone}`.toLowerCase().includes(globalSearch.toLowerCase()));
  return <section className="rounded-xl border border-zinc-800 bg-koma-surface p-5 text-koma-foreground">
    <h2 className="text-xl font-bold">Inscrições</h2>
    <p className="my-2 text-sm text-koma-muted">Cadastros dos últimos 30 dias. Sem atividade há 24 horas indica possível desistência, não cancelamento.</p>
    <div className="my-4 flex gap-3"><select aria-label="Situação da inscrição" className="rounded bg-koma-page p-2" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">Todas</option><option value="inactive">Sem atividade há 24h</option>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><button onClick={() => void load()} className="rounded border border-zinc-700 px-3">Atualizar</button></div>
    {deliveryFailures.length > 0 && <details className="my-3 text-amber-400"><summary>{deliveryFailures.length} envios com falha ou aguardando nova tentativa</summary><p className="my-2 text-sm">Confira a configuração de e-mail e WhatsApp antes de tentar novamente.</p>{deliveryFailures.map(item => <div key={item.id} className="my-2 flex flex-wrap items-center gap-3 text-xs"><span>{item.id} · {item.attempts} tentativas · {item.last_error}</span><button className="rounded border px-2 py-1" onClick={async () => { try { const response = await superAdminFetch(`/api/super-admin/signups/deliveries/${encodeURIComponent(item.id)}/retry`, { method: 'POST' }); if (!response.ok) { const data = await response.json(); throw new Error(data.detail); } await load(); } catch (e) { setError(e instanceof Error ? e.message : 'Falha ao reagendar.'); } }}>Tentar novamente</button></div>)}</details>}
    {successNotice && <p className="my-2 rounded border border-emerald-800 bg-emerald-950/40 p-2 text-sm text-emerald-300" role="status">{successNotice}</p>}
    {error && <p role="alert" className="text-rose-400">{error}</p>}
    {loading ? <p>Carregando…</p> : <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{['Restaurante', 'Contato', 'Plano', 'Situação', 'Última atividade', 'Ações'].map(label => <th className="p-3" key={label}>{label}</th>)}</tr></thead><tbody>{visible.map(item => <tr key={item.id} className="border-t border-zinc-800"><td className="p-3">{item.restaurant_name}<small className="block text-koma-muted">{item.protocol || 'Antes do contrato'}</small></td><td className="p-3">{item.responsible_name}<br />{item.email}<br />{item.phone}</td><td className="p-3">{item.plan} · {item.billing_cycle}</td><td className="p-3">{labels[item.status]}{item.inactive && <small className="block text-amber-400">Sem atividade há 24h</small>}</td><td className="p-3">{new Date(item.updated_at).toLocaleString('pt-BR')}</td><td className="p-3">{item.status === 'awaiting_release' && item.protocol ? <button disabled={releasingProtocol === item.protocol} onClick={async () => { if (!item.protocol) return; setReleasingProtocol(item.protocol); setError(''); setSuccessNotice(''); try { const response = await superAdminFetch(`/api/super-admin/signups/${encodeURIComponent(item.protocol)}/release`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'Liberação manual de inscrição confirmada pelo SuperAdmin' }) }); const data = await response.json(); if (!response.ok) throw new Error(data.detail || 'Falha ao liberar inscrição.'); setSuccessNotice(`Inscrição ${item.protocol} liberada com sucesso! Restaurante #${data.restaurant_id} ativado com 7 dias grátis.`); await load(); } catch (err) { setError(err instanceof Error ? err.message : 'Falha ao liberar inscrição.'); } finally { setReleasingProtocol(null); } }} className="rounded bg-emerald-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50">{releasingProtocol === item.protocol ? 'Liberando…' : 'Liberar acesso'}</button> : item.status === 'activated' ? <span className="text-xs font-semibold text-emerald-400">Liberado</span> : <span className="text-xs text-zinc-500">—</span>}</td></tr>)}</tbody></table>{!visible.length && <p className="p-3">Nenhuma inscrição neste filtro.</p>}</div>}
  </section>;
}
