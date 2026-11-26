# KÔMA Business V2-A & V2-B — Tracker Comercial e Financeiro KÔMA

- **Data:** 2026-11-26
- **Catálogo Canônico:** `2026-11-business-v2a` (`product-contract.json`)
- **Versão Jurídica:** `3.6` (`src/legal/legalContentV36.ts`)

## V2-A — Reestruturação Comercial (Concluída e em Produção)
- **PR:** `#1512` (merged em `main` no commit `c52acb2ed6652fe4ebfaadccd76c0cb5d2b44703`)
- **Deploy verificado:** Railway `e8c0b1e6-e88b-4a92-b81b-28412c930d97` (`SUCCESS`) e Cloudflare Pages `6f12ec32-4091-4791-9c25-8167bf40ab18`; `production-smoke.mjs` verde em `app.komafood.com.br` e `central.komafood.com.br` (`Legal v3.6`).
- **Entregues:**
  1. `product-contract.json` como fonte única de preços e capacidades (`Pocket R$ 99,90`, `Pro R$ 179,90` com `courier_app`, `Premium R$ 329,90`, anual `-10%`, comissão `0%`, implantação padrão gratuita e VIP opcional `R$ 299,00`).
  2. Programa **KÔMA Founders** (`saas_commercial_grants` + RLS + `/api/super-admin/founders`) limitado a 5 beneficiários históricos não reutilizáveis, `R$ 79,90/mês` + módulos homologados gratuitos.
  3. Bloqueio de contratação para módulos futuros (`KÔMA Connect`, `KÔMA Fiscal`, `KÔMA Finance`, `KÔMA Totem`) e landing page simplificada.

## V2-B — Homologação Founders UI + Financeiro KÔMA (Empresa)
- **Branch:** `feat/koma-business-v2b`
- **Entregues:**
  1. **Painel Super Admin Founders (`SuperAdminFoundersPanel.tsx`):** gestão completa dos 5 slots Founders em `/api/super-admin/founders` sem SQL ou chamadas manuais, com histórico, motivo auditável e revogação excepcional protegida.
  2. **Ledger Idempotente da Empresa (`SaaSCompanyReceipt` / `super_admin_company_receipts`):** reconciliação automática de pagamentos recorrentes e estornos do Mercado Pago (`saas_invoice_reconciliation.py`) sem duplicar lançamentos e sem misturar vendas de restaurantes.
  3. **Indicadores CFO (`GET /api/super-admin/finance` + `SuperAdminFinance.tsx`):** MRR contratado (por plano), recebido bruto/líquido (por canal e origem), faturas pagas/abertas/em atraso/estornadas, contagem de restaurantes (pagantes, Founders, trial, onboarding, gratuitos/legado, suspensos), ARPA, margem de contribuição e ponto de equilíbrio.
  4. **Resumo Read-Only para CFO/IA (`GET /api/super-admin/finance/cfo-summary`):** endpoint protegido por `get_current_admin`, sem PII ou credenciais.

## Dados Disponíveis vs. Desconhecidos (Regra de Ouro)
- **Disponíveis automaticamente:** planos contratados, status de assinaturas, programa Founders, faturas DirectPix, pagamentos/estornos recorrentes Mercado Pago reconciliados a partir desta migração.
- **Dependentes de lançamento mensal pelo proprietário (`OwnerFinanceMonth`):** custos de `chatgpt`, `database`, `railway`, `tools`, `taxes`, `other`. Enquanto houver qualquer categoria `null`, `recorded_result` e `break_even_tenants` retornam `null` (`"Custos incompletos"`), nunca `0`.
- **Bloqueios reais mantidos:** módulos futuros (`iFood`, `Fiscal`, `Finance`, `Totem`) permanecem bloqueados para venda até homologação operacional e jurídica.

## Próxima Ação Recomendada
1. Após o merge da V2-B e execução da migração Alembic `20261126c105`, conceder formalmente os benefícios **Founders** aos estabelecimentos elegíveis (ex.: ID 6 e ID 1, após conferência operacional) pelo novo painel em **Super Admin → Cobrança/Financeiro**.
2. Preencher os custos mensais reais do mês corrente no painel para destravar margem de contribuição e ponto de equilíbrio reais no `/api/super-admin/finance/cfo-summary`.
