
import type { Order, OrderItem } from '../../../types';
import type { useCashierOrders } from '../orders/useCashierOrders';
import { KitchenTimer as KDSTimer } from './KitchenTimer';

type BoundaryProps = Pick<ReturnType<typeof useCashierOrders>, 'handleUpdateItemStatus'> & {
  activeSubTab: string;
  activeKitchenItems: (OrderItem &
    Pick<Order, 'mesaId' | 'garcomNome'> & {
      orderId: Order['id'];
      timestamp: unknown;
    })[];
};

/** Kitchen view using operational item IDs and the existing order actions. */
export function CashierKitchen({ activeSubTab, activeKitchenItems, handleUpdateItemStatus }: BoundaryProps) {
  return (
    <>
      {activeSubTab === 'kds' && (
        <div
          className={"bg-koma-card/60 border border-koma-border rounded-3xl p-5 space-y-4"}
        >
          <div
            className={"border-b border-koma-border pb-3 flex items-center justify-between"}
          >
            <span className={"font-serif font-bold text-koma-secondary"}>
              Painel de Produção da Cozinha
            </span>
            <span
              className={"bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 font-bold px-2 py-0.5 rounded-full font-mono text-[9px]"}
            >
              {activeKitchenItems.length} pratos ativos
            </span>
          </div>

          {activeKitchenItems.length === 0 ? (
            <div className={"py-32 text-center text-koma-muted italic space-y-1"}>
              <p>Cozinha Limpa!</p>
              <p className={"text-[9px] text-gray-600"}>
                Nenhum pedido aguardando preparo no momento
              </p>
            </div>
          ) : (
            <div
              className={"grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4"}
            >
              {activeKitchenItems.map((item) => (
                <div
                  key={item.id}
                  className={`bg-koma-card border p-3 rounded-2xl space-y-3 flex flex-col justify-between ${
                    item.status === 'pronto' ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-koma-border'
                  }`}
                >
                  <div className="space-y-2">
                    {/* Header */}
                    <div className={"flex justify-between items-start"}>
                      <div>
                        <span className={"text-[9px] text-koma-subtle font-bold block"}>
                          Mesa {item.mesaId > 0 ? item.mesaId : 'Balcão'}
                        </span>
                        <strong
                          className={"text-koma-foreground text-xs block mt-0.5 truncate w-32"}
                        >
                          {item.nome}
                        </strong>
                      </div>
                      <KDSTimer
                        itemTimestamp={
                          (item as any).created_at ||
                          (item as any).timestamp ||
                          (item as any).preparando_desde
                        }
                        status={item.status}
                      />
                    </div>

                    {/* Observations / details */}
                    {item.observacao && (
                      <div
                        className={"bg-koma-page border border-koma-border/50 p-2 rounded-lg text-rose-400 font-bold text-[10px] leading-relaxed font-mono"}
                      >
                        Obs: {item.observacao}
                      </div>
                    )}
                    <span className={"text-[9px] text-koma-muted block truncate"}>
                      Lançado por: {item.garcomNome}
                    </span>
                  </div>

                  {/* Actions */}
                  <div className={"pt-2 border-t border-koma-border shrink-0"}>
                    {item.status === 'preparando' ? (
                      <button
                        onClick={() => handleUpdateItemStatus(item.id, 'pronto')}
                        className={"w-full py-1.5 bg-[#10b981] hover:bg-[#059669] text-[#121214] font-bold rounded-lg text-[9px] uppercase tracking-wider cursor-pointer"}
                      >
                        Marcar como Pronto
                      </button>
                    ) : (
                      <button
                        onClick={() => handleUpdateItemStatus(item.id, 'entregue')}
                        className={"w-full py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-[9px] uppercase tracking-wider cursor-pointer"}
                      >
                        Marcar como Entregue
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}
