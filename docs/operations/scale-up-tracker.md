# KÔMA — Operação Scale Up Tracker

> Atualizado continuamente durante a execução das Waves 1 a 5 a partir de `origin/main`.

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
| **Provisionamento Universal (Wave 5)** | Inscrição pública salvava rascunho criptografado; criação do tenant dependia de Step 3 contratual ou UI do Super Admin; rotas `super_admin_onboarding` e `super_admin_profile_onboarding` duplicavam lógica de criação | Motor central único (`universal_provisioning.py`) + `/comecar` autônomo (guiado e Expresso) + `POST /api/provisioning/express` + `scripts/koma-provision.mjs` + Super Admin delegado ao mesmo núcleo | Qualquer restaurante nasce em modo preparação sem Super Admin (7 cliques/5 campos no guiado ou 6 cliques/2 campos no expresso) com categorias, horários, modalidades e cardápio na criação |

---

## Status das Missões (Definition of Done)

| Frente | Escopo | Classificação DoD | Branch / PR | Evidência |
|---|---|---|---|---|
| **Wave 1 — Missão D** | Impressão Térmica Bluetooth (Backend + UI + `print-android`) | Implementado, aguardando homologação física | PR #1519 (`87aeadc0`) merged | 12/12 checks CI verdes; `test_print_agents.py` (76) + `test_print_primary_agent_queue.py` (21) + `print-local-connection.spec.ts` (16) + `KOMA Print Android` CI verde |
| **Wave 1 — Missão C** | Mobile como equipamento principal (`min-h-11` + reconciliação `pageshow`/`online`) | Implementado e verificado | PR #1519 (`87aeadc0`) merged | `cashier-fulfillment-workspaces.spec.ts` + `cashier-delivery-stages.spec.ts` (22 passed em `mobile-390` e `desktop-1366`) |
| **Wave 2 — Missão B** | Motor de Cadastro Rápido (Lote completo + Duplicação + Importador Universal) | Implementado e verificado | PR #1521 (`a35b1b41`) merged | 7/7 checks CI verdes; `test_products_bulk_and_import.py` (3) + `test_signup_catalog_import.py` + `test_product_highlights_and_promo_price.py` (11) + `menuImportParser.test.ts` + `catalog-bulk-and-import.spec.ts` (106 passed) |
| **Wave 3 — Missões A, E, F** | Onboarding Ultrarrápido + Presets de Segmento + Super Admin Operacional | Implementado e verificado | PR #1524 (`a4cd054f`) merged | `focus:check -- --e2e` (lint, unit tests, build, 98 Playwright passed) + 4 passed (`super-admin-360-focus`, `signup-catalog-import`); CI & Production Smoke verdes |
| **Wave 4 — Modo Pizzaria & QA Real no Navegador** | `regra_preco_meio_a_meio` full-stack, `/contratar/pro` 1→2, UX mobile Caixa/PDV/Complementos e jornada completa em Desktop (`1366x768`) + Mobile (`390x844`) | Implementado e verificado | PR #1537 (`691a1283`) merged | QA real no navegador em servidor local full-stack (`Pizzaria Laboratório KÔMA` tenant local `#2` e `Pizzaria Laboratório KÔMA QA2` `#3`, slug `pizzaria-lab-qa2`, 34 itens importados + pedidos #1–#4 Retirada/Delivery/Balcão); `focus:check -- --e2e` + `test_pizza_meio_a_meio_pricing.py` + `modifierPricing.test.ts` + `pizza-meio-a-meio-flow.spec.ts` |
| **Wave 5 — Provisionamento Universal & Cadastro Sem Atrito** | Motor central (`universal_provisioning.py`), parser determinístico Python/TS, rotas `/api/provisioning/public/{preview,start}` e `/api/provisioning/express`, CLI `scripts/koma-provision.mjs`, UI autônoma `/comecar` (guiado + expresso) e refatoração do Super Admin | Implementado e verificado | `feat/scaleup-w5-universal-provisioning` | 47/47 pytest onboarding+universal, `expressOnboardingParser.test.ts`, `focus:check -- --e2e` (`mobile-390` + `desktop-1366`), QA real no navegador nos 3 cenários (`#3`, `#4`, `#5`) e CLI (`#2` QA Lab) |

---

## Wave 5 — Comparativo Medido dos 3 Caminhos de Provisionamento (QA Local Full-Stack)

| Cenário | Caminho Executado | Tempo de Resposta Backend | Interações Medias (Browser QA) | Resultado & Evidência |
|---|---|---|---|---|
| **A — Cliente Público Autônomo (Mobile `390x844`)** | `/contratar/pro` → `/comecar?plano=pro` (Guiado) → `/?view=caixa` | `1487 ms` (`POST /api/provisioning/public/start` -> `201`) | 7 cliques / 5 preenchimentos, sem sessão Super Admin | Tenant `#3` (`bistro-mobile-autonomo`), `pending_setup`, 5 categorias + 2 itens visíveis no Caixa (`3 de 4` prontos imediatamente) |
| **B — Expresso Estruturado (`/comecar` Desktop `1366x768` + CLI)** | Colar texto estruturado (`Pizzaria Don Romano`) → preview local → criar → `/?view=caixa`; e `scripts/koma-provision.mjs --qa-lab` | `531 ms` (`public/start` -> `201`) / CLI `--dry-run` + real (`201`) | Browser: 6 cliques / 2 preenchimentos; CLI: 1 comando determinístico com `--idempotency-key` | Browser: Tenant `#4` (`pizzaria-don-romano`, 5 categorias, 3 pizzas). CLI: Tenant `#2` (`pizzaria-laboratorio-koma`, `qaLab=true`, `qaMenuPath` ativo) |
| **C — Super Admin Refatorado (Desktop `1366x768`)** | `/super-admin` → `+ Novo restaurante` → Modo Expresso (`Colar dados`) → `POST /api/provisioning/express` | `201 Created` via mesmo motor central | 7 cliques / 4 preenchimentos | Tenant `#5` (`hamburgueria-central-qa`), `Etapa A — Em preparação (7 dias preservados)` |

### Classificação Wave 5 (Concluído / Bloqueia agora / Pode ficar para depois)
- **Concluído:** Núcleo único de provisionamento (`universal_provisioning.py`), proteção de preparação e bloqueio comercial (`is_provisional_preparation` em `UNIVERSAL_TENANT_PROVISION`), parser determinístico Python/TS, `/comecar` autônomo com preview + login imediato no Caixa, `/api/provisioning/express` com token escopado (`KOMA_PROVISIONING_API_TOKEN`) + `X-Idempotency-Key` + `dry_run` + `qa_lab`, CLI `scripts/koma-provision.mjs`, CORS compatível e delegação do Super Admin sem regressão.
- **Bloqueia agora (produção permanente QA Lab sem sessão navegador):** Caso `KOMA_PROVISIONING_API_TOKEN` ainda não esteja definido no serviço Railway de produção, configurar a variável no ambiente oficial antes de executar:
  ```bash
  printf 'Nome: Pizzaria Laboratório KÔMA\nSegmento: Pizzaria\nResponsável: Equipe QA KÔMA\nEmail: qa-lab@komafood.com.br\nAtendimento: Delivery, Retirada, Consumo no local\nHorário: 18h às 23h\n' | KOMA_PROVISIONING_TOKEN="$TOKEN" node scripts/koma-provision.mjs --stdin --qa-lab --idempotency-key prod-pizzaria-lab-koma
  ```
- **Pode ficar para depois:** Wrapper MCP fino chamando `POST /api/provisioning/express` caso seja útil expor diretamente em agentes externos; adição de novos presets além dos 6 segmentos atuais.

---

## Homologações Físicas e Externas Pendentes
1. Pareamento e impressão física em celular Android real + impressora Bluetooth real (58 mm ou 80 mm) do 3º cliente seguindo `docs/operations/homologacao-fisica-bluetooth.md`.
2. Teste de tela bloqueada por 2+ minutos no aparelho real do cliente (One UI / HyperOS / Motorola).
3. Teste de desconexão física durante expediente real e verificação de não-duplicação no papel via `PrintJournalStore`.
4. Execução autorizada de `scripts/koma-provision.mjs --qa-lab` (ou criação autenticada em `central.komafood.com.br`) para registrar o tenant QA permanente **"Pizzaria Laboratório KÔMA"** em produção.
