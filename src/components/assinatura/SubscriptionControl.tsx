import React, { useEffect, useState } from 'react';
import { API_BASE_URL } from '../../config/api';
import { getOperatorAccessToken } from '../../utils/authSession';

type Subscription = {
  status: string;
  billingCycle?: 'monthly' | 'annual' | 'mensal' | 'anual' | null;
  paymentMethodType?: 'credit_card' | 'pix' | 'account_money' | 'pix_automatic' | null;
  paidUntil: string | null;
  trialEndsAt: string | null;
  trialStartsAfterSetup?: boolean;
  canCancel: boolean;
};

type PixCharge = {
  status: string;
  amount?: string;
  dueAt?: string | null;
  qrCode?: string | null;
  qrCodeBase64?: string | null;
  ticketUrl?: string | null;
  expiresAt?: string | null;
  paidUntil?: string | null;
  message?: string;
};

export function SubscriptionControl({ accessToken }: { accessToken?: string }) {
  const token = accessToken || getOperatorAccessToken();
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [pixCharge, setPixCharge] = useState<PixCharge | null>(null);
  const [pixBusy, setPixBusy] = useState(false);
  const [pixCopied, setPixCopied] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  const loadPix = async () => {
    if (!token) return;
    setPixBusy(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/subscription/pix`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(typeof data?.detail === 'string' ? data.detail : 'Não foi possível gerar o Pix.');
      }
      setPixCharge(data);
      if (data?.status === 'approved' && data?.paidUntil) {
        setSubscription(previous => previous ? { ...previous, status: 'active', paidUntil: data.paidUntil } : previous);
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Não foi possível gerar o Pix.');
    } finally {
      setPixBusy(false);
    }
  };

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    fetch(`${API_BASE_URL}/api/subscription`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    })
      .then(async response => {
        if (!response.ok) return;
        const next = (await response.json()).subscription as Subscription | null;
        setSubscription(next);
        if (next?.paymentMethodType === 'pix' && next.status !== 'canceled') void loadPix();
      })
      .catch(() => { /* Other account controls remain available. */ });
    return () => controller.abort();
    // loadPix intentionally uses the same stable access token resolved above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const copyPix = async () => {
    if (!pixCharge?.qrCode) return;
    try {
      await navigator.clipboard.writeText(pixCharge.qrCode);
      setPixCopied(true);
      window.setTimeout(() => setPixCopied(false), 1500);
    } catch {
      setNotice('Não foi possível copiar automaticamente. Selecione o código Pix e copie manualmente.');
    }
  };

  const cancel = async () => {
    setBusy(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/subscription/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(typeof data.detail === 'string' ? data.detail : 'Não foi possível cancelar. Tente novamente.');
      }
      setSubscription(previous => previous ? { ...previous, status: 'canceled', canCancel: false } : null);
      setPixCharge(null);
      setConfirm(false);
      setNotice(data.message);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Não foi possível cancelar.');
    } finally {
      setBusy(false);
    }
  };

  if (!subscription) return null;

  const setupPending = Boolean(subscription.trialStartsAfterSetup);
  const isPix = subscription.paymentMethodType === 'pix';
  const isAnnualPix = isPix && ['annual', 'anual'].includes(String(subscription.billingCycle || '').toLowerCase());
  const isCanceled = subscription.status === 'canceled';
  const pixPeriodLabel = isAnnualPix ? 'anuidade' : 'mensalidade';
  const summary = isCanceled
    ? 'Renovação cancelada.'
    : setupPending
      ? 'Seus 7 dias grátis ainda não começaram.'
      : isPix
        ? isAnnualPix
          ? 'Pagamento anual por Pix.'
          : 'Pagamento mensal por Pix.'
        : subscription.canCancel
          ? 'Cobrança recorrente autorizada.'
          : 'Sem renovação automática.';

  return (
    <section className="my-5 rounded-xl border border-koma-border p-4 text-sm">
      <h2 className="font-bold">Sua assinatura</h2>
      <p className="my-2">
        {summary}{' '}
        {setupPending
          ? 'Conclua a configuração do restaurante. O período grátis só começa quando você clicar para iniciar a operação.'
          : subscription.paidUntil
            ? `Período vigente até ${new Date(subscription.paidUntil).toLocaleDateString('pt-BR')}.`
            : ''}
      </p>
      {setupPending && !isCanceled && (
        <p className="mb-3 text-xs text-koma-muted">
          Enquanto você configura dados, horários e cardápio, nenhum dia do trial é consumido e nenhuma cobrança Pix é criada.
        </p>
      )}

      {isPix && !isCanceled && (
        <p className="mb-3 text-xs text-koma-muted">
          {isAnnualPix
            ? 'No plano anual, um único Pix do valor anual é gerado depois dos 7 dias grátis e quita os próximos 12 meses.'
            : 'No plano mensal, cada vencimento gera um novo QR Code/Pix Copia e Cola.'}
        </p>
      )}

      {isPix && !isCanceled && pixCharge && (
        <div className="my-4 rounded-xl border border-koma-border p-4">
          {pixCharge.status === 'not_due' ? (
            <p>
              {pixCharge.message || 'Ainda não há Pix para pagar.'}
              {pixCharge.dueAt ? ` Próxima cobrança em ${new Date(pixCharge.dueAt).toLocaleDateString('pt-BR')}.` : ''}
            </p>
          ) : pixCharge.status === 'approved' ? (
            <p>Pix confirmado. {isAnnualPix ? 'Os próximos 12 meses estão quitados.' : 'Seu período mensal pago foi atualizado.'}</p>
          ) : (
            <div className="space-y-3">
              <div>
                <strong>Pix da {pixPeriodLabel}</strong>
                {pixCharge.amount && <p>Valor: R$ {pixCharge.amount.replace('.', ',')}</p>}
                <p className="text-xs text-koma-muted">Leia com qualquer banco/PSP compatível com Pix ou use o Copia e Cola.</p>
                {isAnnualPix && <p className="text-xs text-koma-muted">Após a confirmação, este pagamento cobre 12 meses de assinatura.</p>}
              </div>
              {pixCharge.qrCodeBase64 && (
                <img
                  src={`data:image/png;base64,${pixCharge.qrCodeBase64}`}
                  alt={`QR Code Pix da ${pixPeriodLabel} KÔMA`}
                  className="h-52 w-52 rounded-lg bg-white p-2"
                />
              )}
              {pixCharge.qrCode && (
                <div>
                  <textarea
                    readOnly
                    value={pixCharge.qrCode}
                    aria-label="Pix Copia e Cola"
                    className="min-h-24 w-full rounded border border-koma-border bg-transparent p-2 text-xs"
                  />
                  <button type="button" className="mt-2 underline" onClick={() => void copyPix()}>
                    {pixCopied ? 'Código Pix copiado' : 'Copiar Pix Copia e Cola'}
                  </button>
                </div>
              )}
              {pixCharge.expiresAt && <p className="text-xs text-koma-muted">Este QR expira em {new Date(pixCharge.expiresAt).toLocaleString('pt-BR')}.</p>}
              {pixCharge.ticketUrl && <a className="underline" href={pixCharge.ticketUrl} target="_blank" rel="noreferrer">Abrir instruções do Pix</a>}
            </div>
          )}
        </div>
      )}

      {isPix && !isCanceled && !setupPending && (!pixCharge || (pixCharge.status !== 'pending' && pixCharge.status !== 'in_process')) && (
        <button className="mb-3 underline" disabled={pixBusy} onClick={() => void loadPix()}>
          {pixBusy ? 'Verificando Pix…' : 'Atualizar cobrança Pix'}
        </button>
      )}

      {subscription.canCancel && (!confirm ? (
        <button className="underline" onClick={() => setConfirm(true)}>Cancelar renovação</button>
      ) : (
        <div>
          <p>
            Confirme para interromper as próximas cobranças.
            {setupPending
              ? ' Como o trial ainda não começou, nenhum dia grátis será perdido.'
              : ' O acesso permanece até o fim do período vigente. Isso não solicita reembolso de cobranças anteriores.'}
          </p>
          <button
            className="mt-2 rounded border border-koma-border px-3 py-2"
            disabled={busy}
            onClick={() => void cancel()}
          >
            {busy ? 'Cancelando…' : 'Confirmar cancelamento'}
          </button>
          <button className="ml-3" disabled={busy} onClick={() => setConfirm(false)}>Manter assinatura</button>
        </div>
      ))}
      {notice && <p role="status" className="mt-2">{notice}</p>}
    </section>
  );
}