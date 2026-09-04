import { useCallback, useEffect, useState } from 'react';

export type CustomerSatisfactionSummary = {
  total_avaliacoes: number;
  nota_media: number | null;
  positivas: number;
  neutras: number;
  insatisfeitas: number;
};

export type CustomerSatisfactionReview = {
  id: string;
  cliente_id: string;
  cliente_nome: string;
  nota: number;
  classificacao: 'positiva' | 'neutra' | 'insatisfeita' | string;
  comentario?: string | null;
  criado_em: string;
  comanda_id?: string | null;
};

export type CustomerSatisfactionData = {
  resumo: CustomerSatisfactionSummary;
  recentes: CustomerSatisfactionReview[];
};

type Props = {
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
  enabled?: boolean;
};

const INITIAL_RESUMO: CustomerSatisfactionSummary = {
  total_avaliacoes: 0,
  nota_media: null,
  positivas: 0,
  neutras: 0,
  insatisfeitas: 0,
};

export function useCustomerSatisfaction({ apiBaseUrl, authHeaders, enabled = true }: Props) {
  const [data, setData] = useState<CustomerSatisfactionData>({
    resumo: INITIAL_RESUMO,
    recentes: [],
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshSatisfaction = useCallback(async () => {
    if (!enabled) return;
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(`${apiBaseUrl}/clientes/satisfacao`, {
        headers: authHeaders,
      });
      if (!response.ok) {
        throw new Error(`Falha ao carregar satisfação (${response.status})`);
      }
      const json = await response.json();
      if (json && typeof json === 'object') {
        setData({
          resumo: json.resumo || INITIAL_RESUMO,
          recentes: Array.isArray(json.recentes) ? json.recentes : [],
        });
      }
    } catch (err: any) {
      console.error('Error fetching customer satisfaction:', err);
      setError(err?.message || 'Erro ao carregar avaliações.');
    } finally {
      setIsLoading(false);
    }
  }, [apiBaseUrl, authHeaders, enabled]);

  const submitSatisfaction = async (input: {
    cliente_id: string;
    nota: number;
    comentario?: string;
    comanda_id?: string;
  }) => {
    try {
      const response = await fetch(`${apiBaseUrl}/clientes/satisfacao`, {
        method: 'POST',
        headers: {
          ...authHeaders,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        const errorJson = await response.json().catch(() => null);
        throw new Error(errorJson?.detail || `Falha ao registrar avaliação (${response.status})`);
      }
      await refreshSatisfaction();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Erro ao registrar avaliação.' };
    }
  };

  useEffect(() => {
    if (enabled) {
      void refreshSatisfaction();
    }
  }, [enabled, refreshSatisfaction]);

  return {
    data,
    isLoading,
    error,
    refreshSatisfaction,
    submitSatisfaction,
  };
}
