type Props = {
  kind: 'salon' | 'digital' | 'closing';
  title: string;
  count: number;
};

/** Original KÔMA marks identify work areas without adding labels to each card. */
const marks = {
  salon: <>
    <rect x="6" y="7" width="12" height="10" rx="2" />
    <path d="M8 3v2m8-2v2M8 19v2m8-2v2M2 10v4m20-4v4" />
    <path d="M10 11h4m-4 3h4" />
  </>,
  digital: <>
    <path d="M5 8h14l1 13H4L5 8ZM8 8V6a4 4 0 0 1 8 0v2" />
    <path d="M8 12h8v6l-2-1-2 1-2-1-2 1v-6Zm3 2h2" />
  </>,
  closing: <>
    <path d="M5 3h14v18l-3-1-4 1-4-1-3 1V3ZM9 7h6M9 10h4" />
    <path d="m9 15 2 2 4-4" />
  </>,
};

export function CashierColumnHeader({ kind, title, count }: Props) {
  return (
    <div className="orders-column__header">
      <span className="orders-column__mark" aria-hidden="true">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          {marks[kind]}
        </svg>
      </span>
      <h3 className="orders-column__title">{title}</h3>
      <span className="orders-column__count" aria-label={`${count} nesta coluna`}>{count}</span>
    </div>
  );
}
