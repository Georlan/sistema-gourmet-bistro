/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";

type KomaIconProps = Omit<React.SVGProps<SVGSVGElement>, "width" | "height"> & {
  size?: number | string;
};

type IconFrameProps = KomaIconProps & {
  children: React.ReactNode;
};

const iconClassName = (className?: string) => ["koma-public-icon", className].filter(Boolean).join(" ");

function IconFrame({ size = 16, className, children, style, ...props }: IconFrameProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={iconClassName(className)}
      style={{
        filter: "drop-shadow(0 0 2.5px color-mix(in srgb, var(--color-brand-primary) 24%, transparent))",
        ...style,
      }}
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

/** Lupa com reflexo interno: assinatura visual usada no campo de busca. */
export function KomaSearchIcon(props: KomaIconProps) {
  return (
    <IconFrame {...props}>
      <circle cx="10.7" cy="10.7" r="6.55" />
      <path d="m15.55 15.55 4.25 4.25" />
      <path d="M7.35 8.15c.72-1.08 1.8-1.72 3.05-1.82" strokeWidth="1.45" opacity=".72" />
      <circle cx="6.9" cy="10.65" r=".72" fill="currentColor" stroke="none" opacity=".72" />
    </IconFrame>
  );
}

/** Pin próprio com pequeno marcador de solo para reforçar endereço/localização. */
export function KomaLocationIcon(props: KomaIconProps) {
  return (
    <IconFrame {...props}>
      <path d="M12 20.1s6.15-5.12 6.15-10.25a6.15 6.15 0 1 0-12.3 0C5.85 14.98 12 20.1 12 20.1Z" />
      <circle cx="12" cy="9.85" r="2.1" />
      <path d="M8.8 21.15c1.9.7 4.5.7 6.4 0" strokeWidth="1.35" opacity=".68" />
    </IconFrame>
  );
}

/** Informação em anel, com ponto e haste arredondados. */
export function KomaInfoIcon(props: KomaIconProps) {
  return (
    <IconFrame {...props}>
      <circle cx="12" cy="12" r="8.2" />
      <circle cx="12" cy="8" r=".85" fill="currentColor" stroke="none" />
      <path d="M12 11.2v5" />
    </IconFrame>
  );
}

/** Compartilhamento por três nós, com junções suaves. */
export function KomaShareIcon(props: KomaIconProps) {
  return (
    <IconFrame {...props}>
      <circle cx="17.5" cy="6.4" r="2.25" />
      <circle cx="6.45" cy="12" r="2.25" />
      <circle cx="17.5" cy="17.6" r="2.25" />
      <path d="m8.45 10.98 7-3.55M8.45 13.02l7 3.55" />
    </IconFrame>
  );
}

/** Balão de conversa com detalhe de cloche: pedido + atendimento no mesmo glifo. */
export function KomaOrderChatIcon(props: KomaIconProps) {
  return (
    <IconFrame {...props}>
      <path d="M4.1 6.75A7.5 7.5 0 0 1 11.6 4h.8a7.5 7.5 0 0 1 7.5 7.5v.15a7.5 7.5 0 0 1-7.5 7.5H9l-4.2 2 .92-3.55A7.46 7.46 0 0 1 4.1 6.75Z" />
      <circle cx="9" cy="11.65" r=".72" fill="currentColor" stroke="none" />
      <circle cx="12" cy="11.65" r=".72" fill="currentColor" stroke="none" />
      <circle cx="15" cy="11.65" r=".72" fill="currentColor" stroke="none" />
      <path d="M15.65 7.15c.25-1.08 1.12-1.84 2.22-1.84 1.08 0 1.95.76 2.2 1.84M15.35 7.2h5.05" strokeWidth="1.25" />
    </IconFrame>
  );
}

/** Sacola própria do KÔMA. Mantém a semântica do carrinho do cardápio. */
export function KomaBagIcon(props: KomaIconProps) {
  return (
    <IconFrame {...props}>
      <path d="M5.2 8.1h13.6l-.8 11.25a1.7 1.7 0 0 1-1.7 1.55H7.7A1.7 1.7 0 0 1 6 19.35L5.2 8.1Z" />
      <path d="M8.55 9V7.2a3.45 3.45 0 0 1 6.9 0V9" />
      <path d="M9.2 13.3c1.55 1.18 4.05 1.18 5.6 0" strokeWidth="1.35" opacity=".72" />
    </IconFrame>
  );
}

/** Perfil/login com geometria arredondada e aberta para funcionar bem em 15 px. */
export function KomaUserIcon(props: KomaIconProps) {
  return (
    <IconFrame {...props}>
      <circle cx="12" cy="7.75" r="3.25" />
      <path d="M5.2 20v-1.2a6.8 6.8 0 0 1 13.6 0V20" />
    </IconFrame>
  );
}

/** Câmera social original; sugere Instagram sem depender do glifo oficial. */
export function KomaSocialCameraIcon(props: KomaIconProps) {
  return (
    <IconFrame {...props}>
      <rect x="4.15" y="4.15" width="15.7" height="15.7" rx="4.1" />
      <circle cx="12" cy="12" r="3.65" />
      <circle cx="16.8" cy="7.25" r=".82" fill="currentColor" stroke="none" />
      <path d="M7.4 5.2h2.15" strokeWidth="1.3" opacity=".58" />
    </IconFrame>
  );
}
