# KÔMA Business V2-A — Tracker Comercial e Pendências de Financeiro

- **Data:** 2026-11-26
- **Branch:** `feat/koma-business-v2a`
- **Catálogo Canônico:** `2026-11-business-v2a` (`product-contract.json`)
- **Versão Jurídica:** `3.6` (`src/legal/legalContentV36.ts`)

## Entregues nesta Fase (V2-A)
1. Consolidação de `product-contract.json` como fonte única de preços, capacidades e metadados (`plan_entitlements.py` agora lê diretamente do contrato).
2. Atualização de preços para novas contratações: Pocket `R$ 99,90/mês`, Pro `R$ 179,90/mês`, Premium `R$ 329,90/mês`, desconto anual `10%`, comissão `0%`, implantação padrão gratuita e VIP opcional `R$ 299,00`.
3. Inclusão de `courier_app` no plano **Pro** (além do Premium).
4. Programa **KÔMA Founders** persistente, auditável e limitado a 5 beneficiários (`saas_commercial_grants` + RLS + `/api/super-admin/founders`), preservando `R$ 79,90/mês` sem hardcode numérico de IDs e sem alterar contratos ou cobranças existentes automaticamente.
5. Metadados e bloqueio de compra para módulos futuros (`GET /api/contracts/catalog` e `POST /api/contracts/modules/{module_id}/checkout` -> HTTP 409).
6. Landing page simplificada (`Hero.tsx`, `Plans.tsx`, `FAQ.tsx`) com comissão zero apresentada como benefício geral, ~6 benefícios sem jargão por card e transparência sobre módulos futuros.

## Lacunas do Financeiro KÔMA Registradas para a Próxima Fase (V2-B)
1. **Receitas recorrentes externas ausentes do `SuperAdminFinance`:** `/api/super-admin/finance` consolida apenas `DirectPixFeeInvoice`; assinaturas recorrentes em cartão/Saldo no Mercado Pago (`/preapproval` / `subscription_authorized_payment`) e taxas de Setup VIP (`R$ 299,00`) ainda não entram automaticamente no total recebido.
2. **Ingestão de custos externos:** faturas de Railway, Supabase, Resend, tarifas do gateway SaaS e impostos ainda dependem de lançamento manual mensal em `OwnerFinanceMonth`.
3. **Alocação operacional dos Founders:** após validação de operação real dos IDs 6 e 1, conceder formalmente `founders_5` via `POST /api/super-admin/founders/{tenant_id}` com motivo auditável no Super Admin (sem SQL manual).
4. **Módulos futuros pendentes de homologação antes da venda:** `KÔMA Connect (iFood)` (B7), `KÔMA Fiscal` (B10 + cotação B2B PlugNotas/Focus NFe), `KÔMA Finance` (B8 DRE/CP/CR real) e `KÔMA Totem` (B4).
