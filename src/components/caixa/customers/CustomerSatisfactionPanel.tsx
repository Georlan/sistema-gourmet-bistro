import React from 'react';
import { Star, MessageSquareHeart, Plus, Smile, Meh, Frown, Sparkles } from 'lucide-react';
import type { CustomerSatisfactionSummary, CustomerSatisfactionReview } from './useCustomerSatisfaction';

interface Props {
  resumo: CustomerSatisfactionSummary;
  recentes: CustomerSatisfactionReview[];
  isLoading?: boolean;
  onOpenRegisterModal: () => void;
}

function renderStars(nota: number) {
  return (
    <div className="flex items-center gap-0.5 text-amber-400" aria-label={`${nota} de 5 estrelas`}>
      {[1, 2, 3, 4, 5].map((val) => (
        <Star
          key={val}
          size={12}
          className={val <= nota ? 'fill-amber-400 text-amber-400' : 'text-zinc-600 dark:text-zinc-600 fill-transparent'}
        />
      ))}
    </div>
  );
}

function formatReviewDate(isoString: string): string {
  try {
    const dt = new Date(isoString);
    if (isNaN(dt.getTime())) return '';
    const now = new Date();
    const diffMs = now.getTime() - dt.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return 'hoje';
    if (diffDays === 1) return 'ontem';
    if (diffDays < 30) return `há ${diffDays} dias`;
    return dt.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
  } catch {
    return '';
  }
}

export function CustomerSatisfactionPanel({
  resumo,
  recentes,
  isLoading,
  onOpenRegisterModal,
}: Props) {
  const notaMediaFormatada =
    resumo.nota_media !== null && resumo.nota_media !== undefined
      ? Number(resumo.nota_media).toLocaleString('pt-BR', {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        })
      : '—';

  return (
    <section
      className="rounded-2xl border border-koma-border bg-koma-panel p-4 sm:p-5 space-y-4"
      aria-labelledby="satisfaction-panel-title"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <p className="orders-eyebrow"><span /> SATISFAÇÃO</p>
          <h3 id="satisfaction-panel-title" className="flex items-center gap-2 text-sm font-black text-koma-foreground">
            <MessageSquareHeart size={16} className="text-emerald-600 dark:text-emerald-400" />
            Índice de satisfação do cliente
          </h3>
          <p className="text-[11px] leading-relaxed text-koma-muted">
            Monitore o retorno dos clientes e acompanhe quem teve boa ou má experiência para agir rápido.
          </p>
        </div>

        <button
          type="button"
          onClick={onOpenRegisterModal}
          className="self-start sm:self-center flex items-center gap-1.5 px-3 py-1.5 bg-koma-canvas border border-koma-border hover:border-emerald-500/50 text-koma-foreground hover:text-emerald-600 dark:hover:text-emerald-400 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer shrink-0 shadow-xs"
          aria-label="Registrar avaliação manual"
        >
          <Plus size={13} className="text-emerald-600 dark:text-emerald-400" />
          <span>Registrar avaliação</span>
        </button>
      </div>

      {/* Grid com 3 métricas compactas */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        {/* Nota média */}
        <div className="rounded-xl border border-koma-border-subtle bg-koma-canvas/45 p-3 flex flex-col justify-between">
          <div className="flex items-center justify-between text-amber-500 text-[10px] font-bold uppercase tracking-wider">
            <span>Nota média</span>
            <Star size={12} className="fill-amber-400 text-amber-400" aria-hidden="true" />
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <strong className="font-mono text-xl text-koma-foreground">{notaMediaFormatada}</strong>
            <span className="text-[10px] text-koma-muted font-medium">/ 5</span>
          </div>
          <span className="text-[9px] text-koma-subtle mt-1">
            {resumo.total_avaliacoes === 0
              ? 'sem avaliações'
              : `${resumo.positivas} positivas (${resumo.total_avaliacoes > 0 ? Math.round((resumo.positivas / resumo.total_avaliacoes) * 100) : 0}%)`}
          </span>
        </div>

        {/* Total de avaliações */}
        <div className="rounded-xl border border-koma-border-subtle bg-koma-canvas/45 p-3 flex flex-col justify-between">
          <div className="flex items-center justify-between text-koma-muted text-[10px] font-bold uppercase tracking-wider">
            <span>Avaliações</span>
            <Sparkles size={12} aria-hidden="true" />
          </div>
          <strong className="mt-1 block font-mono text-xl text-koma-foreground">
            {resumo.total_avaliacoes}
          </strong>
          <span className="text-[9px] text-koma-subtle mt-1">
            {resumo.positivas} pos. · {resumo.neutras} neutras
          </span>
        </div>

        {/* Insatisfeitos */}
        <div className="rounded-xl border border-koma-border-subtle bg-koma-canvas/45 p-3 flex flex-col justify-between">
          <div className="flex items-center justify-between text-rose-600 dark:text-rose-400 text-[10px] font-bold uppercase tracking-wider">
            <span>Insatisfeitos</span>
            <Frown size={12} aria-hidden="true" />
          </div>
          <strong className="mt-1 block font-mono text-xl text-rose-600 dark:text-rose-400">
            {resumo.insatisfeitas}
          </strong>
          <span className="text-[9px] text-koma-subtle mt-1">
            {resumo.insatisfeitas === 1 ? '1 cliente insatisfeito' : `${resumo.insatisfeitas} clientes insatisfeitos`}
          </span>
        </div>
      </div>

      {/* Avaliações recentes */}
      <div className="space-y-2 pt-1 border-t border-koma-border-subtle/80">
        <div className="flex items-center justify-between">
          <h4 className="text-[10px] font-black uppercase tracking-wider text-koma-subtle">
            Avaliações recentes
          </h4>
          {recentes.length > 0 && (
            <span className="text-[9px] text-koma-muted font-mono">
              {recentes.length} {recentes.length === 1 ? 'registro' : 'registros'}
            </span>
          )}
        </div>

        {recentes.length === 0 ? (
          <div className="rounded-xl border border-dashed border-koma-border/70 bg-koma-canvas/30 px-4 py-3.5 text-center">
            <p className="text-xs font-semibold text-koma-foreground">
              Nenhuma avaliação registrada ainda.
            </p>
            <p className="text-[10px] text-koma-muted mt-0.5">
              Use o botão acima para registrar avaliações fornecidas pelos clientes no caixa ou pós-venda.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {recentes.map((item) => {
              const dataRelativa = formatReviewDate(item.criado_em);
              return (
                <div
                  key={item.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-xl border border-koma-border-subtle bg-koma-canvas/40 hover:bg-koma-canvas/70 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <div className="pt-0.5 shrink-0">
                      {renderStars(item.nota)}
                    </div>
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-bold text-koma-foreground">
                          {item.cliente_nome}
                        </span>
                        {item.comanda_id && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[9px] font-mono bg-koma-panel border border-koma-border-subtle text-koma-muted">
                            comanda #{item.comanda_id.slice(-4)}
                          </span>
                        )}
                        {dataRelativa && (
                          <span className="text-[10px] text-koma-subtle">
                            · {dataRelativa}
                          </span>
                        )}
                      </div>
                      {item.comentario && (
                        <p className="text-xs text-koma-muted leading-relaxed italic">
                          &ldquo;{item.comentario}&rdquo;
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="self-end sm:self-center shrink-0">
                    {item.nota >= 4 ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                        <Smile size={10} />
                        positiva
                      </span>
                    ) : item.nota === 3 ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                        <Meh size={10} />
                        neutra
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20">
                        <Frown size={10} />
                        insatisfeita
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
