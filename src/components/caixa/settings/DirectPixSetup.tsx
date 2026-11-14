import { useEffect, useState } from 'react';
import { authFetch, authRequestErrorMessage } from '../../../utils/authRequest';

type Configuration = { available: boolean; enabled: boolean; key_type: string; pix_key: string; holder_name: string; city: string; commercial?: { plan: string; billing_cycle: string; billing_amount: string; marketplace_rate: string } | null; test_mode?: boolean };
type Props = { apiBaseUrl: string; authHeaders: Record<string, string>; onChanged: () => void };

/** Uses the existing server-side tenant, receiver and billing guards. */
export function DirectPixSetup({ apiBaseUrl, authHeaders, onChanged }: Props) {
  const [config, setConfig] = useState<Configuration | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const authorization = authHeaders.Authorization || authHeaders.authorization;
  useEffect(() => {
    const controller = new AbortController();
    setConfig(null); setLoading(true); setAccepted(false); setError(''); setMessage('');
    authFetch(`${apiBaseUrl}/payments/direct-pix/settings`, { headers: authHeaders, signal: controller.signal })
      .then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.detail || 'Não foi possível consultar o Pix próprio.'); return body as Configuration; })
      .then(body => { if (!controller.signal.aborted) setConfig(body); })
      .catch(err => { if (!controller.signal.aborted) setError(authRequestErrorMessage(err, 'Não foi possível consultar o Pix próprio.')); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [apiBaseUrl, authorization]);
  function change(key: 'key_type' | 'pix_key' | 'holder_name' | 'city', value: string) {
    setConfig(current => current ? { ...current, [key]: value } : current); setAccepted(false); setMessage('');
  }
  async function save(enabled: boolean) {
    if (!config || busy || !config.available || (enabled && !accepted)) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await authFetch(`${apiBaseUrl}/payments/direct-pix/settings`, { method: 'PUT', headers: { ...authHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled, key_type: config.key_type, pix_key: config.pix_key, holder_name: config.holder_name, city: config.city, accept_manual_confirmation_and_monthly_fees: accepted }) });
      const body = await response.json();
      if (!response.ok) throw new Error(typeof body.detail === 'string' ? body.detail : 'Não foi possível salvar o Pix próprio.');
      setConfig(current => ({ ...body, commercial: current?.commercial, test_mode: current?.test_mode }));
      setAccepted(false); setMessage(enabled ? 'Pix próprio ativo para novos pedidos.' : 'Pix próprio desativado para novos pedidos.'); onChanged();
    } catch (err) { setError(authRequestErrorMessage(err, 'Não foi possível salvar o Pix próprio.')); }
    finally { setBusy(false); }
  }
  return <section aria-labelledby="direct-pix-title" className="rounded-2xl border border-koma-border bg-koma-panel p-5">
    <h3 id="direct-pix-title" className="text-base font-bold text-koma-foreground">Pix com chave própria</h3>
    <p className="mt-2 text-sm text-koma-muted">O KÔMA gera o QR Code e o Pix Copia e Cola com o valor de cada pedido do Cardápio Online.</p>
    {loading && <p role="status" className="mt-3 text-sm text-koma-muted">Consultando…</p>}
    {config && !config.available && <p className="mt-3 text-sm text-koma-muted">Esta opção ainda não está disponível.</p>}
    {config?.available && <div className="mt-4 space-y-3">
      <p className="text-sm font-bold text-koma-foreground">{config.enabled ? 'Ativo' : 'Desativado'}</p>
      <label className="block text-sm text-koma-foreground">Tipo de chave<select aria-label="Tipo de chave Pix" value={config.key_type} onChange={e => change('key_type', e.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-koma-border bg-koma-page p-2"><option value="cpf">CPF</option><option value="cnpj">CNPJ</option><option value="phone">Telefone</option><option value="email">E-mail</option><option value="random">Chave aleatória</option></select></label>
      <label className="block text-sm text-koma-foreground">Chave Pix<input autoComplete="off" value={config.pix_key} onChange={e => change('pix_key', e.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-koma-border bg-koma-page p-2" /></label>
      <label className="block text-sm text-koma-foreground">Nome do recebedor<input maxLength={25} value={config.holder_name} onChange={e => change('holder_name', e.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-koma-border bg-koma-page p-2" /></label>
      <label className="block text-sm text-koma-foreground">Cidade do recebedor<input maxLength={15} value={config.city} onChange={e => change('city', e.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-koma-border bg-koma-page p-2" /></label>
      <p className="text-xs text-koma-muted">Um Pix já copiado pode ser pago mesmo após o cancelamento do pedido.</p>
      {config.commercial && <p className="text-xs text-koma-muted">Assinatura: {config.commercial.plan} · R$ {config.commercial.billing_amount}. As cobranças anteriores mantêm suas condições.</p>}
      {config.test_mode && <p className="text-xs text-koma-muted">Modo teste: Pix pagos transferem dinheiro real.</p>}
      <label className="flex min-h-11 items-start gap-2 text-sm text-koma-foreground"><input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} className="mt-1" />Vou conferir o crédito no banco antes de aprovar cada pagamento. Aceito as condições da assinatura e a substituição da conta de recebimento online para novos pedidos.</label>
      <div className="flex flex-wrap gap-2"><button type="button" onClick={() => void save(true)} disabled={busy || !accepted || !config.pix_key.trim() || !config.holder_name.trim() || !config.city.trim()} className="min-h-11 rounded-xl bg-emerald-700 px-4 text-sm font-bold text-white disabled:opacity-50">{busy ? 'Salvando…' : config.enabled ? 'Salvar chave' : 'Ativar Pix próprio'}</button>{config.enabled && <button type="button" disabled={busy} onClick={() => void save(false)} className="min-h-11 rounded-xl border border-koma-border px-4 text-sm text-koma-foreground disabled:opacity-50">Desativar</button>}</div>
    </div>}
    {message && <p role="status" className="mt-3 text-sm text-koma-foreground">{message}</p>}
    {error && <p role="alert" className="mt-3 text-sm text-koma-foreground">{error}</p>}
  </section>;
}
