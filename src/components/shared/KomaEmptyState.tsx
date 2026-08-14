import React from 'react';
import clsx from 'clsx';
import { LucideIcon } from 'lucide-react';

export interface KomaEmptyStateProps {
  icon?: LucideIcon | React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode | {
    label: string;
    onClick: () => void;
    icon?: LucideIcon;
    variant?: 'primary' | 'secondary';
  };
  variant?: 'panel' | 'inline' | 'compact';
  className?: string;
}

export const KomaEmptyState: React.FC<KomaEmptyStateProps> = ({
  icon,
  title,
  description,
  action,
  variant = 'panel',
  className,
}) => {
  const isInline = variant === 'inline';
  const isCompact = variant === 'compact';

  const renderIcon = () => {
    if (!icon) return null;
    if (React.isValidElement(icon)) {
      return (
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-koma-border bg-koma-raised text-koma-muted mb-2">
          {icon}
        </div>
      );
    }
    const IconComponent = icon as LucideIcon;
    return (
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-koma-border bg-koma-raised text-koma-muted mb-2 shadow-xs">
        <IconComponent size={22} className="text-koma-muted" />
      </div>
    );
  };

  const renderAction = () => {
    if (!action) return null;
    if (React.isValidElement(action)) return action;
    const actionObj = action as {
      label: string;
      onClick: () => void;
      icon?: LucideIcon;
      variant?: 'primary' | 'secondary';
    };
    const ActionIcon = actionObj.icon;
    const isPrimary = actionObj.variant !== 'secondary';

    return (
      <button
        type="button"
        onClick={actionObj.onClick}
        className={clsx(
          'mt-3 inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold uppercase tracking-wider transition-all cursor-pointer shadow-xs',
          isPrimary ? 'koma-btn-success' : 'koma-btn-secondary'
        )}
      >
        {ActionIcon && <ActionIcon size={14} />}
        <span>{actionObj.label}</span>
      </button>
    );
  };

  if (isInline) {
    return (
      <div className={clsx('py-8 px-4 text-center space-y-1', className)}>
        <p className="text-xs font-bold text-koma-foreground">{title}</p>
        {description && <p className="text-[11px] text-koma-muted max-w-md mx-auto">{description}</p>}
        {renderAction()}
      </div>
    );
  }

  return (
    <div
      className={clsx(
        'flex flex-col items-center justify-center text-center mx-auto transition-all',
        isCompact
          ? 'py-6 px-4 space-y-1.5'
          : 'bg-koma-panel border border-koma-border rounded-3xl p-8 sm:p-12 space-y-2.5 max-w-lg shadow-xs my-4',
        className
      )}
    >
      {renderIcon()}
      <h4 className="font-serif font-bold text-sm sm:text-base text-koma-foreground leading-snug">
        {title}
      </h4>
      {description && (
        <p className="text-xs text-koma-muted leading-relaxed max-w-sm font-medium">
          {description}
        </p>
      )}
      {renderAction()}
    </div>
  );
};
