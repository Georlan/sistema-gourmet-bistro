import { API_BASE_URL } from './api';
import { SystemUser } from '../types';

const getAuthHeaders = (): Record<string, string> => {
  const token = localStorage.getItem('koma_caixa_token') || localStorage.getItem('token') || localStorage.getItem('koma_waiter_token');
  return token ? { 'Authorization': `Bearer ${token}` } : {};
};

export interface RefundOrigin {
  comanda_id: string;
  atendimento_id?: string | null;
  label: string;
  valor_original: number;
  valor_estornado: number;
  saldo_estornavel: number;
  bloqueado?: boolean;
  motivo_bloqueio?: string | null;
}

export interface RefundablePayment {
  id: string;
  comanda_id: string;
  turno_id: number;
  valor_original: number;
  saldo_estornavel: number;
  metodo_original: string;
  status: string;
  criado_em: string;
  origem: string;
  numero_pedido?: number | null;
  mesa_id?: number | null;
  origens_financeiras: RefundOrigin[];
  bloqueado?: boolean;
}

export interface RefundResult {
  id: string;
  pagamento_id: string;
  turno_id: number;
  usuario_id?: string | null;
  valor: number;
  metodo_original: string;
  metodo_devolucao: string;
  motivo: string;
  idempotency_key: string;
  criado_em: string;
  saldo_estornavel_pagamento: number;
  alocacoes: Array<{
    comanda_id: string;
    atendimento_id?: string | null;
    valor: number;
  }>;
}

export const getFuncionarios = async (): Promise<SystemUser[]> => {
  const res = await fetch(`${API_BASE_URL}/caixa/funcionarios`, {
    headers: getAuthHeaders()
  });
  if (!res.ok) {
    throw new Error('Falha ao buscar funcionários');
  }
  return res.json();
};

export const cadastrarFuncionario = async (payload: { nome: string; telefone: string; cargo: string }): Promise<SystemUser> => {
  const res = await fetch(`${API_BASE_URL}/caixa/funcionarios`, {
    method: 'POST',
    headers: {
      ...getAuthHeaders(),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.detail || 'Falha ao cadastrar funcionário');
  }
  return res.json();
};

export const imprimirComprovanteFechamento = async (turnoId: number): Promise<void> => {
  const res = await fetch(`${API_BASE_URL}/impressao/caixa/turnos/${turnoId}/comprovante`, {
    method: 'POST',
    headers: getAuthHeaders(),
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.detail || 'Falha ao enfileirar o comprovante de fechamento');
  }
};

export const listarPagamentosEstornaveis = async (): Promise<RefundablePayment[]> => {
  const res = await fetch(`${API_BASE_URL}/caixa/pagamentos/estornaveis?limite=50`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.detail || 'Falha ao carregar pagamentos estornáveis.');
  }
  return res.json();
};

export const estornarPagamento = async (
  pagamentoId: string,
  payload: {
    valor: number;
    motivo: string;
    idempotency_key: string;
    metodo_devolucao?: string;
    alocacoes?: Array<{ comanda_id: string; valor: number }>;
  },
): Promise<RefundResult> => {
  const res = await fetch(`${API_BASE_URL}/caixa/pagamentos/${encodeURIComponent(pagamentoId)}/estornar`, {
    method: 'POST',
    headers: {
      ...getAuthHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.detail || 'Falha ao registrar estorno.');
  }
  return res.json();
};

export const API = {
  getFuncionarios,
  cadastrarFuncionario,
  imprimirComprovanteFechamento,
  listarPagamentosEstornaveis,
  estornarPagamento,
};

export default API;
