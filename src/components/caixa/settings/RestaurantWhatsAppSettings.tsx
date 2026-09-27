import { useCallback, useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { authFetch, authRequestErrorMessage } from '../../../utils/authRequest';

type Status = {
  state: 'not_configured' | 'waiting_qr' | 'connecting' | 'connected' | 'disconnected' | 'error';
  enabled: boolean;
  phone_ending: string | null;
};

const labels: Record<Status['state'], string> = {
  not_configured: 'Não configurado',
  waiting_qr: 'Aguardando QR',
  connecting: 'Conectando',
  connected: 'Conectado',
  disconnected: 'Desconectado',
  error: 'Erro',
};

export function RestaurantWhatsAppSettings({ apiBaseUrl, authHeaders }: {
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
}) {
  const [status, setStatus] = useState<Status>({ state: 'not_configured', enabled: false, phone_ending: null });
  const [phone, setPhone] = useState('');
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const response = await authFetch(`${apiBaseUrl}/caixa/configuracoes/whatsapp`, {
      headers: authHeaders, cache: 'no-store',
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || 'Não foi possível verificar a conexão.');
    setStatus(data as Status);
    if (data.state === 'connected') setQrCode(null);
  }, [apiBaseUrl, authHeaders]);

  useEffect(() => { void refresh().catch((error) => setFeedback(authRequestErrorMessage(error, 'Falha ao consultar WhatsApp.'))); }, [refresh]);

  async function action(name: string, body?: object) {
    setBusy(true);
    setFeedback(null);
    try {
      const response = await authFetch(`${apiBaseUrl}/caixa/configuracoes/whatsapp/${name}`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {}),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || 'Ação não concluída.');
      setQrCode(typeof data.qr_code === 'string' ? data.qr_code : null);
      await refresh();
      setFeedback(name === 'enable' ? 'Avisos ativados para este restaurante.' : name === 'disable' ? 'Avisos desativados.' : name === 'disconnect' ? 'WhatsApp desconectado.' : 'Conexão atualizada.');
    } catch (error) {
      setFeedback(authRequestErrorMessage(error, 'Não foi possível atualizar o WhatsApp.'));
    } finally {
      setBusy(false);
    }
  }

  const button = (label: string, name: string, body?: object) => (
    <button type="button" disabled={busy} onClick={() => void action(name, body)}
      className="rounded-xl border border-koma-border bg-koma-raised px-3 py-2 text-xs font-bold text-koma-foreground disabled:opacity-50">
      {label}
    </button>
  );

  return <section className="mt-4 rounded-2xl border border-koma-border bg-koma-panel p-4 sm:p-5" aria-label="WhatsApp operacional">
    <h3 className="text-sm font-black text-koma-foreground">WhatsApp operacional</h3>
    <p className="mt-1 text-xs text-koma-muted">Aviso opcional de novos pedidos online no WhatsApp deste restaurante. O pedido aparece no KÔMA mesmo sem WhatsApp.</p>
    <p className="mt-3 text-xs text-koma-foreground" role="status">Estado: <strong>{labels[status.state]}</strong>{status.phone_ending ? ` · número final ${status.phone_ending}` : ''} · avisos {status.enabled ? 'ativados' : 'desativados'}</p>
    {status.state === 'not_configured' && <div className="mt-3 flex flex-wrap items-end gap-2">
      <label className="text-xs text-koma-foreground">Seu WhatsApp com DDD
        <input type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)}
          className="mt-1 block w-full rounded-xl border border-koma-border bg-koma-raised px-3 py-2 text-sm" placeholder="(11) 99999-9999" />
      </label>
      {button('Configurar', 'configure', { phone })}
    </div>}
    {qrCode && <div className="mt-4 max-w-full rounded-xl bg-white p-4 text-slate-900">
      <QRCodeSVG value={qrCode} size={220} className="max-w-full" />
      <p className="mt-3 text-xs">No WhatsApp: Dispositivos conectados → Conectar dispositivo → escaneie o QR. Depois, verifique a conexão.</p>
    </div>}
    <div className="mt-4 flex flex-wrap gap-2">
      {status.state !== 'not_configured' && button('Mostrar novo QR', 'qr')}
      <button type="button" disabled={busy} onClick={() => void refresh().catch((error) => setFeedback(authRequestErrorMessage(error, 'Falha ao verificar conexão.')))} className="rounded-xl border border-koma-border px-3 py-2 text-xs font-bold text-koma-foreground disabled:opacity-50">Verificar conexão</button>
      {status.state === 'connected' && !status.enabled && button('Ativar avisos', 'enable')}
      {status.enabled && button('Desativar avisos', 'disable')}
      {status.state !== 'not_configured' && button('Desconectar', 'disconnect')}
    </div>
    {feedback && <p className="mt-3 text-xs text-koma-foreground" role="alert">{feedback}</p>}
  </section>;
}
