import { ArrowUpRight, CreditCard, Plus, Receipt } from "lucide-react";
import { SharedTableCard } from "../../shared/SharedTableCard";
import { TableOrderContext } from "../../shared/TableOrderContext";
import type { SalonActions, SalonCard } from "./cashierSalonContracts";

/** Cashier-specific capabilities compose shared table facts; waiter navigation stays separate. */
export function CashierSalonCard({
  card,
  actions,
}: {
  card: SalonCard;
  actions: SalonActions;
}) {
  const {
    table,
    displayMesaId,
    tableOrders,
    isMerged,
    isOccupied,
    hasPendingPayment,
    operational,
  } = card;
  const origin = tableOrders.find(
    (order) => order.mesaOrigemId && order.mesaOrigemId !== displayMesaId,
  )?.mesaOrigemId;
  const transferred = tableOrders.find(
    (order) =>
      order.mesaTransferidaDe && order.mesaTransferidaDe !== displayMesaId,
  )?.mesaTransferidaDe;
  const hasChecks = tableOrders.length > 0;
  const buttons = isOccupied
    ? [
        {
          label: "Ver comanda",
          icon: Receipt,
          run: () => actions.inspectTable(tableOrders),
          disabled: !hasChecks,
        },
        {
          label: "Adicionar consumo",
          icon: Plus,
          run: () => actions.openTableOrder(table.id),
          disabled: false,
        },
        {
          label: "Receber",
          icon: CreditCard,
          run: () => actions.receiveTable(tableOrders),
          disabled: !hasChecks,
        },
        {
          label: "Transferir…",
          icon: ArrowUpRight,
          run: () => actions.prepareTransfer(tableOrders),
          disabled: !hasChecks,
        },
      ]
    : [
        {
          label: "Abrir pedido",
          icon: Plus,
          run: () => actions.openTableOrder(table.id),
          disabled: false,
        },
      ];
  return (
    <SharedTableCard
      table={table}
      orders={tableOrders}
      operational={operational}
      total={card.total}
      filterStatus={
        isMerged
          ? "merged"
          : hasPendingPayment
            ? "payment"
            : isOccupied
              ? "occupied"
              : "free"
      }
      note={
        origin
          ? `Unida à M${origin}`
          : transferred
            ? `Transf. M${transferred}`
            : undefined
      }
    >
      {!isMerged && (
        <>
          {isOccupied && (
            <div className="space-y-2 border-t border-koma-border pt-2">
              <TableOrderContext context={card.context} />
              <p
                aria-label="Produção e serviço"
                className="text-[10px] leading-relaxed text-koma-secondary"
              >
                {operational.production.preparingItemCount} em preparo ·{" "}
                {operational.production.readyItemCount}{" "}
                {operational.production.readyItemCount === 1
                  ? "pronto"
                  : "prontos"}{" "}
                · {operational.production.deliveredItemCount}{" "}
                {operational.production.deliveredItemCount === 1
                  ? "servido"
                  : "servidos"}
              </p>
              {operational.hasPendingConfirmation && (
                <p className="text-[10px] font-semibold text-koma-warning-text">
                  Pagamento pendente de confirmação
                </p>
              )}
            </div>
          )}
          <div
            className={`grid gap-1.5 border-t border-koma-border pt-2 ${isOccupied ? "grid-cols-2" : "grid-cols-1"}`}
          >
            {buttons.map(({ label, icon: Icon, run, disabled }) => (
              <button
                key={label}
                type="button"
                onClick={run}
                disabled={disabled}
                className={`flex min-h-10 items-center justify-center gap-1 rounded-lg border border-current/20 px-2 text-[10px] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline focus-visible:outline-2 ${label === "Receber" && hasPendingPayment ? "koma-badge-warning" : isOccupied ? "koma-table-occupied-action" : "koma-table-free-action"}`}
              >
                <Icon size={12} className="shrink-0" />
                {label}
              </button>
            ))}
          </div>
        </>
      )}
    </SharedTableCard>
  );
}
