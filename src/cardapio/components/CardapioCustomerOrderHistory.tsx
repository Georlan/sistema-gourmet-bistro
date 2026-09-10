/**
 * Account-backed order history. This is deliberately separate from anonymous
 * order tracking, which remains session-scoped and token-based.
 */
import React from "react";
import { CheckCircle2, ChevronDown, Clock3, History, Loader2, RefreshCw, RotateCcw, XCircle } from "lucide-react";
import clsx from "clsx";
import { API_BASE_URL } from "../../config/api";

interface HistoryModifier {
  grupo_id?: string | null;
  grupo_nome?: string | null;
  opcao_id: string;
  opcao_nome: string;
  preco_aplicado: number;
}

export interface CustomerHistoryItem {
  produto_id: string;
  nome: string;
  quantidade: number;
  preco_unitario: number;
  observacao?: string;
  modificadores: HistoryModifier[];
}

export interface CustomerHistoryOrder {
  id: string;
  numero_pedido: string | number;
  criado_em?: string | null;
  fechado_em?: string | null;
  tipo: string;
  status: string;
  state: {
    label?: string;
    terminal?: boolean;
    rejected?: boolean;
    fulfillment?: string;
  };
  total: number;
  taxa_entrega: number;
  desconto_cupom: number;
  desconto_cashback: number;
  itens: CustomerHistoryItem[];
}

interface HistoryResponse {
  items: CustomerHistoryOrder[];
  next_cursor?: string | null;
}

interface CardapioCustomerOrderHistoryProps {
  customerToken: string;
  onRepeatOrder?: (order: CustomerHistoryOrder) => void;
}

const formatCurrency = (value: number) => new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
}).format(value || 0);

const formatDate = (value?: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
};

export default function CardapioCustomerOrderHistory({
  customerToken,
  onRepeatOrder,
}: CardapioCustomerOrderHistoryProps) {
  const [orders, setOrders] = React.useState<CustomerHistoryOrder[]>([]);
  const [nextCursor, setNextCursor] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [error, setError] = React.useState("");
  const [expandedOrderId, setExpandedOrderId] = React.useState<string | null>(null);

  const load = React.useCallback(async (cursor?: string | null, append = false) => {
    if (!customerToken) return;
    append ? setLoadingMore(true) : setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({ limit: "8" });
      if (cursor) query.set("cursor", cursor);
      const response = await fetch(`${API_BASE_URL}/cardapio/clientes/me/pedidos?${query.toString()}`, {
        headers: { "X-Koma-Customer-Token": customerToken },
        cache: "no-store",
      });
      const payload = await response.json().catch(() => null) as HistoryResponse | { detail?: unknown } | null;
      if (!response.ok) {
        throw new Error(
          typeof (payload as any)?.detail === "string"
            ? String((payload as any).detail)
            : "Não foi possível carregar seu histórico.",
        );
      }
      const data = payload as HistoryResponse;
      const incoming = Array.isArray(data.items) ? data.items : [];
      setOrders((current) => append
        ? [...current, ...incoming.filter((order) => !current.some((existing) => existing.id === order.id))]
        : incoming);
      setNextCursor(data.next_cursor || null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar seu histórico.");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [customerToken]);

  React.useEffect(() => {
    void load(null, false);
  }, [load]);

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/35 p-4" id="customer-account-order-history">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-primary/15 bg-primary/10 text-primary">
            <History className="h-4 w-4" />
          </span>
          <div>
            <h3 className="text-xs font-black text-koma-foreground">Pedidos da sua conta</h3>
            <p className="mt-0.5 text-[10px] leading-relaxed text-koma-muted">
              Histórico sincronizado com o restaurante, mesmo depois de fechar esta aba.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load(null, false)}
          disabled={loading}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-slate-800 bg-slate-950/40 text-koma-muted transition hover:text-koma-foreground disabled:opacity-50"
          aria-label="Atualizar histórico de pedidos"
          title="Atualizar histórico"
        >
          <RefreshCw className={clsx("h-3.5 w-3.5", loading && "animate-spin")} />
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-8 text-[10px] font-semibold text-koma-muted">
          <Loader2 className="h-4 w-4 animate-spin text-primary" /> Carregando seus pedidos…
        </div>
      ) : error ? (
        <div className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-[10px] leading-relaxed text-amber-300">
          <p>{error}</p>
          <button type="button" onClick={() => void load(null, false)} className="mt-2 font-black underline">
            Tentar novamente
          </button>
        </div>
      ) : orders.length === 0 ? (
        <div className="mt-3 rounded-xl border border-slate-800 bg-slate-950/30 p-4 text-center">
          <p className="text-[11px] font-bold text-koma-foreground">Nenhum pedido vinculado à sua conta ainda.</p>
          <p className="mt-1 text-[9px] leading-relaxed text-koma-muted">Seus próximos pedidos identificados aparecerão aqui automaticamente.</p>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          {orders.map((order) => {
            const expanded = expandedOrderId === order.id;
            const rejected = Boolean(order.state?.rejected);
            const terminal = Boolean(order.state?.terminal);
            const delivery = order.state?.fulfillment === "delivery" || order.tipo.toLocaleLowerCase("pt-BR").includes("delivery");
            return (
              <article key={order.id} className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950/30">
                <button
                  type="button"
                  onClick={() => setExpandedOrderId((current) => current === order.id ? null : order.id)}
                  className="flex w-full items-center gap-3 p-3 text-left"
                  aria-expanded={expanded}
                >
                  <span className={clsx(
                    "grid h-8 w-8 shrink-0 place-items-center rounded-xl",
                    rejected ? "bg-rose-500/10 text-rose-400" : terminal ? "bg-emerald-500/10 text-emerald-400" : "bg-amber-500/10 text-amber-300",
                  )}>
                    {rejected ? <XCircle className="h-4 w-4" /> : terminal ? <CheckCircle2 className="h-4 w-4" /> : <Clock3 className="h-4 w-4" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <strong className="text-[11px] text-koma-foreground">Pedido #{order.numero_pedido}</strong>
                      <small className="rounded-md bg-slate-800 px-1.5 py-0.5 text-[8px] font-bold text-koma-muted">{delivery ? "Delivery" : "Retirada"}</small>
                    </span>
                    <span className={clsx("mt-0.5 block text-[9px] font-bold", rejected ? "text-rose-400" : terminal ? "text-emerald-400" : "text-amber-300")}>
                      {order.state?.label || order.status}
                    </span>
                    <span className="mt-0.5 block text-[8px] text-koma-subtle">{formatDate(order.criado_em)}</span>
                  </span>
                  <span className="shrink-0 text-right">
                    <strong className="block text-[11px] text-koma-foreground">{formatCurrency(order.total)}</strong>
                    <ChevronDown className={clsx("ml-auto mt-1 h-3.5 w-3.5 text-koma-muted transition", expanded && "rotate-180")} />
                  </span>
                </button>

                {expanded && (
                  <div className="border-t border-slate-800 px-3 pb-3 pt-2.5">
                    <div className="space-y-1.5">
                      {order.itens.map((item, index) => (
                        <div key={`${item.produto_id}-${index}`} className="text-[9px] leading-relaxed text-koma-muted">
                          <div className="flex items-start justify-between gap-2">
                            <span><strong className="text-koma-secondary">{item.quantidade}x</strong> {item.nome}</span>
                            <span className="shrink-0">{formatCurrency(item.preco_unitario * item.quantidade)}</span>
                          </div>
                          {item.modificadores.length > 0 && (
                            <p className="pl-4 text-[8px] text-koma-subtle">+ {item.modificadores.map((modifier) => modifier.opcao_nome).join(", ")}</p>
                          )}
                          {item.observacao && <p className="pl-4 text-[8px] italic text-koma-subtle">“{item.observacao}”</p>}
                        </div>
                      ))}
                    </div>
                    {(order.desconto_cupom > 0 || order.desconto_cashback > 0 || order.taxa_entrega > 0) && (
                      <div className="mt-2.5 space-y-1 border-t border-slate-800 pt-2 text-[8px] text-koma-subtle">
                        {order.taxa_entrega > 0 && <div className="flex justify-between"><span>Entrega</span><span>{formatCurrency(order.taxa_entrega)}</span></div>}
                        {order.desconto_cupom > 0 && <div className="flex justify-between text-emerald-400"><span>Cupom</span><span>− {formatCurrency(order.desconto_cupom)}</span></div>}
                        {order.desconto_cashback > 0 && <div className="flex justify-between text-emerald-400"><span>Cashback</span><span>− {formatCurrency(order.desconto_cashback)}</span></div>}
                      </div>
                    )}
                    {terminal && order.itens.length > 0 && onRepeatOrder && (
                      <button
                        type="button"
                        onClick={() => onRepeatOrder(order)}
                        className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 py-2.5 text-[10px] font-black text-emerald-400 transition hover:bg-emerald-500/20"
                      >
                        <RotateCcw className="h-3.5 w-3.5" /> Pedir novamente
                      </button>
                    )}
                  </div>
                )}
              </article>
            );
          })}

          {nextCursor && (
            <button
              type="button"
              onClick={() => void load(nextCursor, true)}
              disabled={loadingMore}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-800 bg-slate-950/30 py-2.5 text-[9px] font-black text-koma-secondary transition hover:text-koma-foreground disabled:opacity-50"
            >
              {loadingMore ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ChevronDown className="h-3.5 w-3.5" />}
              {loadingMore ? "Carregando…" : "Carregar pedidos anteriores"}
            </button>
          )}
        </div>
      )}
    </section>
  );
}