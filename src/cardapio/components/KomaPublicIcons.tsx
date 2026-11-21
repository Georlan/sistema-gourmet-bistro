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
