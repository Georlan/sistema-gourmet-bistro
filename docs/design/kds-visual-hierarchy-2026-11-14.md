# KÔMA — hierarquia visual da Cozinha (14/11/2026)

> **Revisão visual posterior — 14/11/2026:** após avaliação em dispositivo real, a faixa âmbar, pontos amarelos, chip vermelho de tempo e ícones de confirmação dentro de círculos foram rejeitados como ruído e aparência genérica. Esses elementos deixam de ser a direção aprovada. Ver **kds-quiet-hierarchy-2026-11-14.md** para a solução revisada, fundamentada na paleta tonal do PDV/Salão.


## Problema observado
As capturas Android em temas claro e escuro mostravam um KDS funcional, porém com duas ações de aparência praticamente idêntica: **Concluir N** (lote) e **Pronto** (item). O preenchimento verde em cada linha gerava competição visual com número/identidade do pedido, tempo de espera e nomes de produtos. Título, dados, observações e ações usavam pesos muito próximos, e o filtro ativo também lembrava um botão de ação.

A captura é evidência de aparência e densidade, não de defeito operacional. Esta mudança não inventa estados, métricas ou comportamento de conclusão.

## Direção
1. **Fila primeiro:** mantém filtro Em preparo por padrão, ordem cronológica canônica e ferramentas de busca/produção total sob demanda. Em 320px, o filtro e as ferramentas continuam visíveis.
2. **Pedido primeiro:** usa Space Grotesk no identificador e Inter para destino, itens, descrição e controles. Identidade e tempo têm uma primeira linha definida; a contagem de pendentes e a ação de lote compartilham o bloco seguinte, sem eliminar identificador opcional.
3. **Estados visíveis, não decorativos:** trilho lateral âmbar somente para tickets em preparo e menta para prontos. O tempo continua medindo *desde o lançamento*; após 15 minutos o tempo passa a ser destacado por cor, fundo e ícone do relógio. Não é SLA.
4. **Duas ações, duas hierarquias:** **Concluir N** é a única ação preenchida do ticket, para conclusão em lote. **Pronto** é secundária, com aro e marca de confirmação. As duas mantêm 44px de altura, nomes acessíveis e callbacks existentes; ações individuais seguem independentes.
5. **Composição legível:** nome do item recebe ênfase, complementos ficam em corpo compacto com espaçamento respirável, e observações reais ganham uma pequena linha contextual; não adicionar informações artificiais ou cartões aninhados.
6. **Contraste e temas:** preferir tokens --koma-operation-* do design system, usar variáveis locais apenas para botão secundário e espera crítica. Garantir texto sobre ação primária e secundária com razão calculada ≥4,5:1 em dark/light, sem usar menta para tudo.
   **Peso tipográfico:** títulos de pedido 1,16rem / 700, produtos 1rem / 600, composição 0,85rem / 400 e ação individual 0,85rem / 600; preservar nomes e quebra de linha em 320px.
7. **Escopo:** CashierKitchen.tsx, kdsWorkspace.css e regressão Playwright. Nenhuma alteração no domínio, API, autenticação, backend, banco, KDS projection, impressão, entregas ou pagamentos.

## Verificação focal
- Lint, 1.259 unitários e build Vite aprovados sobre o código visual final.
- Chromium: 16/16 testes focais mobile-390 e desktop-1366, incluindo KDS, lote com falha/retry, foco, FIFO e confirmação.
- Firefox: 6/6 focais, incluindo contraste e seleção.
- Regressão visual: 320/360/390/430 px, dark/light, preferências A↑ grande/gigante em 320px, sem overflow, distinção entre ação de lote e individual, alvos ≥44px e contraste de texto ≥4,5:1.
- Capturas de fixture isolada inspecionadas em 320/360/430 px; não foram feitos pedidos reais.
- Execução ampla de cashier-responsive.spec.ts apresentou falhas fora do KDS (Cardápio, Relatórios, Estoque e navegação). Não são consideradas resolvidas por este PR e não autorizam alterar outros módulos incidentalmente.

## Peso técnico medido e decisão
Comparação de builds isolados (origin/main 850bb13d versus branch visual, gzip -9 dos bundles Vite):
- CSS principal: 58.470 B → 58.793 B; acréscimo real de 323 B comprimidos.
- JavaScript CaixaPanel: 136.697 B → 136.691 B; variação de -6 B comprimidos (sem novos imports ou dependências).
- CSS do módulo antes da compilação: 2.551 B → 3.284 B gzip; essa medida não representa a transferência real do bundle, que é minificado e unificado.
- Não vale introduzir lazy loading adicional, dependência ou arquitetura paralela para uma diferença inferior a 0,4 KB no CSS principal.
- O ajuste de escala tipográfica alterou os valores sem aumentar os bytes não comprimidos do bundle CSS principal (420.199 B no PR), validado em 320px sem rolagem horizontal.

## Publicação
Autorização de merge fornecida pelo responsável após o draft. Integrar somente após checks obrigatórios verdes no SHA final, confirmar Cloudflare Pages e /meta.json do domínio público. Em eventual regressão, reverter o PR sem migração.
