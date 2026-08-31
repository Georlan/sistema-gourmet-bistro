import clsx from 'clsx';
import { Lock } from 'lucide-react';
import { useEffect, useState } from 'react';
import { CardapioAssetUploader } from '../../CardapioAssetUploader';
import type { CashierNotice, CashierTab } from '../cashierContracts';

interface Props {
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
  activeTab: string;
  activeSubTab: string;
  setActiveSubTab: (tab: string) => void;
  showToast: CashierNotice;
  setActiveTab: (tab: CashierTab) => void;
  hasOnlineMenu: boolean;
}

export default function CashierOnlineMenu({
  apiBaseUrl,
  authHeaders,
  activeTab,
  activeSubTab,
  setActiveSubTab,
  showToast,
  setActiveTab,
  hasOnlineMenu,
}: Props) {
  const [cardapioStatusOverride, setCardapioStatusOverride] = useState<string>('Automático');

  const [cardapioCorPrimaria, setCardapioCorPrimaria] = useState<string>('#00b894');

  const [cardapioCorFundo, setCardapioCorFundo] = useState<string>('#090a0f');

  const [cardapioLogoUrl, setCardapioLogoUrl] = useState<string>('');

  const [cardapioBannerUrl, setCardapioBannerUrl] = useState<string>('');

  const [cardapioSobreNos, setCardapioSobreNos] = useState<string>('');

  const [cardapioEndereco, setCardapioEndereco] = useState<string>('');

  const [isSavingCardapioConfig, setIsSavingCardapioConfig] = useState<boolean>(false);

  const fetchCardapioConfig = async () => {
    try {
      const res = await fetch(`${apiBaseUrl}/caixa/config-cardapio`, { headers: authHeaders });
      if (res.ok) {
        const data = await res.json();
        setCardapioStatusOverride(data.status_override || 'Automático');
        setCardapioCorPrimaria(data.cor_primaria || '#00b894');
        setCardapioCorFundo(data.cor_fundo || '#090a0f');
        setCardapioLogoUrl(data.logo_url || '');
        setCardapioBannerUrl(data.banner_url || '');
        setCardapioSobreNos(data.sobre_nos || '');
        setCardapioEndereco(data.endereco || '');
      }
    } catch (err) {
      console.error('Error fetching cardapio whitelabel config', err);
    }
  };

  const saveCardapioConfig = async () => {
    setIsSavingCardapioConfig(true);
    try {
      const res = await fetch(`${apiBaseUrl}/caixa/config-cardapio`, {
        method: 'PUT',
        headers: {
          ...authHeaders,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          status_override: cardapioStatusOverride,
          cor_primaria: cardapioCorPrimaria,
          cor_fundo: cardapioCorFundo,
          logo_url: cardapioLogoUrl,
          banner_url: cardapioBannerUrl,
          sobre_nos: cardapioSobreNos,
          endereco: cardapioEndereco,
        }),
      });
      if (res.ok) {
        if (typeof showToast === 'function') {
          showToast('Configurações do cardápio digital atualizadas com sucesso!', 'success');
        } else {
          alert('Configurações do cardápio digital atualizadas com sucesso!');
        }
      } else {
        const errD = await res.json().catch(() => ({}));
        const detail = errD.detail || errD.message || 'Falha ao salvar as configurações.';
        alert(`Falha ao salvar as configurações: ${detail}`);
      }
    } catch (err: any) {
      console.error('Error saving cardapio whitelabel config', err);
      alert(`Erro de conexão ao salvar configurações: ${err.message || err}`);
    } finally {
      setIsSavingCardapioConfig(false);
    }
  };
  useEffect(() => {
    if (activeTab === 'cardapio_digital' || activeSubTab === 'cardapio_digital') {
      fetchCardapioConfig();
    }
  }, [activeTab, activeSubTab, apiBaseUrl, authHeaders.Authorization]);
  return (
    <>
      {(activeTab === 'cardapio_digital' || activeSubTab === 'cardapio_digital') && !hasOnlineMenu && (
        <div
          className={clsx(
            'bg-koma-card',
            'border',
            'border-amber-500/20',
            'rounded-3xl',
            'p-8',
            'text-center',
            'max-w-xl',
            'mx-auto',
            'space-y-3',
          )}
        >
          <Lock size={24} className={clsx('text-amber-400', 'mx-auto')} />
          <h3 className={clsx('text-koma-foreground', 'font-bold')}>Confira a ativação do cardápio digital</h3>
          <p className={clsx('text-[10px]', 'text-koma-subtle')}>
            Link, QR Code e aceite de pedidos já estão incluídos em todos os planos. Fale com o suporte para conferir a
            ativação.
          </p>
          <button
            type="button"
            onClick={() => {
              setActiveTab('assinatura_pix');
              setActiveSubTab('planos');
            }}
            className={clsx(
              'px-4',
              'py-2',
              'rounded-xl',
              'bg-emerald-600',
              'hover:bg-emerald-700',
              'text-white',
              'text-[10px]',
              'font-bold',
              'uppercase',
              'cursor-pointer',
            )}
          >
            Ver opções
          </button>
        </div>
      )}
      {(activeTab === 'cardapio_digital' || activeSubTab === 'cardapio_digital') && hasOnlineMenu && (
        <div
          className={clsx(
            'grid',
            'grid-cols-1',
            'lg:grid-cols-12',
            'gap-6',
            'max-w-6xl',
            'mx-auto',
            'text-left',
            'animate-fade-in',
          )}
        >
          {/* Coluna 1: Formulário de Configuração (7 cols) */}
          <div
            className={clsx(
              'lg:col-span-7',
              'bg-koma-panel',
              'border',
              'border-koma-border',
              'rounded-3xl',
              'p-6',
              'space-y-6',
              'shadow-xs',
            )}
          >
            <div className={clsx('border-b', 'border-koma-border', 'pb-3')}>
              <span className={clsx('font-serif', 'font-bold', 'text-base', 'text-koma-foreground', 'block')}>
                Configurações do cardápio online
              </span>
              <span className={clsx('text-[11px]', 'text-koma-muted', 'block', 'mt-1')}>
                Defina a aparência, as informações e o comportamento do cardápio que seus clientes acessam online.
              </span>
            </div>

            <div className="space-y-4">
              {/* Status Override */}
              <div className="space-y-1.5">
                <label
                  className={clsx(
                    'text-[10px]',
                    'font-bold',
                    'text-koma-muted',
                    'uppercase',
                    'tracking-wider',
                    'block',
                  )}
                >
                  Status de Funcionamento:
                </label>
                <select
                  value={cardapioStatusOverride}
                  onChange={(e) => setCardapioStatusOverride(e.target.value)}
                  className={clsx(
                    'w-full',
                    'px-3.5',
                    'py-2.5',
                    'bg-koma-input',
                    'border',
                    'border-koma-border',
                    'rounded-xl',
                    'text-koma-foreground',
                    'text-xs',
                    'font-medium',
                    'focus:outline-none',
                    'focus:border-emerald-500/60',
                  )}
                >
                  <option value="Automático">Automático (Segue horários de funcionamento)</option>
                  <option value="Forçado Aberto">Forçado Aberto (Sempre aberto para pedidos)</option>
                  <option value="Forçado Fechado">Forçado Fechado (Sempre fechado/indisponível)</option>
                </select>
              </div>

              {/* Cores */}
              <div className={clsx('grid', 'grid-cols-1', 'sm:grid-cols-2', 'gap-4')}>
                <div className="space-y-1.5">
                  <label
                    className={clsx(
                      'text-[10px]',
                      'font-bold',
                      'text-koma-muted',
                      'uppercase',
                      'tracking-wider',
                      'block',
                    )}
                  >
                    Cor Primária (Destaques):
                  </label>
                  <div className={clsx('flex', 'gap-2')}>
                    <input
                      type="color"
                      value={cardapioCorPrimaria}
                      onChange={(e) => setCardapioCorPrimaria(e.target.value)}
                      className={clsx(
                        'w-10',
                        'h-10',
                        'p-0',
                        'border',
                        'border-koma-border',
                        'rounded-xl',
                        'bg-transparent',
                        'cursor-pointer',
                      )}
                    />
                    <input
                      type="text"
                      value={cardapioCorPrimaria}
                      onChange={(e) => setCardapioCorPrimaria(e.target.value)}
                      className={clsx(
                        'flex-1',
                        'px-3.5',
                        'py-2',
                        'bg-koma-input',
                        'border',
                        'border-koma-border',
                        'rounded-xl',
                        'text-koma-foreground',
                        'text-xs',
                        'font-mono',
                        'focus:outline-none',
                        'focus:border-emerald-500/60',
                      )}
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label
                    className={clsx(
                      'text-[10px]',
                      'font-bold',
                      'text-koma-muted',
                      'uppercase',
                      'tracking-wider',
                      'block',
                    )}
                  >
                    Cor de Fundo:
                  </label>
                  <div className={clsx('flex', 'gap-2')}>
                    <input
                      type="color"
                      value={cardapioCorFundo}
                      onChange={(e) => setCardapioCorFundo(e.target.value)}
                      className={clsx(
                        'w-10',
                        'h-10',
                        'p-0',
                        'border',
                        'border-koma-border',
                        'rounded-xl',
                        'bg-transparent',
                        'cursor-pointer',
                      )}
                    />
                    <input
                      type="text"
                      value={cardapioCorFundo}
                      onChange={(e) => setCardapioCorFundo(e.target.value)}
                      className={clsx(
                        'flex-1',
                        'px-3.5',
                        'py-2',
                        'bg-koma-input',
                        'border',
                        'border-koma-border',
                        'rounded-xl',
                        'text-koma-foreground',
                        'text-xs',
                        'font-mono',
                        'focus:outline-none',
                        'focus:border-emerald-500/60',
                      )}
                    />
                  </div>
                </div>
              </div>

              {/* Upload de Logo e Banner para Supabase Storage via Endpoints Backend */}
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
                <label
                  className={clsx(
                    'text-[10px]',
                    'font-bold',
                    'text-koma-muted',
                    'uppercase',
                    'tracking-wider',
                    'block',
                  )}
                >
                  Sobre Nós:
                </label>
                <textarea
                  value={cardapioSobreNos}
                  onChange={(e) => setCardapioSobreNos(e.target.value)}
                  rows={3}
                  placeholder="Breve história ou descrição do restaurante..."
                  className={clsx(
                    'w-full',
                    'px-3.5',
                    'py-2.5',
                    'bg-koma-input',
                    'border',
                    'border-koma-border',
                    'rounded-xl',
                    'text-koma-foreground',
                    'text-xs',
                    'focus:outline-none',
                    'focus:border-emerald-500/60',
                  )}
                />
              </div>

              {/* Endereço */}
              <div className="space-y-1.5">
                <label
                  className={clsx(
                    'text-[10px]',
                    'font-bold',
                    'text-koma-muted',
                    'uppercase',
                    'tracking-wider',
                    'block',
                  )}
                >
                  Endereço Físico:
                </label>
                <input
                  type="text"
                  value={cardapioEndereco}
                  onChange={(e) => setCardapioEndereco(e.target.value)}
                  placeholder="Rua Exemplo, 123 - Centro"
                  className={clsx(
                    'w-full',
                    'px-3.5',
                    'py-2.5',
                    'bg-koma-input',
                    'border',
                    'border-koma-border',
                    'rounded-xl',
                    'text-koma-foreground',
                    'text-xs',
                    'focus:outline-none',
                    'focus:border-emerald-500/60',
                  )}
                />
              </div>
            </div>

            {/* Botão de salvar */}
            <div className={clsx('pt-4', 'border-t', 'border-koma-border', 'flex', 'justify-end')}>
              <button
                type="button"
                disabled={isSavingCardapioConfig}
                onClick={saveCardapioConfig}
                className={clsx(
                  'px-6',
                  'py-2.5',
                  'koma-btn-success',
                  'rounded-xl',
                  'text-xs',
                  'font-bold',
                  'uppercase',
                  'tracking-wider',
                  'transition-all',
                  'cursor-pointer',
                  'shadow-sm',
                  'disabled:opacity-50',
                )}
              >
                {isSavingCardapioConfig ? 'Salvando...' : 'Salvar configurações'}
              </button>
            </div>
          </div>

          {/* Coluna 2: Live Mobile Mockup Preview (5 cols) */}
          <div className="lg:col-span-5 flex flex-col items-center">
            <div className="sticky top-6 w-full max-w-[320px] bg-koma-panel border border-koma-border rounded-[2.5rem] p-3 shadow-md space-y-3">
              {/* Top Phone speaker */}
              <div className="flex justify-center items-center gap-2 pt-1 pb-2">
                <div className="w-12 h-1 bg-koma-border rounded-full" />
                <div className="w-2.5 h-2.5 rounded-full bg-koma-border" />
              </div>

              {/* Phone Screen Canvas */}
              <div
                className="rounded-[1.75rem] overflow-hidden border border-koma-border/80 text-left transition-colors duration-300 min-h-[460px] flex flex-col"
                style={{ backgroundColor: cardapioCorFundo || '#ffffff' }}
              >
                {/* Header Banner */}
                <div
                  className="h-28 w-full bg-cover bg-center relative flex items-end p-3"
                  style={{
                    backgroundColor: cardapioCorPrimaria || '#00875f',
                    backgroundImage: cardapioBannerUrl ? `url(${cardapioBannerUrl})` : undefined,
                  }}
                >
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
                  <div className="relative z-10 flex items-center gap-2.5">
                    {cardapioLogoUrl ? (
                      <img
                        src={cardapioLogoUrl}
                        alt="Logo"
                        className="w-10 h-10 rounded-xl object-contain bg-white p-0.5 border border-white/20 shadow-xs"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-xl bg-white text-zinc-900 font-bold flex items-center justify-center text-xs shadow-xs">
                        Kôma
                      </div>
                    )}
                    <div className="text-white">
                      <h5 className="font-bold text-xs leading-tight drop-shadow-xs">Restaurante Gourmet</h5>
                      <span
                        className="inline-block text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md mt-0.5"
                        style={{ backgroundColor: cardapioCorPrimaria || '#00875f', color: '#ffffff' }}
                      >
                        {cardapioStatusOverride === 'Forçado Fechado' ? 'Fechado' : 'Aberto'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Content Preview */}
                <div className="p-3 space-y-3 flex-1 flex flex-col justify-between">
                  <div className="space-y-2">
                    {/* Sobre nós snippet */}
                    {cardapioSobreNos && (
                      <p className="text-[10px] text-zinc-600 dark:text-zinc-300 line-clamp-2 leading-relaxed italic">
                        "{cardapioSobreNos}"
                      </p>
                    )}

                    {/* Dummy Menu Categories */}
                    <div className="flex gap-1.5 overflow-x-hidden pt-1">
                      <span
                        className="text-[9px] font-bold px-2.5 py-1 rounded-full text-white shadow-2xs"
                        style={{ backgroundColor: cardapioCorPrimaria || '#00875f' }}
                      >
                        Destaques
                      </span>
                      <span className="text-[9px] font-bold px-2.5 py-1 rounded-full bg-zinc-200/80 text-zinc-700">
                        Pratos
                      </span>
                      <span className="text-[9px] font-bold px-2.5 py-1 rounded-full bg-zinc-200/80 text-zinc-700">
                        Bebidas
                      </span>
                    </div>

                    {/* Dummy Menu Cards */}
                    <div className="space-y-1.5 pt-1">
                      <div className="p-2 rounded-xl bg-white/90 border border-zinc-200 shadow-2xs flex justify-between items-center text-zinc-900">
                        <div>
                          <strong className="block text-[10px] font-bold">Filé Mignon ao Molho Madeira</strong>
                          <span className="text-[8px] text-zinc-500">Acompanha arroz e batatas rústicas</span>
                          <span
                            className="block text-[10px] font-bold font-mono mt-0.5"
                            style={{ color: cardapioCorPrimaria || '#00875f' }}
                          >
                            R$ 68,90
                          </span>
                        </div>
                        <div className="w-10 h-10 rounded-lg bg-zinc-100 border border-zinc-200 flex items-center justify-center text-[8px] text-zinc-400">
                          Foto
                        </div>
                      </div>

                      <div className="p-2 rounded-xl bg-white/90 border border-zinc-200 shadow-2xs flex justify-between items-center text-zinc-900">
                        <div>
                          <strong className="block text-[10px] font-bold">Salmão Grelhado com Legumes</strong>
                          <span className="text-[8px] text-zinc-500">Salmão fresco com azeite de ervas</span>
                          <span
                            className="block text-[10px] font-bold font-mono mt-0.5"
                            style={{ color: cardapioCorPrimaria || '#00875f' }}
                          >
                            R$ 74,50
                          </span>
                        </div>
                        <div className="w-10 h-10 rounded-lg bg-zinc-100 border border-zinc-200 flex items-center justify-center text-[8px] text-zinc-400">
                          Foto
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Bottom Order Bar */}
                  <div
                    className="w-full py-2 px-3 rounded-xl text-white font-bold text-[10px] flex justify-between items-center shadow-xs"
                    style={{ backgroundColor: cardapioCorPrimaria || '#00875f' }}
                  >
                    <span>Ver Sacola (2 itens)</span>
                    <span className="font-mono">R$ 143,40</span>
                  </div>
                </div>
              </div>

              <span className="text-[9px] text-koma-subtle block text-center font-medium">
                Preview em tempo real do Cardápio Whitelabel
              </span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
