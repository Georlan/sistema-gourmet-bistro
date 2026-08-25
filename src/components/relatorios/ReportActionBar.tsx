import React from 'react';

interface ReportActionBarProps {
  children: React.ReactNode;
  info: React.ReactNode;
}

/** Barra compacta e consistente para contexto, período e ações dos relatórios. */
export function ReportActionBar({ children, info }: ReportActionBarProps) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-koma-border bg-koma-panel p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 text-[10px] leading-relaxed text-koma-muted">{info}</div>
      <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:flex-nowrap">
        {children}
      </div>
    </div>
  );
}
