import React, { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';

export type CourierReassignmentTarget = {
  orderId: string;
  orderLabel: string;
  currentCourierId: number | null;
  currentCourierName: string;
};

type CourierOption = {
  id: string | number;
  nome: string;
  ativo?: boolean;
};

type Props = {
  target: CourierReassignmentTarget | null;
  couriers: readonly CourierOption[];
  isSubmitting: boolean;
  onClose: () => void;
  onSubmit: (courierId: string, reason: string) => Promise<void> | void;
};

export function CourierReassignmentDialog({
  target,
  couriers,
  isSubmitting,
  onClose,
  onSubmit,
}: Props) {
  const [courierId, setCourierId] = useState('');
  const [reason, setReason] = useState('');

  useEffect(() => {
    setCourierId('');
    setReason('');
  }, [target?.orderId, target?.currentCourierId]);

  const availableCouriers = useMemo(
    () => couriers.filter(
      (courier) => courier.ativo !== false
        && String(courier.id) !== String(target?.currentCourierId || ''),
    ),
    [couriers, target?.currentCourierId],
  );

  if (!target) return null;

  const canSubmit = Boolean(courierId) && reason.trim().length >= 3 && !isSubmitting;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isSubmitting) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="courier-reassignment-title"
        className="w-full max-w-md rounded-2xl border border-koma-border bg-koma-card p-5 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <span className="text-[9px] font-extrabold uppercase tracking-[0.16em] text-amber-500">
              Exceção operacional
            </span>
            <h2 id="courier-reassignment-title" className="mt-1 text-base font-extrabold text-koma-foreground">
              Trocar entregador
            </h2>
            <p className="mt-1 text-[10px] leading-relaxed text-koma-muted">
              {target.orderLabel} já está em rota. A troca mantém o pedido em trânsito e exige um motivo para auditoria.
            </p>
          </div>
          <button
            type="button"
            aria-label="Fechar troca de entregador"
            disabled={isSubmitting}
            onClick={onClose}
            className="rounded-lg border border-koma-border p-2 text-koma-muted hover:bg-koma-panel hover:text-koma-foreground disabled:opacity-50"
          >
            <X size={15} />
          </button>
        </div>

        <div className="mt-4 rounded-xl border border-sky-500/20 bg-sky-500/5 px-3 py-2">
          <span className="block text-[8px] font-bold uppercase tracking-wide text-koma-muted">Entregador atual</span>
          <strong className="mt-0.5 block text-xs text-sky-500">{target.currentCourierName}</strong>
        </div>

        <form
          className="mt-4 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (canSubmit) void onSubmit(courierId, reason.trim());
          }}
        >
          <label className="block text-[9px] font-bold uppercase tracking-wide text-koma-muted">
            Novo entregador
            <select
              aria-label="Novo entregador"
              value={courierId}
              disabled={isSubmitting}
              onChange={(event) => setCourierId(event.target.value)}
              className="mt-1.5 min-h-10 w-full rounded-xl border border-koma-border bg-koma-page px-3 text-xs font-bold normal-case tracking-normal text-koma-foreground outline-none focus:border-emerald-500/60 disabled:opacity-60"
            >
              <option value="">Selecionar entregador...</option>
              {availableCouriers.map((courier) => (
                <option key={courier.id} value={courier.id}>{courier.nome}</option>
              ))}
            </select>
          </label>

          <label className="block text-[9px] font-bold uppercase tracking-wide text-koma-muted">
            Motivo da troca
            <textarea
              aria-label="Motivo da troca de entregador"
              value={reason}
              disabled={isSubmitting}
              maxLength={500}
              rows={3}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Ex.: entregador selecionado por engano"
              className="mt-1.5 w-full resize-none rounded-xl border border-koma-border bg-koma-page px-3 py-2 text-xs font-medium normal-case tracking-normal text-koma-foreground outline-none placeholder:text-koma-muted focus:border-emerald-500/60 disabled:opacity-60"
            />
            <span className="mt-1 block text-[9px] font-medium normal-case tracking-normal text-koma-muted">
              Mínimo de 3 caracteres. O motivo fica registrado no histórico operacional.
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
              {isSubmitting ? 'Trocando…' : 'Confirmar troca'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
