import React, { useEffect, useState } from 'react';
import clsx from 'clsx';
import {
  KOMA_WORDMARK_ON_DARK_SRC,
  KOMA_WORDMARK_ON_LIGHT_SRC,
} from '../../brand/komaBrand';
import './komaLoading.css';

export interface KomaLoadingProps {
  label?: string;
  detail?: string;
  fullscreen?: boolean;
  delayMs?: number;
  className?: string;
}

function AnimatedWordmark({ src }: { src: string }) {
  return (
    <div className="koma-loading__stage" aria-hidden="true">
      <div className="koma-loading__animated">
        <div className="koma-loading__k-wrap">
          <span className="koma-loading__cloche-glow" />
          <img className="koma-loading__layer koma-loading__k" src={src} alt="" draggable={false} />
        </div>
        <img className="koma-loading__layer koma-loading__o" src={src} alt="" draggable={false} />
        <img className="koma-loading__layer koma-loading__m" src={src} alt="" draggable={false} />
        <img className="koma-loading__layer koma-loading__a" src={src} alt="" draggable={false} />
        <img className="koma-loading__layer koma-loading__caret-pulse" src={src} alt="" draggable={false} />
      </div>
      <img className="koma-loading__static" src={src} alt="" draggable={false} />
    </div>
  );
}

export function KomaLoading({
  label = 'Preparando Kôma…',
  detail,
  fullscreen = true,
  delayMs = 180,
  className,
}: KomaLoadingProps) {
  const [visible, setVisible] = useState(delayMs <= 0);

  useEffect(() => {
    if (delayMs <= 0) {
      setVisible(true);
      return undefined;
    }

    const timer = window.setTimeout(() => setVisible(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs]);

  return (
    <main
      role="status"
      aria-live="polite"
      aria-label={label}
      data-koma-loading="true"
      className={clsx(
        'flex w-full flex-col items-center justify-center bg-koma-page px-6 text-center text-koma-foreground',
        fullscreen ? 'min-h-dvh' : 'min-h-[55vh]',
        className,
      )}
    >
      {visible ? (
        <div className="flex w-full max-w-2xl flex-col items-center">
          <div className="koma-loading__theme-dark">
            <AnimatedWordmark src={KOMA_WORDMARK_ON_DARK_SRC} />
          </div>
          <div className="koma-loading__theme-light">
            <AnimatedWordmark src={KOMA_WORDMARK_ON_LIGHT_SRC} />
          </div>
          <p className="mt-4 text-xs font-bold tracking-[0.08em] text-koma-secondary">{label}</p>
          {detail ? <p className="mt-1 max-w-md text-xs leading-relaxed text-koma-muted">{detail}</p> : null}
        </div>
      ) : (
        <span className="sr-only">{label}</span>
      )}
    </main>
  );
}
