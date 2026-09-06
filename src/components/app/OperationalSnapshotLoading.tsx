import React from 'react';
import { Loader2 } from 'lucide-react';

export function OperationalSnapshotLoading({ error }: { error?: string | null }) {
  return (
    <main
      data-testid="operational-snapshot-loading"
      aria-live="polite"
      className="flex min-h-[55vh] w-full items-center justify-center px-6 py-16 text-koma-foreground"
    >
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <Loader2 size={24} className="animate-spin text-koma-accent" aria-hidden="true" />
        <p className="font-serif text-xl font-black tracking-[-0.03em]">Sincronizando operação</p>
        <p className="text-xs leading-relaxed text-koma-muted">
          {error
            ? 'Ainda não foi possível obter um snapshot operacional válido. O KÔMA tentará novamente sem assumir mesas livres ou pedidos vazios.'
            : 'Carregando o estado real de mesas e comandas antes de liberar a operação.'}
        </p>
      </div>
    </main>
  );
}
