# Novo pedido — auditoria de usabilidade e capacidade em cenários simulados

**Data:** 12/11/2026. **Base:** main `951b9df`, capturas reais do operador em Android e benchmarks públicos BeeFood / Kyte. **Alvo:** frente de caixa do KÔMA, não o cardápio público.

## Critério de experiência

O operador novo deve conseguir: reconhecer produto e preço, adicionar, corrigir, identificar a modalidade, conferir o total e lançar sem lembrar de comandos, sem pular obrigatoriedades e sem operar outro sistema. O operador experiente mantém o caminho curto e os atalhos.

Referências de contexto: [BeeFood PDV](https://ajuda.beefood.com.br/pdv), [Kyte recursos PDV](https://www.kyteapp.com/pt/recursos), [NN/g reconhecimento vs. memorização](https://www.nngroup.com/articles/recognition-and-recall/), [web.dev INP](https://web.dev/explore/how-to-optimize-inp). São fontes de padrões e pesquisa; não copiar a composição nem inferir performance própria de terceiros.

## Linha de base visual (evidência: capturas Android do operador)

- A guia horizontal de Vendas é visível, começa à esquerda e não mostra a barra cinza de scroll (PR #1308; preservá-la).
- Duas faixas principais ocupam altura fixa: topo de Vendas e guia, mais navegação inferior; o catálogo e carrinho ficam entre elas.
- No catálogo, os controles `Itens / Pedido`, modalidade e CTA flutuante `Ver pedido` parcialmente se repetem. Testar antes de remover qualquer caminho de retorno.
- Os cards apresentam foto, nome, preço e `Adicionar`. Tocar no restante do card abre personalização, mas não há indicação textual disso no card.
- O carrinho reúne item, quantidade, preparação recolhível, cliente opcional, pagamento opcional e ação final em uma tela. Não reintroduzir wizard de confirmação sem evidência de necessidade.

## Riscos ordenados por efeito

| Prioridade | Problema | Evidência / mecanismo | Entrega e aceitação |
|---|---|---|---|
| P0 | Inclusão rápida de produto com escolha obrigatória permite composição vazia | `handleQuickAddProduct` chamava `handlePdvAddToCart` sem consultar `modifierGroupSelectionValid` | `Escolher opções` abre modal e bloqueia `Adicionar ao pedido` até escolha válida; opcional permanece 1 toque |
| P1 | Catálogo grande rerenderiza todos os cards quando muda carrinho | handlers instáveis, filhos não memoizados | `memo` + callbacks estáveis; verificar 240 itens e adições repetidas em E2E |
| P1 | Fluxo de retirada parece simples mas tem três acessos ao carrinho | Controles `Pedido` e CTA persistente quando há itens | Medir por tarefa e preservar clareza antes de eliminar redundância |
| P1 | Grande volume de pedidos pode degradar API/estado operacional | Sem medição desta rodada inicialmente | Executar suíte isolada de pedidos concorrentes, guardar p50/p95/p99 e taxas de erro |
| P2 | Cartões e rodapé de carrinho podem ser densos em celulares baixos | Capturas Android com 3 itens e formulários abertos | Testar altura, safe area e textos ampliados, sem esconder CTA |

## Cenários executáveis, sem pedidos reais

**N1 — iniciante / retirada simples.** Selecionar produto sem complementos → adicionar → `Ver pedido` → conferir preço/quantidade → `Lançar Pedido`. Medir toques; validar que a identidade é opcional. Não enviar ao backend real.

**N2 — iniciante / item obrigatório.** Marmita P com uma proteína obrigatória: botão deve comunicar `Escolher opções`, modal desabilita confirmação inicialmente, seleção de Frango habilita, pedido mostra `Frango`. Sem validação tardia de composição.

**N3 — delivery.** Ao mudar modalidade, exigir telefone/nome/endereço válido antes de confirmação, mostrar orientação contextual; verificar resposta de erro sem perder rascunho. Preservar idempotência e preço backend.

**F1 — carga de interface.** Quatro sessões independentes, 240 produtos e 24 categorias por sessão; 12 adições rápidas em cada sessão e busca no catálogo. Somente `page.route`, sem writes. Relatar tempos de automação para comparar builds idênticos, nunca como INP real nem capacidade do backend.

**F2 — concorrência de API.** `test_capacity_stage_1_ten_tenants`: dez restaurantes sintéticos / quarenta pedidos, até quatro requisições em paralelo, testes de replay, isolamento e percentis. Rodar apenas em SQLite local descartável do GitHub Actions; não usar dados reais, Railway nem produção. Esta medida não equivale a tráfego externo em PostgreSQL/infra real.

**F3 — pico concentrado.** Um único restaurante sintético / 24 pedidos e até quatro requisições concorrentes sobre SQLite descartável; comparar erros, duplicações e percentis com F2. A concentração em um tenant não modela conexões de celulares reais, PostgreSQL nem tráfego do Railway.

## Guardrails

- Core de preço, status, estoque, pagamentos, limites de modificadores e tenant continuam no backend; UI só apresenta e bloqueia escolhas inválidas.
- Não escrever em `restaurante_id=6` ou qualquer tenant de produção.
- Nenhuma nova biblioteca, serviço remoto ou asset decorativo nesta fase.
- Verificar `npm run lint`, `npm run test:unit`, `npm run build`, Playwright mobile/desktop, smoke backend isolado e CI verde antes do merge.
- Após merge, conferir Cloudflare Pages e health/checkout. Testes em aparelhos reais ainda são necessários.

## Tracker

- [x] Conferir capturas reais e a guia horizontal na main.
- [x] Comparar problemas de tarefa com BeeFood, Kyte e pesquisas de UX.
- [x] Teste RED do caso de complemento obrigatório.
- [ ] Confirmar GREEN e guardar métricas das simulações F1/F2.
- [ ] Confirmar regressões dark/light e delivery.
- [ ] Merge com CI verde, deploy e health.
- [ ] Próximo PR: medir e simplificar os acessos duplicados ao pedido sem esconder funções.
- [ ] Próximo PR: medir redução de renderizações em catálogo grande e tempos em Android real.
