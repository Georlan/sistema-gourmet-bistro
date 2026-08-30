import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { CaixaMovimentacao, CaixaTurno, FechamentoCaixaResult } from '../../../types';
import type { CaixaPanelProps, CashierNotice } from '../cashierContracts';

type Props = Pick<CaixaPanelProps, 'apiBaseUrl' | 'authHeaders' | 'onRefreshTurnoResumo'> & {
  showToast: CashierNotice;
  setErrorMsg: (value: string) => void;
  setIsLoading: (value: boolean) => void;
};

/** Owns shift state, effects and actions; composition supplies only cross-feature dependencies. */
export function useCashShift({
  apiBaseUrl,
  authHeaders,
  onRefreshTurnoResumo,
  showToast,
  setErrorMsg,
  setIsLoading,
}: Props) {
  // Turno & Sync state
  const [turno, setTurno] = useState<CaixaTurno | null>(null);

  // Modals state
  const [showAbrirModal, setShowAbrirModal] = useState(false);

  // Caixa Reorganization States
  const [caixaMovimentacoes, setCaixaMovimentacoes] = useState<CaixaMovimentacao[]>([]);

  const [isCaixaMovimentacoesLoading, setIsCaixaMovimentacoesLoading] = useState(false);

  const caixaMovimentacoesRequestRef = useRef(0);

  const [fechamentoResult, setFechamentoResult] = useState<FechamentoCaixaResult | null>(null);

  const [showSangriaModal, setShowSangriaModal] = useState<boolean>(false);

  const [showSuprimentoModal, setShowSuprimentoModal] = useState<boolean>(false);

  // Form states
  const [saldoInicial, setSaldoInicial] = useState<number | ''>(100);

  // Fetch current shift status
  const fetchTurno = async () => {
    try {
      setIsLoading(true);
      const res = await fetch(`${apiBaseUrl}/caixa/turno/atual`, {
        headers: authHeaders,
      });
      if (res.ok) {
        const data = await res.json();
        setTurno(data);
      }
    } catch (err) {
      console.error('Error fetching shift status', err);
    } finally {
      setIsLoading(false);
    }
  };

  // Caixa API Handlers
  const fetchTurnoResumo = onRefreshTurnoResumo;

  const fetchCaixaMovimentacoes = useCallback(async () => {
    const requestId = ++caixaMovimentacoesRequestRef.current;
    setIsCaixaMovimentacoesLoading(true);
    try {
      const res = await fetch(`${apiBaseUrl}/caixa/movimentacoes`, {
        headers: authHeaders,
      });
      if (!res.ok) throw new Error(`Falha ao consultar movimentações (${res.status})`);
      const data: CaixaMovimentacao[] = await res.json();
      if (requestId === caixaMovimentacoesRequestRef.current) {
        setCaixaMovimentacoes(data);
      }
    } catch (error) {
      if (requestId === caixaMovimentacoesRequestRef.current) {
        console.error('Erro ao buscar movimentações de caixa:', error);
      }
    } finally {
      if (requestId === caixaMovimentacoesRequestRef.current) {
        setIsCaixaMovimentacoesLoading(false);
      }
    }
  }, [apiBaseUrl, authHeaders]);

  useEffect(() => {
    const handleCashUpdated = () => {
      void fetchCaixaMovimentacoes();
    };
    window.addEventListener('koma_cash_updated', handleCashUpdated);
    return () => window.removeEventListener('koma_cash_updated', handleCashUpdated);
  }, [fetchCaixaMovimentacoes]);

  const handleRegistrarSangria = async (payload: { valor: number; motivo: string; observacao: string }) => {
    const res = await fetch(`${apiBaseUrl}/caixa/sangria`, {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Erro ao registrar sangria.');
    }
    showToast('Sangria registrada com sucesso!');
    await fetchTurnoResumo();
    await fetchCaixaMovimentacoes();
  };

  const handleRegistrarSuprimento = async (payload: { valor: number; motivo: string; observacao: string }) => {
    const res = await fetch(`${apiBaseUrl}/caixa/suprimento`, {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Erro ao registrar suprimento.');
    }
    showToast('Suprimento registrado com sucesso!');
    await fetchTurnoResumo();
    await fetchCaixaMovimentacoes();
  };

  const handleConfirmarFechamento = async (payload: {
    declarado_dinheiro: number;
    declarado_cartao: number;
    declarado_pix: number;
    observacao: string;
  }) => {
    const res = await fetch(`${apiBaseUrl}/caixa/fechamento`, {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Erro ao fechar caixa.');
    }
    const resultData = await res.json();
    setFechamentoResult(resultData);
    showToast('Turno de caixa encerrado com sucesso!');
    await fetchTurnoResumo();
  };

  // Handle open cashier
  const handleAbrirCaixa = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    try {
      const res = await fetch(`${apiBaseUrl}/caixa/turno/abrir`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ saldo_inicial: Number(saldoInicial || 0) }),
      });
      if (res.ok) {
        setShowAbrirModal(false);
        fetchTurno();
      } else {
        const data = await res.json();
        setErrorMsg(data.detail || 'Erro ao abrir caixa');
      }
    } catch (err) {
      setErrorMsg('Erro de conexão ao servidor.');
    }
  };

  return {
    turno,
    showAbrirModal,
    setShowAbrirModal,
    caixaMovimentacoes,
    isCaixaMovimentacoesLoading,
    fechamentoResult,
    setFechamentoResult,
    showSangriaModal,
    setShowSangriaModal,
    showSuprimentoModal,
    setShowSuprimentoModal,
    saldoInicial,
    setSaldoInicial,
    fetchTurno,
    fetchTurnoResumo,
    fetchCaixaMovimentacoes,
    handleRegistrarSangria,
    handleRegistrarSuprimento,
    handleConfirmarFechamento,
    handleAbrirCaixa,
  };
}
