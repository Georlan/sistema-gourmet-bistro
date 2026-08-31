import { Lock } from 'lucide-react';
import { CardapioDigitalSettingsPanel } from '../../cardapio/CardapioDigitalSettingsPanel';
import type { CashierTab } from '../cashierContracts';

interface Props {
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
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


/** Plan gate and direct composition only; the settings panel owns its single snapshot. */
export default function CashierOnlineMenu({
  apiBaseUrl, authHeaders, setActiveSubTab, setActiveTab, hasOnlineMenu,
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
  return <CardapioDigitalSettingsPanel
    key={authHeaders.Authorization || authHeaders.authorization}
    apiBaseUrl={apiBaseUrl}
    authHeaders={authHeaders}
    publicMenuUrl={restaurantId ? `/cardapio?restaurante_id=${restaurantId}` : null}
  />;
}
