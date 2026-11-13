# Salão do Caixa — interação e leitura operacional (13/11/2026)

## Problema
Na versão anterior, a ação ficava em um botão isolado dentro do card, enquanto o restante da mesa não reagia ao toque. A apresentação era compacta, mas o operador precisava mirar o botão. Mesas com nomes próprios não destacavam seu identificador; mesas unidas não ofereciam consulta ao atendimento real. A filtragem podia somar o mesmo atendimento duas vezes quando a origem de uma mesclagem herdava o estado do destino.

## Contrato visual
Fonte: `docs/design-system/DESIGN_SYSTEM.md`, `docs/design/cashier-visual-direction.md`, `src/styles/komaFoundation.css`, `src/components/mesas/WaiterTableSurface.tsx`. Sem banner, KPI, ilustração, componente decorativo ou ativo novo.

- O card inteiro é um único `button` com alvo de toque grande e foco de teclado; não existem botões aninhados. A área de ação da base é parte desse botão e comunica a consequência.
- O número canônico da mesa é a primeira informação; nome personalizado é complementar. Estados reais aparecem por glyph vetorial KÔMA + texto, não apenas por cor.
- Livre: estado e lugares. Em atendimento: estado, consumo da mesa e duração se disponíveis. Recebimento: estado financeiro explícito vindo da projeção existente, sem apresentar consumo como saldo a cobrar.
- Mesa unida: indica o destino real e permite **apenas consultar** as comandas existentes desse destino. Origem unida sem atendimento ativo é desabilitada; não cria segunda comanda ou pedido.
- Filtros mantêm 44 px ou mais de alvo; busca usa `role=search`. A ausência de resultados permite restabelecer filtro e busca em um toque.
- A ordem exibida é numérica por ID para reduzir saltos quando o snapshot muda. A busca reconhece `7`, `07`, `Mesa 7`, `Mesa 07` e nomes, preservando o filtro selecionado.
- Contagens de `Atendendo` e `Receber` excluem origens mescladas, porque representam um único atendimento no destino. A contagem `Todas` continua representando as mesas físicas.
- Layout: duas colunas em 320 px ou fonte ampliada, três colunas em 360–639 px, expansão progressiva em tablet e desktop; foco visível e `prefers-reduced-motion`.

## Limites preservados
`projectCashierSalonTables` segue autoridade de estado e saldo/consumo. Acesso à comanda permanece via `inspectTable`; abrir pedido via `openTableOrder`. Não foram alterados endpoints, autenticação, pagamento, transferência, impressão, split, tenant ou estado do carrinho. Nenhuma mutação foi feita em restaurante real.

## Testes / publicação
Validação: `npm run lint`, `npm run test:unit`, `npm run build`; Playwright de Salão, PDV, mesclagem/transferência, pagamentos e larguras 320–1366 px. Reverter apenas o PR se houver regressão visual ou operacional; merge e deploy somente com CI verde. Após deploy, confirmar `/meta.json` e smoke de produção somente leitura.
