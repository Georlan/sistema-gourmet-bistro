import React from 'react';
import { Loader2, Check } from 'lucide-react';

/**
 * KÔMA Proprietary Action Primitives
 * Design System de Botões, Controles de Quantidade e Seletores Táteis
 */

/* ========================================================
   1. KomaPrimaryAction (Ação Principal de Conversão)
   ======================================================== */
export interface KomaPrimaryActionProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: React.ReactNode;
  price?: string | number;
  loading?: boolean;
  size?: 'normal' | 'large' | 'compact';
}

export const KomaPrimaryAction = React.forwardRef<HTMLButtonElement, KomaPrimaryActionProps>(
  ({ children, icon, price, loading, size = 'normal', disabled, className = '', ...props }, ref) => {
    const sizeClasses = {
      compact: 'min-h-[44px] px-4 text-xs',
      normal: 'min-h-[48px] px-5 text-xs sm:text-sm',
      large: 'min-h-[54px] px-6 text-sm sm:text-base',
    }[size];

    return (
      <button
        ref={ref}
        type="button"
        disabled={disabled || loading}
        className={`koma-action-primary group relative flex w-full items-center justify-between gap-3 rounded-full font-black uppercase tracking-wider text-white shadow-lg transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 ${sizeClasses} ${className}`}
        {...props}
      >
        <span className="flex items-center gap-2">
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin text-white" aria-hidden="true" />
          ) : icon ? (
            <span className="shrink-0 transition-transform duration-200 group-hover:scale-110">{icon}</span>
          ) : null}
          <span className="truncate">{children}</span>
        </span>
        {price && !loading && (
          <span className="shrink-0 rounded-full bg-black/20 px-2.5 py-1 font-mono text-xs font-black tracking-normal text-emerald-100 sm:text-sm">
            {typeof price === 'number'
              ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(price)
              : price}
          </span>
        )}
      </button>
    );
  }
);
KomaPrimaryAction.displayName = 'KomaPrimaryAction';

/* ========================================================
   2. KomaSecondaryAction (Ação Secundária & Navegação)
   ======================================================== */
export interface KomaSecondaryActionProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: React.ReactNode;
  variant?: 'outline' | 'subtle' | 'ghost' | 'danger';
}

export const KomaSecondaryAction = React.forwardRef<HTMLButtonElement, KomaSecondaryActionProps>(
  ({ children, icon, variant = 'outline', disabled, className = '', ...props }, ref) => {
    const variantClasses = {
      outline: 'border border-white/15 bg-white/[0.03] text-koma-foreground hover:border-emerald-500/40 hover:bg-emerald-500/10 active:scale-[0.98]',
      subtle: 'border border-transparent bg-white/5 text-koma-foreground hover:bg-white/10 active:scale-[0.98]',
      ghost: 'border-none bg-transparent text-koma-muted hover:text-koma-foreground hover:bg-white/5 active:scale-[0.98]',
      danger: 'border border-rose-500/20 bg-rose-500/10 text-rose-400 hover:border-rose-500/40 hover:bg-rose-500/20 active:scale-[0.98]',
    }[variant];

    return (
      <button
        ref={ref}
        type="button"
        disabled={disabled}
        className={`koma-action-secondary flex min-h-[44px] items-center justify-center gap-2 rounded-full px-4 text-xs font-bold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:cursor-not-allowed disabled:opacity-45 disabled:active:scale-100 ${variantClasses} ${className}`}
        {...props}
      >
        {icon && <span className="shrink-0">{icon}</span>}
        <span className="truncate">{children}</span>
      </button>
    );
  }
);
KomaSecondaryAction.displayName = 'KomaSecondaryAction';

/* ========================================================
   3. KomaIconAction (Botão de Ícone com Alvo de 44x44px)
   ======================================================== */
export interface KomaIconActionProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: React.ReactNode;
  label: string;
  badge?: number | string;
  variant?: 'glass' | 'solid' | 'subtle';
}

export const KomaIconAction = React.forwardRef<HTMLButtonElement, KomaIconActionProps>(
  ({ icon, label, badge, variant = 'glass', disabled, className = '', ...props }, ref) => {
    const variantClasses = {
      glass: 'koma-art-glass-btn',
      solid: 'bg-emerald-500 text-white hover:bg-emerald-400 active:scale-95 shadow-md',
      subtle: 'border border-white/10 bg-white/5 text-koma-muted hover:text-koma-foreground hover:bg-white/10 active:scale-95',
    }[variant];

    return (
      <button
        ref={ref}
        type="button"
        aria-label={label}
        title={label}
        disabled={disabled}
        className={`relative grid h-11 w-11 place-items-center rounded-full transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:cursor-not-allowed disabled:opacity-40 ${variantClasses} ${className}`}
        {...props}
      >
        {icon}
        {badge !== undefined && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-emerald-500 px-1 font-mono text-[9px] font-black text-black ring-2 ring-black">
            {badge}
          </span>
        )}
      </button>
    );
  }
);
KomaIconAction.displayName = 'KomaIconAction';

/* ========================================================
   4. KomaQuantityControl (Controle de Quantidade Ergonômico)
   ======================================================== */
export interface KomaQuantityControlProps {
  quantity: number;
  onIncrement: () => void;
  onDecrement: () => void;
  min?: number;
  max?: number;
  disabled?: boolean;
  size?: 'compact' | 'normal';
  itemName?: string;
  className?: string;
  idMinus?: string;
  idPlus?: string;
}

export function KomaQuantityControl({
  quantity,
  onIncrement,
  onDecrement,
  min = 1,
  max = 99,
  disabled = false,
  size = 'normal',
  itemName = 'item',
  className = '',
  idMinus,
  idPlus,
}: KomaQuantityControlProps) {
  const isCompact = size === 'compact';

  return (
    <div
      className={`koma-art-stepper-pill select-none ${isCompact ? '!p-0.5' : ''} ${className}`}
      role="group"
      aria-label={`Controle de quantidade para ${itemName}`}
    >
      <button
        type="button"
        id={idMinus}
        onClick={onDecrement}
        disabled={disabled || quantity <= min}
        className={`koma-art-stepper-btn touch-manipulation hover:text-rose-400 disabled:opacity-30 disabled:cursor-not-allowed ${
          isCompact ? '!h-7 !w-7' : '!h-9 !w-9'
        }`}
        aria-label={`Diminuir quantidade de ${itemName}`}
      >
        <span className="text-base font-bold leading-none">−</span>
      </button>

      <span
        className={`koma-art-stepper-val font-mono font-black ${
          isCompact ? '!min-w-[20px] !text-xs' : '!min-w-[28px] !text-sm'
        }`}
        aria-live="polite"
        aria-atomic="true"
      >
        {quantity}
      </span>

      <button
        type="button"
        id={idPlus}
        onClick={onIncrement}
        disabled={disabled || quantity >= max}
        className={`koma-art-stepper-btn touch-manipulation hover:text-emerald-400 disabled:opacity-30 disabled:cursor-not-allowed ${
          isCompact ? '!h-7 !w-7' : '!h-9 !w-9'
        }`}
        aria-label={`Aumentar quantidade de ${itemName}`}
      >
        <span className="text-base font-bold leading-none">+</span>
      </button>
    </div>
  );
}

/* ========================================================
   5. KomaChoiceCard (Card de Seleção: Rádio, Checkbox ou Stepper)
   ======================================================== */
export interface KomaChoiceCardProps {
  type: 'radio' | 'checkbox' | 'stepper';
  selected: boolean;
  title: string;
  subtitle?: string;
  priceExtra?: number;
  disabled?: boolean;
  quantity?: number;
  onToggle?: () => void;
  onQuantityChange?: (delta: number) => void;
  badge?: string;
  icon?: React.ReactNode;
  ariaLabel?: string;
  className?: string;
  id?: string;
}

export function KomaChoiceCard({
  type,
  selected,
  title,
  subtitle,
  priceExtra,
  disabled = false,
  quantity = 0,
  onToggle,
  onQuantityChange,
  badge,
  icon,
  ariaLabel,
  className = '',
  id,
}: KomaChoiceCardProps) {
  const isRadio = type === 'radio';
  const isCheckbox = type === 'checkbox';
  const isStepper = type === 'stepper';

  const formatPrice = (val: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

  const handleClick = (e: React.MouseEvent) => {
    if (disabled) return;
    if (isRadio || isCheckbox) {
      onToggle?.();
    }
  };

  return (
    <div
      id={id}
      onClick={isStepper ? undefined : handleClick}
      role={isRadio ? 'radio' : isCheckbox ? 'checkbox' : 'group'}
      aria-checked={isRadio || isCheckbox ? selected : undefined}
      aria-label={ariaLabel || title}
      tabIndex={disabled ? -1 : isRadio || isCheckbox ? 0 : undefined}
      onKeyDown={(e) => {
        if (!disabled && (isRadio || isCheckbox) && (e.key === ' ' || e.key === 'Enter')) {
          e.preventDefault();
          onToggle?.();
        }
      }}
      className={`koma-art-modal-option-card group relative flex items-center justify-between gap-3.5 rounded-2xl border p-3.5 transition-all duration-200 ${
        isStepper ? '' : 'cursor-pointer active:scale-[0.99]'
      } ${
        selected
          ? 'is-selected border-emerald-500/60 bg-emerald-500/[0.08]'
          : 'border-white/10 bg-white/[0.025] hover:border-emerald-500/30 hover:bg-emerald-500/[0.02]'
      } ${disabled ? 'opacity-40 cursor-not-allowed' : ''} ${className}`}
    >
      <div className="flex items-center gap-3 min-w-0">
        {icon && <div className="shrink-0 text-emerald-400">{icon}</div>}
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs sm:text-sm font-bold text-koma-foreground truncate">{title}</span>
            {badge && (
              <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[9px] font-extrabold uppercase text-emerald-400">
                {badge}
              </span>
            )}
          </div>
          {subtitle && (
            <p className="mt-0.5 text-[11px] leading-tight text-koma-muted">{subtitle}</p>
          )}
          {priceExtra !== undefined && priceExtra > 0 && (
            <span className="mt-1 block font-mono text-xs font-bold text-emerald-400">
              + {formatPrice(priceExtra)}
            </span>
          )}
        </div>
      </div>

      <div className="shrink-0 flex items-center">
        {isRadio && (
          <div
            className={`grid h-5 w-5 place-items-center rounded-full border-2 transition-all duration-200 ${
              selected
                ? 'border-emerald-500 bg-emerald-500/10'
                : 'border-white/30 group-hover:border-emerald-500/60'
            }`}
            aria-hidden="true"
          >
            {selected && <div className="h-2.5 w-2.5 rounded-full bg-emerald-500" />}
          </div>
        )}

        {isCheckbox && (
          <div
            className={`grid h-5 w-5 place-items-center rounded-lg border-2 transition-all duration-200 ${
              selected
                ? 'border-emerald-500 bg-emerald-500 text-white'
                : 'border-white/30 group-hover:border-emerald-500/60 bg-transparent'
            }`}
            aria-hidden="true"
          >
            {selected && <Check className="h-3.5 w-3.5 stroke-[3]" />}
          </div>
        )}

        {isStepper && onQuantityChange && (
          <KomaQuantityControl
            quantity={quantity}
            onIncrement={() => onQuantityChange(1)}
            onDecrement={() => onQuantityChange(-1)}
            min={0}
            size="compact"
            itemName={title}
            disabled={disabled}
          />
        )}
      </div>
    </div>
  );
}
