import { Sparkles } from 'lucide-react';
import React from 'react';

export function CashierOnboardingShortcut({ mobile = false }: { mobile?: boolean }) {
  const openOnboarding = () => {
    window.location.href = '/ativar?resume=1';
  };

  return (
    <button
      type="button"
      onClick={openOnboarding}
      className="flex w-full items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] px-3 py-2.5 text-left text-xs font-bold text-emerald-300 transition hover:border-emerald-500/40 hover:bg-emerald-500/10"
      aria-label="Voltar para a implantação inicial"
      title="Voltar para a implantação inicial"
    >
      <Sparkles size={15} className="shrink-0" />
      <span className={mobile ? '' : 'group-data-[collapsible=icon]:hidden'}>Implantação inicial</span>
    </button>
  );
}
