export function fulfillmentEligibilityRevision(order: Record<string, unknown> | null | undefined): string {
  if (!order) return '';
  const assignment = order.courierAssignment;
  if (!assignment || typeof assignment !== 'object') return JSON.stringify(order);
  const { options: _options, loading: _loading, loadState: _loadState, onChange: _onChange, ...relevant } = assignment as Record<string, unknown>;
  return JSON.stringify({ ...order, courierAssignment: relevant });
}
