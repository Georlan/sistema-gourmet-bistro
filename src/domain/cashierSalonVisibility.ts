/**
 * Visibility of local-service UI follows the tenant's explicit fulfillment policy,
 * not the restaurant profile, subscription plan, waiter staffing or printer.
 *
 * Legacy tenants without an explicit policy keep the salon until configured.
 * Outstanding local-service work must remain reachable after disabling dine-in.
 */
export function shouldShowSalon(orderTypes: unknown, hasOutstandingLocalWork = false): boolean {
  return hasOutstandingLocalWork
    || !Array.isArray(orderTypes)
    || orderTypes.includes('consumo_local');
}
