import React from 'react';
import { Lock } from 'lucide-react';
import { CardapioAssetUploader } from '../CardapioAssetUploader';
import { ONLINE_MENU_ADDON } from '../../config/subscriptionPlans';
import clsx from 'clsx';

export interface CardapioDigitalWhitelabelTabProps {
  hasOnlineMenu: boolean;
  cardapioStatusOverride: string;
  setCardapioStatusOverride: (val: string) => void;
  cardapioCorPrimaria: string;
  setCardapioCorPrimaria: (val: string) => void;
  cardapioCorFundo: string;
  setCardapioCorFundo: (val: string) => void;
  cardapioLogoUrl: string;
  setCardapioLogoUrl: (val: string) => void;
  cardapioBannerUrl: string;
  setCardapioBannerUrl: (val: string) => void;
  cardapioSobreNos: string;
  setCardapioSobreNos: (val: string) => void;
  cardapioEndereco: string;
  setCardapioEndereco: (val: string) => void;
  isSavingCardapioConfig: boolean;
  saveCardapioConfig: () => Promise<void>;
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
  onNavigatePlans: () => void;
}

export function CardapioDigitalWhitelabelTab({
  hasOnlineMenu,
  cardapioStatusOverride,
  setCardapioStatusOverride,
  cardapioCorPrimaria,
  setCardapioCorPrimaria,
  cardapioCorFundo,
  setCardapioCorFundo,
  cardapioLogoUrl,
  setCardapioLogoUrl,
  cardapioBannerUrl,
  setCardapioBannerUrl,
  cardapioSobreNos,
  setCardapioSobreNos,
  cardapioEndereco,
  setCardapioEndereco,
  isSavingCardapioConfig,
  saveCardapioConfig,
  apiBaseUrl,
  authHeaders,
  onNavigatePlans
}: CardapioDigitalWhitelabelTabProps) {
  if (!hasOnlineMenu) {
    return (
      <div className="bg-[#121214] border border-amber-500/20 rounded-3xl p-8 text-center max-w-xl mx-auto space-y-3">
        <Lock size={24} className="text-amber-400 mx-auto" />
        <h3 className="text-white font-bold">Cardápio online não incluído neste plano</h3>
        <p className="text-[10px] text-gray-400">
          No Kôma Pro, ele pode ser contratado por R$ {ONLINE_MENU_ADDON.price}/mês. No Kôma Premium, link, QR Code e gaveta de aceite já estão incluídos.
        </p>
        <button
          type="button"
          onClick={onNavigatePlans}
          className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-bold uppercase cursor-pointer"
        >
          Ver opções
        </button>
      </div>
    );
  }

  return (
    <div className={clsx('bg-[#121214]', 'border', 'border-[#27272A]', 'rounded-3xl', 'p-6', 'text-left', 'max-w-2xl', 'mx-auto', 'space-y-6', 'animate-fade-in')}>
      <div className={clsx('border-b', 'border-[#27272A]', 'pb-3')}>
        <span className={clsx('font-serif', 'font-bold', 'text-base', 'text-white', 'block')}>Configurações do Cardápio Digital</span>
        <span className={clsx('text-[10px]', 'text-gray-400', 'block', 'mt-1')}>Personalize a identidade visual e comportamento do cardápio digital do cliente (Whitelabel).</span>
      </div>

      <div className="space-y-4">
        {/* Status Override */}
        <div className="space-y-1.5">
          <label className={clsx('text-[10px]', 'font-bold', 'text-gray-300', 'uppercase', 'tracking-wider', 'block')}>Status de Funcionamento:</label>
          <select
            value={cardapioStatusOverride}
            onChange={(e) => setCardapioStatusOverride(e.target.value)}
            className={clsx('w-full', 'px-3', 'py-2', 'bg-[#09090B]', 'border', 'border-[#27272A]', 'rounded-xl', 'text-white', 'text-xs', 'focus:outline-none', 'focus:border-[#10b981]')}
          >
            <option value="Automático">Automático (Segue horários de funcionamento)</option>
            <option value="Forçado Aberto">Forçado Aberto (Sempre aberto para pedidos)</option>
            <option value="Forçado Fechado">Forçado Fechado (Sempre fechado/indisponível)</option>
          </select>
        </div>

        {/* Cores */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className={clsx('text-[10px]', 'font-bold', 'text-gray-300', 'uppercase', 'tracking-wider', 'block')}>Cor Primária (Tema):</label>
            <div className="flex gap-2">
              <input
                type="color"
                value={cardapioCorPrimaria}
                onChange={(e) => setCardapioCorPrimaria(e.target.value)}
                className="w-10 h-10 p-0 border border-[#27272A] rounded-xl bg-transparent cursor-pointer"
              />
              <input
                type="text"
                value={cardapioCorPrimaria}
                onChange={(e) => setCardapioCorPrimaria(e.target.value)}
                className={clsx('flex-1', 'px-3', 'py-2', 'bg-[#09090B]', 'border', 'border-[#27272A]', 'rounded-xl', 'text-white', 'text-xs', 'font-mono')}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className={clsx('text-[10px]', 'font-bold', 'text-gray-300', 'uppercase', 'tracking-wider', 'block')}>Cor de Fundo:</label>
            <div className="flex gap-2">
              <input
                type="color"
                value={cardapioCorFundo}
                onChange={(e) => setCardapioCorFundo(e.target.value)}
                className="w-10 h-10 p-0 border border-[#27272A] rounded-xl bg-transparent cursor-pointer"
              />
              <input
                type="text"
                value={cardapioCorFundo}
                onChange={(e) => setCardapioCorFundo(e.target.value)}
                className={clsx('flex-1', 'px-3', 'py-2', 'bg-[#09090B]', 'border', 'border-[#27272A]', 'rounded-xl', 'text-white', 'text-xs', 'font-mono')}
              />
            </div>
          </div>
        </div>

        {/* Upload de Logo e Banner */}
        <div className="space-y-4">
          <CardapioAssetUploader
            label="Logotipo do Restaurante"
            type="logo"
            currentUrl={cardapioLogoUrl}
            apiBaseUrl={apiBaseUrl}
            authHeaders={authHeaders}
            onSuccess={(newUrl) => setCardapioLogoUrl(newUrl || '')}
          />

          <CardapioAssetUploader
            label="Banner Promocional / Capa"
            type="banner"
            currentUrl={cardapioBannerUrl}
            apiBaseUrl={apiBaseUrl}
            authHeaders={authHeaders}
            onSuccess={(newUrl) => setCardapioBannerUrl(newUrl || '')}
          />
        </div>

        {/* Sobre Nós */}
        <div className="space-y-1.5">
          <label className={clsx('text-[10px]', 'font-bold', 'text-gray-300', 'uppercase', 'tracking-wider', 'block')}>Sobre Nós:</label>
          <textarea
            value={cardapioSobreNos}
            onChange={(e) => setCardapioSobreNos(e.target.value)}
            rows={3}
            placeholder="Breve história ou descrição do restaurante..."
            className={clsx('w-full', 'px-3', 'py-2', 'bg-[#09090B]', 'border', 'border-[#27272A]', 'rounded-xl', 'text-white', 'text-xs', 'focus:outline-none', 'focus:border-[#10b981]')}
          />
        </div>

        {/* Endereço */}
        <div className="space-y-1.5">
          <label className={clsx('text-[10px]', 'font-bold', 'text-gray-300', 'uppercase', 'tracking-wider', 'block')}>Endereço Físico:</label>
          <input
            type="text"
            value={cardapioEndereco}
            onChange={(e) => setCardapioEndereco(e.target.value)}
            placeholder="Rua Exemplo, 123 - Centro"
            className={clsx('w-full', 'px-3', 'py-2', 'bg-[#09090B]', 'border', 'border-[#27272A]', 'rounded-xl', 'text-white', 'text-xs', 'focus:outline-none', 'focus:border-[#10b981]')}
          />
        </div>
      </div>

      {/* Botão de salvar */}
      <div className={clsx('pt-4', 'border-t', 'border-[#27272A]', 'flex', 'justify-end')}>
        <button
          type="button"
          disabled={isSavingCardapioConfig}
          onClick={saveCardapioConfig}
          className={clsx('px-5', 'py-2.5', 'bg-[#10b981]', 'hover:bg-[#059669]', 'text-[#121214]', 'font-bold', 'rounded-xl', 'text-[9px]', 'uppercase', 'tracking-wider', 'transition-all', 'cursor-pointer', 'shadow-lg', 'disabled:opacity-50')}
        >
          {isSavingCardapioConfig ? 'Salvando...' : 'Salvar Configurações Whitelabel'}
        </button>
      </div>
    </div>
  );
}
