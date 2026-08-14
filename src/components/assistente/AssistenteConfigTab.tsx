import React from 'react';
import clsx from 'clsx';

interface AssistenteConfigTabProps {
  aiBotActive: boolean;
  setAiBotActive: (val: boolean) => void;
  aiSystemPrompt: string;
  setAiSystemPrompt: (val: string) => void;
  iaDiscountEnabled: boolean;
  setIaDiscountEnabled: (val: boolean) => void;
  iaMaxDiscount: number;
  setIaMaxDiscount: (val: number) => void;
  iaUpsellEnabled: boolean;
  setIaUpsellEnabled: (val: boolean) => void;
  iaVoiceTone: string;
  setIaVoiceTone: (val: any) => void;
  iaMaxInteractions: number;
  setIaMaxInteractions: (val: number) => void;
}

export function AssistenteConfigTab({
  aiBotActive,
  setAiBotActive,
  aiSystemPrompt,
  setAiSystemPrompt,
  iaDiscountEnabled,
  setIaDiscountEnabled,
  iaMaxDiscount,
  setIaMaxDiscount,
  iaUpsellEnabled,
  setIaUpsellEnabled,
  iaVoiceTone,
  setIaVoiceTone,
  iaMaxInteractions,
  setIaMaxInteractions,
}: AssistenteConfigTabProps) {
  return (
    <div className={clsx('grid', 'grid-cols-1', 'lg:grid-cols-3', 'gap-5', 'text-left', 'animate-fade-in')}>
      {/* Left Column: System Prompt */}
      <div className={clsx('lg:col-span-2', 'bg-[#121214]/60', 'border', 'border-koma-border', 'rounded-3xl', 'p-5', 'space-y-4')}>
        <div className={clsx('border-b', 'border-koma-border', 'pb-3', 'flex', 'justify-between', 'items-center')}>
          <span className={clsx('font-serif', 'font-bold', 'text-koma-secondary')}>Prompt do Atendente Virtual</span>
          <label className={clsx('relative', 'inline-flex', 'items-center', 'cursor-pointer')}>
            <input type="checkbox" checked={aiBotActive} onChange={(e) => setAiBotActive(e.target.checked)} className={clsx('sr-only', 'peer')} />
            <div className={clsx('w-8', 'h-4.5', 'bg-koma-raised', 'peer-focus:outline-none', 'rounded-full', 'peer', 'peer-checked:after:translate-x-full', 'peer-checked:after:border-white', "after:content-['']", 'after:absolute', 'after:top-[2px]', 'after:left-[2px]', 'after:bg-white', 'after:border-gray-300', 'after:border', 'after:rounded-full', 'after:h-3.5', 'after:w-3.5', 'after:transition-all', 'peer-checked:bg-emerald-600')}></div>
          </label>
        </div>

        <div className="space-y-2">
          <label className={clsx('text-[9px]', 'font-bold', 'text-koma-subtle', 'uppercase', 'tracking-wider', 'block')}>Diretrizes da IA (Prompt de Sistema):</label>
          <textarea
            rows={8}
            value={aiSystemPrompt}
            onChange={(e) => setAiSystemPrompt(e.target.value)}
            className={clsx('w-full', 'p-3', 'bg-koma-page', 'border', 'border-koma-border', 'rounded-xl', 'focus:outline-none', 'focus:border-[#10b981]', 'text-koma-foreground', 'text-[10px]', 'resize-none', 'leading-relaxed', 'font-mono')}
          />
          <span className={clsx('text-[8px]', 'text-koma-muted', 'block', 'leading-relaxed')}>
            Instrua a inteligência artificial sobre a história da sua casa, especialidades do cardápio e regras de tom de voz. Evite comandos conflitantes com as travas de governança ao lado.
          </span>
        </div>
      </div>

      {/* Right Column: Painel de Governança */}
      <div className={clsx('bg-[#121214]/60', 'border', 'border-koma-border', 'rounded-3xl', 'p-5', 'space-y-4', 'flex', 'flex-col', 'justify-between')}>
        <div className="space-y-4">
          <div className={clsx('border-b', 'border-koma-border', 'pb-2')}>
            <span className={clsx('font-serif', 'font-bold', 'text-koma-secondary', 'block')}>Segurança & Governança da IA</span>
            <span className={clsx('text-[8px]', 'text-koma-muted', 'block', 'mt-0.5')}>Defina limites comerciais estritos para evitar abusos ou prejuízos nas conversas automatizadas.</span>
          </div>

          {/* Negociar Descontos Toggle */}
          <div className={clsx('bg-[#1C1C1F]/40', 'border', 'border-[#27272A]/40', 'rounded-xl', 'p-3', 'flex', 'justify-between', 'items-center')}>
            <div className="space-y-0.5">
              <span className={clsx('text-[9px]', 'font-bold', 'text-koma-foreground', 'block')}>Negociar Descontos</span>
              <span className={clsx('text-[7px]', 'text-koma-muted', 'block')}>Autoriza IA a oferecer cupons no chat</span>
            </div>
            <button
              onClick={() => setIaDiscountEnabled(!iaDiscountEnabled)}
              className={`w-9 h-5 rounded-full p-0.5 transition-colors duration-200 focus:outline-none cursor-pointer ${iaDiscountEnabled ? 'bg-emerald-600' : 'bg-koma-raised'}`}
            >
              <div className={`w-4 h-4 rounded-full bg-koma-card shadow-md transform duration-200 ${iaDiscountEnabled ? 'translate-x-4' : 'translate-x-0'}`} />
            </button>
          </div>

          {/* Teto de Desconto Selector */}
          {iaDiscountEnabled && (
            <div className={clsx('space-y-1.5', 'animate-fade-in')}>
              <label className={clsx('text-[8px]', 'font-bold', 'text-koma-subtle', 'uppercase', 'tracking-widest', 'block')}>Teto de Desconto Permitido (%):</label>
              <div className={clsx('flex', 'gap-2', 'items-center')}>
                <input
                  type="range"
                  min="5"
                  max="25"
                  step="5"
                  value={iaMaxDiscount}
                  onChange={(e) => setIaMaxDiscount(Number(e.target.value))}
                  className={clsx('flex-1', 'accent-[#10b981]', 'cursor-pointer')}
                />
                <span className={clsx('text-[10px]', 'font-mono', 'font-bold', 'text-koma-foreground', 'bg-koma-page', 'px-2.5', 'py-1', 'border', 'border-koma-border', 'rounded-lg')}>{iaMaxDiscount}%</span>
              </div>
            </div>
          )}

          {/* Upsell Ativo Toggle */}
          <div className={clsx('bg-[#1C1C1F]/40', 'border', 'border-[#27272A]/40', 'rounded-xl', 'p-3', 'flex', 'justify-between', 'items-center')}>
            <div className="space-y-0.5">
              <span className={clsx('text-[9px]', 'font-bold', 'text-koma-foreground', 'block')}>Upsell / Sugestões Ativas</span>
              <span className={clsx('text-[7px]', 'text-koma-muted', 'block')}>Sugere adicionais e bebidas para aumentar o ticket</span>
            </div>
            <button
              onClick={() => setIaUpsellEnabled(!iaUpsellEnabled)}
              className={`w-9 h-5 rounded-full p-0.5 transition-colors duration-200 focus:outline-none cursor-pointer ${iaUpsellEnabled ? 'bg-emerald-600' : 'bg-koma-raised'}`}
            >
              <div className={`w-4 h-4 rounded-full bg-koma-card shadow-md transform duration-200 ${iaUpsellEnabled ? 'translate-x-4' : 'translate-x-0'}`} />
            </button>
          </div>

          {/* Tom de Voz selector */}
          <div className="space-y-1.5">
            <label className={clsx('text-[8px]', 'font-bold', 'text-koma-subtle', 'uppercase', 'tracking-widest', 'block')}>Personalidade / Tom de Voz:</label>
            <div className={clsx('grid', 'grid-cols-2', 'gap-2')}>
              <button
                onClick={() => setIaVoiceTone('direto')}
                className={`py-1.5 rounded-xl border text-[9px] font-bold transition-all cursor-pointer ${iaVoiceTone === 'direto'
                  ? 'bg-[#10b981]/15 border-[#10b981] text-[#10b981]'
                  : 'bg-[#1C1C1F]/40 border-koma-border text-koma-muted'
                  }`}
              >
                Direto (Economiza Tokens)
              </button>
              <button
                onClick={() => setIaVoiceTone('conversador')}
                className={`py-1.5 rounded-xl border text-[9px] font-bold transition-all cursor-pointer ${iaVoiceTone === 'conversador'
                  ? 'bg-[#10b981]/15 border-[#10b981] text-[#10b981]'
                  : 'bg-[#1C1C1F]/40 border-koma-border text-koma-muted'
                  }`}
              >
                Conversador (Fidelidade)
              </button>
            </div>
          </div>

          {/* Teto de Interações selector */}
          <div className="space-y-1.5">
            <label className={clsx('text-[8px]', 'font-bold', 'text-koma-subtle', 'uppercase', 'tracking-widest', 'block')}>Teto de Mensagens sem Pedido:</label>
            <div className={clsx('flex', 'gap-2', 'items-center')}>
              <select
                value={iaMaxInteractions}
                onChange={(e) => setIaMaxInteractions(Number(e.target.value))}
                className={clsx('flex-1', 'px-3', 'py-1.5', 'bg-koma-page', 'border', 'border-koma-border', 'rounded-xl', 'text-koma-foreground', 'text-[10px]')}
              >
                <option value="3">3 interações (Máxima economia)</option>
                <option value="5">5 interações (Padrão sugerido)</option>
                <option value="10">10 interações (Flexível)</option>
              </select>
            </div>
          </div>
        </div>

        <button
          onClick={() => alert('Parâmetros de governança da IA salvos no banco de dados.')}
          className={clsx('w-full', 'py-2', 'bg-[#10b981]', 'hover:bg-[#059669]', 'text-[#121214]', 'font-bold', 'rounded-xl', 'text-[9px]', 'uppercase', 'tracking-wider', 'transition-all', 'cursor-pointer', 'shadow-lg', 'mt-4')}
        >
          Salvar Parâmetros
        </button>
      </div>
    </div>
  );
}
