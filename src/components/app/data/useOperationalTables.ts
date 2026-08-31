import React, { useRef, useState } from 'react';
import { API_BASE_URL } from '../../../config/api';
import { Table } from '../../../types';

import type {
  OperationalRequestContext,
  OperationalErrorSink,
  OperationalNotice,
} from '../operationalContracts';
type BoundaryProps = OperationalRequestContext & OperationalErrorSink & { showToast: OperationalNotice };

/** Owns the shared table snapshot, loading state and catalog mutations. Operational meanings are unchanged. */
export function useOperationalTables({
  setFetchError,
  getAuthHeaders,
  handleLogout,
  showToast,
}: BoundaryProps) {
  const [salonTables, setSalonTables] = useState<Table[]>([]);

  const fetchTablesAbortControllerRef = useRef<AbortController | null>(null);

  const fetchTables = async () => {
    if (fetchTablesAbortControllerRef.current) {
      fetchTablesAbortControllerRef.current.abort();
    }
    const controller = new AbortController();
    fetchTablesAbortControllerRef.current = controller;

    try {
      setFetchError(null);
      const res = await fetch(`${API_BASE_URL}/mesas/`, {
        headers: getAuthHeaders(),
        signal: controller.signal,
      });
      if (res.status === 401) {
        handleLogout();
        return;
      }
      if (res.ok) {
        const data = await res.json();
        setSalonTables(data);
        setIsTablesLoaded(true);
      } else {
        setFetchError(`Erro HTTP mesas ${res.status}: ${res.statusText}`);
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error('Error fetching tables', err);
        setFetchError(err.message || String(err));
      }
    }
  };

  const handleCreateMesa = async (id: number, capacidade: number, nome?: string) => {
    try {
      const res = await fetch(`${API_BASE_URL}/mesas/`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ id, capacidade, nome }),
      });
      if (res.ok) {
        await fetchTables();
      } else {
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.detail || res.statusText || 'Não foi possível criar a mesa.');
      }
    } catch (err: any) {
      console.error(err);
      showToast(`Erro ao criar mesa: ${err.message || 'falha de conexão'}`, 'error');
      throw err;
    }
  };

  const handleUpdateMesa = async (id: number, capacidade?: number, nome?: string) => {
    try {
      const res = await fetch(`${API_BASE_URL}/mesas/${id}`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ capacidade, nome }),
      });
      if (res.ok) {
        await fetchTables();
      } else {
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.detail || res.statusText || 'Não foi possível atualizar a mesa.');
      }
    } catch (err: any) {
      console.error(err);
      showToast(`Erro ao atualizar mesa: ${err.message || 'falha de conexão'}`, 'error');
      throw err;
    }
  };

  const handleDeleteMesa = async (id: number) => {
    try {
      const res = await fetch(`${API_BASE_URL}/mesas/${id}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        await fetchTables();
      } else {
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.detail || res.statusText || 'Não foi possível excluir a mesa.');
      }
    } catch (err: any) {
      console.error(err);
      showToast(`Erro ao excluir mesa: ${err.message || 'falha de conexão'}`, 'error');
      throw err;
    }
  };

  const [isTablesLoaded, setIsTablesLoaded] = useState(false);
  return {
    salonTables,
    setSalonTables,
    fetchTables,
    handleCreateMesa,
    handleUpdateMesa,
    handleDeleteMesa,
    isTablesLoaded,
  };
}
