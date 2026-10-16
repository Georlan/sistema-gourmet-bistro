import { snapshotFetch as fetch } from '../../../utils/snapshotFetch';
import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Gift,
  MessageSquare,
  ShieldAlert,
  ShoppingBag,
  Sparkles,
  Star,
  UserCheck,
  X,
} from 'lucide-react';
import type { CashierNotice, LoyaltyCustomer } from '../cashierContracts';

interface Props {
  customer: LoyaltyCustomer | null;
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
  onClose: () => void;
  onUpdated: () => Promise<void>;
  onStartCampaignForCustomer: (customer: LoyaltyCustomer, suggestedObjective?: string) => void;
  onEditCustomerBasic: (customer: LoyaltyCustomer) => void;
  showToast: CashierNotice;
}

const OPPORTUNITY_LABELS: Record<string, string> = {
  SECOND_PURCHASE: 'Incentivar a 2ª compra',
  CADENCE_RECOVERY: 'Recuperar recorrente fora do ritmo',
  BENEFIT_REMINDER: 'Lembrar benefício disponível',
  VIP_RECOGNITION: 'Reconhecer cliente frequente',
  OCCURRENCE_RECOVERY: 'Retomar após ocorrência',
};

const money = (value?: number | null) =>
  (value ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const formatDate = (iso?: string | null) => {
  if (!iso) return 'Não registrado';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Não registrado';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

export function CustomerProfileDrawer({
  customer,
  apiBaseUrl,
  authHeaders,
  onClose,
  onUpdated,
  onStartCampaignForCustomer,
  onEditCustomerBasic,
  showToast,
}: Props) {
  const [profile, setProfile] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [optOut, setOptOut] = useState(false);
  const [motivoOptOut, setMotivoOptOut] = useState('');
  const [canalPreferido, setCanalPreferido] = useState('WHATSAPP');
  const [observacoesDeclaradas, setObservacoesDeclaradas] = useState('');
  const [savingPrefs, setSavingPrefs] = useState(false);

  useEffect(() => {
    if (!customer) {
      setProfile(null);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setOptOut(Boolean(customer.opt_out_marketing));
    setMotivoOptOut(customer.motivo_opt_out || '');
    setCanalPreferido(customer.canal_preferido || 'WHATSAPP');
    setObservacoesDeclaradas(customer.observacoes_declaradas || '');

    fetch(`${apiBaseUrl}/fidelidade/clientes/${customer.id}/perfil`, {
      headers: authHeaders,
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Erro ao carregar perfil (${res.status})`);
        return res.json();
      })
      .then((data) => {
        if (controller.signal.aborted) return;
        setProfile(data);
        if (data?.dados_declarados) {
          setOptOut(Boolean(data.dados_declarados.opt_out_marketing));
          setMotivoOptOut(data.dados_declarados.motivo_opt_out || '');
          setCanalPreferido(data.dados_declarados.canal_preferido || 'WHATSAPP');
          setObservacoesDeclaradas(data.dados_declarados.observacoes_declaradas || '');
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : 'Não foi possível carregar a ficha individual.');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [customer, apiBaseUrl, authHeaders]);

  if (!customer) return null;

  const handleSavePreferences = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSavingPrefs(true);
      const res = await fetch(`${apiBaseUrl}/fidelidade/clientes/${customer.id}/preferencias`, {
        method: 'PUT',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          opt_out_marketing: optOut,
          motivo_opt_out: optOut ? motivoOptOut.trim() || 'Solicitado pelo cliente' : null,
          canal_preferido: canalPreferido,
          observacoes_declaradas: observacoesDeclaradas.trim() || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Não foi possível salvar as preferências.');
      }
      showToast('Preferências de relacionamento salvas com sucesso!');
      await onUpdated();
    } catch (err: any) {
      showToast(err.message || 'Falha ao salvar preferências.', 'error');
    } finally {
      setSavingPrefs(false);
    }
  };

  const observado = profile?.comportamento_observado;
  const declarado = profile?.dados_declarados;
  const beneficio = profile?.beneficio;
  const controle = profile?.controle_contato;
  const oportunidades: string[] = observado?.oportunidades_elegiveis || [];
  const primaryObjective = oportunidades[0] || 'SECOND_PURCHASE';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Ficha individual de ${customer.cliente}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex justify-end bg-black/75 backdrop-blur-xs animate-fade-in overscroll-contain"
    >
      <div className="relative flex h-full w-full max-w-2xl flex-col overflow-y-auto border-l border-koma-border bg-koma-panel p-5 text-left shadow-2xl overscroll-contain space-y-5">
        {/* Cabeçalho da Ficha Individual */}
        <div className="flex items-start justify-between gap-3 border-b border-koma-border pb-4">
          <div className="min-w-0">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-400">
              <UserCheck size={12} /> Ficha individual · Filtros preservados ao fechar
            </span>
            <h3 className="mt-1.5 text-lg font-black text-koma-foreground break-words">
              {customer.cliente}
            </h3>
            <p className="mt-0.5 font-mono text-xs text-koma-muted">
              {customer.telefone || 'Sem telefone informado'} ·{' '}
              {customer.telefone_valido_whatsapp !== false ? (
                <span className="text-emerald-400">Formato válido para WhatsApp</span>
              ) : (
                <span className="text-amber-400">Telefone inválido para WhatsApp</span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => onEditCustomerBasic(customer)}
              className="koma-btn-secondary rounded-xl px-3 py-2 text-xs font-bold"
            >
              Editar cadastro
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar ficha do cliente"
              className="rounded-xl border border-koma-border bg-koma-raised p-2 text-koma-muted hover:text-koma-foreground"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Barra de Próximo Passo Comercial */}
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.06] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-400">
              Próximo passo comercial recomendado
            </span>
            {optOut ? (
              <p className="text-xs font-semibold text-rose-300">
                Cliente optou por não receber comunicações de campanhas ({motivoOptOut || 'Opt-out ativo'}).
              </p>
            ) : controle?.contato_recente || customer.contato_recente ? (
              <p className="text-xs text-amber-300">
                Abordado recentemente (há {controle?.dias_desde_ultimo_contato ?? customer.dias_desde_ultimo_contato ?? 0}{' '}
                dias). Evite insistência antes de completar {controle?.janela_cooldown_dias ?? 7} dias.
              </p>
            ) : oportunidades.length > 0 ? (
              <p className="text-xs text-koma-foreground">
                Elegível para:{' '}
                <strong>{oportunidades.map((op) => OPPORTUNITY_LABELS[op] || op).join(' · ')}</strong>
              </p>
            ) : (customer.pedidos_concluidos ?? 0) === 0 ? (
              <p className="text-xs text-koma-muted">
                Cliente cadastrado ainda sem compra identificada. Não classificar como carrinho abandonado.
              </p>
            ) : (
              <p className="text-xs text-koma-foreground">
                Relacionamento em dia. Você pode preparar uma abordagem individual personalizada se desejar.
              </p>
            )}
          </div>
          <button
            type="button"
            disabled={optOut || customer.telefone_valido_whatsapp === false}
            onClick={() => onStartCampaignForCustomer(customer, primaryObjective)}
            className="koma-btn-primary shrink-0 rounded-xl px-4 py-2.5 text-xs font-bold disabled:opacity-40"
          >
            Preparar abordagem
          </button>
        </div>

        {loading && (
          <div role="status" className="rounded-xl border border-koma-border bg-koma-card p-4 text-xs text-koma-muted">
            Carregando histórico e preferências do cliente…
          </div>
        )}

        {error && (
          <div role="alert" className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-xs text-amber-200">
            {error} Exibindo os dados resumidos já carregados na base.
          </div>
        )}

        {/* Seção 1 vs Seção 2: Informação Declarada vs Comportamento Observado (Inferência) */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {/* Coluna A: Informação Declarada */}
          <section className="rounded-2xl border border-koma-border bg-koma-card p-4 space-y-3">
            <div className="border-b border-koma-border pb-2">
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-sky-400">
                1. Informação declarada (Cadastro)
              </span>
              <p className="mt-0.5 text-[11px] text-koma-muted">
                Dados informados pelo cliente ou operador. Telefone válido não significa autorização automática para marketing.
              </p>
            </div>

            <dl className="space-y-2 text-xs">
              <div className="flex justify-between gap-2">
                <dt className="text-koma-muted">Nome cadastrado:</dt>
                <dd className="font-semibold text-koma-foreground text-right">{declarado?.nome || customer.cliente}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-koma-muted">Telefone:</dt>
                <dd className="font-mono text-koma-foreground">{declarado?.telefone || customer.telefone || '—'}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-koma-muted">Endereço informado:</dt>
                <dd className="text-koma-foreground text-right break-words max-w-[200px]">
                  {declarado?.endereco || customer.endereco || 'Não declarado'}
                </dd>
              </div>
            </dl>

            <form onSubmit={handleSavePreferences} className="space-y-3 border-t border-koma-border pt-3">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-koma-muted">
                  Canal de contato preferido
                </label>
                <select
                  aria-label="Canal de contato preferido"
                  value={canalPreferido}
                  onChange={(e) => setCanalPreferido(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-koma-border bg-koma-panel px-3 py-2 text-xs text-koma-foreground"
                >
                  <option value="WHATSAPP">WhatsApp individual</option>
                  <option value="TELEFONE">Ligação telefônica</option>
                  <option value="PRESENCIAL">Apenas presencial no salão/balcão</option>
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-koma-muted">
                  Observações declaradas pelo cliente
                </label>
                <textarea
                  rows={2}
                  value={observacoesDeclaradas}
                  onChange={(e) => setObservacoesDeclaradas(e.target.value)}
                  placeholder="Ex.: Prefere sem cebola, pede sempre para viagem…"
                  className="mt-1 w-full rounded-xl border border-koma-border bg-koma-panel px-3 py-2 text-xs text-koma-foreground resize-none"
                />
              </div>

              <label className="flex items-start gap-2.5 rounded-xl border border-koma-border bg-koma-raised p-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={optOut}
                  onChange={(e) => setOptOut(e.target.checked)}
                  className="mt-0.5 rounded border-koma-border"
                />
                <span className="text-xs leading-snug text-koma-foreground">
                  <strong className="block">Não receber mensagens de campanhas (Opt-out)</strong>
                  <span className="text-[11px] text-koma-muted">
                    Exclui este cliente das listas de abordagem comercial.
                  </span>
                </span>
              </label>

              {optOut && (
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-koma-muted">
                    Motivo da exclusão de campanhas
                  </label>
                  <input
                    type="text"
                    value={motivoOptOut}
                    onChange={(e) => setMotivoOptOut(e.target.value)}
                    placeholder="Ex.: Solicitou não receber ofertas no WhatsApp"
                    className="mt-1 w-full rounded-xl border border-koma-border bg-koma-panel px-3 py-2 text-xs text-koma-foreground"
                  />
                </div>
              )}

              <button
                type="submit"
                disabled={savingPrefs}
                className="koma-btn-secondary w-full rounded-xl py-2 text-xs font-bold disabled:opacity-50"
              >
                {savingPrefs ? 'Salvando…' : 'Salvar preferências declaradas'}
              </button>
            </form>
          </section>

          {/* Coluna B: Comportamento Observado / Inferência */}
          <section className="rounded-2xl border border-koma-border bg-koma-card p-4 space-y-3">
            <div className="border-b border-koma-border pb-2">
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-amber-400">
                2. Comportamento observado (Inferido)
              </span>
              <p className="mt-0.5 text-[11px] text-koma-muted">
                Calculado apenas sobre compras concluídas e valores líquidos pagos (sem itens ou pedidos cancelados/estornados).
              </p>
            </div>

            {(observado?.pedidos_concluidos ?? customer.pedidos_concluidos ?? 0) === 0 ? (
              <div className="rounded-xl border border-koma-border bg-koma-raised p-3 text-xs text-koma-muted space-y-1">
                <strong className="block text-koma-foreground">Sem compra concluída identificada</strong>
                <p>
                  {observado?.aviso_sem_compra ||
                    'Este cadastro ainda não possui pedidos concluídos vinculados. Não é tratado como carrinho abandonado.'}
                </p>
              </div>
            ) : (
              <dl className="grid grid-cols-2 gap-2.5 text-xs">
                <div className="rounded-xl border border-koma-border bg-koma-raised p-2.5">
                  <dt className="text-[10px] text-koma-muted">Compras concluídas</dt>
                  <dd className="mt-1 font-mono text-sm font-black text-koma-foreground">
                    {observado?.pedidos_concluidos ?? customer.pedidos_concluidos ?? 0}
                  </dd>
                </div>
                <div className="rounded-xl border border-koma-border bg-koma-raised p-2.5">
                  <dt className="text-[10px] text-koma-muted">Total líquido pago</dt>
                  <dd className="mt-1 font-mono text-sm font-black text-emerald-400">
                    {money(observado?.valor_pago_total ?? customer.valor_pago_total)}
                  </dd>
                </div>
                <div className="rounded-xl border border-koma-border bg-koma-raised p-2.5">
                  <dt className="text-[10px] text-koma-muted">Ticket médio líquido</dt>
                  <dd className="mt-1 font-mono text-xs font-bold text-koma-foreground">
                    {money(observado?.ticket_medio_pago ?? customer.ticket_medio_pago)}
                  </dd>
                </div>
                <div className="rounded-xl border border-koma-border bg-koma-raised p-2.5">
                  <dt className="text-[10px] text-koma-muted">Ritmo / intervalo médio</dt>
                  <dd className="mt-1 font-mono text-xs font-bold text-koma-foreground">
                    {(observado?.intervalo_medio_dias ?? customer.intervalo_medio_dias) != null
                      ? `a cada ${observado?.intervalo_medio_dias ?? customer.intervalo_medio_dias} dias`
                      : 'Amostra insuficiente (<2 compras)'}
                  </dd>
                </div>
                <div className="rounded-xl border border-koma-border bg-koma-raised p-2.5">
                  <dt className="text-[10px] text-koma-muted">Primeira compra</dt>
                  <dd className="mt-1 font-mono text-xs text-koma-foreground">
                    {formatDate(observado?.primeira_compra_em ?? customer.primeira_compra_em)}
                  </dd>
                </div>
                <div className="rounded-xl border border-koma-border bg-koma-raised p-2.5">
                  <dt className="text-[10px] text-koma-muted">Última compra</dt>
                  <dd className="mt-1 font-mono text-xs text-koma-foreground">
                    {formatDate(observado?.ultima_compra_em ?? customer.ultima_compra_em)}
                    {(observado?.dias_sem_comprar ?? customer.dias_sem_comprar) != null && (
                      <span className="block text-[10px] text-koma-muted">
                        há {observado?.dias_sem_comprar ?? customer.dias_sem_comprar} dias
                      </span>
                    )}
                  </dd>
                </div>
              </dl>
            )}

            {observado?.pedidos_cancelados_ou_estornados_excluidos > 0 && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-2.5 text-[11px] text-amber-200 flex items-center gap-2">
                <AlertTriangle size={14} className="shrink-0 text-amber-400" />
                <span>
                  <strong>{observado.pedidos_cancelados_ou_estornados_excluidos}</strong> pedido(s) cancelado(s) ou 100% estornado(s) foram excluídos das métricas deste cliente.
                </span>
              </div>
            )}

            <div className="space-y-1.5 pt-1">
              <span className="block text-[10px] font-bold uppercase tracking-wider text-koma-muted">
                Preferências observadas (itens não cancelados)
              </span>
              {(observado?.produtos_favoritos ?? customer.produtos_favoritos)?.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {(observado?.produtos_favoritos ?? customer.produtos_favoritos).map((prod: any) => (
                    <span
                      key={prod.produto_id}
                      className="inline-flex items-center gap-1 rounded-lg border border-koma-border bg-koma-raised px-2.5 py-1 text-xs text-koma-foreground"
                    >
                      <Sparkles size={11} className="text-emerald-400" />
                      {prod.nome} <strong className="font-mono text-koma-muted">({prod.unidades} un.)</strong>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-koma-muted">Sem itens identificados em compras concluídas.</p>
              )}
            </div>
          </section>
        </div>

        {/* Seção 3: Benefício Atual (Saldo Acumulado vs Saldo Resgatável) */}
        <section className="rounded-2xl border border-koma-border bg-koma-card p-4 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Gift size={15} className="text-emerald-400" />
              <h4 className="text-xs font-extrabold uppercase tracking-wider text-koma-foreground">
                3. Situação de benefícios (Acumulado vs. Resgatável)
              </h4>
            </div>
            <span
              className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
                (beneficio?.elegivel_resgate ?? customer.elegivel_resgate)
                  ? 'bg-emerald-500/15 text-emerald-300'
                  : (beneficio?.status_beneficio ?? customer.status_beneficio) === 'SALDO_EM_FORMACAO'
                  ? 'bg-amber-500/15 text-amber-300'
                  : 'bg-koma-raised text-koma-muted'
              }`}
            >
              {(beneficio?.elegivel_resgate ?? customer.elegivel_resgate)
                ? 'Pronto para resgate'
                : (beneficio?.status_beneficio ?? customer.status_beneficio) === 'SALDO_EM_FORMACAO'
                ? 'Saldo em formação (ainda não permite resgate)'
                : 'Sem saldo resgatável'}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 pt-1 text-xs">
            <div className="rounded-xl border border-koma-border bg-koma-raised p-3">
              <span className="text-[10px] text-koma-muted block">Saldo acumulado na conta</span>
              <strong className="mt-1 block font-mono text-sm text-koma-foreground">
                {beneficio
                  ? beneficio.tipo_recompensa === 'PONTOS'
                    ? `${beneficio.saldo_pontos} pts (equiv. ${money(beneficio.valor_acumulado_brl)})`
                    : `${money(beneficio.saldo_cashback)} em cashback`
                  : `${customer.pontos} pts / ${money(customer.saldoCashback)}`}
              </strong>
            </div>
            <div className="rounded-xl border border-koma-border bg-koma-raised p-3">
              <span className="text-[10px] text-koma-muted block">Saldo resgatável agora</span>
              <strong className="mt-1 block font-mono text-sm text-emerald-400">
                {money(beneficio?.valor_resgatavel_brl ?? customer.valor_resgatavel_brl ?? 0)}
              </strong>
            </div>
            <div className="rounded-xl border border-koma-border bg-koma-raised p-3">
              <span className="text-[10px] text-koma-muted block">Regra vigente do programa</span>
              <span className="mt-1 block text-[11px] text-koma-foreground">
                {beneficio?.explicacao_regra || customer.beneficio_disponivel || 'Confira as regras na aba Benefícios.'}
              </span>
            </div>
          </div>
        </section>

        {/* Seção 4: Avaliações declaradas e ocorrências */}
        {declarado?.avaliacoes_registradas?.length > 0 && (
          <section className="rounded-2xl border border-koma-border bg-koma-card p-4 space-y-2.5">
            <div className="flex items-center gap-2">
              <Star size={15} className="text-amber-400" />
              <h4 className="text-xs font-extrabold uppercase tracking-wider text-koma-foreground">
                Avaliações registradas deste cliente
              </h4>
            </div>
            <div className="space-y-2">
              {declarado.avaliacoes_registradas.map((av: any) => (
                <div key={av.id} className="rounded-xl border border-koma-border bg-koma-raised p-3 text-xs">
                  <div className="flex items-center justify-between">
                    <strong className={av.nota <= 2 ? 'text-rose-400' : 'text-emerald-400'}>
                      Nota {av.nota}/5
                    </strong>
                    <span className="font-mono text-[10px] text-koma-muted">{formatDate(av.criado_em)}</span>
                  </div>
                  {av.comentario && <p className="mt-1 text-koma-foreground">{av.comentario}</p>}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Seção 5: Histórico de Contatos Registrados no CRM */}
        <section className="rounded-2xl border border-koma-border bg-koma-card p-4 space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MessageSquare size={15} className="text-emerald-400" />
              <h4 className="text-xs font-extrabold uppercase tracking-wider text-koma-foreground">
                4. Contatos comerciais registrados ({profile?.contatos_registrados?.length ?? customer.total_contatos_crm ?? 0})
              </h4>
            </div>
          </div>
          {profile?.contatos_registrados?.length ? (
            <div className="space-y-2">
              {profile.contatos_registrados.map((c: any) => (
                <div key={c.id} className="rounded-xl border border-koma-border bg-koma-raised p-3 text-xs space-y-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-bold text-koma-foreground">
                      {OPPORTUNITY_LABELS[c.objetivo] || c.objetivo} ·{' '}
                      <span className="font-mono text-[10px] text-amber-300">
                        {c.tipo_execucao === 'MANUAL' ? 'Registro manual' : c.tipo_execucao}
                      </span>
                    </span>
                    <span className="font-mono text-[10px] text-koma-muted">{formatDate(c.criado_em)}</span>
                  </div>
                  {c.beneficio_oferecido && (
                    <p className="text-[11px] text-emerald-300">
                      Benefício na abordagem: {c.beneficio_oferecido}
                      {c.cupom_codigo ? ` (Cupom: ${c.cupom_codigo})` : ''}
                    </p>
                  )}
                  {c.mensagem_enviada && (
                    <p className="rounded-lg bg-koma-panel p-2 text-[11px] text-koma-muted italic">
                      “{c.mensagem_enviada}”
                    </p>
                  )}
                  {c.pedido_retorno_id && (
                    <p className="text-[11px] font-semibold text-emerald-400">
                      Retorno observado: Pedido {c.pedido_retorno_id} ({money(c.valor_pedido_retorno)}) —{' '}
                      {c.metodo_atribuicao === 'CUPOM_EXPLICITO'
                        ? 'Comprovado por uso do cupom'
                        : 'Estimativa temporal pós-contato'}
                    </p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-koma-muted">
              Nenhuma abordagem comercial registrada para este cliente até o momento.
            </p>
          )}
        </section>

        {/* Seção 6: Histórico de Compras (incluindo distinção honesta de cancelados/estornados) */}
        <section className="rounded-2xl border border-koma-border bg-koma-card p-4 space-y-2.5">
          <div className="flex items-center gap-2">
            <ShoppingBag size={15} className="text-emerald-400" />
            <h4 className="text-xs font-extrabold uppercase tracking-wider text-koma-foreground">
              5. Histórico de pedidos identificados ({profile?.historico_compras?.length ?? 0})
            </h4>
          </div>
          {profile?.historico_compras?.length ? (
            <div className="space-y-2">
              {profile.historico_compras.map((ped: any) => (
                <div
                  key={ped.pedido_id}
                  className={`rounded-xl border p-3 text-xs ${
                    ped.entra_no_crm
                      ? 'border-koma-border bg-koma-raised'
                      : 'border-rose-500/30 bg-rose-500/[0.05] opacity-80'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <strong className="font-mono text-koma-foreground">
                        Pedido #{ped.display_number}
                      </strong>{' '}
                      <span className="text-[10px] text-koma-muted">
                        · {ped.canal} · {formatDate(ped.criado_em)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${
                          ped.entra_no_crm
                            ? 'bg-emerald-500/15 text-emerald-300'
                            : 'bg-rose-500/20 text-rose-300'
                        }`}
                      >
                        {ped.entra_no_crm ? 'Contabilizado no CRM' : `${ped.status} · Excluído do resultado`}
                      </span>
                      <strong className="font-mono text-koma-foreground">
                        {money(ped.valor_liquido_pago)}
                      </strong>
                    </div>
                  </div>
                  {ped.itens?.length > 0 && (
                    <p className="mt-1.5 text-[11px] text-koma-muted">
                      Itens: {ped.itens.map((it: any) => `${it.quantidade}x ${it.nome}`).join(', ')}
                    </p>
                  )}
                  {(ped.desconto > 0 || ped.estornado > 0 || ped.cupom_codigo) && (
                    <p className="mt-1 text-[10px] text-koma-muted">
                      Bruto: {money(ped.valor_bruto)}
                      {ped.desconto > 0 ? ` · Desconto: -${money(ped.desconto)}` : ''}
                      {ped.estornado > 0 ? ` · Estornado: -${money(ped.estornado)}` : ''}
                      {ped.cupom_codigo ? ` · Cupom: ${ped.cupom_codigo}` : ''}
                    </p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-koma-muted">Nenhum pedido vinculado ao histórico deste cliente.</p>
          )}
        </section>
      </div>
    </div>
  );
}
