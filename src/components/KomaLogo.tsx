import React from 'react';
import clsx from 'clsx';
import logoOnDark from '../assets/logo-koma-on-dark.png';
import logoOnLight from '../assets/logo-koma-on-light.png';

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
    <div className={clsx('inline-flex items-center gap-2.5', className)}>
      <span className="inline-flex items-center justify-center shrink-0">{renderImages()}</span>
      <div className="flex flex-col text-left">
        {withText && (
          <span className="font-serif font-black tracking-[-0.03em] text-koma-foreground leading-tight text-base">
            KÔMA
          </span>
        )}
        {withSlogan && (
          <span className="text-[9px] font-sans font-semibold tracking-wide text-koma-accent leading-tight mt-0.5">
            Se está com fome, Kôma
          </span>
        )}
      </div>
    </div>
  );
};
