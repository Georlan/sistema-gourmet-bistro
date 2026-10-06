/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface PublicMenuViewedProps {
  restaurant_id: string | number;
  restaurant_name?: string;
  categories_count: number;
  products_count: number;
  store_status?: string;
}

export interface PublicProductViewedProps {
  restaurant_id: string | number;
  product_id: string | number;
  product_name: string;
  category?: string;
  price: number;
  has_modifiers: boolean;
}

export interface PublicCartItemAddedProps {
  restaurant_id: string | number;
  product_id: string | number;
  product_name: string;
  category?: string;
  price: number;
  quantity: number;
  total_price: number;
  options_count: number;
}

export interface PublicCheckoutInitiatedProps {
  restaurant_id: string | number;
  delivery_method: string;
  items_count: number;
  cart_total: number;
  delivery_fee: number;
  has_coupon: boolean;
  coupon_discount?: number;
  has_cashback: boolean;
  cashback_discount?: number;
  payment_method?: string;
}

export interface PublicOrderSubmittedProps {
  restaurant_id: string | number;
  comanda_id: string;
  numero_pedido: string | number;
  total: number;
  fulfillment: string;
  payment_method: string;
  payment_method_detail?: string;
  items_count: number;
  is_scheduled: boolean;
  has_coupon: boolean;
  has_cashback: boolean;
}

export interface AnalyticsEventMap {
  public_menu_viewed: PublicMenuViewedProps;
  public_product_viewed: PublicProductViewedProps;
  public_cart_item_added: PublicCartItemAddedProps;
  public_checkout_initiated: PublicCheckoutInitiatedProps;
  public_order_submitted: PublicOrderSubmittedProps;
}

export type AnalyticsEventName = keyof AnalyticsEventMap;

export interface OperatorIdentityTraits {
  id?: string | number;
  role?: string;
  cargo?: string;
  restaurante_id?: number;
}

export interface RestaurantGroupProperties {
  restaurant_id: number | string;
  restaurant_name?: string;
  name?: string;
}
