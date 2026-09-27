export const ORDERING_BLOCK_CONFLICT_DETAIL = "Não foi possível receber um novo pedido com estes dados neste momento.";

export function isOrderingBlockConflict(status: number, detail: unknown): boolean {
  return status === 409
    && typeof detail === "string"
    && detail.trim() === ORDERING_BLOCK_CONFLICT_DETAIL;
}
