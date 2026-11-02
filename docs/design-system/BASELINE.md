# Fundação visual KÔMA — levantamento inicial

Estado: **inventário parcial, não homologado**. Base de código: `214cdc1005fe6063f6bca166d9d97e27164dac58` (main, 02/11/2026). Este documento não certifica consistência visual nem substitui os contratos das telas. Para decisões já registradas, consulte [fundação CSS](../../src/styles/komaFoundation.css), [cores operacionais](../engineering/operational-brand-colors.md) e [direção do Caixa](../design/cashier-visual-direction.md). O documento do Entregador em `docs/design/courier-local-refinement.md` descreve fases históricas: confira a implementação atual antes de extrapolar suas afirmações.

## Perfis

- **Compra:** `src/cardapio/`; apresentação de produtos, preço, escolhas e imagens do restaurante. Personalização do tenant não é identidade universal da plataforma.
- **Operação:** Garçom (`src/components/mesas/`), Caixa (`src/components/caixa/`) e Entregador (`src/components/courier/`). Informação e ações relevantes à tarefa têm prioridade; estados operacionais continuam independentes.
- **Gestão e análise:** estoque, equipe e relatórios. Comparação e leitura de dados requerem densidade adequada; não foi realizada uma auditoria visual completa desses módulos.

A existência de estilos distintos não comprova incoerência. Não eliminar estados de mesa validados nem alterar pagamento, projeções, permissões ou fluxos para uniformizar aparência.

## Tipografia e cor observadas

`src/styles/komaFoundation.css` define Inter como corpo (`--koma-font-body`) e Space Grotesk como display (`--koma-font-display`), com fallbacks sans-serif. `src/index.css` também importa Montserrat, Bebas Neue e JetBrains Mono do Google Fonts; existem usos anteriores e pesos variados. A direção do Caixa reserva Inter para leitura e controles, Space Grotesk para títulos e identificação e números tabulares para comparação. Isso ainda não constitui uma escala universal validada. Não remover famílias nem substituir pesos sem inventariar consumidores e verificar telas.

O verde de referência é `#05c49d`; valores e funções de superfície, texto, foco e ação para temas claro e escuro estão na fundação CSS. Compra e operação têm perfis próprios. Usar tokens de ação e texto em conjunto, não aplicar o verde da marca indiscriminadamente; confirmar contraste no contexto real e manter texto ou símbolo além da cor para estados. A cor dos estados de serviço, pronto e pagamento do Garçom permanece no perfil de operação. Para WCAG 2.2 AA, verificar contraste de texto normal de 4,5:1, texto grande de 3:1 e componentes/indicadores necessários de 3:1; testar foco, teclado e alvo mínimo aplicável de 24×24 CSS px com suas exceções. Medidas de contraste dependem do fundo e de transparência composta.

## Componentes observados

| Componente | Papel e consumidores identificados | Limite de reutilização |
| --- | --- | --- |
| `src/components/shared/KomaEmptyState.tsx` | Estado vazio; variantes `panel`, `inline`, `compact`, `action`; usado em estoque, clientes e cardápio administrativo. | Título e ação devem explicar o próximo passo; ícones decorativos não substituem texto. Testar foco e nome de ações fornecidas como ReactNode. |
| `src/components/shared/KomaMetricGroup.tsx` | Métricas recebidas por props, sem consulta; clientes e fidelidade; modo compacto. | Não inferir valor ou proporção ausente. Exige rótulo de seção e dados reais. |
| `src/components/shared/SharedTableCard.tsx` | Apresentação de mesa usada por `MesaCard` e `CashierSalonCard`. | Compartilha apresentação, não ações ou regras de Caixa e Garçom. |
| `src/components/shared/ModifierPicker.tsx` | Escolha de complementos no MenuPanel e PDV. | Preservar limites e contratos do consumidor; não presumir equivalência com montagem pública. |
| `src/components/shared/OperationalBanner.tsx` | Fronteira de compatibilidade usada em Caixa, equipe, estoque e relatórios. | Atualmente renderiza apenas `h1` acessível; métricas passadas não são exibidas. Não documentar como painel de métricas. |
| `src/components/shared/trapOverlayTab.ts` | Auxiliar de teclado usado em overlays específicos. | Não é modal completo: fechamento, foco inicial e retorno ao gatilho continuam responsabilidade do consumidor. |
| `src/components/ui/card.tsx`, `sidebar.tsx` | Primitivas disponíveis em `ui`. | Confirmar comportamento, tema e consumidores antes de reutilizar; aparência semelhante não prova contrato equivalente. |

Inventário ainda incompleto: botões, campos, navegação, overlays e duplicações precisam de análise de consumidores, variantes e acessibilidade. Não houve consolidação de código nesta etapa.

## Comunicação e desempenho: observações de código

- `src/App.tsx` carrega Cardápio e Entregador com `React.lazy`.
- `useCashierRealtime.ts` usa contingência de 12 s quando o WebSocket está indisponível; preserve reconciliação e visibilidade conforme código.
- `useCourierRealtime.ts` implementa socket, reconexão e retomada; `useCourierOfflineShell.ts` e `courierSnapshotCache.ts` participam da resiliência. Cache não autoriza confirmar entrega offline nem prolonga sessão.
- Cardápio tem WebSocket e canais SSE com contingências; `paymentStatusPolling.ts` trata um fluxo financeiro. Não eliminar polling somente por existir outro canal: confirmar consumidores, freshness, falhas e isolamento.
- Preferir compartilhar leitura no owner existente, evitar consulta por card, interromper trabalho dispensável fora de vista, carregar imagens fora da área visível sob demanda e reservar suas dimensões. Preservar imagem crítica e reconciliação operacional. Essas são orientações, não melhorias medidas nesta rodada.

## Cobertura e pendências

[Comparação visual inicial e capturas](VISUAL-2026-11-02.md), com limites e resultados dos testes.

| Superfície | Código identificado | Validação visual atual |
| --- | --- | --- |
| Cardápio | `src/cardapio/CardapioPage.tsx` | Captura local em 390 e 1366; ver comparação |
| Garçom | `src/components/mesas/` e `src/components/MenuPanel.tsx` | Captura local em 390 e 1366; ver comparação |
| Caixa/Pedidos | `src/components/caixa/orders/CaixaOrdersWorkspace.tsx` | Captura local em 390 e 1366; PR #1232 incorporado à main |
| Entregador | `src/components/MotoboyPwaPage.tsx`, `src/components/courier/` | Captura local em 390 e 1366; dispositivo físico não validado |

Faltam capturas de estados adicionais e temas, matriz completa de contraste e interações, escala tipográfica e espaçamento acordados, inventário completo de assets e componentes, medições de rede e testes de regressão. Nenhuma das três tarefas da Fase 0 está encerrada por este levantamento.
