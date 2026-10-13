import MoneyInput from '../../MoneyInput';
import { formatCurrency } from '../cashierPresentation';
import { splitPlanStatus, type SplitPaymentPart, type SplitPaymentMethod } from './splitPaymentPlan';

const METHODS: { id: SplitPaymentMethod; label: string }[] = [
  { id: 'dinheiro', label: 'Dinheiro' },
  { id: 'pix', label: 'Pix' },
  { id: 'cartao_debito', label: 'Cartão de débito' },
  { id: 'cartao_credito', label: 'Cartão de crédito' },
];

type Props = {
  parts: readonly SplitPaymentPart[];
  balance: number;
  locked: boolean;
  onUpdate: (id: number, patch: Partial<Pick<SplitPaymentPart, 'metodo' | 'valor'>>) => void;
  onAdd: () => void;
  onRemove: (id: number) => void;
  onClear: () => void;
};

export function SplitPaymentPlanner({
  parts, balance, locked, onUpdate, onAdd, onRemove, onClear,
}: Props) {
  const summary = splitPlanStatus(parts, balance);
  return (
    <section data-testid="split-payment-plan" aria-label="Divisão por forma de pagamento" className="space-y-3 rounded-xl border border-koma-border bg-koma-panel p-3">
      <div>
        <h4 className="text-sm font-bold text-koma-foreground">Divisão do pagamento</h4>
        <p className="mt-1 text-xs text-koma-secondary">
          Defina quanto vai em dinheiro, Pix ou cartão. Confira e receba uma parte por vez.
          Cada parte será registrada separadamente no Caixa.
        </p>
      </div>
      {parts.map((part, index) => (
        <div key={part.id} className="rounded-lg border border-koma-border/75 bg-koma-card p-2.5">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-bold text-koma-foreground">
              {index === 0 ? 'Próxima parte a receber' : `Parte ${index + 1}`}
            </span>
            {parts.length > 2 && !locked && (
              <button type="button" onClick={() => onRemove(part.id)}
                aria-label={`Remover parte ${index + 1}`} className="text-xs font-semibold text-rose-500">
                Remover
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="space-y-1 text-xs font-medium text-koma-secondary">
              <span>Forma de pagamento</span>
              <select aria-label={`Forma da parte ${index + 1}`} value={part.metodo}
                disabled={locked}
                onChange={event => onUpdate(part.id, { metodo: event.target.value as SplitPaymentMethod | '' })}
                className="min-h-11 w-full rounded-lg border border-koma-border bg-koma-input px-3 text-sm text-koma-foreground">
                <option value="">Selecione</option>
                {METHODS.map(method => <option key={method.id} value={method.id}>{method.label}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-xs font-medium text-koma-secondary">
              <span>Valor (R$)</span>
              <MoneyInput aria-label={`Valor da parte ${index + 1}`} value={part.valor}
                disabled={locked} onValueChange={valor => onUpdate(part.id, { valor })}
                placeholder="0,00"
                className="min-h-11 w-full rounded-lg border border-koma-border bg-koma-input px-3 text-sm text-koma-foreground font-mono" />
            </label>
          </div>
        </div>
      ))}
      <div className="space-y-1 border-t border-koma-border pt-2 text-xs" aria-live="polite">
        <p className="flex justify-between text-koma-secondary"><span>Saldo da mesa</span><strong>{formatCurrency(balance)}</strong></p>
        <p className="flex justify-between text-koma-secondary"><span>Distribuído</span><strong>{formatCurrency(summary.plannedCents / 100)}</strong></p>
        <p className="flex justify-between font-bold text-koma-foreground">
          <span>{summary.differenceCents >= 0 ? 'Falta distribuir' : 'Excedente'}</span>
          <strong>{formatCurrency(Math.abs(summary.differenceCents) / 100)}</strong>
        </p>
        {!summary.valid && <p className="text-amber-600 dark:text-amber-400">
          Informe uma forma e valor positivo por parte. A soma deve ser igual ao saldo a receber.
        </p>}
      </div>
      {!locked && <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onAdd} className="min-h-10 rounded-lg border border-emerald-500/40 px-3 text-xs font-bold text-emerald-700 dark:text-emerald-300">
          + Adicionar forma
        </button>
        <button type="button" onClick={onClear} className="min-h-10 rounded-lg border border-koma-border px-3 text-xs text-koma-secondary">
          Receber sem planejar
        </button>
      </div>}
      {locked && <p className="text-xs text-amber-600 dark:text-amber-400">
        Esta parte já foi enviada. Confirme o resultado antes de alterar os valores; tentativas repetidas mantêm a mesma chave de pagamento.
      </p>}
    </section>
  );
}
