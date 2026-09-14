import { describe, expect, it } from "vitest";

import {
  ORDERING_BLOCK_CONFLICT_DETAIL,
  isOrderingBlockConflict,
} from "../src/cardapio/orderingBlockUi";

describe("ordering block UI classifier", () => {
  it("reconhece somente o 409 autoritativo de bloqueio", () => {
    expect(isOrderingBlockConflict(409, ORDERING_BLOCK_CONFLICT_DETAIL)).toBe(true);
  });

  it("tolera espaços externos sem ampliar o contrato", () => {
    expect(isOrderingBlockConflict(409, `  ${ORDERING_BLOCK_CONFLICT_DETAIL}  `)).toBe(true);
  });

  it("não confunde outros conflitos 409 com bloqueio de cliente", () => {
    expect(isOrderingBlockConflict(409, "A chave idempotente já foi usada com outro conteúdo de pedido.")).toBe(false);
  });

  it("não trata o mesmo texto em outro status HTTP como bloqueio", () => {
    expect(isOrderingBlockConflict(500, ORDERING_BLOCK_CONFLICT_DETAIL)).toBe(false);
  });
});
