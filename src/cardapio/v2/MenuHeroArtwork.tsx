import React from "react";

interface MenuHeroArtworkProps {
  className?: string;
}

/**
 * Ilustração vetorial flat do Cardápio KÔMA (irmã das artes de Garçom e Entregador).
 * Usa exclusivamente tokens --km-art-* para acompanhar tema claro/escuro e cor da loja.
 */
export function MenuHeroArtwork({ className }: MenuHeroArtworkProps) {
  return (
    <svg
      viewBox="0 0 180 72"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {/* Onda orgânica de fundo */}
      <path
        d="M28 72C46 38 78 20 118 24C144 26.6 164 14 180 0V72H28Z"
        fill="var(--km-art-field)"
        opacity="0.72"
      />
      {/* Folhas / frescor */}
      <path
        d="M66 54C56 48 52 36 58 28C66 32 72 42 66 54Z"
        fill="var(--km-art-field)"
      />
      {/* Cúpula de serviço (cloche) */}
      <circle cx="118" cy="21" r="4" fill="var(--km-art-dome)" />
      <path
        d="M84 52C84 35.5 99 24 118 24C137 24 152 35.5 152 52H84Z"
        fill="var(--km-art-dome)"
      />
      {/* Brilho interno sutil na cúpula */}
      <path
        d="M96 44C99 35.5 106 31 114 30"
        stroke="var(--km-art-paper)"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      {/* Bandeja */}
      <rect x="76" y="53" width="84" height="5" rx="2.5" fill="var(--km-art-paper)" />
      {/* Detalhes / faíscas */}
      <circle cx="158" cy="22" r="2.5" fill="var(--km-art-dome)" opacity="0.85" />
      <circle cx="72" cy="22" r="2" fill="var(--km-art-paper)" opacity="0.75" />
    </svg>
  );
}
