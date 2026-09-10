import { Lock } from 'lucide-react';
import { CardapioDigitalSettingsPanel } from '../../cardapio/CardapioDigitalSettingsPanel';
import type { CashierTab } from '../cashierContracts';
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
  cardapio_marca: 'marca',
  cardapio_entrega: 'entrega',
  cardapio_pagamentos: 'pagamentos',
  cardapio_qr_links: 'qr_links',
} as const;

type OnlineMenuSection = (typeof sectionBySubTab)[keyof typeof sectionBySubTab];
type OnlineMenuWorkspace = 'loja' | 'operacao' | 'divulgacao';

const workspaceBySection: Record<OnlineMenuSection, OnlineMenuWorkspace> = {
  perfil: 'loja',
  marca: 'loja',
  pedidos: 'operacao',
  entrega: 'operacao',
  pagamentos: 'operacao',
  qr_links: 'divulgacao',
};

const detailsByWorkspace: Record<OnlineMenuWorkspace, { label: string; target: string; section: OnlineMenuSection }[]> = {
  loja: [
    { label: 'Perfil', target: 'cardapio_perfil', section: 'perfil' },
    { label: 'Marca', target: 'cardapio_marca', section: 'marca' },
  ],
  operacao: [
    { label: 'Pedidos & horários', target: 'cardapio_pedidos', section: 'pedidos' },
    { label: 'Entrega & áreas', target: 'cardapio_entrega', section: 'entrega' },
    { label: 'Pagamentos', target: 'cardapio_pagamentos', section: 'pagamentos' },
  ],
  divulgacao: [
    { label: 'QR & links', target: 'cardapio_qr_links', section: 'qr_links' },
  ],
};

function CompactOnlineMenuNavigation({
  activeSection,
  setActiveSubTab,
}: {
  activeSection: OnlineMenuSection;
  setActiveSubTab: (tab: string) => void;
}) {
  const activeWorkspace = workspaceBySection[activeSection];
  const detailOptions = detailsByWorkspace[activeWorkspace];

  if (detailOptions.length <= 1) return null;

  return (
    <div className="mb-4 flex flex-wrap gap-1.5">
      {detailOptions.map((option) => (
        <button
          key={option.target}
          type="button"
          onClick={() => setActiveSubTab(option.target)}
          className={`rounded-lg border px-3 py-1.5 text-[9px] font-bold transition-colors ${
            option.section === activeSection
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
              : 'border-koma-border bg-koma-panel text-koma-muted hover:text-koma-foreground'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Atalhos comerciais, não novos owners de regra.
 * Cupons e fidelidade continuam pertencendo ao módulo de Clientes; o cardápio
 * apenas aproxima essas ações do lugar em que o restaurante pensa na vitrine.
 */
function OnlineMenuGrowthShortcuts({
  setActiveTab,
  setActiveSubTab,
}: {
  setActiveTab: (tab: CashierTab) => void;
  setActiveSubTab: (tab: string) => void;
}) {
  const openCustomerTool = (subTab: 'cupons' | 'fidelidade') => {
    setActiveTab('clientes');
    setActiveSubTab(subTab);
  };

  return (
    <section
      id="online-menu-growth-shortcuts"
      className="mb-4 rounded-2xl border border-koma-border bg-koma-panel p-4 sm:flex sm:items-center sm:justify-between sm:gap-4"
    >
      <div className="max-w-xl">
        <p className="text-[9px] font-black uppercase tracking-[0.14em] text-emerald-600 dark:text-emerald-300">Venda mais</p>
        <h3 className="mt-1 text-sm font-black text-koma-foreground">Traga o cliente de volta sem complicar o cardápio</h3>
        <p className="mt-1 text-[10px] leading-relaxed text-koma-muted">
          Use cupom para conversão imediata e fidelidade ou cashback para recorrência. As regras continuam centralizadas em Clientes.
        </p>
      </div>

      <div className="mt-3 grid shrink-0 grid-cols-2 gap-2 sm:mt-0 sm:min-w-[300px]">
        <button
          id="online-menu-open-coupons"
          type="button"
          onClick={() => openCustomerTool('cupons')}
          className="rounded-xl border border-koma-border bg-koma-card px-3 py-2.5 text-left transition hover:border-emerald-500/35 hover:bg-emerald-500/[0.06]"
        >
          <strong className="block text-[10px] text-koma-foreground">Cupons</strong>
          <span className="mt-0.5 block text-[8px] leading-relaxed text-koma-muted">Criar incentivo para fechar a compra.</span>
        </button>
        <button
          id="online-menu-open-loyalty"
          type="button"
          onClick={() => openCustomerTool('fidelidade')}
          className="rounded-xl border border-koma-border bg-koma-card px-3 py-2.5 text-left transition hover:border-emerald-500/35 hover:bg-emerald-500/[0.06]"
        >
          <strong className="block text-[10px] text-koma-foreground">Fidelidade</strong>
          <span className="mt-0.5 block text-[8px] leading-relaxed text-koma-muted">Configurar pontos ou cashback.</span>
        </button>
      </div>
    </section>
  );
}

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
              setActiveSubTab('planos');
            }}
            className={"px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-bold uppercase cursor-pointer"}
          >
            Ver opções
          </button>
        </div>
  );

  const restaurantId = readRestaurantIdFromAuthorization(authHeaders.Authorization || authHeaders.authorization);
  const publicMenuUrl = restaurantId ? `/cardapio?restaurante_id=${restaurantId}` : null;
  const activeSection = sectionBySubTab[activeSubTab as keyof typeof sectionBySubTab] ?? 'perfil';

  let content;

  if (activeSection === 'pedidos') {
    content = (
      <>
        <OnlineOrderCapacitySettings apiBaseUrl={apiBaseUrl} authHeaders={authHeaders} />
        <OnlineOrderCustomerBlocks apiBaseUrl={apiBaseUrl} authHeaders={authHeaders} />
        <OnlineMenuOrdersSettings
          apiBaseUrl={apiBaseUrl}
          authHeaders={authHeaders}
          publicMenuUrl={publicMenuUrl}
        />
      </>
    );
  } else if (activeSection === 'entrega') {
    content = <OnlineMenuDeliverySettings apiBaseUrl={apiBaseUrl} authHeaders={authHeaders} />;
  } else if (activeSection === 'pagamentos') {
    content = (
      <OnlineMenuPaymentSettings
        apiBaseUrl={apiBaseUrl}
        authHeaders={authHeaders}
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
    );
  }

  return (
    <>
      <CompactOnlineMenuNavigation activeSection={activeSection} setActiveSubTab={setActiveSubTab} />
      {activeSection === 'perfil' && (
        <OnlineMenuGrowthShortcuts setActiveTab={setActiveTab} setActiveSubTab={setActiveSubTab} />
      )}
      {content}
    </>
  );
}
