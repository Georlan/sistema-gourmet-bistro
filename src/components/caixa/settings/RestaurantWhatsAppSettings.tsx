import { useCallback, useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { authFetch, authRequestErrorMessage } from '../../../utils/authRequest';

type Status = {
  state: 'not_configured' | 'registered' | 'waiting_qr' | 'connecting' | 'connected' | 'disconnected' | 'error';
  mode?: 'central' | 'individual';
  enabled: boolean;
  phone_ending: string | null;
};

const labels: Record<Status['state'], string> = {
  not_configured: 'Não configurado',
  registered: 'Cadastro recebido (envio ainda não habilitado)',
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
  const [recipientConsent, setRecipientConsent] = useState(false);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const response = await authFetch(`${apiBaseUrl}/caixa/configuracoes/whatsapp`, {
      headers: authHeaders, cache: 'no-store',
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || 'Não foi possível verificar a conexão.');
    setStatus(data as Status);
    if (data.state === 'connected') {
      setQrCode(null);
      setPairingCode(null);
    }
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
      const nextQr = typeof data.qr_code === 'string' ? data.qr_code : null;
      const nextPairing = typeof data.pairing_code === 'string' ? data.pairing_code : null;
      setQrCode(nextQr);
      setPairingCode(nextPairing);
      if (nextPairing) setQrCode(null);
      if (nextQr) setPairingCode(null);
      await refresh();
      setFeedback(
        name === 'recipient'
          ? 'Número cadastrado. As notificações centrais ainda aguardam liberação pela plataforma.'
          : name === 'recipient/remove'
            ? 'Número de recebimento removido.'
            : name === 'enable'
              ? 'Avisos ativados para este restaurante.'
          : name === 'disable'
            ? 'Avisos desativados.'
            : name === 'disconnect'
              ? 'WhatsApp desconectado.'
              : nextPairing
                ? 'Código gerado. Digite-o no WhatsApp deste mesmo celular.'
                : 'Conexão atualizada.',
      );
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

  if (status.mode === 'central') {
    const registered = status.state === 'registered';
    return <section className="mt-4 rounded-2xl border border-koma-border bg-koma-panel p-4 sm:p-5" aria-label="Avisos de pedidos pelo WhatsApp">
      <h3 className="text-sm font-black text-koma-foreground">Comandas pelo WhatsApp</h3>
      <p className="mt-2 text-xs leading-relaxed text-koma-muted">
        Cadastre o WhatsApp que receberá as comandas dos pedidos online. O KÔMA enviará os avisos pelo número oficial da plataforma:
        você não precisa vincular seu próprio WhatsApp por QR Code nem instalar outro aplicativo.
      </p>
      <p className="mt-3 text-xs text-koma-foreground" role="status">
        Estado: <strong>{registered ? (status.enabled ? 'Liberado para teste controlado' : 'Cadastrado — aguardando liberação') : 'Ainda não cadastrado'}</strong>
        {status.phone_ending ? ` · Destinatário final ${status.phone_ending}` : ''}
      </p>
      {!registered && <div className="mt-4 space-y-3">
        <label className="block text-xs font-semibold text-koma-foreground">Telefone que receberá as comandas (com DDD)
          <input type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)}
            className="mt-1 block w-full rounded-xl border border-koma-border bg-koma-raised px-3 py-2 text-sm"
            placeholder="(11) 99999-9999" />
        </label>
        <label className="flex items-start gap-2 text-xs leading-relaxed text-koma-muted">
          <input type="checkbox" className="mt-1" checked={recipientConsent} onChange={(event) => setRecipientConsent(event.target.checked)} />
          Confirmo que sou responsável por esse telefone ou tenho autorização do titular para receber apenas avisos operacionais dos pedidos deste restaurante.
        </label>
        <button type="button" disabled={busy || !recipientConsent || !phone.trim()}
          onClick={() => void action('recipient', { phone, confirm_receiving: true })}
          className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-black text-white disabled:opacity-50">
          Salvar telefone de recebimento
        </button>
      </div>}
      {registered && <div className="mt-4">
        {button('Remover telefone cadastrado', 'recipient/remove')}
      </div>}
      <p className="mt-3 text-[11px] leading-relaxed text-koma-muted">
        O cadastro por si só não ativa mensagens. O envio central está em homologação e será liberado de forma controlada.
        O Kanban do KÔMA continua recebendo todos os pedidos independentemente do WhatsApp.
      </p>
      {feedback && <p className="mt-3 text-xs text-koma-foreground" role="alert">{feedback}</p>}
    </section>;
  }

  return <section className="mt-4 rounded-2xl border border-koma-border bg-koma-panel p-4 sm:p-5" aria-label="WhatsApp operacional">
    <h3 className="text-sm font-black text-koma-foreground">WhatsApp operacional</h3>
    <p className="mt-1 text-xs text-koma-muted">Aviso opcional de novos pedidos online no WhatsApp deste restaurante. O pedido aparece no KÔMA mesmo sem WhatsApp.</p>
    <p className="mt-3 text-xs text-koma-foreground" role="status">Estado: <strong>{labels[status.state]}</strong>{status.phone_ending ? ` · número final ${status.phone_ending}` : ''} · avisos {status.enabled ? 'ativados' : 'desativados'}</p>
    {status.state === 'not_configured' && <div className="mt-3 space-y-3">
      <label className="block text-xs text-koma-foreground">Seu WhatsApp com DDD
        <input type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)}
          className="mt-1 block w-full rounded-xl border border-koma-border bg-koma-raised px-3 py-2 text-sm" placeholder="(11) 99999-9999" />
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => void action('configure', { phone, mode: 'pairing_code' })}
          className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-black text-white disabled:opacity-50">
          Conectar neste celular
        </button>
        {button('Usar QR Code', 'configure', { phone, mode: 'qr' })}
      </div>
      <p className="text-[11px] leading-relaxed text-koma-muted">
        Sem computador? Use o código de pareamento e faça tudo neste mesmo celular.
      </p>
    </div>}
    {pairingCode && <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
      <p className="text-xs font-bold text-koma-foreground">Código para conectar neste celular</p>
      <p className="mt-2 select-all font-mono text-3xl font-black tracking-[0.18em] text-emerald-600 dark:text-emerald-300">
        {pairingCode.replace(/(.{4})/g, '$1 ').trim()}
      </p>
      <ol className="mt-3 list-decimal space-y-1 pl-4 text-[11px] leading-relaxed text-koma-muted">
        <li>Abra o WhatsApp neste celular.</li>
        <li>Vá em Dispositivos conectados → Conectar dispositivo.</li>
        <li>Escolha Conectar com número de telefone.</li>
        <li>Digite o código acima e volte ao KÔMA para verificar a conexão.</li>
      </ol>
    </div>}
    {qrCode && <div className="mt-4 max-w-full rounded-xl bg-white p-4 text-slate-900">
      <QRCodeSVG value={qrCode} size={220} className="max-w-full" />
      <p className="mt-3 text-xs">No WhatsApp: Dispositivos conectados → Conectar dispositivo → escaneie o QR. Depois, verifique a conexão.</p>
    </div>}
    <div className="mt-4 flex flex-wrap gap-2">
      {status.state !== 'not_configured' && status.state !== 'connected' && button('Gerar código no celular', 'pairing-code')}
      {status.state !== 'not_configured' && status.state !== 'connected' && button('Mostrar novo QR', 'qr')}
      <button type="button" disabled={busy} onClick={() => void refresh().catch((error) => setFeedback(authRequestErrorMessage(error, 'Falha ao verificar conexão.')))} className="rounded-xl border border-koma-border px-3 py-2 text-xs font-bold text-koma-foreground disabled:opacity-50">Verificar conexão</button>
      {status.state === 'connected' && !status.enabled && button('Ativar avisos', 'enable')}
      {status.enabled && button('Desativar avisos', 'disable')}
      {status.state !== 'not_configured' && button('Desconectar', 'disconnect')}
    </div>
    <p className="mt-3 text-[11px] leading-relaxed text-koma-muted">
      O Kanban recebe o pedido imediatamente. O WhatsApp é apenas redundância e os avisos são espaçados em horários de pico para evitar rajadas automáticas.
    </p>
    {feedback && <p className="mt-3 text-xs text-koma-foreground" role="alert">{feedback}</p>}
  </section>;
}
