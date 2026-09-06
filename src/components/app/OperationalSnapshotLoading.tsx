import React from 'react';
import { KomaSnapshotLoading } from '../shared/KomaSnapshotLoading';

export function OperationalSnapshotLoading({ error }: { error?: string | null }) {
  return (
    <KomaSnapshotLoading
      testId="operational-snapshot-loading"
      title="Sincronizando operação"
      description="Carregando o estado real de mesas e comandas antes de liberar a operação."
      error={error}
      errorDescription="Ainda não foi possível obter um snapshot operacional válido. O KÔMA tentará novamente sem assumir mesas livres ou pedidos vazios."
    />
  );
}
