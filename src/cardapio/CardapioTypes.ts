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
}

/**
 * Resolves a product photo path to either its absolute URL or a Supabase Storage public bucket URL.
 */
export function getProductImageUrl(imagePath: string): string {
  if (!imagePath) {
    return "https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?auto=format&fit=crop&w=500&q=80";
  }
  if (
    imagePath.startsWith("http://") ||
    imagePath.startsWith("https://") ||
    imagePath.startsWith("data:")
  ) {
    return imagePath;
  }
  // Base Supabase URL from environment or fallback
  const supabaseUrl = (import.meta as any).env?.VITE_SUPABASE_URL || "https://tcmquksunj4cwwmjzxpisy.supabase.co";
  return `${supabaseUrl}/storage/v1/object/public/produtos/${imagePath}`;
}

