import { useEffect, useRef, useState, type ReactNode } from 'react';
import { usePublicMenuSlug } from './usePublicMenuSlug';
import { ArrowRight, ChevronDown, Gift, Lock } from 'lucide-react';
import { CardapioDigitalSettingsPanel } from '../../cardapio/CardapioDigitalSettingsPanel';
import type { CashierTab } from '../cashierContracts';
import { getTenantPublicMenuUrl, resolveKomaHost } from '../../../domain/komaHost';
import { OnlineMenuDeliverySettings } from './OnlineMenuDeliverySettings';
import { OnlineMenuOrdersSettings } from './OnlineMenuOrdersSettings';
import { OnlineMenuPaymentSettings } from './OnlineMenuPaymentSettings';
import { OnlineMenuQrLinks } from './OnlineMenuQrLinks';
import { OnlineOrderCapacitySettings } from './OnlineOrderCapacitySettings';
import { OnlineOrderCustomerBlocks } from './OnlineOrderCustomerBlocks';

interface Props {
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
  activeSubTab: string;
  setActiveSubTab: (tab: string) => void;
  setActiveTab: (tab: CashierTab) => void;
  hasOnlineMenu: boolean;
  hasLoyalty: boolean;
  hasCoupons: boolean;
}

const readRestaurantIdFromAuthorization = (authorization?: string): number | null => {
  const token = authorization?.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;

  try {
    const payloadPart = token.split('.')[1];
    if (!payloadPart) return null;
    const normalized = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const payload = JSON.parse(window.atob(padded));
    const restauranteId = Number(payload?.restaurante_id);
    return Number.isInteger(restauranteId) && restauranteId > 0 ? restauranteId : null;
  } catch {
    return null;
  }
};

const sectionBySubTab = {
  cardapio_digital: 'perfil',
  cardapio_perfil: 'perfil',
  cardapio_pedidos: 'pedidos',
  cardapio_bloqueios: 'bloqueios',
  cardapio_marca: 'marca',
  cardapio_entrega: 'entrega',
  cardapio_pagamentos: 'pagamentos',
  cardapio_qr_links: 'qr_links',
} as const;

type OnlineMenuSection = (typeof sectionBySubTab)[keyof typeof sectionBySubTab];

/** Plan gate and online-channel composition only. Technical integrations live under Sistema. */
export default function CashierOnlineMenu({
  apiBaseUrl, authHeaders, activeSubTab, setActiveSubTab, setActiveTab, hasOnlineMenu, hasLoyalty, hasCoupons,
}: Props) {
  const authorization = authHeaders.Authorization || authHeaders.authorization;
  const restaurantId = readRestaurantIdFromAuthorization(authorization);
  const configuredSlug = usePublicMenuSlug(apiBaseUrl, authorization, restaurantId, hasOnlineMenu);

  const activeSection = sectionBySubTab[activeSubTab as keyof typeof sectionBySubTab] ?? 'perfil';
  const activeKey: OnlineMenuSection = activeSection === 'marca'
    ? 'perfil'
    : activeSection === 'bloqueios'
      ? 'pedidos'
      : activeSection;
  const blocksDetailsRef = useRef<HTMLDetailsElement | null>(null);
  const [capacityOpen, setCapacityOpen] = useState(false);
  const [blocksOpen, setBlocksOpen] = useState(activeSection === 'bloqueios');
  const [visitedSections, setVisitedSections] = useState<OnlineMenuSection[]>([activeKey]);
  useEffect(() => {
    setVisitedSections(previous => previous.includes(activeKey) ? previous : [...previous, activeKey]);
  }, [activeKey]);

  useEffect(() => {
    if (activeSection !== 'bloqueios') return;
    setBlocksOpen(true);
    const node = blocksDetailsRef.current;
    if (!node) return;
    node.open = true;
    node.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [activeSection]);

  if (!hasOnlineMenu) return (
        <div
          className="bg-koma-card border border-koma-border rounded-3xl p-8 text-center max-w-xl mx-auto space-y-3"
        >
          <Lock size={24} className="mx-auto" style={{ color: 'var(--koma-warning-text)' }} />
          <h3 className="text-koma-foreground font-bold" style={{ fontFamily: 'var(--koma-font-display)' }}>
            Confira a ativação do cardápio digital
          </h3>
          <p className="text-xs text-koma-subtle">
            Link, QR Code e aceite de pedidos já estão incluídos em todos os planos. Fale com o suporte para conferir a
            ativação.
          </p>
          <button
            type="button"
            onClick={() => {
              setActiveTab('assinatura_pix');
              setActiveSubTab('planos_upgrade');
            }}
            className="inline-flex min-h-11 items-center justify-center px-5 rounded-xl text-xs font-semibold transition cursor-pointer"
            style={{
              background: 'var(--koma-action-bg)',
              color: 'var(--koma-action-text)',
            }}
          >
            Ver opções
          </button>
        </div>
  );

  const resolvedHost = resolveKomaHost();
  const publicMenuUrl = configuredSlug
    ? `/c/${encodeURIComponent(configuredSlug)}`
    : resolvedHost.kind === 'tenant' && resolvedHost.tenantSlug
    ? getTenantPublicMenuUrl(resolvedHost.tenantSlug)
    : null;
  const contents: Partial<Record<OnlineMenuSection, ReactNode>> = {};

  contents.pedidos = (
      <div className="space-y-4">
        <OnlineMenuOrdersSettings
          apiBaseUrl={apiBaseUrl}
          authHeaders={authHeaders}
          publicMenuUrl={publicMenuUrl}
        />

        <details
          open={capacityOpen}
          onToggle={(event) => setCapacityOpen(event.currentTarget.open)}
          className="group rounded-2xl border border-koma-border bg-koma-panel"
        >
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 px-4 py-4 sm:px-5">
            <div>
              <strong
                className="block text-sm text-koma-foreground"
                style={{ fontFamily: 'var(--koma-font-display)' }}
              >
                Limite de segurança
              </strong>
              <span className="mt-1 block text-xs leading-relaxed text-koma-muted">
                Use somente se quiser limitar a quantidade de pedidos online ativos ao mesmo tempo.
              </span>
            </div>
            <ChevronDown
              size={16}
              className="shrink-0 text-koma-muted transition-transform duration-200 group-open:rotate-180"
            />
          </summary>
          {capacityOpen && (
            <div className="border-t border-koma-border px-4 py-4 sm:px-5">
              <OnlineOrderCapacitySettings apiBaseUrl={apiBaseUrl} authHeaders={authHeaders} />
            </div>
          )}
        </details>

        <details
          ref={blocksDetailsRef}
          open={blocksOpen}
          onToggle={(event) => setBlocksOpen(event.currentTarget.open)}
          className="group rounded-2xl border border-koma-border bg-koma-panel"
        >
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 px-4 py-4 sm:px-5">
            <div>
              <strong
                className="block text-sm text-koma-foreground"
                style={{ fontFamily: 'var(--koma-font-display)' }}
              >
                Bloqueios de clientes
              </strong>
              <span className="mt-1 block text-xs leading-relaxed text-koma-muted">
                Veja quem está impedido de pedir online, libere quando necessário e acompanhe o histórico.
              </span>
            </div>
            <ChevronDown
              size={16}
              className="shrink-0 text-koma-muted transition-transform duration-200 group-open:rotate-180"
            />
          </summary>
          {blocksOpen && (
            <div className="border-t border-koma-border px-4 py-4 sm:px-5">
              <OnlineOrderCustomerBlocks apiBaseUrl={apiBaseUrl} authHeaders={authHeaders} />
            </div>
          )}
        </details>
      </div>
  );
  // Compatibility map entry preserved for legacy route checks; rendered inline inside `pedidos`.
  contents.bloqueios = <OnlineOrderCustomerBlocks apiBaseUrl={apiBaseUrl} authHeaders={authHeaders} />;

  contents.entrega = <OnlineMenuDeliverySettings apiBaseUrl={apiBaseUrl} authHeaders={authHeaders} publicMenuUrl={publicMenuUrl} />;

  contents.pagamentos = (
      <OnlineMenuPaymentSettings
        apiBaseUrl={apiBaseUrl}
        authHeaders={authHeaders}
        publicMenuUrl={publicMenuUrl}
        onManageIntegrations={() => {
          setActiveTab('impressao_salao');
          setActiveSubTab('integracoes');
        }}
      />
  );
  contents.qr_links = <OnlineMenuQrLinks publicMenuUrl={publicMenuUrl} />;

  contents.perfil = (
      <>
        <CardapioDigitalSettingsPanel
          key={authHeaders.Authorization || authHeaders.authorization}
          apiBaseUrl={apiBaseUrl}
          authHeaders={authHeaders}
          publicMenuUrl={publicMenuUrl}
          activeSection={activeSection === 'marca' ? 'marca' : 'perfil'}
          onSectionChange={(section) => {
            setActiveSubTab(
              section === 'pedidos'
                ? 'cardapio_pedidos'
                : section === 'marca'
                  ? 'cardapio_marca'
                  : 'cardapio_perfil',
            );
          }}
        />
        {activeKey === 'perfil' && (
          <section
            className="mt-4 rounded-2xl border border-koma-border bg-koma-panel p-4 sm:p-5"
            aria-labelledby="online-menu-promotions-shortcut-title"
          >
            <div className="flex items-start gap-3">
              <span
                className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-koma-border bg-koma-card text-koma-foreground"
                aria-hidden="true"
              >
                <Gift size={18} />
              </span>
              <div className="min-w-0">
                <h2
                  id="online-menu-promotions-shortcut-title"
                  className="text-sm font-bold text-koma-foreground"
                  style={{ fontFamily: 'var(--koma-font-display)' }}
                >
                  Promoções, vitrine e benefícios
                </h2>
                <p className="mt-1 text-xs leading-relaxed text-koma-muted">
                  Ofertas, combos, produto em destaque e recomendações da sacola ficam centralizados em Cardápio → Promoções e vitrine.
                </p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setActiveTab('cardapio');
                  setActiveSubTab('promocoes');
                }}
                className="inline-flex min-h-11 items-center gap-2 rounded-xl px-4 text-xs font-semibold transition"
                style={{
                  background: 'var(--koma-action-bg)',
                  color: 'var(--koma-action-text)',
                }}
              >
                <span>Abrir Promoções e vitrine</span>
                <ArrowRight size={14} aria-hidden="true" />
              </button>
              {hasCoupons && (
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('clientes');
                    setActiveSubTab('cupons');
                  }}
                  className="min-h-11 rounded-xl border border-koma-border bg-koma-card px-4 text-xs font-semibold text-koma-foreground transition hover:bg-koma-raised"
                >
                  Configurar cupons
                </button>
              )}
              {hasLoyalty && (
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('clientes');
                    setActiveSubTab('fidelidade');
                  }}
                  className="min-h-11 rounded-xl border border-koma-border bg-koma-card px-4 text-xs font-semibold text-koma-foreground transition hover:bg-koma-raised"
                >
                  Configurar fidelidade
                </button>
              )}
            </div>
          </section>
        )}
      </>
  );

  return <div className="space-y-4">{Object.entries(contents).map(([section, content]) => (
    (section === activeKey || visitedSections.includes(section as OnlineMenuSection)) && (
      <div key={section} hidden={section !== activeKey} data-online-menu-section={section}>{content}</div>
    )
  ))}</div>;
}
