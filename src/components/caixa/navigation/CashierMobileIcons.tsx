import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

function Frame({ children, ...props }: IconProps) {
  return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}>{children}</svg>;
}

export function OrdersIcon(props: IconProps) {
  return <Frame {...props}><path d="M5 4.5h14v15l-2-1.4-2 1.4-3-1.4-3 1.4-2-1.4-2 1.4z"/><path d="M8 8.5h8M8 12h8M8 15.5h4"/></Frame>;
}
export function NewOrderIcon(props: IconProps) {
  return <Frame {...props}><path d="M5 5.5h10v13H5zM8 9h4M8 12h3"/><circle cx="17" cy="16.5" r="4.5" fill="var(--koma-panel, #172e24)"/><path d="M17 14.5v4M15 16.5h4"/></Frame>;
}
export function KitchenIcon(props: IconProps) {
  return <Frame {...props}><path d="M4 17.5h16M6 15.5a6 6 0 0 1 12 0zM12 9.5v-2"/><circle cx="12" cy="6.5" r="1"/><path d="M7 20h10"/></Frame>;
}
export function CashIcon(props: IconProps) {
  return <Frame {...props}><rect x="3" y="7" width="18" height="12" rx="2.5"/><path d="M3 11h18M7 15h4M16 4.5H8"/></Frame>;
}
export function MoreIcon(props: IconProps) {
  return <Frame {...props}><path d="M5 7h14M5 12h14M5 17h14"/><circle cx="8" cy="7" r="1" fill="currentColor"/><circle cx="16" cy="12" r="1" fill="currentColor"/><circle cx="10" cy="17" r="1" fill="currentColor"/></Frame>;
}
