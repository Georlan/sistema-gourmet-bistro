import { useCallback, useEffect, useState } from 'react';
import { authFetch, authRequestErrorMessage } from '../../../utils/authRequest';

type Status = {
  state: 'not_configured' | 'registered' | 'waiting_qr' | 'connecting' | 'connected' | 'disconnected' | 'error';
  mode?: 'central' | 'individual';
  enabled: boolean;
  phone_ending: string | null;
};

export function RestaurantWhatsAppSettings({ apiBaseUrl, authHeaders }: {
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
}) {
  const [status, setStatus] = useState<Status>({ state: 'not_configured', enabled: false, phone_ending: null });
  const [phone, setPhone] = useState('');
  const [recipientConsent, setRecipientConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const response = await authFetch(`${apiBaseUrl}/caixa/configuracoes/whatsapp`, {
      headers: authHeaders, cache: 'no-store',
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || 'Não foi possível verificar a conexão.');
    setStatus(data as Status);

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
      await refresh();
      setFeedback(
        name === 'recipient'
          ? 'Número cadastrado. As notificações centrais ainda aguardam liberação pela plataforma.'
          : name === 'recipient/remove'
            ? 'Número de recebimento removido.'
            : 'Cadastro atualizado.',
      );
    } catch (error) {
      setFeedback(authRequestErrorMessage(error, 'Não foi possível atualizar o WhatsApp.'));
    } finally {
      setBusy(false);
    }
  }

    const registered = status.state === 'registered';
    return <section className="mt-4 rounded-2xl border border-koma-border bg-koma-panel p-4 sm:p-5" aria-label="Avisos de pedidos pelo WhatsApp">
      <h3 className="text-sm font-black text-koma-foreground">Comandas pelo WhatsApp</h3>
      <p className="mt-2 text-xs leading-relaxed text-koma-muted">
        Receba avisos de novos pedidos pelo número do KÔMA. Cadastre abaixo o telefone autorizado a recebê-los.
      </p>
      <p className="mt-3 text-xs text-koma-foreground" role="status">
        Estado: <strong>{registered ? (status.enabled ? 'Avisos liberados' : 'Cadastrado — aguardando liberação') : 'Ainda não cadastrado'}</strong>
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
        <button type="button" disabled={busy} onClick={() => void action('recipient/remove')}
          className="min-h-11 rounded-xl border border-koma-border px-3 py-2 text-xs font-bold text-koma-foreground disabled:opacity-50">
          Remover telefone cadastrado
        </button>
      </div>}
      <p className="mt-3 text-[11px] leading-relaxed text-koma-muted">
        O cadastro por si só não ativa mensagens. Sem cadastro e liberação, nenhum aviso é criado ou enviado.
        O Kanban do KÔMA continua recebendo todos os pedidos independentemente do WhatsApp.
      </p>
      {feedback && <p className="mt-3 text-xs text-koma-foreground" role="alert">{feedback}</p>}
    </section>;
}
