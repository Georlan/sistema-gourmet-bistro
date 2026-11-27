# KÔMA — Operação Scale Up Tracker

> Atualizado continuamente durante a execução das Waves 1, 2 e 3 a partir de `origin/main`.

## Baseline Verificado vs Estado Pós-Scale Up (Métricas Observáveis)

| Fluxo / Métrica | Antes (`origin/main` `0c067614`) | Depois (Waves 1–3) | Redução / Ganho |
|---|---|---|---|
| **Cadastro de cardápio inicial (WhatsApp/Planilha)** | Exigia envio de arquivo para a equipe KÔMA (espera assíncrona) ou criação manual item a item (6+ cliques/campos por produto) | Importação self-service determinística (`QuickMenuImportModal`) direto no onboarding e no Caixa: colar texto/CSV → prévia editável → publicar `merge` | Elimina dependência de suporte manual para cardápios estruturados/planilhas |
| **Alterações em lote no catálogo** | `PATCH /produtos/edicao-lote` suportava apenas `%` e mover para categoria já existente; sem grupos de complementos em lote; duplicação abria modal manual | `PATCH /produtos/edicao-lote` com `%`, `+/- R$`, `R$ fixo`, `destaque`, `somente_promocao`, adicionar/remover `GrupoModificador` em lote, `+ Nova` categoria inline, filtro `Sem preço` e `POST /produtos/{id}/duplicar` 1-clique | Operação coletiva de 30+ itens sem abrir formulários individuais nem sair da tela |
| **Categorias iniciais por segmento** | Criação manual uma a uma (nome + destino de impressão por categoria) | `segmentCategoryPresets.ts`: 1 toque cria 3–5 categorias com roteamento correto (`COZINHA`/`NENHUM`) para 6 segmentos | Reduz criação inicial de categorias de ~15 cliques para 2 toques |
| **Impressão Bluetooth Android** | `/register` não retornava `is_primary`/`restaurant_name`, UI sem botão para `/set-primary`, copy fixo em Kapbom 58mm sem aviso iOS, self-test Android fixo 58mm | `/register` retorna `is_primary` + `restaurant_name`, UI com botão 1-toque `/set-primary`, guia 4 passos 58/80mm, detecção iOS/Safari, `print-android` adaptável 58/80mm e lista expandida | Elimina SQL manual / ambiguidade de agente primário e cobre térmicas 58mm e 80mm |
| **Operação Mobile & Super Admin** | `useCashierRealtime` não ouvia `pageshow`/`online`; botões `.orders-card__action` com `h-8`; Super Admin `Resumo` sem painel consolidado de impressão+catálogo+blockers | `pageshow`/`online` para retorno do WhatsApp, alvos táteis `>= 44px`, card `Prontidão operacional e impressão` no `SuperAdminRestaurant360` com atalhos diretos em Modo Suporte | Recuperação imediata pós-background no celular e triagem sem SQL no Super Admin |
| **Modo Pizzaria (`meio_a_meio`)** | `OrderPricingService` e Cardápio/PDV somavam os preços de todos os sabores; `limits_by_product` sobrescrevia `tipo = meio_a_meio` | Regra configurável `regra_preco_meio_a_meio` (`maior_preco`, `media`, `soma`) no backend + frontend (`modifierPricing.ts`), badges `Inteira`/`1/2` e frações na comanda | Precificação autoritativa sem somar sabores indevidamente; suporta limites por tamanho |
| **Inscrição `/contratar/pro` & UX Mobile/Admin** | Etapa 1→2 reutilizava botão `<button>` e disparava validação HTML5 prematura; modal `CheckoutDialog` expandia para `1015px` no mobile; títulos do PDV sobrepunham botão `(i)` | Keys distintas na transição 1→2, `min-w-0` no grid/fieldset de recebimento (`390px` sem overflow), espaçamento para `(i)` no PDV, opções estáveis em `ComplementosTab` e estado claro no QA card | Zero falsos erros de validação na inscrição e operação 100% utilizável em `390x844` |

---

## Status das Missões (Definition of Done)

| Frente | Escopo | Classificação DoD | Branch / PR | Evidência |
|---|---|---|---|---|
| **Wave 1 — Missão D** | Impressão Térmica Bluetooth (Backend + UI + `print-android`) | Implementado, aguardando homologação física | PR #1519 (`87aeadc0`) merged | 12/12 checks CI verdes; `test_print_agents.py` (76) + `test_print_primary_agent_queue.py` (21) + `print-local-connection.spec.ts` (16) + `KOMA Print Android` CI verde |
| **Wave 1 — Missão C** | Mobile como equipamento principal (`min-h-11` + reconciliação `pageshow`/`online`) | Implementado e verificado | PR #1519 (`87aeadc0`) merged | `cashier-fulfillment-workspaces.spec.ts` + `cashier-delivery-stages.spec.ts` (22 passed em `mobile-390` e `desktop-1366`) |
| **Wave 2 — Missão B** | Motor de Cadastro Rápido (Lote completo + Duplicação + Importador Universal) | Implementado e verificado | PR #1521 (`a35b1b41`) merged | 7/7 checks CI verdes; `test_products_bulk_and_import.py` (3) + `test_signup_catalog_import.py` + `test_product_highlights_and_promo_price.py` (11) + `menuImportParser.test.ts` + `catalog-bulk-and-import.spec.ts` (106 passed) |
| **Wave 3 — Missões A, E, F** | Onboarding Ultrarrápido + Presets de Segmento + Super Admin Operacional | Implementado e verificado | PR #1524 (`a4cd054f`) merged | `focus:check -- --e2e` (lint, unit tests, build, 98 Playwright passed) + 4 passed (`super-admin-360-focus`, `signup-catalog-import`); CI & Production Smoke verdes |
| **Wave 4 — Modo Pizzaria & QA Real no Navegador** | `regra_preco_meio_a_meio` full-stack, `/contratar/pro` 1→2, UX mobile Caixa/PDV/Complementos e jornada completa em Desktop (`1366x768`) + Mobile (`390x844`) | Implementado e verificado | `feat/scaleup-w4-pizza-mode-qa` | QA real no navegador em servidor local full-stack (`Pizzaria Laboratório KÔMA` tenant local `#2` e `Pizzaria Laboratório KÔMA QA2` `#3`, slug `pizzaria-lab-qa2`, 34 itens importados + pedidos #1–#4 Retirada/Delivery/Balcão); `focus:check -- --e2e` + `test_pizza_meio_a_meio_pricing.py` + `modifierPricing.test.ts` + `pizza-meio-a-meio-flow.spec.ts` |

---

## Homologações Físicas e Externas Pendentes
1. Pareamento e impressão física em celular Android real + impressora Bluetooth real (58 mm ou 80 mm) do 3º cliente seguindo `docs/operations/homologacao-fisica-bluetooth.md`.
2. Teste de tela bloqueada por 2+ minutos no aparelho real do cliente (One UI / HyperOS / Motorola).
3. Teste de desconexão física durante expediente real e verificação de não-duplicação no papel via `PrintJournalStore`.
4. Provisionamento do tenant QA permanente **"Pizzaria Laboratório KÔMA"** em produção (`central.komafood.com.br`): requer sessão autenticada do SuperAdmin diretamente no navegador embutido antes da criação oficial pela UI.
