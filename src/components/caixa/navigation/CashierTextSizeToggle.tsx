import type { KomaTextSize } from '../../../config/textSize';
import './cashierTextSizeToggle.css';

/** The existing persisted preference, with two deliberate operational sizes. */
export function CashierTextSizeToggle({ size, onChange }: { size: KomaTextSize; onChange: (size: KomaTextSize) => void }) {
  const large = size !== 'padrao';
  const label = large ? 'Usar texto padrão' : 'Usar texto grande';
  return <button type="button" id="btn-caixa-text-size" className="cashier-text-toggle"
    aria-label="Texto grande" aria-pressed={large} title={`${large ? 'Texto grande' : 'Texto padrão'} · ${label}`}
    onClick={() => onChange(large ? 'padrao' : 'grande')}>
    <svg viewBox="0 0 28 24" width="26" height="24" fill="none" aria-hidden="true" focusable="false" data-large={large}>
      <path className="cashier-text-toggle__letter" d="m3 19 6-15 6 15M5.4 13h7.2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <path className="cashier-text-toggle__arrow" d={large ? 'M23 5v13m-3-3 3 3 3-3' : 'M23 19V6m-3 3 3-3 3 3'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  </button>;
}
