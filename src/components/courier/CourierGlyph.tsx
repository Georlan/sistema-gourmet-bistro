import type { SVGProps } from 'react';

/** Original KÔMA operational glyphs: inline vectors, no image/network dependency. */
export function CourierGlyph({ kind, ...props }: SVGProps<SVGSVGElement> & { kind: 'route' | 'items' | 'delivery' }) {
  return <svg width={23} height={23} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    {kind === 'route' ? <><path d="M18.5 10c0 4.5-6.5 10.5-6.5 10.5S5.5 14.5 5.5 10a6.5 6.5 0 1 1 13 0Z" fill="currentColor" fillOpacity={.12} /><path d="m14.8 7.1-2 6-1.3-2.6-2.6-1.3 5.9-2.1Z" fill="currentColor" strokeWidth={1.2} /></>
      : kind === 'items' ? <><path d="M5 8h14l1 13H4L5 8ZM8 8V6a4 4 0 0 1 8 0v2M7 16h10M8 14a4 4 0 0 1 8 0H8ZM12 9v1" /></>
      : <><path d="m4 7 8-4 8 4v10l-8 4-8-4V7ZM4 7l8 4 8-4M12 11v10M8 5l8 4" /><path d="m8 15 2 2 5-5" strokeWidth={2.4} /></>}
  </svg>;
}

export function CourierPaymentArtwork({ method }: { method: 'cash' | 'card' }) {
  return <svg className="k-courier__payment-art" width={54} height={40} viewBox="0 0 56 40" fill="none" aria-hidden="true">
    {method === 'cash' ? <><rect x={7} y={4} width={44} height={27} rx={5} fill="#4e8066" /><rect x={3} y={9} width={44} height={27} rx={5} fill="#d0ebd9" stroke="#214b3b" strokeWidth={2} /><path d="M10 15h5M35 30h5" stroke="#46775a" strokeWidth={2} strokeLinecap="round" /><circle cx={25} cy={22.5} r={8} fill="#214b3b" /><path d="M28 19h-4a2 2 0 0 0 0 4h2a2 2 0 0 1 0 4h-4m3-10v12" stroke="#e0f3e7" strokeWidth={1.5} strokeLinecap="round" /></>
      : <><rect x={5} y={6} width={46} height={30} rx={6} fill="#214b3b" /><path d="M5 14h46v7H5z" fill="#d0ebd9" /><rect x={11} y={25} width={8} height={6} rx={1.5} fill="#b0d9c1" /><path d="M35 27h8m-8 4h4" stroke="#b0d9c1" strokeWidth={2} strokeLinecap="round" /><path d="M11 7h34" stroke="#64937a" strokeLinecap="round" /></>}
  </svg>;
}
