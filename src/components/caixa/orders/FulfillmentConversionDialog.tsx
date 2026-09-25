import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';

export type FulfillmentConversionTarget = {
  orderId: string;
  orderLabel: string;
};

type Props = {
  target: FulfillmentConversionTarget | null;
  isSubmitting: boolean;
  onClose: () => void;
  onSubmit: (reason: string) => Promise<void> | void;
};

export function FulfillmentConversionDialog({
  target,
  isSubmitting,
  onClose,
  onSubmit,
}: Props) {
  const [reason, setReason] = useState('');

  useEffect(() => {
    setReason('');
  }, [target?.orderId]);

  if (!target) return null;

  const canSubmit = reason.trim().length >= 3 && !isSubmitting;

  return (
    <div
      className="fixed inset-0 z-[92] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isSubmitting) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="fulfillment-conversion-title"
        className="w-full max-w-md rounded-2xl border border-koma-border bg-koma-card p-5 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <span className="text-[9px] font-extrabold uppercase tracking-[0.16em] text-amber-500">
              Exceção operacional
            </span>
            <h2 id="fulfillment-conversion-title" className="mt-1 text-base font-extrabold text-koma-foreground">
              Alterar para retirada
            </h2>
            <p className="mt-1 text-[10px] leading-relaxed text-koma-muted">
              {target.orderLabel} deixará a fila de entregas e passará para Retiradas sem mudar a etapa de preparo.
            </p>
          </div>
          <button
            type="button"
            aria-label="Fechar alteração para retirada"
            disabled={isSubmitting}
            onClick={onClose}
            className="rounded-lg border border-koma-border p-2 text-koma-muted hover:bg-koma-panel hover:text-koma-foreground disabled:opacity-50"
          >
            <X size={15} />
          </button>
        </div>

        <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[10px] leading-relaxed text-koma-secondary">
          O entregador pré-atribuído será removido e a taxa de entrega será zerada. A forma de pagamento continua independente da modalidade.
        </div>

        <form
          className="mt-4 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (canSubmit) void onSubmit(reason.trim());
          }}
        >
          <label className="block text-[9px] font-bold uppercase tracking-wide text-koma-muted">
            Motivo da alteração
            <textarea
              aria-label="Motivo da alteração para retirada"
              value={reason}
              disabled={isSubmitting}
              maxLength={500}
              rows={3}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Ex.: cliente avisou que passará para buscar"
              className="mt-1.5 w-full resize-none rounded-xl border border-koma-border bg-koma-page px-3 py-2 text-xs font-medium normal-case tracking-normal text-koma-foreground outline-none placeholder:text-koma-muted focus:border-emerald-500/60 disabled:opacity-60"
            />
            <span className="mt-1 block text-[9px] font-medium normal-case tracking-normal text-koma-muted">
              Mínimo de 3 caracteres. A alteração fica registrada para auditoria.
            </span>
          </label>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              disabled={isSubmitting}
              onClick={onClose}
              className="min-h-10 rounded-xl border border-koma-border px-4 text-[10px] font-bold text-koma-secondary hover:bg-koma-panel disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="min-h-10 rounded-xl bg-amber-600 px-4 text-[10px] font-extrabold text-white hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSubmitting ? 'Alterando…' : 'Confirmar retirada'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
