import { useEffect, useState } from 'react';
import type { LoyaltyCustomer } from '../cashierContracts';

type Props = {
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
};

export function useCashierCustomers({ apiBaseUrl, authHeaders }: Props) {
  const [loyaltyUsers, setLoyaltyUsers] = useState<LoyaltyCustomer[]>([]);

  const refreshLoyaltyUsers = async () => {
    try {
      // O backend aplica autenticação, tenant e RLS antes de devolver as fichas.
      const response = await fetch(`${apiBaseUrl}/fidelidade/clientes`, {
        headers: authHeaders,
      });
      if (!response.ok) {
        throw new Error(`Falha ao carregar clientes (${response.status})`);
      }
      const clientes = await response.json();
      if (Array.isArray(clientes)) {
        const mapped: LoyaltyCustomer[] = clientes.map((c: any) => ({
          id: String(c.id || c.telefone),
          cliente: c.nome || c.cliente || 'Cliente',
          nome: c.nome || c.cliente || 'Cliente',
          telefone: c.telefone || '',
          endereco: c.endereco || '',
          pontos: Number(c.saldo_pontos || 0),
          saldo_pontos: Number(c.saldo_pontos || 0),
          saldoCashback: Number(c.saldo_cashback || 0),
          saldo_cashback: Number(c.saldo_cashback || 0),
          historico: c.historico || [],
          pedidos_concluidos: typeof c.pedidos_concluidos === 'number' ? c.pedidos_concluidos : 0,
          valor_pago_total: typeof c.valor_pago_total === 'number' ? c.valor_pago_total : 0,
          ticket_medio_pago: typeof c.ticket_medio_pago === 'number' ? c.ticket_medio_pago : 0,
          ultima_compra_em: c.ultima_compra_em ?? null,
          dias_sem_comprar: typeof c.dias_sem_comprar === 'number' ? c.dias_sem_comprar : null,
          segmento_relacionamento: c.segmento_relacionamento || 'SEM_COMPRA',
        }));
        setLoyaltyUsers(mapped);
        return;
      }
    } catch (error) {
      console.error('Error fetching loyalty clients from API:', error);
    }
  };

  useEffect(() => {
    // 1. Carga inicial dos clientes
    void refreshLoyaltyUsers();

    const handleCustomerEvent = () => {
      void refreshLoyaltyUsers();
    };
    window.addEventListener('koma_customers_updated', handleCustomerEvent);
    window.addEventListener('storage', handleCustomerEvent);

    return () => {
      window.removeEventListener('koma_customers_updated', handleCustomerEvent);
      window.removeEventListener('storage', handleCustomerEvent);
    };
  }, [apiBaseUrl]);

  return { loyaltyUsers, refreshLoyaltyUsers };
}
