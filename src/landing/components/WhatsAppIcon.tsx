import React from 'react';

type WhatsAppIconProps = {
  className?: string;
};

export function WhatsAppIcon({ className = '' }: WhatsAppIconProps) {
  return (
    <svg
      className={`koma-whatsapp-icon ${className}`.trim()}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M20.5 11.7a8.5 8.5 0 0 1-12.62 7.43L3.5 20.5l1.42-4.21A8.5 8.5 0 1 1 20.5 11.7Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M8.2 7.75c.18-.4.37-.41.68-.42h.58c.18 0 .35.05.45.34l.75 1.82c.08.22.05.4-.08.58l-.61.76c-.12.14-.16.28-.06.46.63 1.13 1.57 2.06 2.71 2.67.18.1.32.06.45-.08l.75-.87c.16-.19.35-.22.57-.13l1.82.86c.24.11.36.27.32.51-.12.72-.55 1.39-1.18 1.76-.55.33-1.28.45-2.02.22-1.04-.32-2.38-.94-3.75-2.16-1.11-.99-1.91-2.09-2.38-3.04-.44-.88-.48-1.69-.17-2.36l.17-.36Z"
        fill="currentColor"
      />
    </svg>
  );
}
