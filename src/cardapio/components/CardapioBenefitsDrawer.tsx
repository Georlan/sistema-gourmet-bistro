/**
 * Benefícios públicos do cardápio.
 *
 * O conteúdo promocional só é buscado quando o cliente abre o painel. Isso
 * evita adicionar uma requisição a toda visita ao cardápio e mantém o caminho
 * crítico de catálogo enxuto.
 */
import React, { useEffect, useMemo, useState } from "react";
import {
  Check,
  Copy,
  Gift,
  Loader2,
  LogIn,
  Sparkles,
  TicketPercent,
  WalletCards,
  X,
} from "lucide-react";
import { API_BASE_URL } from "../../config/api";

interface PublicCoupon {
  codigo: string;
  tipo_desconto: "porcentagem" | "fixo" | string;
  valor_desconto: number;
  valor_minimo_pedido: number;
  valido_ate?: string | null;
  apenas_primeira_compra: boolean;
}

interface PublicLoyaltyProgram {
  ativo: boolean;
  tipo_recompensa: "PONTOS" | "CASHBACK" | string;
  taxa_conversao: number;
  valor_ponto_em_dinheiro: number;
}

interface BenefitsResponse {
  cupons: PublicCoupon[];
  programa?: PublicLoyaltyProgram | null;
}

interface BenefitsUser {
  name?: string;
  points?: number;
  cashback?: number;
}

interface CardapioBenefitsDrawerProps {
  restaurantId: string | number;
  isOpen: boolean;
  onClose: () => void;
  user?: BenefitsUser | null;
  onAuthClick: () => void;
}

type BenefitsTab = "offers" | "credit" | "points";

const formatCurrency = (value: number) => new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
}).format(Number(value || 0));

const formatNumber = (value: number) => new Intl.NumberFormat("pt-BR", {
  maximumFractionDigits: 2,
}).format(Number(value || 0));

const formatDate = (value?: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
};

export default function CardapioBenefitsDrawer({
  restaurantId,
  isOpen,
  onClose,
  user,
  onAuthClick,
}: CardapioBenefitsDrawerProps) {
  const [activeTab, setActiveTab] = useState<BenefitsTab>("offers");
  const [data, setData] = useState<BenefitsResponse>({ cupons: [] });
  const [loadedRestaurantId, setLoadedRestaurantId] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [copiedCode, setCopiedCode] = useState("");

  const restaurantKey = String(restaurantId || "");

  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !restaurantKey || loadedRestaurantId === restaurantKey) return;

    const controller = new AbortController();
    setIsLoading(true);
    setError("");
    const query = new URLSearchParams({ restaurante_id: restaurantKey });
    void fetch(`${API_BASE_URL}/cardapio/cupons/beneficios?${query.toString()}`, {
      signal: controller.signal,
    }).then(async (response) => {
      const payload = await response.json().catch(() => null) as BenefitsResponse | { detail?: unknown } | null;
      if (!response.ok) {
        throw new Error(
          typeof (payload as any)?.detail === "string"
            ? String((payload as any).detail)
            : "Não foi possível carregar os benefícios agora.",
        );
      }
      const normalized = payload as BenefitsResponse;
      setData({
        cupons: Array.isArray(normalized?.cupons) ? normalized.cupons : [],
        programa: normalized?.programa || null,
      });
      setLoadedRestaurantId(restaurantKey);
    }).catch((loadError) => {
      if ((loadError as Error).name === "AbortError") return;
      setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar os benefícios agora.");
    }).finally(() => {
      if (!controller.signal.aborted) setIsLoading(false);
    });

    return () => controller.abort();
  }, [isOpen, restaurantKey, loadedRestaurantId]);

  useEffect(() => {
    if (loadedRestaurantId && loadedRestaurantId !== restaurantKey) {
      setLoadedRestaurantId("");
      setData({ cupons: [] });
      setActiveTab("offers");
    }
  }, [restaurantKey, loadedRestaurantId]);

  const program = data.programa;
  const cashbackEnabled = Boolean(program?.ativo && program.tipo_recompensa === "CASHBACK");
  const pointsEnabled = Boolean(program?.ativo && program.tipo_recompensa === "PONTOS");

  const tabs = useMemo(() => ([
    { id: "offers" as const, label: "Ofertas", icon: TicketPercent },
    { id: "credit" as const, label: "Créditos", icon: WalletCards },
    { id: "points" as const, label: "Pontos", icon: Sparkles },
  ]), []);

  const copyCoupon = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(code);
      window.setTimeout(() => setCopiedCode((current) => current === code ? "" : current), 1800);
    } catch {
      setCopiedCode("");
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex justify-end bg-black/70 backdrop-blur-sm animate-fade-in"
      id="cardapio-benefits-overlay"
      onClick={onClose}
    >
      <aside
        className="flex h-full w-full max-w-md flex-col border-l border-koma-border bg-koma-panel text-koma-foreground shadow-2xl"
        id="cardapio-benefits-drawer"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="shrink-0 border-b border-koma-border px-4 pb-3 pt-4 sm:px-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl border border-emerald-500/20 bg-emerald-500/10 text-emerald-400">
                <Gift className="h-5 w-5" />
              </span>
              <div>
                <p className="text-[9px] font-black uppercase tracking-[0.16em] text-emerald-400">Vantagens da casa</p>
                <h2 className="mt-0.5 text-base font-black text-koma-foreground">Benefícios para voltar</h2>
                <p className="mt-1 text-[10px] leading-relaxed text-koma-muted">Ofertas e saldos do cliente reunidos sem pesar o carregamento do cardápio.</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-koma-border bg-koma-card text-koma-muted transition hover:text-koma-foreground"
              aria-label="Fechar benefícios"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <nav className="mt-4 grid grid-cols-3 gap-1 rounded-2xl border border-koma-border bg-koma-card p-1" aria-label="Tipos de benefício">
            {tabs.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                className={`flex h-10 items-center justify-center gap-1.5 rounded-xl px-2 text-[10px] font-black transition ${
                  activeTab === id
                    ? "bg-emerald-500 text-white shadow-lg shadow-emerald-950/30"
                    : "text-koma-muted hover:bg-koma-raised hover:text-koma-foreground"
                }`}
              >
                <Icon className="h-3.5 w-3.5" /> {label}
              </button>
            ))}
          </nav>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5 no-scrollbar">
          {isLoading ? (
            <div className="flex min-h-48 items-center justify-center gap-2 text-xs font-semibold text-koma-muted">
              <Loader2 className="h-4 w-4 animate-spin text-emerald-400" /> Carregando vantagens…
            </div>
          ) : error ? (
            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-xs leading-relaxed text-amber-300">
              <p>{error}</p>
              <button
                type="button"
                onClick={() => setLoadedRestaurantId("")}
                className="mt-3 font-black underline"
              >
                Tentar novamente
              </button>
            </div>
          ) : activeTab === "offers" ? (
            <section className="space-y-3" id="cardapio-benefits-offers">
              {data.cupons.length === 0 ? (
                <div className="rounded-2xl border border-koma-border bg-koma-card p-5 text-center">
                  <TicketPercent className="mx-auto h-7 w-7 text-koma-subtle" />
                  <p className="mt-3 text-xs font-black text-koma-foreground">Nenhuma oferta pública ativa agora.</p>
                  <p className="mt-1 text-[10px] leading-relaxed text-koma-muted">Quando o restaurante liberar uma condição especial, ela aparece aqui.</p>
                </div>
              ) : data.cupons.map((coupon) => {
                const expiry = formatDate(coupon.valido_ate);
                const headline = coupon.tipo_desconto === "porcentagem"
                  ? `${formatNumber(coupon.valor_desconto)}% de economia`
                  : `${formatCurrency(coupon.valor_desconto)} de economia`;
                return (
                  <article key={coupon.codigo} className="rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/[0.09] to-koma-card p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <span className="text-[9px] font-black uppercase tracking-[0.14em] text-emerald-400">Oferta disponível</span>
                        <h3 className="mt-1 text-sm font-black text-koma-foreground">{headline}</h3>
                        <code className="mt-2 inline-block rounded-lg border border-koma-border bg-black/20 px-2.5 py-1.5 text-xs font-black tracking-wider text-emerald-300">{coupon.codigo}</code>
                      </div>
                      <button
                        type="button"
                        onClick={() => void copyCoupon(coupon.codigo)}
                        className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-koma-border bg-koma-panel px-3 text-[9px] font-black text-koma-secondary transition hover:border-emerald-500/30 hover:text-emerald-400"
                        aria-label={`Copiar código ${coupon.codigo}`}
                      >
                        {copiedCode === coupon.codigo ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                        {copiedCode === coupon.codigo ? "Copiado" : "Copiar"}
                      </button>
                    </div>
                    <div className="mt-3 space-y-1 border-t border-koma-border/70 pt-3 text-[10px] leading-relaxed text-koma-muted">
                      {coupon.valor_minimo_pedido > 0 && <p>Pedido a partir de <strong className="text-koma-secondary">{formatCurrency(coupon.valor_minimo_pedido)}</strong>.</p>}
                      {coupon.apenas_primeira_compra && <p>Válida para a primeira compra elegível.</p>}
                      {expiry && <p>Disponível até {expiry}.</p>}
                      <p>Copie o código e aplique na sacola antes de finalizar.</p>
                    </div>
                  </article>
                );
              })}
            </section>
          ) : activeTab === "credit" ? (
            <section id="cardapio-benefits-credit">
              <div className="rounded-3xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/[0.13] to-koma-card p-5">
                <p className="text-[9px] font-black uppercase tracking-[0.14em] text-emerald-400">Crédito para a próxima compra</p>
                {user ? (
                  <>
                    <p className="mt-2 text-3xl font-black tracking-tight text-koma-foreground">{formatCurrency(Number(user.cashback || 0))}</p>
                    <p className="mt-1 text-[10px] text-koma-muted">Saldo vinculado à sua conta neste restaurante.</p>
                  </>
                ) : (
                  <>
                    <p className="mt-2 text-sm font-black text-koma-foreground">Entre para consultar seu saldo.</p>
                    <button
                      type="button"
                      onClick={onAuthClick}
                      className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 text-xs font-black text-white"
                    >
                      <LogIn className="h-4 w-4" /> Entrar na minha conta
                    </button>
                  </>
                )}
              </div>

              <div className="mt-3 rounded-2xl border border-koma-border bg-koma-card p-4">
                <h3 className="text-xs font-black text-koma-foreground">Como funciona aqui</h3>
                {cashbackEnabled ? (
                  <p className="mt-2 text-[10px] leading-relaxed text-koma-muted">
                    Compras elegíveis geram <strong className="text-emerald-400">{formatNumber(program?.taxa_conversao || 0)}%</strong> do valor em crédito. O saldo disponível pode ser usado no checkout.
                  </p>
                ) : (
                  <p className="mt-2 text-[10px] leading-relaxed text-koma-muted">
                    O restaurante não está acumulando novos créditos por compra neste momento. Um saldo já existente continua aparecendo na sua conta.
                  </p>
                )}
              </div>
            </section>
          ) : (
            <section id="cardapio-benefits-points">
              <div className="rounded-3xl border border-cyan-500/20 bg-gradient-to-br from-cyan-500/[0.10] to-koma-card p-5">
                <p className="text-[9px] font-black uppercase tracking-[0.14em] text-cyan-300">Pontos acumulados</p>
                {user ? (
                  <>
                    <p className="mt-2 text-3xl font-black tracking-tight text-koma-foreground">{formatNumber(Number(user.points || 0))}</p>
                    <p className="mt-1 text-[10px] text-koma-muted">Seu saldo acompanha a conta do restaurante.</p>
                  </>
                ) : (
                  <>
                    <p className="mt-2 text-sm font-black text-koma-foreground">Entre para ver sua pontuação.</p>
                    <button
                      type="button"
                      onClick={onAuthClick}
                      className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 text-xs font-black text-white"
                    >
                      <LogIn className="h-4 w-4" /> Entrar na minha conta
                    </button>
                  </>
                )}
              </div>

              <div className="mt-3 rounded-2xl border border-koma-border bg-koma-card p-4">
                <h3 className="text-xs font-black text-koma-foreground">Regra atual</h3>
                {pointsEnabled ? (
                  <p className="mt-2 text-[10px] leading-relaxed text-koma-muted">
                    Cada R$ 1 elegível gera <strong className="text-cyan-300">{formatNumber(program?.taxa_conversao || 0)} ponto(s)</strong>
                    {Number(program?.valor_ponto_em_dinheiro || 0) > 0
                      ? <> e cada ponto pode representar <strong className="text-cyan-300">{formatCurrency(program?.valor_ponto_em_dinheiro || 0)}</strong> no resgate.</>
                      : "."}
                  </p>
                ) : (
                  <p className="mt-2 text-[10px] leading-relaxed text-koma-muted">
                    O restaurante está usando outra modalidade de vantagem no momento. Seus pontos anteriores permanecem vinculados à conta.
                  </p>
                )}
              </div>
            </section>
          )}
        </div>

        <footer className="shrink-0 border-t border-koma-border bg-koma-card/50 px-4 py-3 text-center text-[9px] leading-relaxed text-koma-subtle">
          Regras exibidas pelo próprio restaurante. O desconto final é validado novamente no fechamento do pedido.
        </footer>
      </aside>
    </div>
  );
}
