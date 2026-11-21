import React from "react";
import { motion } from "motion/react";
import NumberFlow from "@number-flow/react";
import {
  MenuAccountGlyph,
  MenuBagGlyph,
  MenuHomeGlyph,
  MenuOrdersGlyph,
} from "./MenuSvgAssets";
import { KOMA_SPRING_BUBBLE } from "./motionTokens";

export type MenuDockTab = "home" | "orders" | "bag" | "account";

interface MenuBottomDockProps {
  activeTab: MenuDockTab;
  cartCount: number;
  cartTotal: number;
  activeOrdersCount: number;
  userFirstName?: string | null;
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

export default function MenuBottomDock({
  activeTab,
  cartCount,
  cartTotal,
  activeOrdersCount,
  userFirstName,
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

          return (
            <motion.button
              key={tab.id}
              type="button"
              id={tab.domId}
              className={`km-dock__btn ${isActive ? "is-active" : ""}`}
              aria-current={isActive ? "page" : undefined}
              whileTap={{ scale: 0.94 }}
              transition={KOMA_SPRING_BUBBLE}
              onClick={() => onNavigate(tab.id)}
            >
              {isActive && (
                <motion.span
                  layoutId="km-dock-ink"
                  className="km-dock__ink"
                  transition={KOMA_SPRING_BUBBLE}
                  aria-hidden="true"
                >
                  <span key={activeTab} className="km-dock__ink-drop" />
                </motion.span>
              )}

              <motion.span
                className="km-dock__icon-wrap"
                animate={isActive ? { scale: 1.06, y: -1 } : { scale: 1, y: 0 }}
                transition={KOMA_SPRING_BUBBLE}
              >
                {renderGlyph(tab.id)}
                {badge > 0 && (
                  <span className="km-dock__badge" aria-label={`${badge} itens`}>
                    {canUseNumberFlow ? <NumberFlow value={badge} /> : badge}
                  </span>
                )}
              </motion.span>

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
            </motion.button>
          );
        })}
      </nav>
    </div>
  );
}
