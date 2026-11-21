import React from "react";

interface AssetProps {
  className?: string;
  active?: boolean;
}

/**
 * Official KÔMA layered vector assets adapted from Caixa (CheckoutPaymentArt),
 * Entregador (CourierPaymentArtwork) and public/brand/cashier/ SVGs,
 * driven by --km-art-* tokens so every color theme (Green, Pink, Blue...) harmonizes automatically.
 */

export function KomaBagAsset({ className = "w-9 h-9", active = false }: AssetProps) {
  return (
    <svg
      viewBox="0 0 40 40"
      fill="none"
      className={`${className} transition-transform duration-300 ease-out ${active ? "scale-105" : ""}`}
      aria-hidden="true"
    >
      <rect x="7" y="13" width="26" height="21" rx="5" fill="var(--km-art-mid)" />
      <path
        d="M8 15C8 13.3 9.3 12 11 12H29C30.7 12 32 13.3 32 15L33 29C33 31.2 31.2 33 29 33H11C8.8 33 7 31.2 7 29L8 15Z"
        fill="var(--km-art-paper)"
        stroke="var(--km-art-ink)"
        strokeWidth="2"
      />
      <path
        d="M14.5 12V10C14.5 7.2 16.9 5 20 5C23.1 5 25.5 7.2 25.5 10V12"
        stroke="var(--km-art-ink)"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <path
        d="M15.5 18.5C15.5 21 17.5 23 20 23C22.5 23 24.5 21 24.5 18.5"
        stroke="var(--km-art-mid)"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function KomaDeliveryAsset({ className = "w-11 h-9" }: AssetProps) {
  return (
    <svg viewBox="0 0 56 40" fill="none" className={className} aria-hidden="true">
      <rect x="6" y="10" width="21" height="15" rx="3.5" fill="var(--km-art-mid)" stroke="var(--km-art-ink)" strokeWidth="2" />
      <path d="M27 14H36.5L43 22V26H27V14Z" fill="var(--km-art-paper)" stroke="var(--km-art-ink)" strokeWidth="2" strokeLinejoin="round" />
      <circle cx="16" cy="29" r="4.5" fill="var(--km-art-ink)" />
      <circle cx="16" cy="29" r="1.8" fill="var(--km-art-paper)" />
      <circle cx="37" cy="29" r="4.5" fill="var(--km-art-ink)" />
      <circle cx="37" cy="29" r="1.8" fill="var(--km-art-paper)" />
      <path d="M11 16H21" stroke="var(--km-art-paper)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function KomaPickupAsset({ className = "w-11 h-9" }: AssetProps) {
  return (
    <svg viewBox="0 0 56 40" fill="none" className={className} aria-hidden="true">
      <path d="M10 15L14 7H42L46 15H10Z" fill="var(--km-art-mid)" stroke="var(--km-art-ink)" strokeWidth="2" strokeLinejoin="round" />
      <rect x="12" y="15" width="32" height="18" rx="3" fill="var(--km-art-paper)" stroke="var(--km-art-ink)" strokeWidth="2" />
      <rect x="22" y="21" width="12" height="12" rx="2" fill="var(--km-art-ink)" />
      <path d="M17 15V18M28 15V18M39 15V18" stroke="var(--km-art-ink)" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function KomaDineInAsset({ className = "w-11 h-9" }: AssetProps) {
  return (
    <svg viewBox="0 0 56 40" fill="none" className={className} aria-hidden="true">
      <circle cx="28" cy="10" r="2.5" fill="var(--km-art-ink)" />
      <path d="M12 25C12 17.8 19.2 12 28 12C36.8 12 44 17.8 44 25H12Z" fill="var(--km-art-paper)" stroke="var(--km-art-ink)" strokeWidth="2" />
      <path d="M18 21C19.5 17.8 22.8 16 26.5 15.8" stroke="var(--km-art-mid)" strokeWidth="2" strokeLinecap="round" />
      <rect x="9" y="27" width="38" height="4.5" rx="2.25" fill="var(--km-art-mid)" stroke="var(--km-art-ink)" strokeWidth="1.8" />
    </svg>
  );
}

/** Exact CourierPaymentArtwork ("cash") geometry adapted to --km-art-* tokens */
export function KomaCashAsset({ className = "w-12 h-9" }: AssetProps) {
  return (
    <svg viewBox="0 0 56 40" fill="none" className={className} aria-hidden="true">
      <rect x="7" y="4" width="44" height="27" rx="5" fill="var(--km-art-mid)" />
      <rect x="3" y="9" width="44" height="27" rx="5" fill="var(--km-art-paper)" stroke="var(--km-art-ink)" strokeWidth="2" />
      <path d="M10 15h5M35 30h5" stroke="var(--km-art-mid)" strokeWidth="2" strokeLinecap="round" />
      <circle cx="25" cy="22.5" r="8" fill="var(--km-art-ink)" />
      <path d="M28 19h-4a2 2 0 0 0 0 4h2a2 2 0 0 1 0 4h-4m3-10v12" stroke="var(--km-art-paper)" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/** Exact CheckoutPaymentArt ("cartao_credito") geometry adapted to --km-art-* tokens */
export function KomaCardAsset({ className = "w-11 h-9" }: AssetProps) {
  return (
    <svg viewBox="0 0 40 30" fill="none" className={className} aria-hidden="true">
      <rect x="8" y="2" width="29" height="21" rx="4" fill="var(--km-art-mid)" />
      <rect x="3" y="6" width="29" height="21" rx="4" fill="var(--km-art-paper)" stroke="var(--km-art-ink)" strokeWidth="1.6" />
      <path d="M3 12h29v4H3z" fill="var(--km-art-ink)" />
      <rect x="8" y="19" width="6" height="3" rx="1" fill="var(--km-art-mid)" />
      <path d="M22 21h5m-5 3h3" stroke="var(--km-art-ink)" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/** Exact CheckoutPaymentArt ("pix") geometry adapted to --km-art-* tokens */
export function KomaPixAsset({ className = "w-11 h-9" }: AssetProps) {
  return (
    <svg viewBox="0 0 40 30" fill="none" className={className} aria-hidden="true">
      <rect x="3" y="2" width="34" height="26" rx="6" fill="var(--km-art-ink)" />
      <path d="M10 7h7v7h-7zM23 7h7v7h-7zM10 17h7v7h-7z" stroke="var(--km-art-paper)" strokeWidth="2" />
      <path d="M24 18h3v3h-3zm5 3h3v3h-3z" fill="var(--km-art-paper)" />
    </svg>
  );
}

/** Account Invitation layered KÔMA illustration (replaces generic Sparkles) */
export function KomaAccountInviteAsset({ className = "w-16 h-16" }: AssetProps) {
  return (
    <svg viewBox="0 0 72 72" fill="none" className={className} aria-hidden="true">
      <rect x="6" y="10" width="60" height="52" rx="18" fill="var(--km-art-mid)" />
      <rect x="10" y="14" width="52" height="44" rx="14" fill="var(--km-art-paper)" stroke="var(--km-art-ink)" strokeWidth="2" />
      <circle cx="36" cy="30" r="8" fill="var(--km-art-ink)" />
      <path d="M22 49C24.5 42 29.5 38.5 36 38.5C42.5 38.5 47.5 42 50 49" stroke="var(--km-art-ink)" strokeWidth="3.5" strokeLinecap="round" />
      <circle cx="55" cy="17" r="7.5" fill="var(--km-accent)" stroke="var(--km-art-ink)" strokeWidth="1.8" />
      <path d="M52 17L54.2 19.2L58.2 15" stroke="var(--km-on-accent)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function KomaOrderStatusAsset({ className = "w-11 h-11" }: AssetProps) {
  return (
    <svg viewBox="0 0 44 44" fill="none" className={className} aria-hidden="true">
      <rect x="9" y="7" width="26" height="30" rx="5" fill="var(--km-art-paper)" stroke="var(--km-art-ink)" strokeWidth="2" />
      <path d="M15 16H29M15 22H25M15 28H21" stroke="var(--km-art-ink)" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="32" cy="30" r="6.5" fill="var(--km-accent)" stroke="var(--km-art-ink)" strokeWidth="1.8" />
      <path d="M29.5 30L31.2 31.7L34.5 28.3" stroke="var(--km-on-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function KomaSpeedAsset({ className = "w-10 h-10" }: AssetProps) {
  return (
    <svg viewBox="0 0 40 40" fill="none" className={className} aria-hidden="true">
      <rect x="4" y="4" width="32" height="32" rx="11" fill="var(--km-art-paper)" stroke="var(--km-art-ink)" strokeWidth="1.8" />
      <path d="M22 9L12 22H20L18 31L28 18H20L22 9Z" fill="var(--km-art-mid)" stroke="var(--km-art-ink)" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

export function KomaBrandPaletteAsset({ className = "w-10 h-10" }: AssetProps) {
  return (
    <svg viewBox="0 0 40 40" fill="none" className={className} aria-hidden="true">
      <rect x="4" y="4" width="32" height="32" rx="11" fill="var(--km-art-paper)" stroke="var(--km-art-ink)" strokeWidth="1.8" />
      <circle cx="16" cy="18" r="6" fill="var(--km-art-ink)" />
      <circle cx="24" cy="18" r="6" fill="var(--km-art-mid)" />
      <circle cx="20" cy="24.5" r="5.5" fill="var(--km-accent)" stroke="var(--km-art-ink)" strokeWidth="1.4" />
    </svg>
  );
}

export function KomaSyncOpsAsset({ className = "w-10 h-10" }: AssetProps) {
  return (
    <svg viewBox="0 0 40 40" fill="none" className={className} aria-hidden="true">
      <rect x="4" y="4" width="32" height="32" rx="11" fill="var(--km-art-paper)" stroke="var(--km-art-ink)" strokeWidth="1.8" />
      <rect x="10" y="12" width="11" height="16" rx="2.5" fill="var(--km-art-ink)" />
      <rect x="19" y="15" width="11" height="13" rx="2.5" fill="var(--km-art-mid)" stroke="var(--km-art-ink)" strokeWidth="1.5" />
      <path d="M22.5 21.5L24.5 23.5L27.5 19.5" stroke="var(--km-art-paper)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
