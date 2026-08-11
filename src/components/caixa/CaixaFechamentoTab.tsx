import React, { useMemo, useState } from 'react';
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
  Wifi,
  WifiOff,
} from 'lucide-react';
import { CaixaTurnoResumo, FechamentoCaixaResult } from '../../types';

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
  required?: boolean;
  onChange: (value: number | '') => void;
}

const CountField: React.FC<CountFieldProps> = ({
  id,
  label,
  help,
  icon: Icon,
  value,
  required,
  onChange,
}) => (
  <label htmlFor={id} className="block rounded-2xl border border-[#252b28] bg-[#111512] p-4 transition-colors focus-within:border-[#1f8f70]">
    <span className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-300">
      <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-[#1f5948] bg-[#0c2a22] text-[#54d9b3]">
        <Icon size={15} />
      </span>
      <span>{label}{required ? <span className="ml-1 text-[#54d9b3]">*</span> : null}</span>
    </span>
    <span className="mt-3 flex items-center rounded-xl border border-[#242925] bg-[#090c0a] px-3 focus-within:border-[#2a9f7d]">
      <span className="text-sm font-semibold text-zinc-500">R$</span>
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
        className="min-w-0 flex-1 bg-transparent px-2 py-3 text-lg font-semibold tabular-nums text-white outline-none placeholder:text-zinc-700"
      />
    </span>
    <span className="mt-2 block text-[10px] leading-relaxed text-zinc-500">{help}</span>
  </label>
);

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
  const declaredTotal = useMemo(
    () => Number(declaradoDinheiro || 0) + Number(declaradoCartao || 0) + Number(declaradoPix || 0),
    [declaradoCartao, declaradoDinheiro, declaradoPix],
  );

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
    if (declaradoDinheiro === '' || Number(declaradoDinheiro) < 0) {
      setErrorMsg('Informe o valor físico contado em dinheiro.');
      return;
    }
    if (hasBlockingPending) {
      setErrorMsg('Resolva as contas e confirmações pendentes antes de fechar o turno.');
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
        <section className="overflow-hidden rounded-3xl border border-[#252b28] bg-[#0d100f]">
          <header className="flex flex-col gap-4 border-b border-[#252b28] p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-[#1f7058] bg-[#0d3026] text-[#54d9b3]">
                <CheckCircle2 size={22} />
              </span>
              <div>
                <h2 className="text-base font-bold text-white">Turno encerrado com segurança</h2>
                <p className="mt-0.5 text-[11px] text-zinc-500">
                  Caixa #{fechamentoResult.turno_id} · {fechamentoResult.fechado_por_nome} · {new Date(fechamentoResult.fechado_em).toLocaleString('pt-BR')}
                </p>
              </div>
            </div>
            <span className="w-fit rounded-full border border-[#2d3531] bg-[#151a17] px-3 py-1 text-[9px] font-bold uppercase tracking-wider text-zinc-300">
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
                <span className="mt-1 block text-[10px] text-zinc-400">
                  {isExact ? 'Os valores contados conferem com os registros do sistema.' : 'A diferença ficou registrada no fechamento para auditoria.'}
                </span>
              </div>
              <strong className={clsx('text-xl tabular-nums', isExact ? 'text-[#54d9b3]' : 'text-[#f0b3aa]')}>
                {difference > 0 ? '+' : ''}{formatMoney(difference)}
              </strong>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-[#252b28]">
              <table className="w-full min-w-[620px] text-left text-xs">
                <thead className="bg-[#141815] text-[9px] uppercase tracking-wider text-zinc-500">
                  <tr>
                    <th className="p-3">Meio</th>
                    <th className="p-3">Sistema</th>
                    <th className="p-3">Contado</th>
                    <th className="p-3 text-right">Diferença</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#252b28] text-zinc-300">
                  {rows.map(([label, expected, declared, rowDifference]) => (
                    <tr key={label}>
                      <td className="p-3 font-semibold text-white">{label}</td>
                      <td className="p-3 tabular-nums">{formatMoney(expected)}</td>
                      <td className="p-3 tabular-nums">{formatMoney(declared)}</td>
                      <td className={clsx('p-3 text-right font-semibold tabular-nums', Math.abs(rowDifference) < 0.01 ? 'text-[#54d9b3]' : 'text-[#f0b3aa]')}>
                        {rowDifference > 0 ? '+' : ''}{formatMoney(rowDifference)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t border-[#303832] bg-[#141815] text-sm font-bold text-white">
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

        <aside className="flex flex-col justify-between rounded-3xl border border-[#252b28] bg-[#0d100f] p-5">
          <div>
            <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-[#54d9b3]">Próximo turno</p>
            <h3 className="mt-2 text-lg font-bold text-white">Caixa pronto para recomeçar</h3>
            <p className="mt-2 text-xs leading-relaxed text-zinc-500">O fechamento foi gravado e os valores permanecerão disponíveis no histórico do caixa.</p>
          </div>
          {onOpenNovoTurnoModal && (
            <button type="button" onClick={onOpenNovoTurnoModal} className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-[#1f8f70] bg-[#0f6f55] px-4 py-3 text-xs font-bold text-white transition-colors hover:bg-[#128364]">
              <DollarSign size={16} /> Abrir novo turno
            </button>
          )}
        </aside>
      </div>
    );
  }

  if (!isTurnoAberto) {
    return (
      <section className="rounded-3xl border border-[#252b28] bg-[#0d100f] p-8 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-[#2d3531] bg-[#151a17] text-zinc-400"><Lock size={22} /></span>
        <h2 className="mt-4 text-base font-bold text-white">Nenhum turno aberto</h2>
        <p className="mx-auto mt-2 max-w-lg text-xs leading-relaxed text-zinc-500">Abra o caixa para registrar vendas, movimentações e realizar a conferência ao final do expediente.</p>
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
      <section className="rounded-3xl border border-[#252b28] bg-[#0d100f] p-5 sm:p-6">
        <div className="flex flex-col gap-3 border-b border-[#252b28] pb-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-[#54d9b3]">Conferência cega</p>
            <h2 className="mt-1 text-lg font-bold text-white">Conte antes de comparar</h2>
            <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-zinc-500">Informe o que existe na gaveta e nos comprovantes. Os valores esperados só aparecem depois da confirmação.</p>
          </div>
          <button type="button" onClick={handleRefresh} disabled={!onRefresh || isRefreshing} className="inline-flex w-fit items-center gap-2 rounded-xl border border-[#2d3531] bg-[#151a17] px-3 py-2 text-[10px] font-semibold text-zinc-300 hover:border-[#3a4540] hover:text-white disabled:opacity-50">
            <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} /> Atualizar dados
          </button>
        </div>

        {errorMsg && (
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-[#5d2b31] bg-[#251316] p-3 text-xs text-[#f0b3aa]" role="alert">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handlePreSubmit} className="mt-5">
          <div className="grid gap-3 md:grid-cols-3">
            <CountField id="closing-cash" label="Dinheiro contado" help="Notas e moedas presentes na gaveta." icon={DollarSign} value={declaradoDinheiro} required onChange={setDeclaradoDinheiro} />
            <CountField id="closing-card" label="Comprovantes de cartão" help="Total das maquininhas de débito e crédito." icon={CreditCard} value={declaradoCartao} onChange={setDeclaradoCartao} />
            <CountField id="closing-pix" label="Comprovantes Pix" help="Total confirmado nos recebimentos Pix." icon={Smartphone} value={declaradoPix} onChange={setDeclaradoPix} />
          </div>

          <label htmlFor="closing-note" className="mt-4 block">
            <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-zinc-500">Observação do fechamento <span className="normal-case tracking-normal">(opcional)</span></span>
            <textarea id="closing-note" rows={3} maxLength={500} placeholder="Registre uma informação útil para a conferência deste turno" value={observacao} onChange={(event) => setObservacao(event.target.value)} className="mt-2 w-full resize-none rounded-xl border border-[#252b28] bg-[#111512] px-3 py-3 text-xs text-white outline-none placeholder:text-zinc-700 focus:border-[#2a9f7d]" />
          </label>

          <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-[#252b28] bg-[#111512] p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-zinc-500">Total declarado</span>
              <strong className="mt-1 block text-xl tabular-nums text-white">{formatMoney(declaredTotal)}</strong>
            </div>
            <button type="submit" disabled={hasBlockingPending || isSubmitting} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[#1f8f70] bg-[#0f6f55] px-5 py-3 text-xs font-bold text-white transition-colors hover:bg-[#128364] disabled:cursor-not-allowed disabled:border-[#2d3531] disabled:bg-[#1a1f1c] disabled:text-zinc-600">
              <Lock size={15} /> Revisar e fechar caixa <ArrowRight size={15} />
            </button>
          </div>
        </form>
      </section>

      <aside className="rounded-3xl border border-[#252b28] bg-[#0d100f] p-5">
        <div className="flex items-center justify-between border-b border-[#252b28] pb-4">
          <div>
            <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-[#54d9b3]">Validação do turno</p>
            <h2 className="mt-1 text-base font-bold text-white">Antes de fechar</h2>
          </div>
          {isConnected ? <Wifi size={17} className="text-[#54d9b3]" /> : <WifiOff size={17} className="text-zinc-500" />}
        </div>

        <div className="mt-4 space-y-3">
          <div className={clsx('rounded-2xl border p-4', pendingPaymentsCount > 0 ? 'border-[#4b3430] bg-[#211816]' : 'border-[#254c40] bg-[#101d18]')}>
            <div className="flex items-start justify-between gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-current/20 text-[#54d9b3]"><ReceiptText size={17} /></span>
              <strong className="text-xl tabular-nums text-white">{pendingPaymentsCount}</strong>
            </div>
            <h3 className="mt-3 text-xs font-bold text-white">Pagamentos aguardando confirmação</h3>
            <p className="mt-1 text-[10px] text-zinc-500">{pendingPaymentsCount > 0 ? `${formatMoney(pendingPaymentsTotal)} ainda precisa ser conferido.` : 'Nenhum recebimento pendente neste momento.'}</p>
            {pendingPaymentsCount > 0 && onNavigateToPendingPayments && (
              <button type="button" onClick={onNavigateToPendingPayments} className="mt-3 inline-flex items-center gap-1.5 text-[10px] font-bold text-[#54d9b3] hover:text-white">Resolver pagamentos <ArrowRight size={13} /></button>
            )}
          </div>

          <div className={clsx('rounded-2xl border p-4', openAccountsCount > 0 ? 'border-[#4b3430] bg-[#211816]' : 'border-[#254c40] bg-[#101d18]')}>
            <div className="flex items-start justify-between gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-current/20 text-[#54d9b3]"><ClipboardCheck size={17} /></span>
              <strong className="text-xl tabular-nums text-white">{openAccountsCount}</strong>
            </div>
            <h3 className="mt-3 text-xs font-bold text-white">Comandas ainda abertas</h3>
            <p className="mt-1 text-[10px] text-zinc-500">{openAccountsCount > 0 ? 'Finalize as contas para não levar valores ao próximo turno.' : 'Todas as comandas estão finalizadas.'}</p>
            {openAccountsCount > 0 && onNavigateToOpenComandas && (
              <button type="button" onClick={onNavigateToOpenComandas} className="mt-3 inline-flex items-center gap-1.5 text-[10px] font-bold text-[#54d9b3] hover:text-white">Revisar comandas <ArrowRight size={13} /></button>
            )}
          </div>
        </div>

        <div className={clsx('mt-4 flex items-start gap-3 rounded-2xl border p-4', hasBlockingPending ? 'border-[#4b3430] bg-[#211816]' : 'border-[#1f7058] bg-[#0d3026]')}>
          {hasBlockingPending ? <AlertCircle size={18} className="mt-0.5 shrink-0 text-[#f0b3aa]" /> : <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-[#54d9b3]" />}
          <div>
            <strong className={clsx('block text-xs', hasBlockingPending ? 'text-[#f0b3aa]' : 'text-[#54d9b3]')}>{hasBlockingPending ? 'Fechamento bloqueado com segurança' : 'Turno pronto para conferência'}</strong>
            <p className="mt-1 text-[10px] leading-relaxed text-zinc-400">{hasBlockingPending ? 'Resolva as pendências acima. O sistema também valida tudo novamente no servidor.' : 'A confirmação fará uma última validação no servidor antes de encerrar.'}</p>
          </div>
        </div>
      </aside>

      {showConfirmModal && (
        <div onClick={(event) => { if (event.target === event.currentTarget && !isSubmitting) setShowConfirmModal(false); }} className="fixed inset-0 z-50 flex cursor-pointer items-center justify-center overflow-y-auto bg-black/80 p-4 backdrop-blur-sm">
          <div role="dialog" aria-modal="true" aria-labelledby="confirm-closing-title" className="my-8 w-full max-w-md cursor-default rounded-3xl border border-[#2d3531] bg-[#0d100f] p-5 shadow-2xl">
            <div className="flex items-start gap-3 border-b border-[#252b28] pb-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-[#1f7058] bg-[#0d3026] text-[#54d9b3]"><Lock size={18} /></span>
              <div>
                <h2 id="confirm-closing-title" className="text-base font-bold text-white">Confirmar encerramento do turno?</h2>
                <p className="mt-1 text-[10px] leading-relaxed text-zinc-500">Depois de confirmar, os lançamentos deste turno ficam encerrados e a conferência será exibida.</p>
              </div>
            </div>

            <dl className="mt-4 space-y-2 rounded-2xl border border-[#252b28] bg-[#111512] p-4 text-xs">
              <div className="flex justify-between gap-3 text-zinc-400"><dt>Dinheiro contado</dt><dd className="font-semibold tabular-nums text-white">{formatMoney(Number(declaradoDinheiro || 0))}</dd></div>
              <div className="flex justify-between gap-3 text-zinc-400"><dt>Comprovantes de cartão</dt><dd className="font-semibold tabular-nums text-white">{formatMoney(Number(declaradoCartao || 0))}</dd></div>
              <div className="flex justify-between gap-3 text-zinc-400"><dt>Comprovantes Pix</dt><dd className="font-semibold tabular-nums text-white">{formatMoney(Number(declaradoPix || 0))}</dd></div>
              <div className="flex justify-between gap-3 border-t border-[#252b28] pt-2 text-white"><dt className="font-bold">Total declarado</dt><dd className="font-bold tabular-nums text-[#54d9b3]">{formatMoney(declaredTotal)}</dd></div>
            </dl>

            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => setShowConfirmModal(false)} disabled={isSubmitting} className="flex-1 rounded-xl border border-[#2d3531] bg-[#151a17] px-3 py-3 text-xs font-bold text-zinc-300 hover:text-white disabled:opacity-50">Voltar e conferir</button>
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
