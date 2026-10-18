import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { SubscriptionEntitlements, SubscriptionPlanId } from '../../../config/subscriptionPlans';
import { getCashierHorizontalItems, isCashierNavigationActive } from './cashierNavigation';

interface Props {
  activeTab: string;
  activeSubTab: string;
  planId: SubscriptionPlanId;
  entitlements?: SubscriptionEntitlements;
  setupMode: boolean;
  onNavigate: (id: string) => void;
  counts?: Record<string, number>;
}

export function CashierSubNavigation({ activeTab, activeSubTab, planId, entitlements, setupMode, onNavigate, counts = {} }: Props) {
  const items = getCashierHorizontalItems(activeTab, planId, entitlements, setupMode);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const itemKey = items.map(item => item.id).join('|');

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const update = () => setEdges({ left: scroller.scrollLeft > 2, right: scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 2 });
    const revealSelected = () => {
      const selected = scroller.querySelector<HTMLElement>('[aria-current="page"]');
      if (selected) {
        // The positioned scroller is the button offset parent. Its own
        // offset in the nav must not be subtracted from this local coordinate.
        const start = selected.offsetLeft;
        if (start < scroller.scrollLeft) scroller.scrollLeft = start;
        else if (start + selected.offsetWidth > scroller.scrollLeft + scroller.clientWidth) scroller.scrollLeft = start + selected.offsetWidth - scroller.clientWidth;
      }
      update();
    };
    revealSelected();
    const observer = new ResizeObserver(revealSelected);
    observer.observe(scroller);
    // Text scaling changes child widths even when the viewport is unchanged.
    for (const child of scroller.children) observer.observe(child);
    scroller.addEventListener('scroll', update, { passive: true });
    return () => { observer.disconnect(); scroller.removeEventListener('scroll', update); };
  }, [activeTab, activeSubTab, itemKey]);

  if (!items.length) return null;
  return (
    <nav className="cashier-subnav cashier-subnav--shared flex shrink-0 border-b border-koma-border" aria-label="Telas desta área">
      <button type="button" className="cashier-subnav__arrow" aria-label="Ver abas anteriores" disabled={!edges.left} onClick={() => scrollRef.current?.scrollBy({ left: -240, behavior: 'smooth' })}><ChevronLeft size={16} /></button>
      <div ref={scrollRef} className="cashier-subnav__scroll">
        {items.map(item => {
          const selected = isCashierNavigationActive(item.id, activeTab, activeSubTab);
          return <button key={item.id} type="button" id={`${activeTab}-subtab-${item.target.subTab}`} data-navigation-id={item.id} className={`cashier-subnav__button${selected ? ' is-active' : ''}`} aria-current={selected ? 'page' : undefined} onClick={() => onNavigate(item.id)}>
            {item.label}{counts[item.id] !== undefined && <span className="ml-2 opacity-70">{counts[item.id]}</span>}
          </button>;
        })}
      </div>
      <button type="button" className="cashier-subnav__arrow" aria-label="Ver próximas abas" disabled={!edges.right} onClick={() => scrollRef.current?.scrollBy({ left: 240, behavior: 'smooth' })}><ChevronRight size={16} /></button>
    </nav>
  );
}
