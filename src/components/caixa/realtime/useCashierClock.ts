import { useEffect, useState } from 'react';

/** Owns clock state, effects and actions; composition supplies only cross-feature dependencies. */
export function useCashierClock() {
  // ============================================================================
  // ⚡ FILTRAGEM DINÂMICA DAS COMANDAS DE MESA PARA O KANBAN
  // ============================================================================

  // Col 1 — somente pedidos vinculados a uma mesa física, lançados pelo garçom ou caixa.
  const [nowTimestamp, setNowTimestamp] = useState<number>(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => {
      setNowTimestamp(Date.now());
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const handleOrdersUpdated = () => {
      setNowTimestamp(Date.now());
    };
    window.addEventListener('koma_orders_updated', handleOrdersUpdated);
    return () => {
      window.removeEventListener('koma_orders_updated', handleOrdersUpdated);
    };
  }, []);

  return { nowTimestamp };
}
