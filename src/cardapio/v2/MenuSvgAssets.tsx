import React from "react";

interface SvgProps {
  className?: string;
  size?: number;
}

/**
 * Full-bleed concave organic wave backdrop for the store hero.
 * Flows seamlessly from --km-header-deep into --km-page with zero boxy borders.
 */
export function MenuTopWaveBackdrop({ className }: SvgProps) {
  return (
    <svg
      viewBox="0 0 440 160"
      preserveAspectRatio="none"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M0 0H440V116C368 152 292 146 220 126C148 106 72 98 0 132V0Z"
        fill="var(--km-header-deep)"
      />
      <path
        d="M170 0H440V84C380 112 315 102 260 68C215 40 185 18 170 0Z"
        fill="var(--km-art-field)"
        opacity="0.32"
      />
      <circle cx="388" cy="34" r="46" fill="var(--km-art-dome)" opacity="0.12" />
    </svg>
  );
}

/**
 * Curved organic backdrop for the "Promoções da Casa" showcase (inspired by "Special for you").
 */
export function MenuPromoArcBackdrop({ className }: SvgProps) {
  return (
    <svg
      viewBox="0 0 440 180"
      preserveAspectRatio="none"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M0 10C120 -16 320 -16 440 10V180H0V10Z"
        fill="var(--km-header-deep)"
      />
      <circle cx="370" cy="48" r="64" fill="var(--km-art-field)" opacity="0.3" />
    </svg>
  );
}

/** Custom weighted UI glyphs for buttons and curved bottom navigation */
export function MenuBagGlyph({ className }: SvgProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M6.5 8.5H17.5L19 19.5C19.1 20.3 18.5 21 17.7 21H6.3C5.5 21 4.9 20.3 5 19.5L6.5 8.5Z"
        fill="currentColor"
        fillOpacity="0.16"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinejoin="round"
      />
      <path
        d="M9 8.5V6.5C9 4.84 10.34 3.5 12 3.5C13.66 3.5 15 4.84 15 6.5V8.5"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function MenuSearchGlyph({ className, size }: SvgProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <circle
        cx="11"
        cy="11"
        r="6.5"
        fill="currentColor"
        fillOpacity="0.12"
        stroke="currentColor"
        strokeWidth="1.9"
      />
      <path
        d="M16 16L20 20"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function MenuCategoriesGlyph({ className }: SvgProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <rect x="4" y="4.5" width="6.5" height="6.5" rx="2" fill="currentColor" fillOpacity="0.22" stroke="currentColor" strokeWidth="1.8" />
      <rect x="13.5" y="4.5" width="6.5" height="6.5" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="2" fill="currentColor" fillOpacity="0.22" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

export function MenuHomeGlyph({ className }: SvgProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M4 10.5L12 4L20 10.5V19C20 19.8 19.3 20.5 18.5 20.5H5.5C4.7 20.5 4 19.8 4 19V10.5Z"
        fill="currentColor"
        fillOpacity="0.15"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinejoin="round"
      />
      <path
        d="M9.5 20.5V14.5C9.5 13.7 10.2 13 11 13H13C13.8 13 14.5 13.7 14.5 14.5V20.5"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function MenuOrdersGlyph({ className }: SvgProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M6.5 4H17.5C18.3 4 19 4.7 19 5.5V20L16.5 18.4L14.2 20L12 18.4L9.8 20L7.5 18.4L5 20V5.5C5 4.7 5.7 4 6.5 4Z"
        fill="currentColor"
        fillOpacity="0.14"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinejoin="round"
      />
      <path d="M8.5 9H15.5M8.5 13H13.5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}

export function MenuAccountGlyph({ className }: SvgProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <circle
        cx="12"
        cy="8.5"
        r="3.5"
        fill="currentColor"
        fillOpacity="0.18"
        stroke="currentColor"
        strokeWidth="1.9"
      />
      <path
        d="M5.5 19.5C6.5 16.3 9 14.8 12 14.8C15 14.8 17.5 16.3 18.5 19.5"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
    </svg>
  );
}
