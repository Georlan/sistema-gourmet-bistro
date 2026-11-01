/** Small, local SVGs: no image downloads or extra runtime dependencies. */
export function CashierFooterArt({ kind }: { kind: 'pause' | 'resume' | 'help' }) {
  return <svg className="cashier-footer-art" viewBox="0 0 40 40" fill="none" aria-hidden="true" focusable="false">
    {kind === 'help' ? <>
      <path d="M7 9h25v19H20l-8 6v-6H7z" fill="currentColor" opacity=".16" />
      <path d="M7 8h26v20H21l-8 6v-6H7z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M16.5 15a3.6 3.6 0 0 1 7 .8c0 2.5-3.5 2.2-3.5 4.7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="20" cy="24" r="1.1" fill="currentColor" />
      <path d="m29 4 2-2m5 7h2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </> : <>
      <path d="M9 5h17l6 6v25H9z" fill="currentColor" opacity=".13" />
      <path d="M9 5h17l6 6v25H9V5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M25 5v7h7M14 16h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      {kind === 'resume' ? <path d="m17 21 8 5-8 5z" fill="currentColor" /> : <path d="M17 22v8m7-8v8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />}
      <path d="M5 12v19" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity=".5" />
    </>}
  </svg>;
}
