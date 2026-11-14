import { MessageCircle } from 'lucide-react';
import type { StoredOrder } from '../orderTracking';
import { manualPixReceiptUrl } from '../manualPixReceiptUrl';

export function ManualPixReceiptContact({ order, phone, restaurantId }: { order: StoredOrder; phone?: string | null; restaurantId?: string | number | null }) {
  const url = manualPixReceiptUrl({ order, phone, restaurantId });
  if (!url) return null;
  return <div className="mt-4">
    <a href={url} target="_blank" rel="noopener noreferrer" className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-emerald-600 bg-emerald-800 px-3 text-sm font-semibold text-white hover:bg-emerald-900">
      <MessageCircle size={17} aria-hidden="true" /> Enviar comprovante no WhatsApp
    </a>
    <p className="mt-2 text-xs text-koma-muted">Anexe o comprovante na conversa. O restaurante confirma o recebimento pelo banco.</p>
  </div>;
}
