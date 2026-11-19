# Homologação Final — Bloco B1 (Integridade, Segurança e Confiabilidade)

**Data de referência:** 2026-11-19  
**Parecer:** **`B1 — HOMOLOGADO COM RESSALVAS`**

---

## 1. Escopo entregue e integrado em `main`

| Entrega / PR | Merge SHA | Escopo validado |
|---|---|---|
| Base de isolamento, RLS, idempotência e ledger | Preexistente na `main` | 119 tabelas com RLS habilitado, 166 policies, `idempotency_key`/`idempotency_fingerprint`, `financial_ledger_stage3`, `ActivityLog` e `super_admin_audit_logs` |
| `#1397` | `db7e54fa1993e70887d01fe0ffbd773286e77905` | Refatoração do Caixa e correção individual de itens |
| `#1400` | `64a6421ca2cb5f7d285b0d492b72670a37877e4d` | Alocação de liquidação por item entre comandas e fechamento atômico de `AtendimentoMesa` (SmartPOS / PagBank PlugPag) |
| `#1398` | `8369529e5397fd3ea3c237be60c82b6dca020ec2` | Isolamento de pedidos `Retirada` (com `mesa_id` opcional) contra cobrança, fechamento ou mescla em contas de mesa (`Comanda.tipo == 'Consumo no Local'`), exclusão de links legados de retirada em operações de mesa e bloqueio de `Delivery` com `mesa_id` |
| `#1399` | `45f96055777344a19c9f7208ab8c9016969ad9e3` | Bloqueio autoritativo de `cancel_order` e `reject_order` quando há pagamento aprovado, diferenciando pagamento pendente vs. aprovado, alocação vs. referência de recibo e exigindo estorno auditado antes do cancelamento |
| Este PR (`fix/b1-role-revocation-and-homologation`) | *(pendente merge)* | Revogação imediata de sessões (`revoke_user_sessions` / `token_version`) ao alterar o cargo (`role`) de um usuário ativo em `PATCH /auth/usuarios/{user_id}`, além de regressão automatizada e consolidação desta homologação |

---

## 2. Matriz de verificação dos critérios de B1

| Critério B1 | Status | Evidência verificável |
|---|---|---|
| Isolamento multi-tenant e RLS | **Concluído e validado** | 119 tabelas com RLS / 166 policies confirmadas no restore drill (`15/11/2026`); workflow `security-tenant-boundaries.yml` ativo e verde |
| Autenticação, RBAC e revogação de sessões | **Concluído e validado** | `get_current_user` valida `Usuario` no banco + `UserSessionVersion.token_version`; revogação imediata na desativação, reset de senha, remoção multistore e alteração de cargo (`backend/tests/test_auth_tenant_session_hardening.py`) |
| Identidade e vínculo canônico dos pedidos | **Concluído e validado** | `AtendimentoMesa` ≠ `Comanda` ≠ `Lancamento` ≠ `Item`; `docs/architecture/orders_identity_memory.md` |
| Idempotência em pedidos e pagamentos | **Concluído e validado** | `idempotency_key` + `idempotency_fingerprint` em `OrderApplicationService.create_order` e fluxos de pagamento |
| Concorrência em Caixa, estoque e pedidos | **Concluído e validado** | Gates dedicados `payment-item-concurrency-targeted.yml`, `transfer-concurrency.yml`, `inventory-integrity-targeted.yml` e `online-payment-cash-close-targeted.yml` |
| Separação Consumo Local vs. Retirada vs. Delivery | **Concluído e validado** | PR `#1398` (`backend/tests/test_b1_mesa_retirada_isolation.py`, 19/19 checks verdes no merge) |
| Integridade de cobranças associadas a mesas | **Concluído e validado** | PR `#1398` + PR `#1400` (liquidação por item entre comandas e fechamento coordenado de `AtendimentoMesa`) |
| Proteção contra cancelamento/recusa de pedidos pagos | **Concluído e validado** | PR `#1399` (`backend/tests/test_b1_cancel_payment_guard.py`, 14/14 checks verdes no merge) |
| Estornos, consistência financeira e auditoria | **Validado em código/testes; ressalva operacional** | Estorno auditado prévio ao cancelamento coberto em `#1399`, `ActivityLog` em alterações de equipe/acesso e `super_admin_audit_logs` no Super Admin |

---

## 3. Evidências de testes locais (deste fechamento)

- `pytest -q -ra backend/tests/test_auth_tenant_session_hardening.py backend/tests/test_b1_mesa_retirada_isolation.py backend/tests/test_b1_cancel_payment_guard.py` -> **36 passed**.
- Inclui nova regressão `test_role_change_revokes_previous_active_tokens_immediately` garantindo que tokens antigos emitidos antes de uma troca de cargo (`caixa -> cozinha`) passam a retornar HTTP `401` imediatamente.

---

## 4. Ressalvas residuais (não impeditivas para avançar para B3+)

- A revogação imediata por `token_version` bloqueia imediatamente novas requisições HTTP e novos handshakes WebSocket; conexões WebSocket já estabelecidas antes da alteração de cargo continuam encerrando no próximo ciclo de reconexão/verificação.
- Conciliação financeira em produção com adquirentes externos (Mercado Pago / PagBank) depende de validação contínua com transações reais de clientes, fora do escopo de testes automatizados isolados.
