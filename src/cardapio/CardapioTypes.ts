/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { KOMA_SYMBOL_ON_LIGHT_SRC } from '../brand/komaBrand';

export interface ProductOption {
  id: string;
  name: string;
  extraPrice: number;
}

export interface ModifierOption {
  id: string;
  name: string;
  extraPrice: number;
  active?: boolean;
}

export interface ModifierGroup {
  id: string;
  name: string;
  minSelection: number;
  maxSelection: number;
  type: 'obrigatorio' | 'opcional' | 'meio_a_meio';
  options: ModifierOption[];
}

export interface ProductModifier {
  id: string;
  title: string;
  required: boolean;
  maxSelection: number;
  options: ProductOption[];
}

export interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  image: string;
  imagesGallery?: string[];
  category: string;
  modifiers?: ProductModifier[];
  modifierGroups?: ModifierGroup[];
  isAvailable?: boolean;
}

export interface BairroTaxa {
  bairro: string;
  taxa: number;
}

export interface SocialNetwork {
  platform: string;
  url: string;
  active: boolean;
}

export interface PaymentMethodGroup {
  type: string;
  accepted: string[];
}

export interface OperatingHours {
  days: string;
  hours: string;
}

export interface BrandConfig {
  id: string;
  name: string;
  slogan: string;
  logo: string;
  bannerImage: string;
  phone: string;
  address: string;
  colors: {
    primary: string;
    secondary?: string;
    background: string;
    text?: string;
    card?: string;
    accent?: string;
  };
  categories: string[];
  products: Product[];
  socials?: SocialNetwork[];
  about?: string;
  paymentMethods?: PaymentMethodGroup[];
  onlinePaymentEnabled?: boolean;
  operatingHours?: OperatingHours[];
  googleMapsUrl?: string;
  storeStatus?: "open" | "closed" | "automatic";
  acceptingOrders?: boolean;
  orderingMessage?: string;
  availabilitySource?: string;
  deliveryEnabled?: boolean;
  pedidoMinimo?: number;
  freteGratisValor?: number;
  tipoTaxaEntrega?: string;
  tabelaTaxasBairros?: BairroTaxa[];
  taxaEntregaPadrao?: number;
}

export const LOCAL_PRODUCT_PLACEHOLDER = "data:image/svg+xml;utf8," + encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300" fill="none">
  <defs>
    <radialGradient id="cardGlow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#141923"/>
      <stop offset="100%" stop-color="#0B0D13"/>
    </radialGradient>
    <linearGradient id="strokeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#334155"/>
      <stop offset="100%" stop-color="#1E293B"/>
    </linearGradient>
  </defs>
  <rect width="400" height="300" fill="url(#cardGlow)"/>
  <!-- Ambient plate silhouette -->
  <ellipse cx="200" cy="180" rx="90" ry="26" fill="#05C49D" fill-opacity="0.03" stroke="url(#strokeGrad)" stroke-width="2"/>
  <ellipse cx="200" cy="178" rx="65" ry="18" fill="#1E293B" fill-opacity="0.25" stroke="#334155" stroke-width="1.5" stroke-dasharray="3 3"/>
  <!-- Sleek cover cloche dome -->
  <path d="M145 168C145 130 170 110 200 110C230 110 255 130 255 168" stroke="#475569" stroke-width="2.5" stroke-linecap="round"/>
  <!-- Top handle -->
  <circle cx="200" cy="102" r="5" fill="#05C49D" fill-opacity="0.8"/>
  <path d="M200 107V110" stroke="#05C49D" stroke-width="2"/>
</svg>
`);

export const LOCAL_LOGO_PLACEHOLDER = KOMA_SYMBOL_ON_LIGHT_SRC;

export const LOCAL_BANNER_PLACEHOLDER = "data:image/svg+xml;utf8," + encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="400" viewBox="0 0 1200 400" fill="none">
  <rect width="1200" height="400" fill="#08100C"/>
  <circle cx="1020" cy="-20" r="360" fill="url(#glow)" opacity="0.48"/>
  <path d="M745 -40L1070 440" stroke="#0F5A43" stroke-width="2" opacity="0.8"/>
  <path d="M820 -40L1145 440" stroke="#10B981" stroke-width="2" opacity="0.18"/>
  <defs>
    <radialGradient id="glow" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(1020 -20) rotate(90) scale(360)">
      <stop stop-color="#10B981" stop-opacity="0.55"/>
      <stop offset="1" stop-color="#08100C" stop-opacity="0"/>
    </radialGradient>
  </defs>
</svg>
`);

export function getProductImageUrl(imagePath: string): string {
  if (!imagePath) return LOCAL_PRODUCT_PLACEHOLDER;
  if (
    imagePath.startsWith("http://") ||
    imagePath.startsWith("https://") ||
    imagePath.startsWith("data:")
  ) {
    return imagePath;
  }
  const supabaseUrl = (import.meta as any).env?.VITE_SUPABASE_URL;
  if (!supabaseUrl) return LOCAL_PRODUCT_PLACEHOLDER;
  return `${supabaseUrl}/storage/v1/object/public/produtos/${imagePath}`;
}

export function getRestaurantAssetUrl(urlOrPath: string | null | undefined, isLogo: boolean): string {
  if (!urlOrPath) return isLogo ? LOCAL_LOGO_PLACEHOLDER : LOCAL_BANNER_PLACEHOLDER;
  if (
    urlOrPath.startsWith("http://") ||
    urlOrPath.startsWith("https://") ||
    urlOrPath.startsWith("data:")
  ) {
    return urlOrPath;
  }
  const supabaseUrl = (import.meta as any).env?.VITE_SUPABASE_URL;
  if (!supabaseUrl) return isLogo ? LOCAL_LOGO_PLACEHOLDER : LOCAL_BANNER_PLACEHOLDER;
  const cleanPath = urlOrPath.replace(/^\/+/, '');
  return `${supabaseUrl}/storage/v1/object/public/cardapio-assets/${cleanPath}`;
}
