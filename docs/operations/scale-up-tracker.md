# KÔMA — Operação Scale Up Tracker

> Atualizado continuamente durante a execução das Waves 1, 2 e 3 a partir de `origin/main` (`0c067614`).

## Baseline Verificado em `origin/main` (2026-11-27)
- **Impressão Bluetooth:** backend (`print_agents.py`), `print-android/` (Kotlin SPP 58mm + Journal atômico + ForegroundService) e `CashierPrintingSettings.tsx` já existentes; lacunas identificadas: `/register` não retornava `is_primary`/`restaurant_name`, UI sem botão para `/set-primary`, copy hardcoded em Kapbom KA-1445 58mm sem aviso iOS/Safari, lista de modelos 58mm restrita e self-test Android fixo em 58mm.
- **Operação Mobile:** `CashierMobileBottomBar`, `CaixaOrdersWorkspace`, `useCashierRealtime` já funcionais; lacunas identificadas: `useCashierRealtime` não reconciliava em `pageshow`/`online` e botões `.orders-card__action` usavam `h-8 sm:h-9` (32px).
- **Motor de Cardápio (Wave 2):** `PATCH /produtos/edicao-lote` só aceita `reajuste_percentual` e `categoria_id`; falta `POST /produtos/{id}/duplicar`, associação de modificadores em lote, criação inline de categoria no lote e parser/modal de importação em massa (WhatsApp/CSV/Planilha) com prévia editável.
- **Onboarding & Super Admin (Wave 3):** `FirstAccessOnboarding.tsx` depende de envio de foto/PDF para o fundador montar o cardápio (sem importador self-service nem presets rápidos de categorias por segmento); Super Admin precisa de visão consolidada de bloqueios/impressão/catálogo para implantação sem SQL.

---

## Status das Missões (Definition of Done)

| Frente | Escopo | Classificação DoD | Branch / PR | Evidência |
|---|---|---|---|---|
| **Wave 1 — Missão D** | Impressão Térmica Bluetooth (Backend + UI + `print-android`) | Implementado, aguardando homologação física | PR #1519 (`87aeadc0`) merged | 12/12 checks CI verdes; `test_print_agents.py` (76) + `test_print_primary_agent_queue.py` (21) + E2E (38) |
| **Wave 1 — Missão C** | Mobile como equipamento principal (touch targets + reconciliação `pageshow`/`online`) | Implementado e verificado | PR #1519 (`87aeadc0`) merged | `cashier-fulfillment-workspaces` + `cashier-delivery-stages` (22 passed em 390px/1366px) |
| **Wave 2 — Missão B** | Motor de Cadastro Rápido (Lote completo + Duplicação + Importador Universal) | Em andamento | `feat/scaleup-p1-catalog-engine` | Backend lote/duplicar/merge + parser determinístico + `QuickMenuImportModal` |
| **Wave 3 — Missões A, E, F** | Onboarding Ultrarrápido + Presets + Super Admin Operacional | Próxima fase | — | A iniciar após Wave 2 |

---

## Log de Decisões Técnicas e Execução

### Wave 1 (`feat/scaleup-p0-bluetooth-mobile`)
- **Arquivos modificados:**
  - `backend/app/routes/print_agents.py`: `/register` agora retorna `is_primary` e `restaurant_name` mantendo 100% compatibilidade e regras de proteção contra roubo de fila.
  - `backend/tests/test_print_agents.py`: teste de primeiro pareamento mobile automático como primário, retorno de `restaurant_name` e isolamento cross-tenant em `/set-primary`.
  - `src/components/printing/PrintMonitorPanel.tsx`: botão "Usar este aparelho como principal" (`POST /api/print-agents/set-primary`) e quebra de linha legível no título diagnóstico mobile.
  - `src/components/caixa/settings/CashierPrintingSettings.tsx`: guia de 4 passos 58mm/80mm, remoção de `backdrop-blur-xs`, detecção separada Android vs iOS/Safari (sem auto-disparo de deep-link no iOS).
  - `src/components/caixa/realtime/useCashierRealtime.ts`: reconciliação em `pageshow` e `online` além de `focus`/`visibilitychange`.
  - `src/components/caixa/orders/CaixaOrdersWorkspace.tsx`: `min-h-11 sm:min-h-9` nos botões de ação dos cards para alvo tátil >= 44px no mobile.
  - `print-android/`: reconhecimento expandido de térmicas 58mm (Goojprt, Lelong, POS58, Goldensky, etc.), `EscPos58Renderer.buildSelfTestPayload` adaptável para 58mm e 80mm, e testes Kotlin correspondentes.
  - `docs/operations/homologacao-fisica-bluetooth.md`: roteiro objetivo de validação física pendente.

## Homologações Físicas Pendentes (Dependência de Hardware Real)
1. Pareamento e impressão física em celular Android real + impressora Bluetooth real (58 mm ou 80 mm) do 3º cliente.
2. Teste de tela bloqueada por 2+ minutos no aparelho específico do cliente (MIUI/HyperOS/One UI/Motorola).
3. Teste de desconexão física durante expediente e confirmação de não-duplicação via `PrintJournalStore`.
