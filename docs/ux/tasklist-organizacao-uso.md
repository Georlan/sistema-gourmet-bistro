# KÔMA — Tasklist de organização e facilidade de uso

Este tracker é executável: cada item deve resultar em mudança concreta, teste e PR. Auditoria passiva não conta como conclusão.

## P0 — Operação diária

- [x] Caixa: remover Pix presumido do checkout e exigir escolha explícita do método.
- [x] Caixa: abrir recebimento de mesa sem pré-selecionar itens prontos; o saldo pode vir preenchido, mas permanece visível e editável.
- [x] Caixa: revisar hierarquia visual do checkout em mobile e desktop com fluxo real de recebimento; ação principal agora explicita contexto + valor e modais ficam acima do chrome móvel.
- [x] Caixa: reconciliar pedidos digitais e turno imediatamente ao retomar aba/janela, sem adicionar polling concorrente ao WebSocket.
- [x] Caixa: impedir respostas de leitura fora de ordem de regredirem pedidos/turno após retomada do background.
- [x] Caixa: avanço do Kanban digital otimista, com trava por pedido, rollback em erro e proteção contra leituras/realtime que tentem regredir a mutação pendente.
- [x] Caixa: adicionar aba de Retiradas como visão operacional derivada do Kanban, com pendentes, prontas, atrasadas e concluídas do dia sem criar uma segunda máquina de estados.
- [x] App do Garçom — onda 1: compactar o Salão, remover métricas duplicadas e deixar explícita a ação de cada mesa antes do toque.
- [x] App do Garçom — onda 2: simplificar mesa → cardápio → revisão → lançamento; opções obrigatórias não passam pelo quick-add, CTAs mostram quantidade/valor/mesa e o rascunho fica travado durante envio.
- [ ] App do Garçom — onda 3: consumo → itens prontos → pagamento/fechamento, removendo estados ambíguos e ações redundantes.
- [ ] Impressão — onda única: consolidar diagnóstico, configuração, teste e status da fila em uma sequência operacional curta.

## P1 — Organização do produto

- [ ] Cardápio Online — onda 1: reconstruir bloqueio do cliente + motivo da recusa do PR #328 sobre a main atual.
- [ ] Cardápio Online — onda 2: consolidar navegação/configurações e manter poucos fluxos canônicos.
- [ ] Super Admin — onda única: organizar ações do tenant por tarefa operacional, suporte, plano e status; destacar ações perigosas.
- [ ] Onboarding — onda única: reduzir primeiro acesso às decisões essenciais até chegar ao Caixa operacional.
- [x] Equipe: espelhar Pessoas e Funções e acessos na mesma árvore canônica do menu vertical e da barra horizontal.
- [ ] Equipe: manter gestão de pessoas e acessos sem telas paralelas.
- [ ] Equipe — onda única: tornar cargos/permissões explícitos e impedir ações administrativas ambíguas.

## P1 — Integridade que afeta a operação

- [ ] Integridade — onda 1: Outbox idempotente também na colisão do mesmo `event_id` entre transações concorrentes.
- [ ] Integridade — onda 2: serializar writers restantes de estoque de entrada manual/XML/movimentações administrativas.
- [x] Entregador: timeout no POST de confirmar entrega, sem retry automático; após timeout o PWA reconcilia por GET antes de permitir nova tentativa.

## P2 — Limpeza e simplificação

- [ ] Chat: reavaliar e reconstruir a retenção de 90 dias do PR #317 sobre a arquitetura atual.
- [ ] Navegação do Caixa: validar agrupamentos, nomes e destinos com uso real; remover rotas/atalhos redundantes.
- [x] Conta & assinatura: espelhar Meu Plano, Planos & Upgrade e Contrato e documentos na mesma árvore canônica do menu vertical e da barra horizontal, removendo as pills internas paralelas.
- [x] Relatórios: espelhar Visão Geral, Financeiro, Produtos e Equipe na mesma árvore canônica do menu vertical e da barra horizontal.
- [ ] Relatórios: manter somente atalhos e indicadores que levam a decisão operacional clara.
- [x] Configurações: unificar Aparência, Impressão, Mesas, App do Garçom, Taxa de Serviço, Implantação inicial e Integrações na mesma árvore canônica, espelhada no menu vertical e na barra horizontal, sem cards internos de navegação.
- [ ] Configurações: consolidar owners existentes e impedir novas telas paralelas para a mesma regra.

## Regra de execução — modo ondas

1. Partir sempre da `main` mais recente.
2. Cada rodada deve resolver **um fluxo inteiro**, agrupando de 2 a 4 melhorias coerentes no mesmo owner/PR; micro-PR só quando houver risco financeiro, tenant, estoque, migração ou irreversibilidade.
3. O ChatGPT implementa o máximo possível primeiro. O Gemini recebe apenas teste visual/click-through ou uma correção concreta que dependa do navegador dele; nada de auditoria passiva ou ping-pong.
4. Rodar unit/typecheck/build/E2E relevantes **uma vez por onda**, não uma vez por microajuste.
5. Mergear somente com CI verde e head estável. Depois do merge, o Gemini testa a onda concluída enquanto o ChatGPT já avança para a próxima frente sem sobreposição de arquivos.
6. Achados manuais entram na próxima onda do mesmo fluxo; não reabrir uma sequência de PRs microscópicos salvo regressão crítica.
