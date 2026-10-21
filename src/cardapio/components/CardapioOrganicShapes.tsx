import React from 'react';
import { Crown, Sparkles, Flame, Tag } from 'lucide-react';

export function KomaWaveDivider({ className = '' }: { className?: string }) {
  return (
    <div className={`koma-wave-divider-wrap ${className}`} aria-hidden="true">
      <svg
        viewBox="0 0 1200 290"
        preserveAspectRatio="none"
        className="koma-wave-divider-svg"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M0 0H1200V144C1045 84 933 248 770 222C583 192 537 94 355 136C210 169 148 244 0 193Z"
          fill="var(--koma-wave-base, currentColor)"
        />
        <path
          d="M0 145C138 222 241 103 354 125C538 163 557 243 744 237C951 230 1037 116 1200 160"
          stroke="var(--koma-wave-accent, #20d69b)"
          strokeWidth="3.5"
          opacity="0.85"
        />
      </svg>
    </div>
  );
}

export function KomaOrganicBackplate({ className = '' }: { className?: string }) {
  return (
    <div className={`koma-backplate-wrap ${className}`} aria-hidden="true">
      <svg
        viewBox="0 0 900 500"
        preserveAspectRatio="none"
        className="koma-backplate-svg"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M45 180C39 78 125 20 252 54C348 82 405 28 511 39C627 50 655 102 750 87C855 70 887 151 851 232C810 323 881 391 747 445C636 490 570 421 455 448C332 477 273 416 184 429C66 446 9 362 45 180Z"
          fill="var(--koma-plate-fill, #0c2b22)"
        />
        <path
          d="M103 321C190 404 302 372 405 401C555 443 672 408 773 329"
          stroke="var(--koma-plate-line, #20d69b)"
          strokeWidth="4"
          opacity="0.65"
        />
      </svg>
    </div>
  );
}

export function KomaHeroCorner({ className = '' }: { className?: string }) {
  return (
    <div className={`koma-corner-wrap ${className}`} aria-hidden="true">
      <svg
        viewBox="0 0 540 440"
        preserveAspectRatio="none"
        className="koma-corner-svg"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M540 0H220C340 41 358 100 319 170C265 258 335 357 540 440Z"
          fill="var(--koma-hero-accent, #0a4d3c)"
          opacity="0.4"
        />
        <path
          d="M540 0H302C384 59 394 127 365 194C338 256 377 339 540 381Z"
          fill="var(--koma-hero-mid, #062e24)"
          opacity="0.5"
        />
        <path
          d="M540 359C399 319 346 267 365 187"
          stroke="var(--koma-hero-line, #20d69b)"
          strokeWidth="2.5"
          opacity="0.75"
        />
      </svg>
    </div>
  );
}

export interface KomaSeloBadgeProps {
  label: string;
  icon?: 'crown' | 'sparkles' | 'flame' | 'tag';
  rank?: string | number;
  className?: string;
}

/**
 * Selo KÔMA Reconstruído:
 * Reinterpreta a anatomia do kit exploratório (prancha 04 / selo_01_01)
 * com formas SVG/CSS limpas, texto semântico em HTML acessível e
 * preservação estrita de contraste WCAG AA, dark/light mode e tokens do tenant.
 */
export function KomaSeloBadge({ label, icon = 'crown', rank = '#1', className = '' }: KomaSeloBadgeProps) {
  return (
    <div className={`koma-selo-badge ${className}`} role="status">
      <div className="koma-selo-badge__nódulo" aria-hidden="true">
        {icon === 'crown' && <Crown className="koma-selo-badge__icon" />}
        {icon === 'sparkles' && <Sparkles className="koma-selo-badge__icon" />}
        {icon === 'flame' && <Flame className="koma-selo-badge__icon" />}
        {icon === 'tag' && <Tag className="koma-selo-badge__icon" />}
        {rank && <span className="koma-selo-badge__rank">{rank}</span>}
      </div>
      <div className="koma-selo-badge__body">
        <span className="koma-selo-badge__label">{label}</span>
        <span className="koma-selo-badge__underline" aria-hidden="true" />
      </div>
    </div>
  );
}
