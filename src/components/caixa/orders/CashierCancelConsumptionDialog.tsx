
import { RefreshCw, Trash2, X } from 'lucide-react';
import React from 'react';
import type { useCashierOrders } from './useCashierOrders';

type BoundaryProps = Pick<
  ReturnType<typeof useCashierOrders>,
  | 'cancelConsumptionTarget'
  | 'setCancelConsumptionTarget'
  | 'isCancellingTable'
  | 'cancelTableReason'
  | 'setCancelTableReason'
  | 'handleCancelTableConsumption'
>;

/** Cancellation confirmation preserving item/order/table scope in the orders owner. */
export function CashierCancelConsumptionDialog({
  cancelConsumptionTarget,
  setCancelConsumptionTarget,
  isCancellingTable,
  cancelTableReason,
  setCancelTableReason,
  handleCancelTableConsumption,
}: BoundaryProps) {
  return (
    <>
      {cancelConsumptionTarget && (
        <div
          className={"fixed inset-0 z-[60] flex items-center justify-center bg-black/90 p-4 backdrop-blur-sm"}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="cancel-table-title"
            className={"w-full max-w-md space-y-4 rounded-3xl border border-rose-900/50 bg-koma-card p-5 shadow-2xl"}
          >
            <div
              className={"flex items-start justify-between gap-3 border-b border-koma-border-subtle pb-4"}
            >
              <div>
                <span
                  className={"font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-rose-400"}
                >
                  Ação irreversível
                </span>
                <h3
                  id="cancel-table-title"
                  className={"mt-1 text-lg font-bold text-koma-foreground"}
                >
                  {cancelConsumptionTarget.scope === 'table'
                    ? `Liberar Mesa ${cancelConsumptionTarget.mesaId} sem receber?`
                    : cancelConsumptionTarget.scope === 'digital'
                      ? 'Cancelar este pedido?'
                      : 'Cancelar somente este pedido?'}
                </h3>
                <p className={"mt-1 text-[11px] leading-relaxed text-koma-subtle"}>
                  {cancelConsumptionTarget.scope === 'table'
                    ? 'Todos os pedidos da mesa serão cancelados. Esta opção existe apenas no Salão.'
                    : cancelConsumptionTarget.scope === 'digital'
                      ? 'O pedido sairá da operação ativa.'
                      : 'Somente os itens deste pedido serão cancelados; os demais pedidos da mesa serão preservados.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCancelConsumptionTarget(null)}
                disabled={isCancellingTable}
                className={"rounded-lg p-2 text-koma-muted hover:bg-white/[0.05] hover:text-koma-foreground disabled:opacity-40"}
                aria-label="Fechar"
              >
                <X size={16} />
              </button>
            </div>

            <div className={"grid grid-cols-3 gap-2"}>
              <div
                className={"rounded-xl border border-koma-border-subtle bg-black/20 p-3"}
              >
                <strong className={"block font-mono text-sm text-koma-foreground"}>
                  {cancelConsumptionTarget.comandas}
                </strong>
                <span className={"text-[9px] text-koma-muted"}>comandas</span>
              </div>
              <div
                className={"rounded-xl border border-koma-border-subtle bg-black/20 p-3"}
              >
                <strong className={"block font-mono text-sm text-koma-foreground"}>
                  {cancelConsumptionTarget.itens}
                </strong>
                <span className={"text-[9px] text-koma-muted"}>itens</span>
              </div>
              <div
                className={"rounded-xl border border-koma-border-subtle bg-black/20 p-3"}
              >
                <strong className={"block font-mono text-sm text-rose-600 dark:text-rose-300"}>
                  {cancelConsumptionTarget.total.toLocaleString('pt-BR', {
                    style: 'currency',
                    currency: 'BRL',
                  })}
                </strong>
                <span className={"text-[9px] text-koma-muted"}>cancelados</span>
              </div>
            </div>

            <label className={"block space-y-1.5"}>
              <span
                className={"text-[9px] font-bold uppercase tracking-wider text-koma-subtle"}
              >
                Motivo obrigatório
              </span>
              <textarea
                autoFocus
                maxLength={300}
                rows={3}
                value={cancelTableReason}
                onChange={(event) => setCancelTableReason(event.target.value)}
                placeholder="Ex.: pedido lançado por engano"
                className={"w-full resize-none rounded-xl border border-[#343936] bg-koma-panel px-3 py-2.5 text-sm text-koma-foreground outline-none placeholder:text-zinc-700 focus:border-rose-500/60"}
              />
            </label>

            <div className={"flex flex-col-reverse gap-2 sm:flex-row"}>
              <button
                type="button"
                onClick={() => setCancelConsumptionTarget(null)}
                disabled={isCancellingTable}
                className={"min-h-11 flex-1 rounded-xl border border-[#343936] text-xs font-bold text-koma-subtle hover:text-koma-foreground disabled:opacity-40"}
              >
                {cancelConsumptionTarget.scope === 'digital' ? 'Manter pedido' : 'Manter atendimento'}
              </button>
              <button
                type="button"
                onClick={handleCancelTableConsumption}
                disabled={cancelTableReason.trim().length < 3 || isCancellingTable}
                className={"flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-rose-600 px-3 text-xs font-extrabold text-koma-foreground hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-40"}
              >
                {isCancellingTable ? <RefreshCw className="animate-spin" size={14} /> : <Trash2 size={14} />}
                {isCancellingTable
                  ? 'Cancelando…'
                  : cancelConsumptionTarget.scope === 'table'
                    ? 'Cancelar e liberar'
                    : 'Cancelar pedido'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
