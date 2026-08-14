import React, { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import {
  AlertCircle,
  ArrowRight,
  Check,
  CheckCircle2,
  ClipboardCheck,
  CreditCard,
  DollarSign,
  Lock,
  ReceiptText,
  RefreshCw,
  Smartphone,
  Zap,
  Wifi,
  WifiOff,
  Printer,
} from 'lucide-react';
import { CaixaTurnoResumo, FechamentoCaixaResult } from '../../types';
import { formatBackendDateTime } from '../../utils/dateTime';

interface CaixaFechamentoTabProps {
  isTurnoAberto: boolean;
  fechamentoResult: FechamentoCaixaResult | null;
  turnoResumo: CaixaTurnoResumo | null;
  pendingPaymentsCount: number;
  pendingPaymentsTotal: number;
  isConnected: boolean;
  onConfirmFechamento: (payload: {
    declarado_dinheiro: number;
    declarado_cartao: number;
    declarado_pix: number;
    observacao: string;
  }) => Promise<void>;
  onOpenNovoTurnoModal?: () => void;
  onRefresh?: () => Promise<void> | void;
  onNavigateToPendingPayments?: () => void;
  onNavigateToOpenComandas?: () => void;
}

const money = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

const formatMoney = (value: number) => money.format(Number(value) || 0);

const valueFromInput = (value: string): number | '' => {
  if (value === '') return '';
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : '';
};

interface CountFieldProps {
  id: string;
  label: string;
  help: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  value: number | '';
  expected: number;
  required?: boolean;
  onChange: (value: number | '') => void;
  onUseExpected: () => void;
}

const CountField: React.FC<CountFieldProps> = ({
  id,
  label,
  help,
  icon: Icon,
  value,
  expected,
  required,
  onChange,
  onUseExpected,
}) => {
  const difference = value === '' ? null : Number(value) - expected;
  const isExact = difference !== null && Math.abs(difference) < 0.01;

  return (
    <div className="rounded-2xl border border-koma-border bg-koma-panel p-4 transition-colors focus-within:border-[#1f8f70]">
      <div className="flex items-start justify-between gap-3">
        <label htmlFor={id} className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-koma-secondary">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-[#1f5948] bg-[#0c2a22] text-[#54d9b3]">
            <Icon size={15} />
          </span>
          <span>{label}{required ? <span className="ml-1 text-[#54d9b3]">*</span> : null}</span>
        </label>
        <button type="button" onClick={onUseExpected} className="rounded-lg border border-[#275f4d] bg-[#0d3026] px-2.5 py-1.5 text-[9px] font-bold text-[#54d9b3] transition-colors hover:border-[#3ba982] hover:text-koma-foreground">
          Usar {formatMoney(expected)}
        </button>
      </div>
      <label htmlFor={id} className="mt-3 flex items-center rounded-xl border border-koma-border bg-[#090c0a] px-3 focus-within:border-[#2a9f7d]">
        <span className="text-sm font-semibold text-koma-muted">R$</span>
        <input
          id={id}
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          required={required}
          placeholder="0,00"
          value={value}
          onChange={(event) => onChange(valueFromInput(event.target.value))}
          onFocus={(event) => event.currentTarget.select()}
          className="min-w-0 flex-1 appearance-none bg-transparent px-2 py-3 text-lg font-semibold tabular-nums text-koma-foreground outline-none placeholder:text-zinc-700 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
      </label>
      <div className="mt-2 flex items-center justify-between gap-3 text-[10px]">
        <span className="leading-relaxed text-koma-muted">{help}</span>
        <span className={clsx(
          'shrink-0 font-semibold tabular-nums',
          difference === null ? 'text-koma-muted' : isExact ? 'text-[#54d9b3]' : 'text-[#f0b3aa]',
        )}>
          {difference === null ? `Esperado ${formatMoney(expected)}` : isExact ? 'Confere' : `${difference > 0 ? '+' : ''}${formatMoney(difference)}`}
        </span>
      </div>
    </div>
  );
};

export const CaixaFechamentoTab: React.FC<CaixaFechamentoTabProps> = ({
  isTurnoAberto,
  fechamentoResult,
  turnoResumo,
  pendingPaymentsCount,
  pendingPaymentsTotal,
  isConnected,
  onConfirmFechamento,
  onOpenNovoTurnoModal,
  onRefresh,
  onNavigateToPendingPayments,
  onNavigateToOpenComandas,
}) => {
  const [declaradoDinheiro, setDeclaradoDinheiro] = useState<number | ''>('');
  const [declaradoCartao, setDeclaradoCartao] = useState<number | ''>('');
  const [declaradoPix, setDeclaradoPix] = useState<number | ''>('');
  const [observacao, setObservacao] = useState('');
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const openAccountsCount = turnoResumo?.comandas_abertas_count ?? 0;
  const hasBlockingPending = pendingPaymentsCount > 0 || openAccountsCount > 0;
  const expectedCash = Number(turnoResumo?.saldo_esperado_dinheiro || 0);
  const expectedCard = Number(turnoResumo?.total_cartao || 0);
  const expectedPix = Number(turnoResumo?.total_pix || 0);
  const expectedTotal = expectedCash + expectedCard + expectedPix;
  const hasMissingDeclarations = [declaradoDinheiro, declaradoCartao, declaradoPix].some((value) => value === '');
  const declaredTotal = useMemo(
    () => Number(declaradoDinheiro || 0) + Number(declaradoCartao || 0) + Number(declaradoPix || 0),
    [declaradoCartao, declaradoDinheiro, declaradoPix],
  );
  const liveDifference = declaredTotal - expectedTotal;
  const isDivergent = !hasMissingDeclarations && Math.abs(liveDifference) >= 0.01;

  useEffect(() => {
    setDeclaradoDinheiro('');
    setDeclaradoCartao('');
    setDeclaradoPix('');
    setObservacao('');
    setShowConfirmModal(false);
    setErrorMsg(null);
  }, [turnoResumo?.turno_id]);

  const useExpectedValues = () => {
    setDeclaradoDinheiro(expectedCash);
    setDeclaradoCartao(expectedCard);
    setDeclaradoPix(expectedPix);
    setErrorMsg(null);
  };

  const handleRefresh = async () => {
    if (!onRefresh || isRefreshing) return;
    try {
      setIsRefreshing(true);
      await onRefresh();
    } finally {
      setIsRefreshing(false);
    }
  };

  const handlePreSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setErrorMsg(null);
    if (hasMissingDeclarations) {
      setErrorMsg('Confira os três meios de pagamento antes de continuar.');
      return;
    }
    if (hasBlockingPending) {
      setErrorMsg('Resolva as contas e confirmações pendentes antes de fechar o turno.');
      return;
    }
    if (isDivergent && !observacao.trim()) {
      setErrorMsg('Diferença de caixa identificada. É obrigatório informar o motivo na observação para auditoria gerencial.');
      return;
    }
    setShowConfirmModal(true);
  };

  const handleExecuteFechamento = async () => {
    try {
      setIsSubmitting(true);
      setErrorMsg(null);
      await onConfirmFechamento({
        declarado_dinheiro: Number(declaradoDinheiro || 0),
        declarado_cartao: Number(declaradoCartao || 0),
        declarado_pix: Number(declaradoPix || 0),
        observacao: observacao.trim(),
      });
      setShowConfirmModal(false);
    } catch (error: unknown) {
      setErrorMsg(error instanceof Error ? error.message : 'Erro ao processar fechamento de caixa.');
      setShowConfirmModal(false);
    } finally {
      setIsSubmitting(false);
    }
  };


  const handlePrintComprovante = () => {
    if (!fechamentoResult) return;
    const isSurplus = fechamentoResult.diferenca_total > 0;
    const isExact = Math.abs(fechamentoResult.diferenca_total) < 0.01;
    const diferencaLabel = isExact ? "Caixa exato" : (isSurplus ? "Sobra de caixa" : "Quebra/Falta de caixa");
    
    const comprovanteText = `
--------------------------------
    COMPROVANTE DE FECHAMENTO
--------------------------------
Turno: #${fechamentoResult.turno_id}
Operador: ${fechamentoResult.fechado_por_nome}
Fechado em: ${formatBackendDateTime(fechamentoResult.fechado_em)}
Status: ${fechamentoResult.status.toUpperCase()}
--------------------------------
VALORES ESPERADOS (SISTEMA)
Dinheiro: ${formatMoney(fechamentoResult.esperado_dinheiro)}
Cartões: ${formatMoney(fechamentoResult.esperado_cartao)}
Pix: ${formatMoney(fechamentoResult.esperado_pix)}
Total Esperado: ${formatMoney(fechamentoResult.total_esperado)}
--------------------------------
VALORES DECLARADOS (FÍSICO)
Dinheiro: ${formatMoney(fechamentoResult.declarado_dinheiro)}
Cartões: ${formatMoney(fechamentoResult.declarado_cartao)}
Pix: ${formatMoney(fechamentoResult.declarado_pix)}
Total Declarado: ${formatMoney(fechamentoResult.total_declarado)}
--------------------------------
DIFERENÇA
Dinheiro: ${formatMoney(fechamentoResult.diferenca_dinheiro)}
Cartões: ${formatMoney(fechamentoResult.diferenca_cartao)}
Pix: ${formatMoney(fechamentoResult.diferenca_pix)}
--------------------------------
RESULTADO FINAL
${diferencaLabel}
Diferença Total: ${formatMoney(fechamentoResult.diferenca_total)}
--------------------------------
    CONFERIDO POR:

________________________________
    Assinatura do Responsável
`.trim();

    const event = new CustomEvent('koma-print', {
      detail: { title: 'Comprovante de Fechamento', content: comprovanteText }
    });
    window.dispatchEvent(event);
  };

  if (!isTurnoAberto && fechamentoResult) {
    const difference = fechamentoResult.diferenca_total;
    const isExact = Math.abs(difference) < 0.01;
    const isSurplus = difference > 0;
    const rows = [
      ['Dinheiro', fechamentoResult.esperado_dinheiro, fechamentoResult.declarado_dinheiro, fechamentoResult.diferenca_dinheiro],
      ['Cartões', fechamentoResult.esperado_cartao, fechamentoResult.declarado_cartao, fechamentoResult.diferenca_cartao],
      ['Pix', fechamentoResult.esperado_pix, fechamentoResult.declarado_pix, fechamentoResult.diferenca_pix],
    ] as const;

    return (
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(280px,.5fr)]">
        <section className="overflow-hidden rounded-3xl border border-koma-border bg-koma-panel">
          <header className="flex flex-col gap-4 border-b border-koma-border p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-[#1f7058] bg-[#0d3026] text-[#54d9b3]">
                <CheckCircle2 size={22} />
              </span>
              <div>
                <h2 className="text-base font-bold text-koma-foreground">Turno encerrado com segurança</h2>
                <p className="mt-0.5 text-[11px] text-koma-muted">
                  Caixa #{fechamentoResult.turno_id} · {fechamentoResult.fechado_por_nome} · {formatBackendDateTime(fechamentoResult.fechado_em)}
                </p>
              </div>
            </div>
            <span className="w-fit rounded-full border border-koma-border-subtle bg-koma-panel px-3 py-1 text-[9px] font-bold uppercase tracking-wider text-koma-secondary">
              Conferência concluída
            </span>
          </header>

          <div className="p-5">
            <div className={clsx(
              'mb-4 flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between',
              isExact ? 'border-[#1f7058] bg-[#0d3026]' : 'border-[#4c332f] bg-[#241715]',
            )}>
              <div>
                <strong className={clsx('block text-sm', isExact ? 'text-[#54d9b3]' : 'text-[#f0b3aa]')}>
                  {isExact ? 'Caixa conferido sem divergência' : isSurplus ? 'Sobra identificada na conferência' : 'Falta identificada na conferência'}
                </strong>
                <span className="mt-1 block text-[10px] text-koma-subtle">
                  {isExact ? 'Os valores contados conferem com os registros do sistema.' : 'A diferença ficou registrada no fechamento para auditoria.'}
                </span>
              </div>
              <strong className={clsx('text-xl tabular-nums', isExact ? 'text-[#54d9b3]' : 'text-[#f0b3aa]')}>
                {difference > 0 ? '+' : ''}{formatMoney(difference)}
              </strong>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-koma-border">
              <table className="w-full min-w-[620px] text-left text-xs">
                <thead className="bg-koma-panel text-[9px] uppercase tracking-wider text-koma-muted">
                  <tr>
                    <th className="p-3">Meio</th>
                    <th className="p-3">Sistema</th>
                    <th className="p-3">Contado</th>
                    <th className="p-3 text-right">Diferença</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#252b28] text-koma-secondary">
                  {rows.map(([label, expected, declared, rowDifference]) => (
                    <tr key={label}>
                      <td className="p-3 font-semibold text-koma-foreground">{label}</td>
                      <td className="p-3 tabular-nums">{formatMoney(expected)}</td>
                      <td className="p-3 tabular-nums">{formatMoney(declared)}</td>
                      <td className={clsx('p-3 text-right font-semibold tabular-nums', Math.abs(rowDifference) < 0.01 ? 'text-[#54d9b3]' : 'text-[#f0b3aa]')}>
                        {rowDifference > 0 ? '+' : ''}{formatMoney(rowDifference)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t border-koma-border bg-koma-panel text-sm font-bold text-koma-foreground">
                  <tr>
                    <td className="p-3">Total</td>
                    <td className="p-3 tabular-nums">{formatMoney(fechamentoResult.total_esperado)}</td>
                    <td className="p-3 tabular-nums">{formatMoney(fechamentoResult.total_declarado)}</td>
                    <td className="p-3 text-right tabular-nums">{difference > 0 ? '+' : ''}{formatMoney(difference)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </section>

        <aside className="flex flex-col justify-between rounded-3xl border border-koma-border bg-koma-panel p-5">
          <div>
            <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-[#54d9b3]">Próximo turno</p>
            <h3 className="mt-2 text-lg font-bold text-koma-foreground">Caixa pronto para recomeçar</h3>
            <p className="mt-2 text-xs leading-relaxed text-koma-muted">O fechamento foi gravado e os valores permanecerão disponíveis no histórico do caixa.</p>
          </div>
          {onOpenNovoTurnoModal && (
            <button type="button" onClick={onOpenNovoTurnoModal} className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-[#1f8f70] bg-[#0f6f55] px-4 py-3 text-xs font-bold text-white transition-colors hover:bg-[#128364]">
              <DollarSign size={16} /> Abrir novo turno
            </button>
          )}
          
          <button type="button" onClick={handlePrintComprovante} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-koma-border-subtle bg-koma-panel px-4 py-3 text-xs font-bold text-koma-secondary transition-colors hover:bg-[#1a201c] hover:text-koma-foreground">
            <Printer size={16} /> Imprimir comprovante
          </button>
        </aside>
      </div>
    );
  }

  if (!isTurnoAberto) {
    return (
      <section className="rounded-3xl border border-koma-border bg-koma-panel p-8 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-koma-border-subtle bg-koma-panel text-koma-subtle"><Lock size={22} /></span>
        <h2 className="mt-4 text-base font-bold text-koma-foreground">Nenhum turno aberto</h2>
        <p className="mx-auto mt-2 max-w-lg text-xs leading-relaxed text-koma-muted">Abra o caixa para registrar vendas, movimentações e realizar a conferência ao final do expediente.</p>
        {onOpenNovoTurnoModal && (
          <button type="button" onClick={onOpenNovoTurnoModal} className="mt-5 inline-flex items-center gap-2 rounded-xl border border-[#1f8f70] bg-[#0f6f55] px-5 py-2.5 text-xs font-bold text-white hover:bg-[#128364]">
            <DollarSign size={15} /> Abrir caixa
          </button>
        )}
      </section>
    );
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,.55fr)]">
      <section className="rounded-3xl border border-koma-border bg-koma-panel p-5 sm:p-6">
        <div className="flex flex-col gap-3 border-b border-koma-border pb-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-[#54d9b3]">Conferência assistida</p>
            <h2 className="mt-1 text-lg font-bold text-koma-foreground">Confira e feche mais rápido</h2>
            <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-koma-muted">Compare cada meio com o sistema. Use os valores esperados e altere apenas quando houver divergência.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={handleRefresh} disabled={!onRefresh || isRefreshing} className="inline-flex w-fit items-center gap-2 rounded-xl border border-koma-border-subtle bg-koma-panel px-3 py-2 text-[10px] font-semibold text-koma-secondary hover:border-[#3a4540] hover:text-koma-foreground disabled:opacity-50">
              <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} /> Atualizar
            </button>
            <button type="button" onClick={useExpectedValues} className="inline-flex w-fit items-center gap-2 rounded-xl border border-[#1f8f70] bg-[#0f6f55] px-3 py-2 text-[10px] font-bold text-white transition-colors hover:bg-[#128364]">
              <Zap size={14} /> Preencher esperados
            </button>
          </div>
        </div>

        {errorMsg && (
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-[#5d2b31] bg-[#251316] p-3 text-xs text-[#f0b3aa]" role="alert">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handlePreSubmit} className="mt-5">
          <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
            <CountField id="closing-cash" label="Dinheiro na gaveta" help="Fundo + vendas + suprimentos − sangrias." icon={DollarSign} value={declaradoDinheiro} expected={expectedCash} required onChange={setDeclaradoDinheiro} onUseExpected={() => setDeclaradoDinheiro(expectedCash)} />
            <CountField id="closing-card" label="Cartões" help="Débito e crédito registrados no turno." icon={CreditCard} value={declaradoCartao} expected={expectedCard} required onChange={setDeclaradoCartao} onUseExpected={() => setDeclaradoCartao(expectedCard)} />
            <CountField id="closing-pix" label="Pix" help="Recebimentos Pix aprovados no turno." icon={Smartphone} value={declaradoPix} expected={expectedPix} required onChange={setDeclaradoPix} onUseExpected={() => setDeclaradoPix(expectedPix)} />
          </div>

          <label htmlFor="closing-note" className="mt-4 block">
            <span className={clsx("text-[9px] font-bold uppercase tracking-[0.12em]", isDivergent ? "text-[#f0b3aa]" : "text-koma-muted")}>
              Observação do fechamento {isDivergent ? <span className="normal-case tracking-normal ml-1 text-[#f0b3aa]">* Obrigatório para justificar divergência</span> : <span className="normal-case tracking-normal">(opcional)</span>}
            </span>
            <textarea id="closing-note" rows={2} maxLength={500} placeholder={isDivergent ? "Justifique a diferença de caixa..." : "Ex.: comprovante ausente, valor deixado para troco..."} value={observacao} onChange={(event) => setObservacao(event.target.value)} required={isDivergent} className={clsx("mt-2 w-full resize-none rounded-xl border bg-koma-panel px-3 py-3 text-xs text-koma-foreground outline-none placeholder:text-zinc-700 focus:border-[#2a9f7d]", isDivergent && !observacao.trim() ? "border-[#5d2b31] focus:border-[#f0b3aa]" : "border-koma-border")} />
          </label>

          <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-koma-border bg-koma-panel p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="grid grid-cols-3 gap-x-2 gap-y-1 sm:gap-x-5">
              <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-koma-muted">Esperado</span>
              <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-koma-muted">Declarado</span>
              <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-koma-muted">Diferença</span>
              <strong className="text-sm tabular-nums text-koma-secondary sm:text-base">{formatMoney(expectedTotal)}</strong>
              <strong className="text-sm tabular-nums text-koma-foreground sm:text-base">{hasMissingDeclarations ? '—' : formatMoney(declaredTotal)}</strong>
              <strong className={clsx('text-sm tabular-nums sm:text-base', hasMissingDeclarations ? 'text-zinc-600' : Math.abs(liveDifference) < 0.01 ? 'text-[#54d9b3]' : 'text-[#f0b3aa]')}>
                {hasMissingDeclarations ? '—' : `${liveDifference > 0 ? '+' : ''}${formatMoney(liveDifference)}`}
              </strong>
            </div>
            <button type="submit" disabled={hasBlockingPending || hasMissingDeclarations || isSubmitting} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[#1f8f70] bg-[#0f6f55] px-5 py-3 text-xs font-bold text-white transition-colors hover:bg-[#128364] disabled:cursor-not-allowed disabled:border-[#2d3531] disabled:bg-[#1a1f1c] disabled:text-zinc-600">
              <Lock size={15} /> Revisar e fechar caixa <ArrowRight size={15} />
            </button>
          </div>
        </form>
      </section>

      <aside className="rounded-3xl border border-koma-border bg-koma-panel p-5">
        <div className="flex items-center justify-between border-b border-koma-border pb-4">
          <div>
            <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-[#54d9b3]">Validação do turno</p>
            <h2 className="mt-1 text-base font-bold text-koma-foreground">Antes de fechar</h2>
          </div>
          {isConnected ? <Wifi size={17} className="text-[#54d9b3]" /> : <WifiOff size={17} className="text-koma-muted" />}
        </div>

        <div className="mt-4 space-y-3">
          <div className={clsx('rounded-2xl border p-4', pendingPaymentsCount > 0 ? 'border-[#4b3430] bg-[#211816]' : 'border-[#254c40] bg-[#101d18]')}>
            <div className="flex items-start justify-between gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-current/20 text-[#54d9b3]"><ReceiptText size={17} /></span>
              <strong className="text-xl tabular-nums text-koma-foreground">{pendingPaymentsCount}</strong>
            </div>
            <h3 className="mt-3 text-xs font-bold text-koma-foreground">Pagamentos aguardando confirmação</h3>
            <p className="mt-1 text-[10px] text-koma-muted">{pendingPaymentsCount > 0 ? `${formatMoney(pendingPaymentsTotal)} ainda precisa ser conferido.` : 'Nenhum recebimento pendente neste momento.'}</p>
            {pendingPaymentsCount > 0 && onNavigateToPendingPayments && (
              <button type="button" onClick={onNavigateToPendingPayments} className="mt-3 inline-flex items-center gap-1.5 text-[10px] font-bold text-[#54d9b3] hover:text-koma-foreground">Resolver pagamentos <ArrowRight size={13} /></button>
            )}
          </div>

          <div className={clsx('rounded-2xl border p-4', openAccountsCount > 0 ? 'border-[#4b3430] bg-[#211816]' : 'border-[#254c40] bg-[#101d18]')}>
            <div className="flex items-start justify-between gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-current/20 text-[#54d9b3]"><ClipboardCheck size={17} /></span>
              <strong className="text-xl tabular-nums text-koma-foreground">{openAccountsCount}</strong>
            </div>
            <h3 className="mt-3 text-xs font-bold text-koma-foreground">Comandas ainda abertas</h3>
            <p className="mt-1 text-[10px] text-koma-muted">{openAccountsCount > 0 ? 'Finalize as contas para não levar valores ao próximo turno.' : 'Todas as comandas estão finalizadas.'}</p>
            {openAccountsCount > 0 && onNavigateToOpenComandas && (
              <button type="button" onClick={onNavigateToOpenComandas} className="mt-3 inline-flex items-center gap-1.5 text-[10px] font-bold text-[#54d9b3] hover:text-koma-foreground">Revisar comandas <ArrowRight size={13} /></button>
            )}
          </div>
        </div>

        <div className={clsx('mt-4 flex items-start gap-3 rounded-2xl border p-4', hasBlockingPending ? 'border-[#4b3430] bg-[#211816]' : 'border-[#1f7058] bg-[#0d3026]')}>
          {hasBlockingPending ? <AlertCircle size={18} className="mt-0.5 shrink-0 text-[#f0b3aa]" /> : <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-[#54d9b3]" />}
          <div>
            <strong className={clsx('block text-xs', hasBlockingPending ? 'text-[#f0b3aa]' : 'text-[#54d9b3]')}>{hasBlockingPending ? 'Fechamento bloqueado com segurança' : 'Turno pronto para conferência'}</strong>
            <p className="mt-1 text-[10px] leading-relaxed text-koma-subtle">{hasBlockingPending ? 'Resolva as pendências acima. O sistema também valida tudo novamente no servidor.' : 'A confirmação fará uma última validação no servidor antes de encerrar.'}</p>
          </div>
        </div>
      </aside>

      {showConfirmModal && (
        <div onClick={(event) => { if (event.target === event.currentTarget && !isSubmitting) setShowConfirmModal(false); }} className="fixed inset-0 z-50 flex cursor-pointer items-center justify-center overflow-y-auto bg-black/80 p-4 backdrop-blur-sm">
          <div role="dialog" aria-modal="true" aria-labelledby="confirm-closing-title" className="my-8 w-full max-w-md cursor-default rounded-3xl border border-koma-border-subtle bg-koma-panel p-5 shadow-2xl">
            <div className="flex items-start gap-3 border-b border-koma-border pb-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-[#1f7058] bg-[#0d3026] text-[#54d9b3]"><Lock size={18} /></span>
              <div>
                <h2 id="confirm-closing-title" className="text-base font-bold text-koma-foreground">Confirmar encerramento do turno?</h2>
                <p className="mt-1 text-[10px] leading-relaxed text-koma-muted">Depois de confirmar, os lançamentos deste turno ficam encerrados e a conferência será exibida.</p>
              </div>
            </div>

            <div className="mt-4 overflow-hidden rounded-2xl border border-koma-border bg-koma-panel text-[10px]">
              <div className="grid grid-cols-[1fr_repeat(3,auto)] gap-x-3 border-b border-koma-border px-4 py-2 font-bold uppercase tracking-wider text-zinc-600">
                <span>Meio</span><span>Esperado</span><span>Informado</span><span>Dif.</span>
              </div>
              {[
                ['Dinheiro', expectedCash, Number(declaradoDinheiro || 0)],
                ['Cartão', expectedCard, Number(declaradoCartao || 0)],
                ['Pix', expectedPix, Number(declaradoPix || 0)],
              ].map(([label, expected, declared]) => {
                const rowDifference = Number(declared) - Number(expected);
                return (
                  <div key={String(label)} className="grid grid-cols-[1fr_repeat(3,auto)] gap-x-3 border-b border-koma-border px-4 py-2.5 tabular-nums last:border-0">
                    <strong className="text-koma-secondary">{label}</strong>
                    <span className="text-koma-muted">{formatMoney(Number(expected))}</span>
                    <span className="text-koma-foreground">{formatMoney(Number(declared))}</span>
                    <span className={Math.abs(rowDifference) < 0.01 ? 'text-[#54d9b3]' : 'text-[#f0b3aa]'}>{rowDifference > 0 ? '+' : ''}{formatMoney(rowDifference)}</span>
                  </div>
                );
              })}
              <div className="flex items-center justify-between bg-koma-panel px-4 py-3 text-xs font-bold text-koma-foreground">
                <span>Diferença total</span>
                <span className={Math.abs(liveDifference) < 0.01 ? 'text-[#54d9b3]' : 'text-[#f0b3aa]'}>{liveDifference > 0 ? '+' : ''}{formatMoney(liveDifference)}</span>
              </div>
            </div>

            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => setShowConfirmModal(false)} disabled={isSubmitting} className="flex-1 rounded-xl border border-koma-border-subtle bg-koma-panel px-3 py-3 text-xs font-bold text-koma-secondary hover:text-koma-foreground disabled:opacity-50">Voltar e conferir</button>
              <button type="button" onClick={handleExecuteFechamento} disabled={isSubmitting} className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-[#1f8f70] bg-[#0f6f55] px-3 py-3 text-xs font-bold text-white hover:bg-[#128364] disabled:opacity-50">
                <Check size={15} /> {isSubmitting ? 'Encerrando...' : 'Confirmar fechamento'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
