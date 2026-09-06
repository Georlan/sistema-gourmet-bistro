import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import React from 'react';

type Props = {
  title: string;
  description: string;
  error?: string | null;
  errorDescription?: string;
  onRetry?: () => void;
  testId?: string;
  mode?: 'page' | 'section';
};

/**
 * Boundary visual para o primeiro snapshot autoritativo.
 *
 * Use somente quando UNKNOWN não pode ser tratado como EMPTY. Depois que um
 * snapshot válido existe, mantenha os últimos dados na tela durante refreshes
 * em vez de remontar este estado.
 */
export function KomaSnapshotLoading({
  title,
  description,
  error,
  errorDescription,
  onRetry,
  testId,
  mode = 'section',
}: Props) {
  const hasError = Boolean(error);
  return (
    <div
      data-testid={testId}
      role="status"
      aria-live="polite"
      className={[
        'flex w-full items-center justify-center px-6 text-koma-foreground',
        mode === 'page' ? 'min-h-dvh bg-koma-page py-16' : 'min-h-[45vh] py-12',
      ].join(' ')}
    >
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        {hasError ? (
          <AlertTriangle size={25} className="text-amber-600 dark:text-amber-300" aria-hidden="true" />
        ) : (
          <Loader2 size={25} className="animate-spin text-koma-accent" aria-hidden="true" />
        )}
        <p className="font-serif text-xl font-black tracking-[-0.03em]">{title}</p>
        <p className="text-xs leading-relaxed text-koma-muted">
          {hasError ? errorDescription || error : description}
        </p>
        {hasError && onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="koma-btn-secondary mt-1 inline-flex items-center gap-2 px-4 py-2 text-[10px] font-bold"
          >
            <RefreshCw size={13} aria-hidden="true" /> Tentar novamente
          </button>
        )}
      </div>
    </div>
  );
}
