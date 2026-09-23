import { ChevronDown, Gift, Lock } from 'lucide-react';
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
  apiBaseUrl, authHeaders, activeSubTab, setActiveSubTab, setActiveTab, hasOnlineMenu,
}: Props) {
  if (!hasOnlineMenu) return (
        <div
          className={"bg-koma-card border border-amber-500/20 rounded-3xl p-8 text-center max-w-xl mx-auto space-y-3"}
        >
          <Lock size={24} className={"text-amber-400 mx-auto"} />
          <h3 className={"text-koma-foreground font-bold"}>Confira a ativação do cardápio digital</h3>
          <p className={"text-[10px] text-koma-subtle"}>
            Link, QR Code e aceite de pedidos já estão incluídos em todos os planos. Fale com o suporte para conferir a
            ativação.
          </p>
          <button
            type="button"
            onClick={() => {
              setActiveTab('assinatura_pix');
              setActiveSubTab('planos_upgrade');
            }}
            className={"px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-bold uppercase cursor-pointer"}
          >
            Ver opções
          </button>
        </div>
  );

  const restaurantId = readRestaurantIdFromAuthorization(authHeaders.Authorization || authHeaders.authorization);
  const resolvedHost = resolveKomaHost();
  const publicMenuUrl = resolvedHost.kind === 'tenant' && resolvedHost.tenantSlug
    ? getTenantPublicMenuUrl(resolvedHost.tenantSlug)
    : restaurantId
      ? `/cardapio?restaurante_id=${restaurantId}`
      : null;
  const activeSection = sectionBySubTab[activeSubTab as keyof typeof sectionBySubTab] ?? 'perfil';

  let content;

  if (activeSection === 'pedidos') {
    content = (
      <div className="space-y-4">
        <OnlineMenuOrdersSettings
          apiBaseUrl={apiBaseUrl}
          authHeaders={authHeaders}
          publicMenuUrl={publicMenuUrl}
        />

        <details className="group rounded-2xl border border-koma-border bg-koma-panel">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-4 sm:px-5">
            <div>
              <strong className="block text-sm text-koma-foreground">Limite de segurança</strong>
              <span className="mt-1 block text-[10px] leading-relaxed text-koma-muted">
                Use somente se quiser limitar a quantidade de pedidos online ativos ao mesmo tempo.
              </span>
            </div>
            <ChevronDown
              size={16}
              className="shrink-0 text-koma-muted transition-transform duration-200 group-open:rotate-180"
            />
          </summary>
          <div className="border-t border-koma-border px-4 py-4 sm:px-5">
            <OnlineOrderCapacitySettings apiBaseUrl={apiBaseUrl} authHeaders={authHeaders} />
          </div>
        </details>
      </div>
    );
  } else if (activeSection === 'bloqueios') {
    content = <OnlineOrderCustomerBlocks apiBaseUrl={apiBaseUrl} authHeaders={authHeaders} />;
  } else if (activeSection === 'entrega') {
    content = <OnlineMenuDeliverySettings apiBaseUrl={apiBaseUrl} authHeaders={authHeaders} publicMenuUrl={publicMenuUrl} />;
  } else if (activeSection === 'pagamentos') {
    content = (
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
  } else if (activeSection === 'qr_links') {
    content = <OnlineMenuQrLinks publicMenuUrl={publicMenuUrl} />;
  } else {
    content = (
      <>
        <CardapioDigitalSettingsPanel
          key={authHeaders.Authorization || authHeaders.authorization}
          apiBaseUrl={apiBaseUrl}
          authHeaders={authHeaders}
          publicMenuUrl={publicMenuUrl}
          activeSection={activeSection}
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
        {activeSection === 'perfil' && (
          <section className="mt-4 rounded-2xl border border-koma-border bg-koma-panel p-4 sm:p-5" aria-labelledby="online-menu-benefits-settings-title">
            <div className="flex items-start gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-emerald-500/10 text-emerald-500"><Gift size={18} aria-hidden="true" /></span>
              <div>
                <h2 id="online-menu-benefits-settings-title" className="text-sm font-black text-koma-foreground">Promoções e fidelidade</h2>
                <p className="mt-1 text-xs leading-relaxed text-koma-muted">Os cupons públicos e a regra de pontos ou cashback configurados em Clientes aparecem em Benefícios no cardápio. O saldo pessoal aparece quando o cliente entra na conta.</p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" onClick={() => { setActiveTab('clientes'); setActiveSubTab('cupons'); }} className="min-h-11 rounded-xl border border-koma-border bg-koma-card px-4 text-xs font-bold text-koma-foreground">Configurar cupons</button>
              <button type="button" onClick={() => { setActiveTab('clientes'); setActiveSubTab('fidelidade'); }} className="min-h-11 rounded-xl border border-koma-border bg-koma-card px-4 text-xs font-bold text-koma-foreground">Configurar fidelidade</button>
            </div>
          </section>
        )}
      </>
    );
  }

  return content;
}
