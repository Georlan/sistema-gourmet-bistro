import React from "react";
import NumberFlow from "@number-flow/react";
import {
  MenuAccountGlyph,
  MenuBagGlyph,
  MenuHomeGlyph,
  MenuOrdersGlyph,
} from "./MenuSvgAssets";

export type MenuDockTab = "home" | "orders" | "bag" | "account";

interface MenuBottomDockProps {
  activeTab: MenuDockTab;
  cartCount: number;
  cartTotal: number;
  activeOrdersCount: number;
  userFirstName?: string | null;
  userFullName?: string | null;
  hidden?: boolean;
  onNavigate: (tab: MenuDockTab) => void;
}

const brlFormatter = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

const TABS: Array<{ id: MenuDockTab; label: string; domId: string }> = [
  { id: "home", label: "Início", domId: "mobile-nav-home" },
  { id: "orders", label: "Pedidos", domId: "mobile-nav-orders" },
  { id: "bag", label: "Sacola", domId: "mobile-nav-cart" },
  { id: "account", label: "Conta", domId: "mobile-nav-account" },
];

function MenuBottomDock({
  activeTab,
  cartCount,
  cartTotal,
  activeOrdersCount,
  userFirstName,
  userFullName,
  hidden = false,
  onNavigate,
}: MenuBottomDockProps) {
  if (hidden) return null;

  const canUseNumberFlow = typeof window !== "undefined" && typeof document !== "undefined";

  const renderGlyph = (id: MenuDockTab) => {
    switch (id) {
      case "home":
        return <MenuHomeGlyph className="w-5 h-5" />;
      case "orders":
        return <MenuOrdersGlyph className="w-5 h-5" />;
      case "bag":
        return <MenuBagGlyph className="w-5 h-5" />;
      case "account":
        return <MenuAccountGlyph className="w-5 h-5" />;
    }
  };

  return (
      <div className="km-dock-wrap">
        <nav className="km-dock" id="koma-art-dock" aria-label="Navegação rápida">
          {TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            const badge =
              tab.id === "bag"
                ? cartCount
                : tab.id === "orders"
                  ? activeOrdersCount
                  : 0;
            let accessibleLabel: string | undefined;
            if (tab.id === "account") {
              accessibleLabel = userFullName || "Minha conta";
            } else if (tab.id === "bag" && cartCount > 0) {
              const itemLabel = cartCount === 1 ? "item" : "itens";
              accessibleLabel = `${tab.label}, ${cartCount} ${itemLabel}, ${brlFormatter.format(cartTotal)}`;
            }

            return (
              <button
                key={tab.id}
                type="button"
                id={tab.domId}
                className={`km-dock__btn ${isActive ? "is-active" : ""}`}
                aria-current={isActive ? "page" : undefined}
                aria-label={accessibleLabel}
                onClick={() => onNavigate(tab.id)}
              >
                {isActive && (
                  <span className="km-dock__ink" aria-hidden="true">
                    <span key={activeTab} className="km-dock__ink-drop" />
                  </span>
                )}

                <span className="km-dock__icon-wrap">
                  {renderGlyph(tab.id)}
                  {badge > 0 && (
                    <span className="km-dock__badge" aria-label={`${badge} itens`}>
                      {canUseNumberFlow ? <NumberFlow value={badge} /> : badge}
                    </span>
                  )}
                </span>

                <span className="km-dock__label km-tabular">
                  {tab.id === "bag" && cartCount > 0 ? (
                    canUseNumberFlow ? (
                      <NumberFlow
                        value={cartTotal}
                        format={{ style: "currency", currency: "BRL" }}
                        locales="pt-BR"
                      />
                    ) : (
                      brlFormatter.format(cartTotal)
                    )
                  ) : tab.id === "account" && userFirstName ? (
                    userFirstName
                  ) : (
                    tab.label
                  )}
                </span>
              </button>
            );
          })}
        </nav>
      </div>
  );
}

export default React.memo(MenuBottomDock);
