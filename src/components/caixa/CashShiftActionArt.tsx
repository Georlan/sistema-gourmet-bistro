/** Compact operational artwork, always accompanied by an action label. */
export function CashShiftActionArt({kind}: {kind: 'cash' | 'add' | 'withdraw' | 'close'}) {
  return <svg width="30" height="30" viewBox="0 0 40 40" fill="none" aria-hidden="true" focusable="false">
    <rect x="4" y="9" width="32" height="23" rx="5" fill="#195b47" stroke="#8bd8bf" strokeWidth="1.5"/>
    <path d="M9 25h22M10 29h20" stroke="#8bd8bf" strokeWidth="2" strokeLinecap="round"/>
    {kind === 'cash' ? <><rect x="10" y="3" width="20" height="16" rx="2" fill="#baedd9"/><circle cx="20" cy="11" r="4" stroke="#195b47" strokeWidth="2"/></> : kind === 'close' ? <><rect x="13" y="11" width="14" height="12" rx="3" fill="#baedd9"/><path d="M16 11V8a4 4 0 0 1 8 0v3" stroke="#baedd9" strokeWidth="2.5"/><circle cx="20" cy="17" r="1.5" fill="#195b47"/></> : <><circle cx="28" cy="11" r="9" fill={kind === 'add' ? '#baedd9' : '#efc4b8'}/><path d={kind === 'add' ? 'M28 6v10m-4-4 4 4 4-4' : 'M28 16V6m-4 4 4-4 4 4'} stroke="#195b47" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></>}
  </svg>;
}
