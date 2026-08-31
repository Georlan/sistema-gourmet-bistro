import { Plus, Receipt } from 'lucide-react';
import { SharedTableCard } from '../../shared/SharedTableCard';
import type { SalonActions, SalonCard } from './cashierSalonContracts';

/** Overview only: context and secondary actions remain available in table details. */
export function CashierSalonCard({ card, actions }: { card: SalonCard; actions: SalonActions }) {
  const { table, tableOrders, isMerged, isOccupied, hasPendingPayment, operational } = card;
  const inspect = isOccupied && tableOrders.length > 0;
  const Icon = inspect ? Receipt : Plus;
  return (
    <SharedTableCard
      density="compact"
      table={table}
      orders={tableOrders}
      operational={operational}
      total={card.total}
      filterStatus={isMerged ? 'merged' : hasPendingPayment ? 'payment' : isOccupied ? 'occupied' : 'free'}
    >
      {!isMerged && (
        <div className="border-t border-koma-border pt-2">
          <button
            type="button"
            onClick={() => inspect ? actions.inspectTable(tableOrders) : actions.openTableOrder(table.id)}
            className={`flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg border border-current/20 px-2 text-xs font-bold transition-colors focus-visible:outline focus-visible:outline-2 ${isOccupied ? 'koma-table-occupied-action' : 'koma-table-free-action'}`}
          >
            <Icon size={13} aria-hidden="true" />
            {inspect ? 'Ver comanda' : isOccupied ? 'Adicionar consumo' : 'Abrir pedido'}
          </button>
        </div>
      )}
    </SharedTableCard>
  );
}
