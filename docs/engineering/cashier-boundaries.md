# Caixa: continuação da divisão e carregamento por rota

Base: `126d813` (PR #142). Este bloco não aumenta permissões, não altera projeções
financeiras nem substitui teste de integração com impressora/SmartPOS físicos.

## Onde alterar cada responsabilidade

Dentro de `src/components/caixa/`:

- `navigation/cashierNavigation.ts`: catálogo único de destinos de desktop/mobile.
- `navigation/cashierNavigationContracts.ts`: contrato comum dos menus derivado dos owners, sem cópias de assinaturas.
- `navigation/useCashierNavigation.ts`: aba, subaba, aliases legados, persistência e cleanup do menu móvel.
- `navigation/useCashierPreferences.ts`: tema, fonte e fullscreen; listeners e cleanup no próprio hook.
- `navigation/CashierDesktopSidebar.tsx`, `CashierMobileSidebar.tsx`, `CashierOperatorDrawer.tsx`: apresentações controladas.
- `salao/useCashierSalonProjection.ts`: filtro, totais e opções do PDV derivados da projeção canônica.
- `kitchen/CashierKitchen.tsx`: view da cozinha; ações continuam no owner de pedidos.
- `orders/CashierCouriers.tsx`: view de entregadores, sem redefinir dados/ações de acesso.
- `orders/CashierCancelConsumptionDialog.tsx`: confirmação com escopo original de pedido/mesa/digital.
- `shift/CashierOpenShiftDialog.tsx`: abertura de turno com MoneyInput; autoridade continua em useCashShift.
- `settings/useCashierTableSettings.ts`: rascunhos, validação e ações de criar/editar/remover mesa.
- `settings/CashierTableSettings.tsx`, `CashierTableDialogs.tsx`: cadastro e formulários controlados.
- `settings/CashierPrintingSettings.tsx`: impressão e monitor, desmontado quando inativo.
- `settings/CashierWaiterSettings.tsx`: permissões existentes do garçom; nenhum poder novo inferido.
- `settings/CashierServiceTaxSettings.tsx`: taxa compartilhada com checkout, sem cálculo paralelo.
- `inventory/useCashierInventoryData.ts`: snapshots, refresh e insights do estoque.
- `inventory/useCashierInventoryOperations.ts`: XML, entrada, movimento, ficha técnica e contagem.
- `inventory/useCashierIngredientEditor.ts`: rascunho, cadastro/edição e ajuste de ingrediente.
- `inventory/useCashierSupplierEditor.ts`: rascunho e ações de fornecedor.
- `inventory/CashierIngredientDialogs.tsx`, `CashierStockAdjustmentDialog.tsx`, `CashierSupplierDialogs.tsx`: formulários controlados.

Os contratos de view usam `Pick<ReturnType<typeof owner>, ...>` onde aplicável.
Uma alteração na API do owner acusa incompatibilidade no consumidor pelo TypeScript,
sem exigir cópias manuais das assinaturas. Isso não garante compatibilidade de significado
nem substitui testes de comportamento.

## Estado e recuperação

Os hooks operacionais do caixa continuam incondicionais no painel. Os hooks locais de
estoque e configuração permanecem no módulo lazy já visitado, não nos diálogos condicionais.
Não há troca de identidade de componentes dentro do render. Não há recarga automática.

`src/components/shared/FeatureErrorBoundary.tsx` é o mecanismo comum de erro/recarga
confirmada. `src/components/app/AppRouteBoundary.tsx` usa o mecanismo para rotas públicas,
e `loading/DeferredCashierSection.tsx` continua responsável pelo loading/retention do caixa.

Os caminhos e condições de seleção das rotas em `App` foram preservados. Cardápio público,
landing, ativação, entregador e SuperAdminGate agora são lazy. O gate, e não o painel
administrativo, continua sendo o ponto de entrada da administração.

## Evidência e limites

- Composição: CaixaPanel 3.640 → 1.539 linhas; configurações 2.098 → 266;
  estoque 2.065 → 444. LOC é contagem física, não funcionalidade removida.
- Estado/efeitos/HTTP diretos do CaixaPanel: 16/7/0 → 8/2/0.
- Build local: App 647.647 → 203.574 bytes; grafo JS inicial do caixa
  1.164.956 → aproximadamente 858.589 bytes (−26,3% adicionais).
- O chunk específico do Caixa cresce ligeiramente (~289 → 294 kB) pela composição;
  o ganho de carregamento é medido no grafo inteiro, não escondido nesse arquivo.
- Não medidos: LCP, INP, FPS, RAM e consumo efetivo de tokens. Visitar todas as rotas
  baixa seus módulos. Retenção de rascunhos também retém estado em memória.
- Testes de fonte foram redirecionados aos owners reais, preservando os contratos
  monetários, tema compartilhado, logout e gate de superadmin.
- Um seletor novo de teste de exclusão foi corrigido após DOM/screenshot mostrarem
  que a confirmação substitui os campos do formulário; não houve ajuste de UI para satisfazê-lo.

## Reproduzir

Validação local: 176 unitários frontend; 787 testes backend mais o teste dedicado
de concorrência PostgreSQL (aprovado em banco temporário, descartado após o teste);
32 testes do agente de impressão. Dois smokes B1.4 exigem o workflow específico.
A matriz completa passou em 548 cenários, com quatro skips previstos, em oito
viewports (8,3 minutos). Fontes permaneceram congeladas durante a execução.
A revisão posterior dos contratos é somente de tipos: o novo build conservou os
mesmos hashes/bytes dos chunks e os 20 testes dedicados de produção passaram
(29,2 segundos), sem falhas. Testes não substituem equipamentos físicos.

```sh
npm run lint
npm run test:unit
npm run build
node scripts/audit-cashier-loading.mjs
node scripts/architecture-metrics.mjs
KOMA_E2E_PORT=4291 npm run test:e2e -- --workers=2
KOMA_E2E_PREVIEW=true KOMA_E2E_PORT=4291 npm run test:e2e -- e2e/cashier-loading.spec.ts e2e/cashier-boundaries.spec.ts --project=mobile-360 --project=desktop-1366 --workers=2
```

Testes usam dados fictícios. Validação em aparelhos físicos continua pendente.
Próximo bloco funcional exige decidir quais informações/ações adicionais o caixa
deve oferecer; compartilhar código não equivale a liberar autorização no servidor.
