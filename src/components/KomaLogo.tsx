import React from 'react';
import clsx from 'clsx';
import logoOnDark from '../assets/logo-koma-on-dark.png';
import logoOnLight from '../assets/logo-koma-on-light.png';
import { KOMA_SLOGAN, KOMA_WORDMARK_SRC } from '../brand/komaBrand';

export interface KomaLogoProps {
  className?: string;
  imageClassName?: string;
  variant?: 'auto' | 'dark' | 'light';
  alt?: string;
  withText?: boolean;
  withSlogan?: boolean;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'custom';
}

const SIZE_MAP = {
  sm: 'w-6 h-6',
  md: 'w-7 h-7',
  lg: 'w-8 h-8',
  xl: 'w-16 h-16',
  custom: '',
};

const WORDMARK_SIZE_MAP = {
  sm: 'w-20 h-auto',
  md: 'w-24 h-auto',
  lg: 'w-28 h-auto',
  xl: 'w-44 h-auto',
  custom: '',
};

const isKomaBrandLabel = (value: string | null | undefined) => {
  const normalized = String(value || '').trim().toLocaleLowerCase('pt-BR');
  return normalized === 'koma' || normalized === 'kôma';
};

export const KomaLogo: React.FC<KomaLogoProps> = ({
  className,
  imageClassName,
  variant = 'auto',
  alt = 'Kôma',
  withText = false,
  withSlogan = false,
  size = 'md',
}) => {
  const sizeClass = SIZE_MAP[size] || SIZE_MAP.md;
  const wordmarkSizeClass = WORDMARK_SIZE_MAP[size] || WORDMARK_SIZE_MAP.md;
  const iconRootRef = React.useRef<HTMLSpanElement>(null);
  const [contextWordmark, setContextWordmark] = React.useState(false);

  React.useEffect(() => {
    if (withText || withSlogan) {
      if (contextWordmark) setContextWordmark(false);
      return undefined;
    }

    const root = iconRootRef.current;
    if (!root) return undefined;

    let typedBrandNode: HTMLElement | null = null;
    let logoWrap: HTMLElement | null = null;

    const cashierBrand = root.closest('.cashier-sidebar__brand') as HTMLElement | null;
    if (cashierBrand) {
      typedBrandNode = cashierBrand.querySelector('.cashier-sidebar__brand-copy strong') as HTMLElement | null;
      logoWrap = root.closest('.cashier-sidebar__logo-wrap') as HTMLElement | null;
    } else {
      const row = root.parentElement;
      typedBrandNode = (
        row?.querySelector(':scope > div > h1')
        || row?.querySelector(':scope > div > span:first-child')
      ) as HTMLElement | null;
    }

    const shouldUseWordmark = isKomaBrandLabel(typedBrandNode?.textContent);
    if (contextWordmark !== shouldUseWordmark) {
      setContextWordmark(shouldUseWordmark);
    }

    if (!shouldUseWordmark || !typedBrandNode) return undefined;

    const previousDisplay = typedBrandNode.style.display;
    typedBrandNode.style.display = 'none';

    let previousWrapStyles: Record<string, string> | null = null;
    if (logoWrap) {
      previousWrapStyles = {
        width: logoWrap.style.width,
        height: logoWrap.style.height,
        border: logoWrap.style.border,
        borderRadius: logoWrap.style.borderRadius,
        background: logoWrap.style.background,
        overflow: logoWrap.style.overflow,
      };
      logoWrap.style.width = size === 'sm' ? '5rem' : size === 'md' ? '6rem' : '7rem';
      logoWrap.style.height = 'auto';
      logoWrap.style.border = '0';
      logoWrap.style.borderRadius = '0';
      logoWrap.style.background = 'transparent';
      logoWrap.style.overflow = 'visible';
    }

    return () => {
      typedBrandNode.style.display = previousDisplay;
      if (logoWrap && previousWrapStyles) {
        logoWrap.style.width = previousWrapStyles.width;
        logoWrap.style.height = previousWrapStyles.height;
        logoWrap.style.border = previousWrapStyles.border;
        logoWrap.style.borderRadius = previousWrapStyles.borderRadius;
        logoWrap.style.background = previousWrapStyles.background;
        logoWrap.style.overflow = previousWrapStyles.overflow;
      }
    };
  });

  const renderImages = () => {
    if (variant === 'dark') {
      return (
        <img
          src={logoOnDark}
          alt={alt}
          className={clsx(sizeClass, 'object-contain shrink-0', imageClassName)}
        />
      );
    }

    if (variant === 'light') {
      return (
        <img
          src={logoOnLight}
          alt={alt}
          className={clsx(sizeClass, 'object-contain shrink-0', imageClassName)}
        />
      );
    }

    return (
      <>
        <img
          src={logoOnLight}
          alt={alt}
          className={clsx(sizeClass, 'object-contain shrink-0 dark:hidden', imageClassName)}
        />
        <img
          src={logoOnDark}
          alt={alt}
          className={clsx(sizeClass, 'object-contain shrink-0 hidden dark:block', imageClassName)}
        />
      </>
    );
  };

  if (!withText && !withSlogan) {
    if (contextWordmark) {
      return (
        <span
          ref={iconRootRef}
          data-koma-logo="context-wordmark"
          className={clsx('inline-flex items-center justify-center', className)}
        >
          <img
            src={KOMA_WORDMARK_SRC}
            alt={alt}
            draggable={false}
            className={clsx(wordmarkSizeClass, 'h-auto object-contain shrink-0', imageClassName)}
          />
        </span>
      );
    }

    return (
      <span
        ref={iconRootRef}
        data-koma-logo="icon"
        className={clsx('inline-flex items-center justify-center', className)}
      >
        {renderImages()}
      </span>
    );
  }

  return (
    <div
      data-koma-logo="wordmark"
      className={clsx('inline-flex flex-col items-start justify-center', className)}
    >
      <img
        src={KOMA_WORDMARK_SRC}
        alt={alt}
        draggable={false}
        className={clsx(wordmarkSizeClass, 'object-contain shrink-0', imageClassName)}
      />
      {withSlogan && (
        <span className="mt-0.5 text-[9px] font-sans font-semibold leading-tight tracking-wide text-koma-accent">
          {KOMA_SLOGAN}
        </span>
      )}
    </div>
  );
};
