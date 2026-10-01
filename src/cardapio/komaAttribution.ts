export type KomaAttributionSurface = "menu_footer" | "store_info";

const KOMA_LANDING_URL = "https://komafood.com.br/";

export function buildKomaAttributionUrl(
  surface: KomaAttributionSurface,
  restaurantId?: string | number | null,
): string {
  const url = new URL(KOMA_LANDING_URL);
  url.searchParams.set("utm_source", "cardapio_digital");
  url.searchParams.set("utm_medium", "powered_by");
  url.searchParams.set("utm_campaign", "restaurant_referral");
  url.searchParams.set("utm_content", surface);

  if (restaurantId !== undefined && restaurantId !== null && String(restaurantId).trim()) {
    url.searchParams.set("utm_term", `restaurant_${String(restaurantId).trim()}`);
  }

  return url.toString();
}
