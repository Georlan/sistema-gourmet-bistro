export type OrderUpdateResource = 'salon' | 'digital' | 'payments';
export function orderUpdateAffects(event: Event, resource: OrderUpdateResource): boolean {
  const resources = (event as CustomEvent<{ resources?: OrderUpdateResource[] }>).detail?.resources;
  return !Array.isArray(resources) || resources.includes(resource);
}
