import './cashierOptions.css';
import { Bell, CircleHelp, RefreshCw, Volume2, VolumeX, X } from 'lucide-react';
import React, { useEffect, useId, useRef, useState } from 'react';
import { openCustomerSupport } from '../../app/customerSupportEvents';
import { LoginButton } from '../../auth/LoginButton';
import type { CaixaPanelProps, CashierNotice } from '../cashierContracts';
import type { useCashierAlerts } from '../realtime/useCashierAlerts';

type BoundaryProps = Pick<ReturnType<typeof useCashierAlerts>, 'soundEnabled' | 'audioReady' | 'toggleSound' | 'activateAudio'> &
  Pick<CaixaPanelProps, 'activeWaiterNome' | 'onRefreshOrders' | 'isWsConnected'> & {
    restaurantName: string;
    isOperatorDrawerOpen: boolean;
    setIsOperatorDrawerOpen: React.Dispatch<React.SetStateAction<boolean>>;
    handleLogoutOperator: () => void;
    showToast: CashierNotice;
  };

/** Session and browser controls only; operational owners keep their existing callbacks. */
export function CashierOperatorDrawer({
  isOperatorDrawerOpen, setIsOperatorDrawerOpen, activeWaiterNome, handleLogoutOperator,
  onRefreshOrders, restaurantName, isWsConnected,
  soundEnabled, toggleSound, audioReady, activateAudio,
}: BoundaryProps) {
  const [syncing, setSyncing] = useState(false);
  const [testingSound, setTestingSound] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [syncFeedback, setSyncFeedback] = useState('');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (!isOperatorDrawerOpen) return;
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      dialog?.close(); document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected && previousFocus !== document.body) previousFocus.focus();
      else document.getElementById('btn-mobile-caixa-sidebar-open')?.focus();
    };
  }, [isOperatorDrawerOpen]);
  const close = () => setIsOperatorDrawerOpen(false);
  if (!isOperatorDrawerOpen) return null;
  return <dialog ref={dialogRef} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); close(); }} className="cashier-account-dialog">
    <div className="cashier-account-backdrop" aria-hidden="true" onClick={close} />
    <section className="cashier-options">
      <header className="cashier-options__header">
        <div><h2 id={titleId}>Conta e preferências</h2><p>{restaurantName}</p></div>
        <button type="button" autoFocus onClick={close} aria-label="Fechar preferências" className="cashier-options__close"><X size={20} /></button>
      </header>
      <div className="cashier-options__body">
        <section className="cashier-options__identity" aria-label="Operador atual">
          <img src="/brand/cashier/operator-access-v1.svg" alt="" width="92" height="104" aria-hidden="true" />
          <div><span>Operador desta aba</span><strong>{activeWaiterNome || 'Operador'}</strong></div>
        </section>
        <section className="cashier-options__section" aria-label="Sons dos pedidos">
          <div className="cashier-options__section-heading"><span className="cashier-options__symbol" aria-hidden="true">{soundEnabled ? <Volume2 size={23} /> : <VolumeX size={23} />}</span><div><h3>Sons dos pedidos</h3><p>{soundEnabled ? audioReady ? 'Ativos neste navegador' : 'Aguardando liberação do navegador' : 'Silenciados neste navegador'}</p></div></div>
          <div className="cashier-options__sound-actions">
            <button type="button" role="switch" aria-checked={soundEnabled} aria-label="Sons dos pedidos" className="cashier-options__sound-switch" onClick={toggleSound}><span aria-hidden="true" /><strong>{soundEnabled ? 'Silenciar' : 'Ativar som'}</strong></button>
            <button type="button" disabled={testingSound} className="cashier-options__secondary" onClick={async () => {
              if (testingSound) return;
              setTestingSound(true);
              try {
                const ready = await activateAudio();
                setFeedback(ready ? 'Teste enviado ao navegador. Confira se ouviu o bip neste computador.' : 'O navegador não liberou o áudio. Verifique as permissões de som deste site.');
              } catch { setFeedback('Não foi possível testar o som. Tente novamente.'); }
              finally { setTestingSound(false); }
            }}><Bell size={16} />{testingSound ? 'Testando…' : 'Testar som'}</button>
          </div>
          {feedback && <p role="status" className="cashier-options__feedback">{feedback}</p>}
        </section>
        <section className="cashier-options__section" aria-label="Conexão dos pedidos">
          <div className="cashier-options__connection"><span className="cashier-options__connection-dot" data-connected={isWsConnected} aria-hidden="true" /><div><h3>Atualização dos pedidos</h3><p>{isWsConnected ? 'Conectado em tempo real' : 'Reconectando às atualizações'}</p></div></div>
          <button type="button" disabled={syncing} className="cashier-options__secondary" onClick={async () => {
            if (syncing) return;
            setSyncing(true);
            setSyncFeedback('');
            try { await onRefreshOrders(); setSyncFeedback('Consulta de atualização concluída.'); }
            catch { setSyncFeedback('Não foi possível atualizar os pedidos. Tente novamente.'); }
            finally { setSyncing(false); }
          }}><RefreshCw size={16} className={syncing ? 'animate-spin' : ''} />{syncing ? 'Atualizando pedidos…' : 'Atualizar pedidos'}</button>
          {syncFeedback && <p role="status" className="cashier-options__feedback">{syncFeedback}</p>}
        </section>
        <button type="button" className="cashier-options__help" onClick={() => { close(); openCustomerSupport(); }}><CircleHelp size={21} /><span>Ajuda e feedback</span><span aria-hidden="true">›</span></button>
      </div>
      <footer className="cashier-options__footer"><LoginButton onClick={handleLogoutOperator} className="cashier-options__logout">Sair / trocar operador</LoginButton></footer>
    </section>
  </dialog>;
}
