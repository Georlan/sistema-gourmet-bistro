import { API_BASE_URL } from './api';
import { SystemUser } from '../types';

const getAuthHeaders = (): Record<string, string> => {
  const token = localStorage.getItem('token');
  return token ? { 'Authorization': `Bearer ${token}` } : {};
};

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

export const API = {
  getFuncionarios,
  cadastrarFuncionario
};

export default API;
