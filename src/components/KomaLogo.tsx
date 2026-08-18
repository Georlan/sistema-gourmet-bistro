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
    let cashierBrandCopy: HTMLElement | null = null;
    let cashierSloganNode: HTMLElement | null = null;

    const cashierBrand = root.closest('.cashier-sidebar__brand') as HTMLElement | null;
    if (cashierBrand) {
      cashierBrandCopy = cashierBrand.querySelector('.cashier-sidebar__brand-copy') as HTMLElement | null;
      typedBrandNode = cashierBrandCopy?.querySelector('strong') as HTMLElement | null;
      cashierSloganNode = cashierBrandCopy?.querySelector('small') as HTMLElement | null;
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
      logoWrap.style.width = size === 'sm' ? '5rem' : size === 'md' ? '8rem' : '8.5rem';
      logoWrap.style.height = 'auto';
      logoWrap.style.border = '0';
      logoWrap.style.borderRadius = '0';
      logoWrap.style.background = 'transparent';
      logoWrap.style.overflow = 'visible';
    }

    let previousCashierBrandStyles: Record<string, string> | null = null;
    let previousBrandCopyStyles: Record<string, string> | null = null;
    let previousSloganStyles: Record<string, string> | null = null;

    if (cashierBrand) {
      previousCashierBrandStyles = {
        flexDirection: cashierBrand.style.flexDirection,
        alignItems: cashierBrand.style.alignItems,
        gap: cashierBrand.style.gap,
        maxWidth: cashierBrand.style.maxWidth,
      };
      cashierBrand.style.flexDirection = 'column';
      cashierBrand.style.alignItems = 'flex-start';
      cashierBrand.style.gap = '0.2rem';
      cashierBrand.style.maxWidth = '9.5rem';
    }

    if (cashierBrandCopy) {
      previousBrandCopyStyles = {
        width: cashierBrandCopy.style.width,
        gap: cashierBrandCopy.style.gap,
      };
      cashierBrandCopy.style.width = '100%';
      cashierBrandCopy.style.gap = '0';
    }

    if (cashierSloganNode) {
      previousSloganStyles = {
        display: cashierSloganNode.style.display,
        width: cashierSloganNode.style.width,
        whiteSpace: cashierSloganNode.style.whiteSpace,
        overflow: cashierSloganNode.style.overflow,
        textOverflow: cashierSloganNode.style.textOverflow,
        lineHeight: cashierSloganNode.style.lineHeight,
      };
      cashierSloganNode.style.display = 'block';
      cashierSloganNode.style.width = '100%';
      cashierSloganNode.style.whiteSpace = 'normal';
      cashierSloganNode.style.overflow = 'visible';
      cashierSloganNode.style.textOverflow = 'clip';
      cashierSloganNode.style.lineHeight = '1.2';
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
      if (cashierBrand && previousCashierBrandStyles) {
        cashierBrand.style.flexDirection = previousCashierBrandStyles.flexDirection;
        cashierBrand.style.alignItems = previousCashierBrandStyles.alignItems;
        cashierBrand.style.gap = previousCashierBrandStyles.gap;
        cashierBrand.style.maxWidth = previousCashierBrandStyles.maxWidth;
      }
      if (cashierBrandCopy && previousBrandCopyStyles) {
        cashierBrandCopy.style.width = previousBrandCopyStyles.width;
        cashierBrandCopy.style.gap = previousBrandCopyStyles.gap;
      }
      if (cashierSloganNode && previousSloganStyles) {
        cashierSloganNode.style.display = previousSloganStyles.display;
        cashierSloganNode.style.width = previousSloganStyles.width;
        cashierSloganNode.style.whiteSpace = previousSloganStyles.whiteSpace;
        cashierSloganNode.style.overflow = previousSloganStyles.overflow;
        cashierSloganNode.style.textOverflow = previousSloganStyles.textOverflow;
        cashierSloganNode.style.lineHeight = previousSloganStyles.lineHeight;
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
