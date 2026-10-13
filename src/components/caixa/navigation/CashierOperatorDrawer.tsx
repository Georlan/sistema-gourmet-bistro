import clsx from 'clsx';
import './cashierOptions.css';
import { Bell, RefreshCw, SlidersHorizontal, Volume2, VolumeX, X } from 'lucide-react';
import React, { useEffect, useId, useRef, useState } from 'react';
import { persistKomaTheme } from '../../../config/theme';
import { LoginButton } from '../../auth/LoginButton';
import type { CaixaPanelProps, CashierNotice } from '../cashierContracts';
import type { useCashierAlerts } from '../realtime/useCashierAlerts';
import type { useCashierPreferences } from './useCashierPreferences';

type BoundaryProps = Pick<ReturnType<typeof useCashierPreferences>, 'changeFontSize' | 'fontSize' | 'theme'> &
  Pick<ReturnType<typeof useCashierAlerts>, 'soundEnabled' | 'audioReady' | 'toggleSound' | 'activateAudio'> &
  Pick<CaixaPanelProps, 'activeWaiterNome' | 'onRefreshOrders'> & {
    isOperatorDrawerOpen: boolean;
    setIsOperatorDrawerOpen: React.Dispatch<React.SetStateAction<boolean>>;
    handleLogoutOperator: () => void;
    showToast: CashierNotice;
  };

/** Local preferences and session actions; no duplicated salon projection. */
export function CashierOperatorDrawer({
  isOperatorDrawerOpen, setIsOperatorDrawerOpen, activeWaiterNome, handleLogoutOperator,
  onRefreshOrders, showToast, changeFontSize, fontSize, theme,
  soundEnabled, toggleSound, audioReady, activateAudio,
}: BoundaryProps) {
  const [syncing, setSyncing] = useState(false);
  const [testingSound, setTestingSound] = useState(false);
  const [feedback, setFeedback] = useState('');
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
      dialog?.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected && previousFocus !== document.body) previousFocus.focus();
      else document.getElementById('btn-mobile-caixa-sidebar-open')?.focus();
    };
  }, [isOperatorDrawerOpen]);

  const controlClass = 'min-h-11 min-w-0 rounded-xl border px-2 py-2 text-sm font-semibold whitespace-normal break-words leading-snug transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500';
  const close = () => setIsOperatorDrawerOpen(false);

  if (!isOperatorDrawerOpen) return null;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={(event) => { event.preventDefault(); close(); }}
      className="fixed inset-0 m-0 h-dvh max-h-none w-full max-w-none border-0 bg-transparent p-0 text-koma-foreground backdrop:bg-black/60"
    >
      <div className="absolute inset-0" aria-hidden="true" onClick={close} />
      <section className="cashier-options relative flex h-full w-full max-w-sm flex-col border-r border-koma-border bg-koma-panel shadow-2xl">
        <header className="flex shrink-0 items-center gap-3 border-b border-koma-border px-4 py-3">
          <SlidersHorizontal size={20} className="shrink-0 text-koma-accent" aria-hidden="true" />
          <h2 id={titleId} className="min-w-0 flex-1 text-base font-bold leading-snug">Conta e preferências</h2>
          <button type="button" autoFocus onClick={close} aria-label="Fechar preferências" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-koma-secondary hover:bg-koma-raised">
            <X size={20} />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain p-4">
          <section aria-label="Operador atual" className="space-y-3">
            <div className="flex items-start gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-koma-raised text-lg font-bold text-koma-accent" aria-hidden="true">
                {activeWaiterNome?.trim().charAt(0).toUpperCase() || 'K'}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-koma-muted">Operador atual</p>
                <p className="break-words text-base font-semibold leading-snug">{activeWaiterNome || 'Operador'}</p>
              </div>
            </div>
            <LoginButton onClick={handleLogoutOperator} className="min-h-11 w-full whitespace-normal text-sm tracking-normal">
              Sair / trocar operador
            </LoginButton>
          </section>

          <fieldset className="min-w-0 space-y-2 border-0 p-0">
            <legend className="mb-2 text-sm font-semibold">Tamanho do texto</legend>
            <div className="grid grid-cols-3 gap-2">
              {(['padrao', 'grande', 'gigante'] as const).map(size => (
                <button key={size} type="button" aria-pressed={fontSize === size} onClick={() => changeFontSize(size)} className={clsx(controlClass,
                  fontSize === size ? 'border-emerald-500 bg-emerald-500 text-zinc-950' : 'border-koma-border bg-koma-raised text-koma-foreground')}
                >{size === 'padrao' ? 'Padrão' : size === 'grande' ? 'Grande' : 'Gigante'}</button>
              ))}
            </div>
          </fieldset>

          <fieldset className="min-w-0 space-y-2 border-0 p-0">
            <legend className="mb-2 text-sm font-semibold">Tema</legend>
            <div className="grid grid-cols-2 gap-2">
              {(['light', 'dark'] as const).map(value => (
                <button key={value} type="button" aria-pressed={theme === value} onClick={() => persistKomaTheme(value)} className={clsx(controlClass,
                  theme === value ? 'border-emerald-500 bg-emerald-500 text-zinc-950' : 'border-koma-border bg-koma-raised text-koma-foreground')}
                >{value === 'light' ? 'Claro' : 'Escuro'}</button>
              ))}
            </div>
          </fieldset>

          <section aria-label="Sons dos pedidos" className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2 text-sm font-semibold">
                {soundEnabled ? <Volume2 size={18} className="shrink-0" /> : <VolumeX size={18} className="shrink-0" />}
                Sons dos pedidos
              </span>
              <button type="button" onClick={() => {
                if (soundEnabled && !audioReady) void activateAudio();
                else toggleSound();
              }} className={clsx(controlClass, 'border-koma-border bg-koma-raised text-koma-foreground')}>
                {soundEnabled ? (audioReady ? 'Silenciar' : 'Ativar som') : 'Ativar som'}
              </button>
            </div>
            <p className="text-xs leading-relaxed text-koma-muted">
              {soundEnabled && audioReady ? 'Som liberado neste navegador.' : soundEnabled ? 'Libere o áudio neste navegador para ouvir os avisos.' : 'Avisos sonoros desativados neste navegador.'}
            </p>
            <button type="button" disabled={testingSound} onClick={async () => {
              if (testingSound) return;
              setTestingSound(true);
              try {
                const ready = await activateAudio();
                const message = ready ? 'Teste enviado ao navegador. Confira se ouviu o bip neste computador.' : 'O navegador não liberou o áudio. Verifique as permissões de som deste site.';
                setFeedback(message);
                showToast(message, ready ? 'info' : 'error');
              } catch {
                setFeedback('Não foi possível testar o som. Tente novamente.');
                showToast('Não foi possível testar o som. Tente novamente.', 'error');
              } finally { setTestingSound(false); }
            }} className={clsx(controlClass, 'flex w-full items-center justify-center gap-2 border-koma-border bg-koma-raised text-koma-foreground disabled:opacity-50')}>
              <Bell size={16} className="shrink-0" />{testingSound ? 'Testando…' : 'Testar som'}
            </button>
          </section>

          {feedback && <p role="status" className="text-xs leading-relaxed text-koma-secondary">{feedback}</p>}

          <details className="border-t border-koma-border pt-3">
            <summary className="cursor-pointer py-2 text-sm font-semibold text-koma-secondary">Recuperação</summary>
            <p className="my-2 text-xs leading-relaxed text-koma-muted">Se a tela parecer desatualizada, consulte os pedidos novamente.</p>
            <button type="button" disabled={syncing} onClick={async () => {
              if (syncing) return;
              setSyncing(true);
              try { await onRefreshOrders(); showToast('Consulta de atualização concluída.', 'info'); }
              catch { showToast('Não foi possível atualizar os pedidos. Tente novamente.', 'error'); }
              finally { setSyncing(false); }
            }} className={clsx(controlClass, 'flex w-full items-center justify-center gap-2 border-koma-border bg-koma-raised text-koma-foreground disabled:opacity-50')}>
              <RefreshCw size={16} className={clsx('shrink-0', syncing && 'animate-spin')} />
              {syncing ? 'Atualizando pedidos…' : 'Atualizar pedidos'}
            </button>
          </details>
        </div>
      </section>
    </dialog>
  );
}
