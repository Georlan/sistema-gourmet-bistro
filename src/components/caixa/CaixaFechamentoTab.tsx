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
  Smartphone,
  Printer,
} from 'lucide-react';
import { CaixaTurnoResumo, FechamentoCaixaResult } from '../../types';
import { imprimirComprovanteFechamento } from '../../config/caixaService';
import { formatBackendDateTime } from '../../utils/dateTime';
import { MoneyInput } from '../MoneyInput';

interface CaixaFechamentoTabProps {
  isTurnoAberto: boolean;
  fechamentoResult: FechamentoCaixaResult | null;
  turnoResumo: CaixaTurnoResumo | null;
  pendingPaymentsCount: number;
  pendingPaymentsTotal: number;
  onConfirmFechamento: (payload: {
    declarado_dinheiro: number;
    declarado_cartao: number;
    declarado_pix: number;
    observacao: string;
  }) => Promise<void>;
  onOpenNovoTurnoModal?: () => void;
  onNavigateToPendingPayments?: () => void;
  onNavigateToOpenComandas?: () => void;
}

const money = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

const formatMoney = (value: number) => money.format(Number(value) || 0);

interface CountFieldProps {
  id: string;
  label: string;
  help: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  value: number | '';
  expected: number;
  required?: boolean;
  allowNegative?: boolean;
  hideExpected?: boolean;
  automatic?: boolean;
  onChange: (value: number | '') => void;
}

const CountField: React.FC<CountFieldProps> = ({
  id,
  label,
  help,
  icon: Icon,
  value,
  expected,
  required,
  allowNegative = false,
  hideExpected = false,
  automatic = false,
  onChange,
}) => {
  const difference = value === '' ? null : Number(value) - expected;
  const isExact = difference !== null && Math.abs(difference) < 0.01;

  return (
    <div className="closing-count-field min-w-0 rounded-2xl border border-koma-border bg-koma-panel p-4 transition-colors focus-within:border-koma-accent">
      <div className="closing-count-field__header flex min-w-0 items-start justify-between gap-3">
        <label htmlFor={id} className="flex min-w-0 items-center gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-koma-secondary">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-emerald-300 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300">
            <Icon size={15} />
          </span>
          <span className="min-w-0">{label}{required ? <span className="ml-1 text-emerald-800 dark:text-emerald-300">*</span> : null}</span>
        </label>
        {automatic && (
          <span className="rounded-full border border-emerald-300 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-950/30 px-2 py-1 text-[8px] font-bold uppercase tracking-wider text-emerald-800 dark:text-emerald-300">
            Automático
          </span>
        )}
      </div>
      <label htmlFor={id} className="mt-3 flex w-full min-w-0 items-center rounded-xl border border-koma-border bg-koma-input px-3 focus-within:border-koma-accent">
        <span className="text-sm font-semibold text-koma-muted">R$</span>
        <MoneyInput
          id={id}
          required={required}
          placeholder="0,00"
          value={value}
          onValueChange={onChange}
          allowNegative={allowNegative}
          selectOnFocus
          className="min-w-0 flex-1 bg-transparent px-2 py-3 text-lg font-semibold tabular-nums text-koma-foreground outline-none placeholder:text-zinc-700"
        />
      </label>
      <div className="mt-2 flex min-w-0 items-center justify-between gap-3 text-[10px]">
        <span className="min-w-0 leading-relaxed text-koma-muted">{help}</span>
        <span className={clsx(
          'shrink-0 font-semibold tabular-nums',
          hideExpected || difference === null ? 'text-koma-muted' : isExact ? 'text-emerald-800 dark:text-emerald-300' : 'text-rose-800 dark:text-rose-300',
        )}>
          {hideExpected
            ? 'Valor oculto'
            : difference === null
              ? 'Informe para comparar'
              : isExact
                ? 'Confere'
                : `${difference > 0 ? '+' : ''}${formatMoney(difference)}`}
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
  onConfirmFechamento,
  onOpenNovoTurnoModal,
  onNavigateToPendingPayments,
  onNavigateToOpenComandas,
}) => {
  const [closingMode, setClosingMode] = useState<'rapida' | 'cega'>('rapida');
  const [cardAutomatic, setCardAutomatic] = useState(true);
  const [pixAutomatic, setPixAutomatic] = useState(true);
  const [declaradoDinheiro, setDeclaradoDinheiro] = useState<number | ''>('');
  const [declaradoCartao, setDeclaradoCartao] = useState<number | ''>('');
  const [declaradoPix, setDeclaradoPix] = useState<number | ''>('');
  const [observacao, setObservacao] = useState('');
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);
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
  const isDivergent = closingMode === 'rapida' && !hasMissingDeclarations && Math.abs(liveDifference) >= 0.01;

  useEffect(() => {
    setClosingMode('rapida');
    setCardAutomatic(true);
    setPixAutomatic(true);
    setDeclaradoDinheiro('');
    setDeclaradoCartao(expectedCard);
    setDeclaradoPix(expectedPix);
    setObservacao('');
    setShowConfirmModal(false);
    setErrorMsg(null);
  }, [turnoResumo?.turno_id]);

  useEffect(() => {
    if (closingMode === 'rapida' && cardAutomatic) setDeclaradoCartao(expectedCard);
  }, [cardAutomatic, closingMode, expectedCard]);

  useEffect(() => {
    if (closingMode === 'rapida' && pixAutomatic) setDeclaradoPix(expectedPix);
  }, [closingMode, expectedPix, pixAutomatic]);

  const handleModeChange = (mode: 'rapida' | 'cega') => {
    setClosingMode(mode);
    setErrorMsg(null);
    setObservacao('');
    setDeclaradoDinheiro('');
    if (mode === 'rapida') {
      setCardAutomatic(true);
      setPixAutomatic(true);
      setDeclaradoCartao(expectedCard);
      setDeclaradoPix(expectedPix);
    } else {
      setCardAutomatic(false);
      setPixAutomatic(false);
      setDeclaradoCartao('');
      setDeclaradoPix('');
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
      setErrorMsg('Há uma diferença nos valores. Informe o motivo antes de continuar.');
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
      setErrorMsg(error instanceof Error ? error.message : 'Não foi possível fechar o caixa.');
      setShowConfirmModal(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePrintComprovante = async () => {
    if (!fechamentoResult || isPrinting) return;
    try {
      setIsPrinting(true);
      setErrorMsg(null);
      await imprimirComprovanteFechamento(fechamentoResult.turno_id);
    } catch (error: unknown) {
      setErrorMsg(error instanceof Error ? error.message : 'Erro ao enfileirar o comprovante de fechamento.');
    } finally {
      setIsPrinting(false);
    }
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
      <div className="cashier-fluid-view closing-workspace grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(280px,.5fr)]">
        <section className="cashier-fluid-panel overflow-hidden rounded-3xl border border-koma-border bg-koma-panel">
          <header className="flex flex-col gap-4 border-b border-koma-border p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-emerald-300 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300">
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
            {errorMsg && (
              <div className="mb-4 flex items-start gap-2 rounded-xl border border-rose-300 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/30 p-3 text-xs text-rose-800 dark:text-rose-300" role="alert">
                <AlertCircle size={16} className="mt-0.5 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}
            <div className={clsx(
              'mb-4 flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between',
              isExact ? 'border-emerald-300 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-950/30' : 'border-rose-300 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/30',
            )}>
              <div>
                <strong className={clsx('block text-sm', isExact ? 'text-emerald-800 dark:text-emerald-300' : 'text-rose-800 dark:text-rose-300')}>
                  {isExact ? 'Caixa conferido sem divergência' : isSurplus ? 'Sobra identificada na conferência' : 'Falta identificada na conferência'}
                </strong>
                <span className="mt-1 block text-[10px] text-koma-subtle">
                  {isExact ? 'Os valores contados conferem com os registros do sistema.' : 'A diferença ficou registrada no fechamento para auditoria.'}
                </span>
              </div>
              <strong className={clsx('text-xl tabular-nums', isExact ? 'text-emerald-800 dark:text-emerald-300' : 'text-rose-800 dark:text-rose-300')}>
                {difference > 0 ? '+' : ''}{formatMoney(difference)}
              </strong>
            </div>

            <div className="overflow-x-auto overscroll-x-contain rounded-2xl border border-koma-border">
              <table className="w-full min-w-[620px] text-left text-xs">
                <thead className="bg-koma-panel text-[9px] uppercase tracking-wider text-koma-muted">
                  <tr>
                    <th className="p-3">Meio</th>
                    <th className="p-3">Sistema</th>
                    <th className="p-3">Contado</th>
                    <th className="p-3 text-right">Diferença</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-koma-border text-koma-secondary">
                  {rows.map(([label, expected, declared, rowDifference]) => (
                    <tr key={label}>
                      <td className="p-3 font-semibold text-koma-foreground">{label}</td>
                      <td className="p-3 tabular-nums">{formatMoney(expected)}</td>
                      <td className="p-3 tabular-nums">{formatMoney(declared)}</td>
                      <td className={clsx('p-3 text-right font-semibold tabular-nums', Math.abs(rowDifference) < 0.01 ? 'text-emerald-800 dark:text-emerald-300' : 'text-rose-800 dark:text-rose-300')}>
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

        <aside className="cashier-fluid-panel flex flex-col justify-between rounded-3xl border border-koma-border bg-koma-panel p-5">
          <div>
            <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-emerald-800 dark:text-emerald-300">Próximo turno</p>
            <h3 className="mt-2 text-lg font-bold text-koma-foreground">Caixa pronto para recomeçar</h3>
            <p className="mt-2 text-xs leading-relaxed text-koma-muted">O fechamento foi gravado e os valores permanecerão disponíveis no histórico do caixa.</p>
          </div>
          {onOpenNovoTurnoModal && (
            <button type="button" onClick={onOpenNovoTurnoModal} className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-600 hover:bg-emerald-500 px-4 py-3 text-xs font-bold text-white transition-colors hover:bg-emerald-600 hover:bg-emerald-500">
              <DollarSign size={16} /> Abrir novo turno
            </button>
          )}
          
          <button type="button" onClick={handlePrintComprovante} disabled={isPrinting} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-koma-border-subtle bg-koma-panel px-4 py-3 text-xs font-bold text-koma-secondary transition-colors hover:bg-koma-raised hover:text-koma-foreground disabled:cursor-not-allowed disabled:opacity-60">
            <Printer size={16} /> {isPrinting ? 'Enviando para impressão...' : 'Imprimir comprovante'}
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
          <button type="button" onClick={onOpenNovoTurnoModal} className="mt-5 inline-flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-600 hover:bg-emerald-500 px-5 py-2.5 text-xs font-bold text-white hover:bg-emerald-600 hover:bg-emerald-500">
            <DollarSign size={15} /> Abrir caixa
          </button>
        )}
      </section>
    );
  }

  return (
    <div className="cashier-fluid-view closing-workspace grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,.55fr)]">
      <section className="cashier-fluid-panel rounded-2xl sm:rounded-3xl border border-koma-border bg-koma-panel p-4 sm:p-6">
        <div className="border-b border-koma-border pb-4">
          <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-emerald-800 dark:text-emerald-300">Como você quer conferir?</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Modo de conferência do caixa">
            <button
              type="button"
              role="radio"
              aria-checked={closingMode === 'rapida'}
              onClick={() => handleModeChange('rapida')}
              className={clsx('rounded-2xl border p-4 text-left transition-colors', closingMode === 'rapida' ? 'border-emerald-500/50 bg-emerald-50 dark:bg-emerald-950/30' : 'border-koma-border bg-koma-card hover:bg-koma-raised')}
            >
              <strong className="block text-sm text-koma-foreground">Conferência rápida</strong>
              <span className="mt-1 block text-[10px] leading-relaxed text-koma-muted">Pix e cartões vêm dos pagamentos registrados. Você conta o dinheiro e pode corrigir qualquer valor.</span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={closingMode === 'cega'}
              onClick={() => handleModeChange('cega')}
              className={clsx('rounded-2xl border p-4 text-left transition-colors', closingMode === 'cega' ? 'border-emerald-500/50 bg-emerald-50 dark:bg-emerald-950/30' : 'border-koma-border bg-koma-card hover:bg-koma-raised')}
            >
              <strong className="block text-sm text-koma-foreground">Conferência cega</strong>
              <span className="mt-1 block text-[10px] leading-relaxed text-koma-muted">Nenhum valor esperado aparece antes do fechamento. Informe dinheiro, cartões e Pix manualmente.</span>
            </button>
          </div>
        </div>

        {errorMsg && (
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-rose-300 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/30 p-3 text-xs text-rose-800 dark:text-rose-300" role="alert">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handlePreSubmit} className="mt-5">
          <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
            <CountField
              id="closing-cash"
              label="Dinheiro contado"
              help="Conte as notas e moedas que estão no caixa."
              icon={DollarSign}
              value={declaradoDinheiro}
              expected={expectedCash}
              required
              hideExpected={closingMode === 'cega' || declaradoDinheiro === ''}
              onChange={setDeclaradoDinheiro}
            />
            <CountField
              id="closing-card"
              label="Cartões"
              help={closingMode === 'rapida' ? 'Valor registrado nos pagamentos. Edite somente se precisar corrigir.' : 'Informe o total conferido nos comprovantes.'}
              icon={CreditCard}
              value={declaradoCartao}
              expected={expectedCard}
              required
              allowNegative
              hideExpected={closingMode === 'cega'}
              automatic={closingMode === 'rapida' && cardAutomatic}
              onChange={(next) => { setDeclaradoCartao(next); setCardAutomatic(false); }}
            />
            <CountField
              id="closing-pix"
              label="Pix"
              help={closingMode === 'rapida' ? 'Valor registrado nos pagamentos. Edite somente se precisar corrigir.' : 'Informe o total conferido no Pix.'}
              icon={Smartphone}
              value={declaradoPix}
              expected={expectedPix}
              required
              allowNegative
              hideExpected={closingMode === 'cega'}
              automatic={closingMode === 'rapida' && pixAutomatic}
              onChange={(next) => { setDeclaradoPix(next); setPixAutomatic(false); }}
            />
          </div>

          <label htmlFor="closing-note" className="mt-4 block">
            <span className={clsx('text-[9px] font-bold uppercase tracking-[0.12em]', isDivergent ? 'text-rose-800 dark:text-rose-300' : 'text-koma-muted')}>
              Observação {isDivergent ? <span className="normal-case tracking-normal ml-1">* explique a diferença</span> : <span className="normal-case tracking-normal">(opcional)</span>}
            </span>
            <textarea
              id="closing-note"
              rows={2}
              maxLength={500}
              placeholder={isDivergent ? 'Explique a diferença encontrada...' : 'Ex.: comprovante ausente, valor deixado para troco...'}
              value={observacao}
              onChange={(event) => setObservacao(event.target.value)}
              required={isDivergent}
              className={clsx('mt-2 w-full resize-none rounded-xl border bg-koma-panel px-3 py-3 text-xs text-koma-foreground outline-none placeholder:text-zinc-700 focus:border-[#2a9f7d]', isDivergent && !observacao.trim() ? 'border-rose-300 dark:border-rose-900/50' : 'border-koma-border')}
            />
          </label>

          <div className="closing-toolbar-actions mt-4 flex flex-col gap-3 rounded-2xl border border-koma-border bg-koma-panel p-4 sm:flex-row sm:items-center sm:justify-between">
            {closingMode === 'rapida' ? (
              <div className="grid grid-cols-3 gap-x-2 gap-y-1 sm:gap-x-5">
                <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-koma-muted">Registrado</span>
                <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-koma-muted">Informado</span>
                <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-koma-muted">Diferença</span>
                <strong className="text-sm tabular-nums text-koma-secondary sm:text-base">{formatMoney(expectedTotal)}</strong>
                <strong className="text-sm tabular-nums text-koma-foreground sm:text-base">{hasMissingDeclarations ? '—' : formatMoney(declaredTotal)}</strong>
                <strong className={clsx('text-sm tabular-nums sm:text-base', hasMissingDeclarations ? 'text-koma-muted' : Math.abs(liveDifference) < 0.01 ? 'text-emerald-800 dark:text-emerald-300' : 'text-rose-800 dark:text-rose-300')}>
                  {hasMissingDeclarations ? '—' : `${liveDifference > 0 ? '+' : ''}${formatMoney(liveDifference)}`}
                </strong>
              </div>
            ) : (
              <div>
                <span className="block text-[9px] font-bold uppercase tracking-[0.12em] text-koma-muted">Total informado</span>
                <strong className="mt-1 block text-base tabular-nums text-koma-foreground">{hasMissingDeclarations ? '—' : formatMoney(declaredTotal)}</strong>
                <span className="mt-1 block text-[10px] text-koma-muted">A comparação com o sistema só aparece depois de fechar.</span>
              </div>
            )}
            <button type="submit" disabled={hasBlockingPending || hasMissingDeclarations || isSubmitting} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-600 px-5 py-3 text-xs font-bold text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:border-koma-border-subtle disabled:bg-koma-raised disabled:text-zinc-600">
              <Lock size={15} /> Revisar fechamento <ArrowRight size={15} />
            </button>
          </div>
        </form>
      </section>

      <aside className="cashier-fluid-panel rounded-3xl border border-koma-border bg-koma-panel p-5">
        <div className="border-b border-koma-border pb-4">
          <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-emerald-800 dark:text-emerald-300">Antes de fechar</p>
          <h2 className="mt-1 text-base font-bold text-koma-foreground">Resolva só o que está pendente</h2>
        </div>

        <div className="mt-4 space-y-3">
          <div className={clsx('rounded-2xl border p-4', pendingPaymentsCount > 0 ? 'border-rose-300 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/30' : 'border-emerald-300 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-950/30')}>
            <div className="flex items-start justify-between gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-current/20 text-emerald-800 dark:text-emerald-300"><ReceiptText size={17} /></span>
              <strong className="text-xl tabular-nums text-koma-foreground">{pendingPaymentsCount}</strong>
            </div>
            <h3 className="mt-3 text-xs font-bold text-koma-foreground">Pagamentos para confirmar</h3>
            <p className="mt-1 text-[10px] text-koma-muted">{pendingPaymentsCount > 0 ? `${formatMoney(pendingPaymentsTotal)} ainda precisa de confirmação.` : 'Nenhum pagamento aguardando confirmação.'}</p>
            {pendingPaymentsCount > 0 && onNavigateToPendingPayments && (
              <button type="button" onClick={onNavigateToPendingPayments} className="mt-3 inline-flex items-center gap-1.5 text-[10px] font-bold text-emerald-800 dark:text-emerald-300 hover:text-koma-foreground">Ver pagamentos <ArrowRight size={13} /></button>
            )}
          </div>

          <div className={clsx('rounded-2xl border p-4', openAccountsCount > 0 ? 'border-rose-300 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/30' : 'border-emerald-300 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-950/30')}>
            <div className="flex items-start justify-between gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-current/20 text-emerald-800 dark:text-emerald-300"><ClipboardCheck size={17} /></span>
              <strong className="text-xl tabular-nums text-koma-foreground">{openAccountsCount}</strong>
            </div>
            <h3 className="mt-3 text-xs font-bold text-koma-foreground">Contas ainda abertas</h3>
            <p className="mt-1 text-[10px] text-koma-muted">{openAccountsCount > 0 ? 'Finalize essas contas antes de encerrar o turno.' : 'Todas as contas estão finalizadas.'}</p>
            {openAccountsCount > 0 && onNavigateToOpenComandas && (
              <button type="button" onClick={onNavigateToOpenComandas} className="mt-3 inline-flex items-center gap-1.5 text-[10px] font-bold text-emerald-800 dark:text-emerald-300 hover:text-koma-foreground">Ver contas <ArrowRight size={13} /></button>
            )}
          </div>
        </div>

        <div className={clsx('mt-4 flex items-start gap-3 rounded-2xl border p-4', hasBlockingPending ? 'border-rose-300 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/30' : 'border-emerald-300 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-950/30')}>
          {hasBlockingPending ? <AlertCircle size={18} className="mt-0.5 shrink-0 text-rose-800 dark:text-rose-300" /> : <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-800 dark:text-emerald-300" />}
          <div>
            <strong className={clsx('block text-xs', hasBlockingPending ? 'text-rose-800 dark:text-rose-300' : 'text-emerald-800 dark:text-emerald-300')}>{hasBlockingPending ? 'Ainda não dá para fechar' : 'Pronto para conferir'}</strong>
            <p className="mt-1 text-[10px] leading-relaxed text-koma-subtle">{hasBlockingPending ? 'Resolva os itens acima para continuar.' : closingMode === 'cega' ? 'Os valores do sistema ficarão ocultos até o fechamento.' : 'Cartões e Pix já estão preenchidos; conte o dinheiro para continuar.'}</p>
          </div>
        </div>
      </aside>

      {showConfirmModal && (
        <div onClick={(event) => { if (event.target === event.currentTarget && !isSubmitting) setShowConfirmModal(false); }} className="fixed inset-0 z-50 flex cursor-pointer items-center justify-center overflow-y-auto bg-black/80 p-4 backdrop-blur-sm">
          <div role="dialog" aria-modal="true" aria-labelledby="confirm-closing-title" className="my-8 w-full max-w-md cursor-default rounded-3xl border border-koma-border-subtle bg-koma-panel p-5 shadow-2xl">
            <div className="flex items-start gap-3 border-b border-koma-border pb-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-emerald-300 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300"><Lock size={18} /></span>
              <div>
                <h2 id="confirm-closing-title" className="text-base font-bold text-koma-foreground">Confirmar fechamento?</h2>
                <p className="mt-1 text-[10px] leading-relaxed text-koma-muted">Depois de confirmar, este turno fica encerrado.</p>
              </div>
            </div>

            {closingMode === 'rapida' ? (
              <div className="mt-4 overflow-hidden rounded-2xl border border-koma-border bg-koma-panel text-[10px]">
                <div className="grid grid-cols-[1fr_repeat(3,auto)] gap-x-3 border-b border-koma-border px-4 py-2 font-bold uppercase tracking-wider text-koma-muted">
                  <span>Meio</span><span>Registrado</span><span>Informado</span><span>Dif.</span>
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
                      <span className={Math.abs(rowDifference) < 0.01 ? 'text-emerald-800 dark:text-emerald-300' : 'text-rose-800 dark:text-rose-300'}>{rowDifference > 0 ? '+' : ''}{formatMoney(rowDifference)}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="mt-4 rounded-2xl border border-koma-border bg-koma-card p-4">
                <strong className="block text-xs text-koma-foreground">Conferência cega mantida</strong>
                <p className="mt-1 text-[10px] leading-relaxed text-koma-muted">Os valores registrados pelo sistema continuam ocultos. A comparação aparece somente depois que o turno for encerrado.</p>
                <dl className="mt-3 space-y-2 text-[10px] text-koma-secondary">
                  <div className="flex justify-between"><dt>Dinheiro informado</dt><dd className="font-bold tabular-nums text-koma-foreground">{formatMoney(Number(declaradoDinheiro || 0))}</dd></div>
                  <div className="flex justify-between"><dt>Cartões informados</dt><dd className="font-bold tabular-nums text-koma-foreground">{formatMoney(Number(declaradoCartao || 0))}</dd></div>
                  <div className="flex justify-between"><dt>Pix informado</dt><dd className="font-bold tabular-nums text-koma-foreground">{formatMoney(Number(declaradoPix || 0))}</dd></div>
                </dl>
              </div>
            )}

            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => setShowConfirmModal(false)} disabled={isSubmitting} className="flex-1 rounded-xl border border-koma-border-subtle bg-koma-panel px-3 py-3 text-xs font-bold text-koma-secondary hover:text-koma-foreground disabled:opacity-50">Voltar</button>
              <button type="button" onClick={handleExecuteFechamento} disabled={isSubmitting} className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-600 px-3 py-3 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50">
                <Check size={15} /> {isSubmitting ? 'Fechando...' : 'Fechar caixa'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

};
