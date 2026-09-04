import { AlertCircle, Clock, HeartHandshake, RotateCcw, UserCheck, Users } from 'lucide-react';
import React, { useMemo } from 'react';
import type { LoyaltyCustomer } from '../cashierContracts';

interface Props {
  customers: LoyaltyCustomer[];
}

function formatLastPurchase(dias?: number | null): string {
  if (dias === null || dias === undefined) return 'nunca comprou';
  if (dias === 0) return 'hoje';
  if (dias === 1) return 'ontem';
  return `há ${dias} dias`;
}

export function CustomerRelationshipPanel({ customers }: Props) {
  const summary = useMemo(() => {
    let ativos = 0;
    let atencao = 0;
    let reativar = 0;
    let semCompra = 0;

    for (const c of customers) {
      const seg = c.segmento_relacionamento || 'SEM_COMPRA';
      if (seg === 'ATIVO') ativos++;
      else if (seg === 'ATENCAO') atencao++;
      else if (seg === 'REATIVAR') reativar++;
      else semCompra++;
    }

    return {
      total: customers.length,
      ativos,
      atencao,
      reativar,
      semCompra,
    };
  }, [customers]);

  const priorityCustomers = useMemo(() => {
    // Prioritize REATIVAR before ATENCAO; within segment, largest dias_sem_comprar first
    return customers
      .filter((c) => c.segmento_relacionamento === 'REATIVAR' || c.segmento_relacionamento === 'ATENCAO')
      .sort((a, b) => {
        const segWeightA = a.segmento_relacionamento === 'REATIVAR' ? 0 : 1;
        const segWeightB = b.segmento_relacionamento === 'REATIVAR' ? 0 : 1;
        if (segWeightA !== segWeightB) {
          return segWeightA - segWeightB;
        }
        const daysA = a.dias_sem_comprar ?? 0;
        const daysB = b.dias_sem_comprar ?? 0;
        return daysB - daysA;
      })
      .slice(0, 5);
  }, [customers]);

  return (
    <section className="rounded-2xl border border-koma-border bg-koma-panel p-4 sm:p-5 space-y-4" aria-labelledby="relationship-panel-title">
      <div className="flex flex-col gap-2">
        <p className="orders-eyebrow"><span /> RELACIONAMENTO</p>
        <h3 id="relationship-panel-title" className="flex items-center gap-2 text-sm font-black text-koma-foreground">
          <HeartHandshake size={16} className="text-emerald-600 dark:text-emerald-400" />
          Saúde do relacionamento e frequência
        </h3>
        <p className="text-[11px] leading-relaxed text-koma-muted">
          Acompanhe o tempo desde a última compra identificada e saiba quem precisa de atenção antes de esfriar.
        </p>
      </div>

      {/* Resumo compacto de segmentos */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <div className="rounded-xl border border-koma-border-subtle bg-koma-canvas/45 p-3">
          <div className="flex items-center justify-between text-koma-muted text-[10px] font-bold uppercase tracking-wider">
            <span>Total</span>
            <Users size={12} aria-hidden="true" />
          </div>
          <strong className="mt-1 block font-mono text-lg text-koma-foreground">{summary.total}</strong>
          <span className="text-[9px] text-koma-subtle">{summary.semCompra} sem compra</span>
        </div>

        <div className="rounded-xl border border-koma-border-subtle bg-koma-canvas/45 p-3">
          <div className="flex items-center justify-between text-emerald-600 dark:text-emerald-400 text-[10px] font-bold uppercase tracking-wider">
            <span>Ativos</span>
            <UserCheck size={12} aria-hidden="true" />
          </div>
          <strong className="mt-1 block font-mono text-lg text-emerald-600 dark:text-emerald-400">{summary.ativos}</strong>
          <span className="text-[9px] text-koma-subtle">até 30 dias</span>
        </div>

        <div className="rounded-xl border border-koma-border-subtle bg-koma-canvas/45 p-3">
          <div className="flex items-center justify-between text-amber-600 dark:text-amber-400 text-[10px] font-bold uppercase tracking-wider">
            <span>Atenção</span>
            <Clock size={12} aria-hidden="true" />
          </div>
          <strong className="mt-1 block font-mono text-lg text-amber-600 dark:text-amber-400">{summary.atencao}</strong>
          <span className="text-[9px] text-koma-subtle">31 a 60 dias</span>
        </div>

        <div className="rounded-xl border border-koma-border-subtle bg-koma-canvas/45 p-3">
          <div className="flex items-center justify-between text-rose-600 dark:text-rose-400 text-[10px] font-bold uppercase tracking-wider">
            <span>Reativar</span>
            <RotateCcw size={12} aria-hidden="true" />
          </div>
          <strong className="mt-1 block font-mono text-lg text-rose-600 dark:text-rose-400">{summary.reativar}</strong>
          <span className="text-[9px] text-koma-subtle">+60 dias</span>
        </div>
      </div>

      {/* Prioridade de relacionamento (máx 5) */}
      <div className="space-y-2 pt-1 border-t border-koma-border-subtle">
        <div className="flex items-center justify-between">
          <h4 className="text-[10px] font-bold uppercase tracking-wider text-koma-secondary flex items-center gap-1.5">
            <AlertCircle size={12} className="text-koma-muted" />
            Prioridade de relacionamento
          </h4>
          <span className="text-[10px] text-koma-muted">
            {priorityCustomers.length > 0 ? `Top ${priorityCustomers.length} para reconectar` : 'Nenhum pendente'}
          </span>
        </div>

        {priorityCustomers.length > 0 ? (
          <div className="space-y-1.5">
            {priorityCustomers.map((user) => {
              const isReativar = user.segmento_relacionamento === 'REATIVAR';
              return (
                <div
                  key={user.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-koma-border-subtle bg-koma-raised/40 px-3 py-2.5 text-xs transition-colors hover:bg-koma-raised"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <strong className="truncate font-bold text-koma-foreground text-xs">
                        {user.cliente}
                      </strong>
                      <span
                        className={
                          isReativar
                            ? 'inline-flex items-center rounded-full border border-rose-500/20 bg-rose-500/10 px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-wider text-rose-600 dark:text-rose-400 shrink-0'
                            : 'inline-flex items-center rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-wider text-amber-600 dark:text-amber-400 shrink-0'
                        }
                      >
                        {isReativar ? 'Reativar' : 'Atenção'}
                      </span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[10px] text-koma-muted">
                      <span>{formatLastPurchase(user.dias_sem_comprar)}</span>
                      <span aria-hidden="true">•</span>
                      <span>
                        {user.pedidos_concluidos ?? 0}{' '}
                        {(user.pedidos_concluidos ?? 0) === 1 ? 'pedido' : 'pedidos'}
                      </span>
                      {Boolean(user.ticket_medio_pago && user.ticket_medio_pago > 0) && (
                        <>
                          <span aria-hidden="true">•</span>
                          <span>Ticket médio R$ {user.ticket_medio_pago?.toFixed(2)}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-xl border border-koma-border-subtle bg-koma-canvas/30 px-3 py-3 text-center text-xs text-koma-muted">
            Nenhum cliente necessitando de reativação ou atenção imediata no momento.
          </div>
        )}
      </div>
    </section>
  );
}
