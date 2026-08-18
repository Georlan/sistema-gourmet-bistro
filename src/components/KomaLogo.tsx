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
    return <span className={clsx('inline-flex items-center justify-center', className)}>{renderImages()}</span>;
  }

  return (
    <div className={clsx('inline-flex flex-col items-start justify-center', className)}>
      <img
        src={KOMA_WORDMARK_SRC}
        alt={alt}
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
