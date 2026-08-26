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
  isAvailable?: boolean;
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
}

export const LOCAL_PRODUCT_PLACEHOLDER = "data:image/svg+xml;utf8," + encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300" fill="none">
  <rect width="400" height="300" fill="#101512"/>
  <circle cx="200" cy="145" r="54" stroke="#2B3831" stroke-width="3"/>
  <circle cx="200" cy="145" r="37" stroke="#243029" stroke-width="2"/>
  <path d="M138 88V202M126 88V126C126 136 132 142 138 142C144 142 150 136 150 126V88M264 88V202M264 88C249 101 248 126 264 139" stroke="#607068" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="200" cy="145" r="5" fill="#10B981"/>
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
