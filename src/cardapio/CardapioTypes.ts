/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { KOMA_WORDMARK_SRC } from '../brand/komaBrand';

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
  operatingHours?: OperatingHours[];
  googleMapsUrl?: string;
  storeStatus?: "open" | "closed" | "automatic";
  pedidoMinimo?: number;
  freteGratisValor?: number;
  tipoTaxaEntrega?: string;
  tabelaTaxasBairros?: BairroTaxa[];
  taxaEntregaPadrao?: number;
}

export const LOCAL_PRODUCT_PLACEHOLDER = "data:image/svg+xml;utf8," + encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300" fill="none">
  <defs>
    <radialGradient id="bgGlow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#1b2820"/>
      <stop offset="100%" stop-color="#0d1410"/>
    </radialGradient>
    <linearGradient id="iconGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#10B981"/>
      <stop offset="100%" stop-color="#059669"/>
    </linearGradient>
  </defs>
  <rect width="400" height="300" fill="url(#bgGlow)"/>
  <circle cx="200" cy="140" r="60" fill="#10B981" fill-opacity="0.06"/>
  <path d="M155 160C155 135 175 115 200 115C225 115 245 135 245 160H155Z" fill="url(#iconGrad)" fill-opacity="0.25" stroke="#10B981" stroke-width="3" stroke-linejoin="round"/>
  <path d="M140 166H260C263 166 265 168 265 171C265 174 263 176 260 176H140C137 176 135 174 135 171C135 168 137 166 140 166Z" fill="#10B981" fill-opacity="0.4"/>
  <circle cx="200" cy="106" r="6" fill="#10B981"/>
  <path d="M175 190H225" stroke="#2B3E34" stroke-width="2" stroke-linecap="round"/>
</svg>
`);

export const LOCAL_LOGO_PLACEHOLDER = KOMA_WORDMARK_SRC;

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
