import { RefreshCw, Trash2, X } from 'lucide-react';
import React, { useEffect, useState } from 'react';
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

/** Cancellation/rejection confirmation preserving the order authority in the owner hook. */
export function CashierCancelConsumptionDialog({
  cancelConsumptionTarget,
  setCancelConsumptionTarget,
  isCancellingTable,
  cancelTableReason,
  setCancelTableReason,
  handleCancelTableConsumption,
}: BoundaryProps) {
  const [blockCustomer, setBlockCustomer] = useState(false);
  const [blockDuration, setBlockDuration] = useState<'24' | '168' | '720' | 'permanent'>('168');

  const isDigital = cancelConsumptionTarget?.scope === 'digital';
  const isRejection = isDigital && cancelConsumptionTarget?.intent === 'reject';

  useEffect(() => {
    setBlockCustomer(false);
    setBlockDuration('168');
  }, [cancelConsumptionTarget?.orderId, cancelConsumptionTarget?.intent]);

  const closeDialog = () => {
    if (isCancellingTable) return;
    setCancelConsumptionTarget(null);
  };

  const confirmAction = () => {
    const blockDurationHours = blockDuration === 'permanent' ? null : Number(blockDuration) as 24 | 168 | 720;
    void handleCancelTableConsumption({
      blockCustomer: Boolean(isRejection && blockCustomer),
      blockDurationHours: isRejection && blockCustomer ? blockDurationHours : null,
    });
  };

  return (
    <>
      {cancelConsumptionTarget && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 p-4 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="cancel-table-title"
            className="w-full max-w-md space-y-4 rounded-3xl border border-rose-900/50 bg-koma-card p-5 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-3 border-b border-koma-border-subtle pb-4">
              <div>
                <span className="font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-rose-400">
                  {isRejection ? 'Recusa de pedido' : 'Ação irreversível'}
                </span>
                <h3 id="cancel-table-title" className="mt-1 text-lg font-bold text-koma-foreground">
                  {cancelConsumptionTarget.scope === 'table'
                    ? `Liberar Mesa ${cancelConsumptionTarget.mesaId} sem receber?`
                    : isRejection
                      ? 'Recusar este pedido?'
                      : cancelConsumptionTarget.scope === 'digital'
                        ? 'Cancelar este pedido?'
                        : 'Cancelar somente este pedido?'}
                </h3>
                <p className="mt-1 text-[11px] leading-relaxed text-koma-subtle">
                  {cancelConsumptionTarget.scope === 'table'
                    ? 'Todos os pedidos da mesa serão cancelados. Esta opção existe apenas no Salão.'
                    : isRejection
                      ? 'O pedido não entrará em produção e o cliente receberá o motivo informado abaixo.'
                      : cancelConsumptionTarget.scope === 'digital'
                        ? 'O pedido sairá da operação ativa.'
                        : 'Somente os itens deste pedido serão cancelados; os demais pedidos da mesa serão preservados.'}
                </p>
              </div>
              <button
                type="button"
                onClick={closeDialog}
                disabled={isCancellingTable}
                className="rounded-lg p-2 text-koma-muted hover:bg-white/[0.05] hover:text-koma-foreground disabled:opacity-40"
                aria-label="Fechar"
              >
                <X size={16} />
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-xl border border-koma-border-subtle bg-black/20 p-3">
                <strong className="block font-mono text-sm text-koma-foreground">
                  {cancelConsumptionTarget.comandas}
                </strong>
                <span className="text-[9px] text-koma-muted">comandas</span>
              </div>
              <div className="rounded-xl border border-koma-border-subtle bg-black/20 p-3">
                <strong className="block font-mono text-sm text-koma-foreground">
                  {cancelConsumptionTarget.itens}
                </strong>
                <span className="text-[9px] text-koma-muted">itens</span>
              </div>
              <div className="rounded-xl border border-koma-border-subtle bg-black/20 p-3">
                <strong className="block font-mono text-sm text-rose-600 dark:text-rose-300">
                  {cancelConsumptionTarget.total.toLocaleString('pt-BR', {
                    style: 'currency',
                    currency: 'BRL',
                  })}
                </strong>
                <span className="text-[9px] text-koma-muted">valor do pedido</span>
              </div>
            </div>

            <label className="block space-y-1.5">
              <span className="text-[9px] font-bold uppercase tracking-wider text-koma-subtle">
                Motivo obrigatório
              </span>
              <textarea
                autoFocus
                maxLength={300}
                rows={3}
                value={cancelTableReason}
                onChange={(event) => setCancelTableReason(event.target.value)}
                placeholder={isRejection ? 'Ex.: não conseguimos atender este pedido no prazo informado' : 'Ex.: pedido lançado por engano'}
                className="w-full resize-none rounded-xl border border-[#343936] bg-koma-panel px-3 py-2.5 text-sm text-koma-foreground outline-none placeholder:text-zinc-700 focus:border-rose-500/60"
              />
              {isRejection && (
                <span className="block text-[10px] leading-relaxed text-koma-muted">
                  Este texto ficará no histórico e será mostrado ao cliente como motivo da recusa.
                </span>
              )}
            </label>

            {isRejection && (
              <div className="space-y-3 rounded-2xl border border-amber-500/25 bg-amber-500/[0.06] p-3.5">
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={blockCustomer}
                    onChange={(event) => setBlockCustomer(event.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-koma-border bg-koma-panel accent-rose-500"
                    aria-label="Bloquear novos pedidos deste cliente"
                  />
                  <span className="min-w-0">
                    <strong className="block text-xs text-koma-foreground">Bloquear novos pedidos deste cliente</strong>
                    <span className="mt-0.5 block text-[10px] leading-relaxed text-koma-muted">
                      Use para spam ou abuso. O bloqueio vale somente para este restaurante e pode ser removido depois.
                    </span>
                  </span>
                </label>

                {blockCustomer && (
                  <label className="block space-y-1.5">
                    <span className="text-[9px] font-bold uppercase tracking-wider text-koma-subtle">Duração do bloqueio</span>
                    <select
                      value={blockDuration}
                      onChange={(event) => setBlockDuration(event.target.value as typeof blockDuration)}
                      className="w-full rounded-xl border border-koma-border bg-koma-panel px-3 py-2.5 text-xs text-koma-foreground outline-none focus:border-rose-500/60"
                    >
                      <option value="24">24 horas</option>
                      <option value="168">7 dias</option>
                      <option value="720">30 dias</option>
                      <option value="permanent">Permanente</option>
                    </select>
                    <span className="block text-[9px] leading-relaxed text-koma-muted">
                      Novas tentativas bloqueadas recebem uma mensagem neutra e não chegam à operação.
                    </span>
                  </label>
                )}
              </div>
            )}

            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <button
                type="button"
                onClick={closeDialog}
                disabled={isCancellingTable}
                className="min-h-11 flex-1 rounded-xl border border-[#343936] text-xs font-bold text-koma-subtle hover:text-koma-foreground disabled:opacity-40"
              >
                {cancelConsumptionTarget.scope === 'digital' ? 'Manter pedido' : 'Manter atendimento'}
              </button>
              <button
                type="button"
                onClick={confirmAction}
                disabled={cancelTableReason.trim().length < 3 || isCancellingTable}
                className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-rose-600 px-3 text-xs font-extrabold text-white hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isCancellingTable ? <RefreshCw className="animate-spin" size={14} /> : <Trash2 size={14} />}
                {isCancellingTable
                  ? (isRejection ? 'Recusando…' : 'Cancelando…')
                  : cancelConsumptionTarget.scope === 'table'
                    ? 'Cancelar e liberar'
                    : isRejection
                      ? (blockCustomer ? 'Recusar e bloquear' : 'Recusar pedido')
                      : 'Cancelar pedido'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
