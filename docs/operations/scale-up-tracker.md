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

---

## Status das Missões (Definition of Done)

| Frente | Escopo | Classificação DoD | Branch / PR | Evidência |
|---|---|---|---|---|
| **Wave 1 — Missão D** | Impressão Térmica Bluetooth (Backend + UI + `print-android`) | Implementado, aguardando homologação física | PR #1519 (`87aeadc0`) merged | 12/12 checks CI verdes; `test_print_agents.py` (76) + `test_print_primary_agent_queue.py` (21) + `print-local-connection.spec.ts` (16) + `KOMA Print Android` CI verde |
| **Wave 1 — Missão C** | Mobile como equipamento principal (`min-h-11` + reconciliação `pageshow`/`online`) | Implementado e verificado | PR #1519 (`87aeadc0`) merged | `cashier-fulfillment-workspaces.spec.ts` + `cashier-delivery-stages.spec.ts` (22 passed em `mobile-390` e `desktop-1366`) |
| **Wave 2 — Missão B** | Motor de Cadastro Rápido (Lote completo + Duplicação + Importador Universal) | Implementado e verificado | PR #1521 (`a35b1b41`) merged | 7/7 checks CI verdes; `test_products_bulk_and_import.py` (3) + `test_signup_catalog_import.py` + `test_product_highlights_and_promo_price.py` (11) + `menuImportParser.test.ts` + `catalog-bulk-and-import.spec.ts` (106 passed) |
| **Wave 3 — Missões A, E, F** | Onboarding Ultrarrápido + Presets de Segmento + Super Admin Operacional | Implementado e verificado | `feat/scaleup-p1-onboarding-superadmin` | `focus:check -- --e2e` (lint, unit tests, build, 98 Playwright passed em `onboarding-scaleup-catalog`, `auth-persistence`, `onboarding-first-client-ux`) + 4 passed (`super-admin-360-focus`, `signup-catalog-import`) |

---

## Homologações Físicas Pendentes (Dependência de Hardware Real)
1. Pareamento e impressão física em celular Android real + impressora Bluetooth real (58 mm ou 80 mm) do 3º cliente seguindo `docs/operations/homologacao-fisica-bluetooth.md`.
2. Teste de tela bloqueada por 2+ minutos no aparelho real do cliente (One UI / HyperOS / Motorola).
3. Teste de desconexão física durante expediente real e verificação de não-duplicação no papel via `PrintJournalStore`.
