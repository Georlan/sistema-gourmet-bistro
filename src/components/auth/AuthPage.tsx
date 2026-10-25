import type { ReactNode } from 'react';
import { KomaLogo } from '../KomaLogo';
import './authPresentation.css';

/** Presentation only. Each owner retains its own authentication contract. */
export function AuthPage({ children, tools }: { children: ReactNode; tools?: ReactNode }) {
  return <main className="k-auth-page">
    {tools && <div className="k-auth-tools">{tools}</div>}
    <div className="k-auth-layout">
      <div className="k-auth-brand">
        <KomaLogo withText size="custom" contextualWordmark={false} imageClassName="k-auth-wordmark" />
        <svg className="k-auth-art" viewBox="0 0 460 360" fill="none" aria-hidden="true" focusable="false">
          {/* Interlocking planes extend the wordmark geometry across the whole team. */}
          <path d="M-38 292 134 120c28-28 74-28 102 0l62 62-58 58-55-55L20 350Z" fill="#05C49D" />
          <path d="m168 292 164-164c28-28 74-28 102 0l64 64v116l-115-115-157 157Z" fill="#78DCC2" />
          <path d="m240 240 58-58 58 58-58 58Z" fill="#007A64" />
          <path d="M298 58 326 30l28 28-28 28Z" fill="#78DCC2" />
          <path d="m58 102 21-21 21 21-21 21Z" fill="#05C49D" />
        </svg>
      </div>
      <section className="k-auth-content">{children}</section>
    </div>
  </main>;
}
