import { CourierPaymentArtwork } from '../../courier/CourierGlyph';

type Method = 'pix' | 'dinheiro' | 'cartao_debito' | 'cartao_credito';

/** Decorative, local KÔMA glyphs. The payment method remains identified by text. */
export function CheckoutPaymentArt({ method }: { method: Method }) {
  if (method === 'dinheiro') return <CourierPaymentArtwork method="cash" />;
  if (method === 'pix') return <svg width="40" height="30" viewBox="0 0 40 30" fill="none" aria-hidden="true">
    <rect x="3" y="2" width="34" height="26" rx="6" fill="#205846" />
    <path d="M10 7h7v7h-7zM23 7h7v7h-7zM10 17h7v7h-7z" stroke="#B4F0D8" strokeWidth="2" />
    <path d="M24 18h3v3h-3zm5 3h3v3h-3z" fill="#B4F0D8" />
  </svg>;
  if (method === 'cartao_debito') return <svg width="40" height="30" viewBox="0 0 40 30" fill="none" aria-hidden="true">
    <rect x="2" y="3" width="30" height="21" rx="4" fill="#164B3B" />
    <path d="M2 9h30v5H2z" fill="#AEE8D0" /><rect x="7" y="17" width="7" height="3" rx="1" fill="#AEE8D0" />
    <circle cx="31" cy="21" r="7" fill="#83DDBD" stroke="#214E3D" strokeWidth="1.5" />
    <path d="M31 17v7m-3-3 3 3 3-3" stroke="#123F31" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
  return <svg width="40" height="30" viewBox="0 0 40 30" fill="none" aria-hidden="true">
    <rect x="8" y="2" width="29" height="21" rx="4" fill="#4D8972" />
    <rect x="3" y="6" width="29" height="21" rx="4" fill="#C3E7D4" stroke="#164B3B" strokeWidth="1.5" />
    <path d="M3 12h29v4H3z" fill="#164B3B" /><rect x="8" y="19" width="6" height="3" rx="1" fill="#4D8972" />
    <path d="M22 21h5m-5 3h3" stroke="#164B3B" strokeWidth="1.4" strokeLinecap="round" />
  </svg>;
}
