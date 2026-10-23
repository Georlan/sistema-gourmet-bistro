import type { SVGProps, ReactNode } from 'react';

/**
 * KÔMA Garçom authorial glyphs — original, lightweight and theme-adaptive via currentColor.
 */
export type KomaGlyphName =
  | 'table-free'
  | 'table-service'
  | 'table-ready'
  | 'table-payment'
  | 'table-served'
  | 'table-merged'
  | 'quick-add'
  | 'transfer'
  | 'draft-saved'
  | 'sync'
  | 'focus-table'
  | 'orders-ready'
  | 'receipt'
  | 'lightning-action';

type Props = Omit<SVGProps<SVGSVGElement>, 'children'> & {
  name: KomaGlyphName;
  size?: number;
  title?: string;
};

const glyphs: Record<KomaGlyphName, ReactNode> = {
  'table-free': (
    <>
      <rect x="5" y="9" width="14" height="7" rx="2" />
      <path d="M7 5v2M17 5v2M7 18v2M17 18v2" />
      <path d="m10 12 1.5 1.5L14.5 10.5" />
    </>
  ),
  'table-service': (
    <>
      <rect x="4" y="8" width="16" height="8" rx="2" />
      <circle cx="9" cy="12" r="1.6" />
      <circle cx="15" cy="12" r="1.6" />
      <path d="M7 5v1M17 5v1M7 18v2M17 18v2" />
    </>
  ),
  'table-ready': (
    <>
      <path d="M3 17h18M5 15a7 7 0 0 1 14 0H5Z" />
      <path d="M12 8V5" />
      <circle cx="12" cy="4" r="1" fill="currentColor" stroke="none" />
      <path d="m10 12 1.4 1.4 2.8-3" />
    </>
  ),
  'table-payment': (
    <>
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <path d="M9 7h6M9 11h6M9 15h3" />
      <path d="m13.6 16.8 1.5 1.4 2.4-2.6" />
    </>
  ),
  'table-served': (
    <>
      <path d="M4 18h16M6 16h12M7 14a5 5 0 0 1 10 0H7Z" />
      <path d="m10 9 1.4 1.4L14.5 7" />
    </>
  ),
  'table-merged': (
    <>
      <rect x="3" y="6" width="11" height="12" rx="2" />
      <rect x="10" y="6" width="11" height="12" rx="2" />
      <path d="m10 12 2 2 2-2" />
    </>
  ),
  'quick-add': (
    <>
      <path d="M12 4v16M4 12h16" />
      <circle cx="12" cy="12" r="9" />
    </>
  ),
  'transfer': (
    <>
      <rect x="2.5" y="5.5" width="6" height="13" rx="1.5" />
      <rect x="15.5" y="5.5" width="6" height="13" rx="1.5" />
      <path d="M10.5 9h5m0 0-2-2m2 2-2 2M13.5 15h-5m0 0 2-2m-2 2 2 2" />
    </>
  ),
  'draft-saved': (
    <>
      <path d="M6 3.5h9l3 3V21H6Z" />
      <path d="M14.5 3.5v4h3.5M9 12h6" />
      <path d="m9 16 1.7 1.5 3.6-3.4" />
    </>
  ),
  'sync': (
    <>
      <path d="M20 7a8 8 0 0 0-13.7-2.3L4 7m0-4v4h4M4 17a8 8 0 0 0 13.7 2.3L20 17m0 4v-4h-4" />
    </>
  ),
  'focus-table': (
    <>
      <path d="M8 3H4v4M16 3h4v4M8 21H4v-4M16 21h4v-4" />
      <rect x="7" y="9" width="10" height="7" rx="1.5" />
    </>
  ),
  'orders-ready': (
    <>
      <path d="M4 4h16v16H4z" />
      <path d="M8 9h8M8 13h4m1 3 2 2 4-5" />
    </>
  ),
  'receipt': (
    <>
      <path d="M7 3h10v18l-2.5-2-2.5 2-2.5-2L7 21V3Z" />
      <path d="M10 8h4M10 12h4" />
    </>
  ),
  'lightning-action': <path d="m13 2-9 12h7l-1 8 10-12h-7z" />,
};

export function KomaWaiterGlyph({ name, size = 20, title, className, ...props }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
      className={className}
      {...props}
    >
      {glyphs[name]}
    </svg>
  );
}
