import React, { useCallback, useEffect, useState } from 'react';
import { superAdminFetch } from './superAdminApi';
type Signup = { id: string; restaurant_name: string; responsible_name: string; email: string; phone: string; plan: string; billing_cycle: string; status: string; inactive: boolean; updated_at: string; protocol: string | null };
const labels: Record<string, string> = { started: 'Cadastro iniciado', payment_pending: 'Pagamento pendente', payment_failed: 'Pagamento recusado', activated: 'Acesso liberado' };
export function SuperAdminSignupsTab({ globalSearch }: { globalSearch: string }) {
  const [items, setItems] = useState<Signup[]>([]);
  const [deliveryFailures, setDeliveryFailures] = useState<{ id: string; status: string; attempts: number; last_error?: string }[]>([]);
  const [error, setError] = useState('');
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
    {error && <p role="alert">{error}</p>}
    {loading ? <p>Carregando…</p> : <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{['Restaurante', 'Contato', 'Plano', 'Situação', 'Última atividade'].map(label => <th className="p-3" key={label}>{label}</th>)}</tr></thead><tbody>{visible.map(item => <tr key={item.id} className="border-t border-zinc-800"><td className="p-3">{item.restaurant_name}<small className="block text-koma-muted">{item.protocol || 'Antes do contrato'}</small></td><td className="p-3">{item.responsible_name}<br />{item.email}<br />{item.phone}</td><td className="p-3">{item.plan} · {item.billing_cycle}</td><td className="p-3">{labels[item.status]}{item.inactive && <small className="block text-amber-400">Sem atividade há 24h</small>}</td><td className="p-3">{new Date(item.updated_at).toLocaleString('pt-BR')}</td></tr>)}</tbody></table>{!visible.length && <p className="p-3">Nenhuma inscrição neste filtro.</p>}</div>}
  </section>;
}
