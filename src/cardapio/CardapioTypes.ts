/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

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
  phone: string; // WhatsApp for sending orders
  address: string;
  colors: {
    primary: string;      // Used for primary buttons, active categories, highlights
    secondary?: string;    // Used for dark accents, headers
    background: string;   // Main app background
    text?: string;         // Main text color
    card?: string;         // Card background
    accent?: string;       // Accent badges, discounts, promo
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
  <rect width="400" height="300" fill="#18181B"/>
  <circle cx="200" cy="130" r="44" fill="#27272A"/>
  <path d="M175 130C175 116.193 186.193 105 200 105C213.807 105 225 116.193 225 130C225 143.807 213.807 155 200 155C186.193 155 175 143.807 175 130Z" fill="#3F3F46"/>
  <path d="M160 185C160 168.431 177.909 155 200 155C222.091 155 240 168.431 240 185V190H160V185Z" fill="#3F3F46"/>
  <text x="200" y="225" text-anchor="middle" fill="#A1A1AA" font-family="system-ui, sans-serif" font-size="13" font-weight="600">Sem Imagem</text>
</svg>
`);

export const LOCAL_LOGO_PLACEHOLDER = "data:image/svg+xml;utf8," + encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200" fill="none">
  <rect width="200" height="200" rx="100" fill="#18181B"/>
  <circle cx="100" cy="100" r="70" stroke="#27272A" stroke-width="4"/>
  <text x="100" y="115" text-anchor="middle" fill="#10B981" font-family="system-ui, sans-serif" font-size="46" font-weight="900">K</text>
</svg>
`);

export const LOCAL_BANNER_PLACEHOLDER = "data:image/svg+xml;utf8," + encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="400" viewBox="0 0 1200 400" fill="none">
  <rect width="1200" height="400" fill="#09090B"/>
  <rect width="1200" height="400" fill="url(#grad)" opacity="0.4"/>
  <defs>
    <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#10B981" stop-opacity="0.2"/>
      <stop offset="100%" stop-color="#09090B" stop-opacity="0.8"/>
    </linearGradient>
  </defs>
  <text x="600" y="215" text-anchor="middle" fill="#3F3F46" font-family="system-ui, sans-serif" font-size="32" font-weight="800">CARDÁPIO DIGITAL</text>
</svg>
`);

/**
 * Resolves a product photo path to either its absolute URL or a Supabase Storage public bucket URL.
 */
export function getProductImageUrl(imagePath: string): string {
  if (!imagePath) {
    return LOCAL_PRODUCT_PLACEHOLDER;
  }
  if (
    imagePath.startsWith("http://") ||
    imagePath.startsWith("https://") ||
    imagePath.startsWith("data:")
  ) {
    return imagePath;
  }
  // Base Supabase URL from environment or fallback
  const supabaseUrl = (import.meta as any).env?.VITE_SUPABASE_URL || "https://iiowhekvahxiepwcdidm.supabase.co";
  return `${supabaseUrl}/storage/v1/object/public/produtos/${imagePath}`;
}

/**
 * Resolves a restaurant photo path or URL (logo/banner) to its public URL.
 */
export function getRestaurantAssetUrl(urlOrPath: string | null | undefined, isLogo: boolean): string {
  if (!urlOrPath) {
    return isLogo ? LOCAL_LOGO_PLACEHOLDER : LOCAL_BANNER_PLACEHOLDER;
  }
  if (
    urlOrPath.startsWith("http://") ||
    urlOrPath.startsWith("https://") ||
    urlOrPath.startsWith("data:")
  ) {
    return urlOrPath;
  }
  const supabaseUrl = (import.meta as any).env?.VITE_SUPABASE_URL || "https://iiowhekvahxiepwcdidm.supabase.co";
  const cleanPath = urlOrPath.replace(/^\/+/, '');
  return `${supabaseUrl}/storage/v1/object/public/cardapio-assets/${cleanPath}`;
}
