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
- [x] Super Admin — organização: ficha 360° por tarefa (implantação, plano, equipe, pagamentos, operação e histórico), suporte auditado e ações de status com motivo/confirmação. A ficha assume o foco ao abrir, preservando a lista/filtros ao voltar.
- [x] Super Admin — diagnóstico: leitura canônica para implantação administrativa sem assinatura comercial; resumo agrupa alertas iguais, mantendo evidências e executores individuais na Operação. Liberação comercial continua exigindo assinatura.
- [x] Super Admin — integrações: saúde baseada em evidência, Telegram por leitura, auditoria por tenant e links/ações reais Linear/PostHog. PostHog sem consulta autenticada fica não verificado; falha de atualização remove resultados antigos.
- [ ] Super Admin — pendências operacionais e próximas ondas: seguir prioridades abaixo; não encerrar incidentes apenas porque uma melhoria de interface foi entregue.
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

## Super Admin — prioridades reconciliadas em 07/10/2026

Base inicial consultada: main `c7aa1888dd16`, PRs #970/#982/#983/#1021 já incorporadas e interface autenticada de produção. As três correções de organização/diagnóstico acima integram a onda atual; merge e revisão servida devem ser confirmados na entrega. A onda paralela #1028 avançou main para `745ddb2d26e3` durante a validação, sem alterar o backend/Super Admin desta onda. A atualização paralela #1030 (`d826d89c867a`) também foi incorporada, preservando o fluxo de implantação. Carregamentos nas imagens não são falhas persistentes: prioridades e GitHub concluíram normalmente na consulta ao vivo.

- [x] Super Admin — horários operacionais: Início, lista e 360° reutilizam o conversor canônico de timestamps UTC legados, preservando offsets explícitos e sem transformar data inválida em horário atual.

### P0 — operação real antes de novos indicadores

- [ ] Revisar fila de impressão e agente da Quentinha (#6), incluindo falha antiga de 03/10; decidir documento por documento o que ainda deve ser impresso. Não reenviar em lote nem apagar histórico. Papel e alerta sonoro continuam validação manual.
- [ ] Reconciliar os documentos de impressão do D8 (#8) na fonte corrigida. A interface chegou a mostrar fila zero/nenhum agente às 01:57, mas a investigação confirmou HTTP 404 por consulta fora do escopo do tenant. Essa leitura não prova fila vazia e não encerra os 14 alertas vistos inicialmente. Nenhuma ação de impressão foi executada nesta onda.
- [x] Super Admin — acesso ao diagnóstico: consultas de impressão, links e tarefas aplicam o escopo do restaurante antes da primeira leitura. Erros e respostas inválidas mostram fonte não verificada e valores indisponíveis; sincronização de tarefas libera SQL antes de aguardar o Linear.
- [ ] Revisar blockers canônicos e liberação da Espetaria (#7). Somente o responsável pode confirmar que a implantação está pronta; ausência de atividade não comprova falha.

### P1 — fechar integrações e trabalho paralelo com evidência

- [x] Impressão no 360° já tem diagnóstico de agente/fila e links operacionais em #1021; não criar outro executor ou painel concorrente.
- [x] Linear/PostHog já têm registry, links e rastreabilidade por restaurante em #1021; não reimplementar KOM-8/9/10.
- [ ] Validar a utilidade do dashboard PostHog com eventos de negócio reais e janela explícita. Projeto conectado: KÔMA Production `648305`; consulta de erros ativos de sete dias retornou vazia em 07/10, sem provar ausência de falhas. Dados de teste do tenant #8 estão excluídos por padrão no projeto; respeitar esse filtro e explicitar quando comparar esse restaurante.
- [ ] Integrar a onda de CRM pós-evento em uma única implementação: #1026 e #1027 estão abertas e sobrepõem painel/rotas/migração. Preservar essa tarefa paralela, reconciliar as duas antes de merge e não duplicar schema.
- [x] Telegram: bot, destino e participação verificados por leitura em produção em 07/10 às 01:51 (Fortaleza). Nenhuma mensagem enviada; entrega continua não testada.
- [ ] Habilitar acesso do backend ao Linear se a criação de issues dentro do KÔMA for usada: registry atual informa `LINEAR_API_KEY` ausente. Plugin conectado no Codex não configura o runtime do produto.
- [ ] Investigar consulta administrativa do Resend que retornou HTTP 401 nesta leitura. A falha da consulta não confirma falha de entrega de e-mails; validar credencial/permissão e evidência de envio antes de alterar o fluxo.

### P2 — eficiência e redução de ruído

- [ ] Consolidar informações repetidas entre Início, Saúde e Integrações somente quando cada remoção preservar estado, evidência e próximo passo. Catálogo de taxas e referência mensal não representam receita recebida.
- [ ] Agrupar visualmente incidentes repetidos na central com expansão por documento, preservando executores individuais e tenant; medir ganho antes de adicionar novos indicadores.
- [ ] Medir duração/volume das consultas do diagnóstico antes de adicionar cache; manter atualização por navegação/ação, sem polling, novos serviços pagos ou consultas analíticas no banco operacional.

## Regra de execução — modo ondas

1. Partir sempre da `main` mais recente.
2. Cada rodada deve resolver **um fluxo inteiro**, agrupando de 2 a 4 melhorias coerentes no mesmo owner/PR; micro-PR só quando houver risco financeiro, tenant, estoque, migração ou irreversibilidade.
3. O ChatGPT implementa o máximo possível primeiro. O Gemini recebe apenas teste visual/click-through ou uma correção concreta que dependa do navegador dele; nada de auditoria passiva ou ping-pong.
4. Rodar unit/typecheck/build/E2E relevantes **uma vez por onda**, não uma vez por microajuste.
5. Mergear somente com CI verde e head estável. Depois do merge, o Gemini testa a onda concluída enquanto o ChatGPT já avança para a próxima frente sem sobreposição de arquivos.
6. Achados manuais entram na próxima onda do mesmo fluxo; não reabrir uma sequência de PRs microscópicos salvo regressão crítica.
