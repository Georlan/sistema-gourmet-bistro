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
- [x] Onboarding — essenciais: dados e horários são salvos na implantação canônica, com confirmação de prontidão, proteção de alterações e passagem para revisão KÔMA (#1030). Arquivo de cardápio recebido não conclui catálogo; a liberação explícita permanece necessária.
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

## Super Admin — controle do proprietário, revisão de 09/10/2026

Esta onda parte da main `c6c030a2` e preserva as atualizações paralelas. Os itens abaixo descrevem implementação e verificações desta branch; merge e publicação exigem checks verdes e revisão servida. A reconciliação de 08/10 permanece abaixo como histórico.

### Entregue nesta onda

- [x] Expor **Recursos e exceções** na ficha 360°: liberar, bloquear ou seguir o plano para uma loja, mostrando antes/depois e exigindo motivo. Reutiliza o executor canônico e a auditoria; não muda plano nem cobrança. Proteção contra clique duplicado e teste de concessão/revogação/restauração.
- [x] Abrir diretamente os controles autenticados por `?tenant=ID&panel=resources`, a ficha por `?tenant=ID` e o financeiro por `?panel=finance`. O atalho de recursos evita carregar as demais consultas da ficha. O link não realiza alterações nem dispensa autenticação.
- [x] Unificar os atalhos de suporte do cockpit com a árvore canônica do Caixa; preservar aliases válidos e o fluxo auditado de suporte, sem encaminhar a sessão para outro domínio.
- [x] Substituir a referência de catálogo no Início por acesso ao **Financeiro KÔMA**. Catálogo continua disponível, recolhido e identificado como referência comercial.
- [x] Apurar faturas consolidadas KÔMA recebidas no mês por `paid_at`, com corte de Fortaleza, e valores em aberto da competência. Não somar vendas dos restaurantes ou preços do catálogo como receita.
- [x] Registrar custos mensais em reais (ChatGPT, banco, Railway, ferramentas/domínio, impostos/tarifas e outros), com responsável, motivo e evidência antes/depois. Campo vazio é desconhecido; zero precisa ser confirmado. O resultado permanece incompleto enquanto houver custos desconhecidos e explicita recebimentos externos não cobertos.
- [x] Proteger os custos em tabelas privadas: ENABLE/FORCE RLS, sem acesso `anon`/`authenticated`, acesso mínimo do backend e auditoria sem UPDATE/DELETE para a role da aplicação. Migração e permissões exercitadas em PostgreSQL isolado, sem dados de produção.
- [x] Remover o segundo inventário de credenciais em Integrações e sua consulta redundante. Manter diagnóstico Telegram; mover consultas opcionais de hospedagem/DNS para seção recolhida da Saúde.
- [x] Corrigir a classificação do Resend: uma leitura administrativa rejeitada fica não verificada, não prova falha de envio; resposta administrativa positiva também não prova entrega de e-mail. Nenhum e-mail de teste enviado.
- [x] Conferir PostHog pelo plugin no projeto KÔMA Production `648305`, janela de sete dias e exclusão padrão de contas internas/testes: há eventos recentes de cardápio e envio de pedido. Isso não habilita uma credencial de consulta no backend.
- [x] Reconsultar Telegram por leitura em produção em 09/10 às 09:42 (Fortaleza): bot, destino e participação verificados. Entrega continua não testada.

- [x] Reconciliar novas entregas paralelas de impressão: #1052 reduz reconexões da wake stream e #1054 limita retries de heartbeat/claim; incorporadas na main em 09/10. São mudanças do agente local e não encerram incidentes sem atualização do aparelho e prova física.

### Prioridades que continuam abertas

- [ ] **P0 — impressão:** em 09/10 a central mostrou três incidentes altos: falha antiga de documento da Quentinha #6 e agentes sem heartbeat nas lojas #6/#8. A redução de 16 para 3 alertas não prova impressão física. Reconsultar fonte, corrigir o agente local e decidir cada documento; não reenviar nem encerrar em lote.
- [ ] **P0 — implantação:** revisar os blockers e a liberação comercial da Espetaria #7 com o responsável. Não liberar por ausência de incidentes.
- [ ] **P1 — resultado financeiro completo:** informar os valores reais dos custos e reconciliar recebimentos recorrentes/avulsos externos à fatura consolidada. A busca no histórico acessível não localizou os valores de ChatGPT/banco/Railway; não preencher preços presumidos. O painel entregue calcula resultado registrado, sem afirmar lucro total.
- [ ] **P1 — integrações necessárias:** habilitar credencial mínima do backend para Linear/PostHog somente se as consultas/ações dentro do painel forem usadas. Railway e DNS Cloudflare são consultas administrativas opcionais, não requisitos de disponibilidade. Não reutilizar credenciais OAuth do plugin como segredo do produto.
- [ ] **P1 — canais:** diagnosticar a instância Evolution/WhatsApp que continua em `close`, preservando a instância pessoal; confirmar entrega dos avisos existentes de leads/cobrança por recibos, sem novos envios para testar. Resend com leitura não verificada não deve provocar troca de chave de envio funcional.
- [ ] **P2 — simplicidade:** agrupar incidentes na central sem esconder evidências/executores por documento e medir consultas antes de cache/polling. Os atalhos financeiros e de recursos não criam serviços pagos adicionais.

Guia de operação e limites: [controle do proprietário](../operations/super-admin-owner-controls.md).

## Super Admin — prioridades reconciliadas em 08/10/2026

Base desta reconciliação: main `8a7dd7c22e76`, comparada à entrega #1033 (`366b6f39696f`). Código, contratos/documentação e PRs incorporadas foram conferidos. Leitura pública em 08/10: frontend `8a7dd7c22e76`; backend `/health/ready` respondeu 200, banco saudável e revisão `ce90157fc2e8` (#1048). A diferença corresponde à #1049, que altera apenas frontend/teste. Esta revisão da tasklist não repetiu diagnóstico autenticado dos tenants, pagamentos, mensagens ou testes físicos: observações operacionais de 07/10 abaixo são históricas e precisam de nova leitura antes de execução.

A entrega #1029 continua incorporada: diagnóstico sob escopo do tenant, estados desconhecidos explícitos e resumo agrupado. Na validação de 07/10, backend/frontend serviram `83cfcf4a5eae`; smoke GET/OPTIONS e checks passaram, com 2184 testes de backend, 962 unitários e 32 de navegador. Esses números pertencem àquela entrega, não à main atual.

### Mudanças incorporadas desde a última rodada

- [x] CRM de leads e aquisição Siará: #1026, #1035, #1041 e #1044 incorporaram acompanhamento comercial, origem/evento, QR e captação de demonstração persistida no CRM. Avisos por e-mail/Telegram reutilizam a fila existente, com deduplicação; código enfileirado não comprova entrega real.
- [x] Multilojas: #1043/#1045 implementaram rede explícita, unidade matriz e autorização por gestor/direção em Equipe do 360°. O seletor mostra somente unidades autorizadas; vincular uma loja à rede não concede acesso automaticamente. Não criar outro cadastro ou inferir rede por e-mail/ID.
- [x] Cobrança no Super Admin: #1046 adicionou situação da assinatura/faturas, restrição de novas vendas e histórico das últimas 24 competências por restaurante. Fatura KÔMA e recebimento das vendas continuam distintos; ausência de fatura não comprova pagamento.
- [x] Pix próprio: #1047 acrescentou liberação explícita para lojas de teste sem contrato; #1049 corrigiu QR e confirmação manual ao reabrir pagamento. A chave própria permanece manual; esta reconciliação não autoriza movimentação financeira ou ativação de tenants.
- [x] Pocket Android: #1048 incorporou ativação de avisos por aparelho e preparo móvel legível usando a outbox existente. A allowlist vazia mantém o recurso desativado; recebimento na tela bloqueada depende de Android real, e tenant #6 ficou fora da ativação dessa entrega.
- [x] Segurança: #999/#1031/#1034 incorporaram hardening, isolamento de notificações WhatsApp e proteção dos contatos globais. Pendências de manutenção continuam no tracker canônico `docs/security/tenant-boundaries-20261007.md`.
- [x] Operação cotidiana: #1036/#1038 recuperaram avisos discretos de mesa compartilhada e corrigiram rodapé/escolhas obrigatórias; #1039/#1040 corrigiram troco solicitado, fila de aceitação concluída e contraste de avisos. Isso não encerra a onda de pagamento/fechamento do Garçom.

- [x] Super Admin — horários operacionais: Início, lista e 360° reutilizam o conversor canônico de timestamps UTC legados, preservando offsets explícitos e sem transformar data inválida em horário atual.

### P0 — operação real antes de novos indicadores

- [ ] Revisar fila de impressão e agente da Quentinha (#6), incluindo falha antiga de 03/10 e os dois agentes sem heartbeat vistos em 07/10 às 02:34; reconsultar a fonte antes de decidir o que ainda existe; decidir documento por documento o que ainda deve ser impresso. Não reenviar em lote nem apagar histórico. Papel e alerta sonoro continuam validação manual.
- [x] Reconciliar a leitura da fila do D8 (#8): após a correção publicada, o diagnóstico autenticado retornou pendentes=0, em processo=0, falhas=0 e nenhum incidente atual. O agente `desktop-0BRBobKlLYTz` estava configurado, com heartbeat de 26 segundos. Os 14 alertas iniciais não estavam mais presentes; esta onda não alterou documentos nem atribui sua resolução à mudança de interface.
- [ ] D8 (#8): verificar falha local de impressão apesar de heartbeat recente (estado degradado, “Falha ao enviar à impressora local.”) e concluir o primeiro pedido de teste indicado pela fonte de implantação. Fila vazia não comprova impressão física.
- [x] Super Admin — acesso ao diagnóstico: consultas de impressão, links e tarefas aplicam o escopo do restaurante antes da primeira leitura. Erros e respostas inválidas mostram fonte não verificada e valores indisponíveis; sincronização de tarefas libera SQL antes de aguardar o Linear.
- [ ] Revisar blockers canônicos e liberação da Espetaria (#7). Somente o responsável pode confirmar que a implantação está pronta; ausência de atividade não comprova falha.

### P1 — fechar integrações e trabalho paralelo com evidência

- [ ] Homologar cobrança/Pix por etapas: conferir migração publicada, vencimento contratual e allowlists apenas de lojas autorizadas; validar demonstrativo, confirmação de fatura no gateway, desbloqueio e entrega dos avisos. Não ativar `DIRECT_PIX_BILLING_TENANT_IDS` ou `DIRECT_PIX_TEST_TENANT_IDS` nesta reconciliação. Pix próprio não possui confirmação bancária automática.
- [ ] Validar rede/unidades com um gestor autorizado: ida/retorno, cancelamento, revogação e isolamento entre abas. Conservar lojas independentes e tenant #6; não vincular unidades apenas para testar.
- [ ] Validar alertas Pocket em aparelho Android real autorizado, incluindo tela bloqueada, permissão e ausência de duplicação; só depois decidir ativação por loja. WhatsApp Business é outra implantação e não deve substituir a instância pessoal existente.
- [ ] Homologar avisos de leads e cobrança usando evidência da fila/recibo e canal correto; evitar novo envio apenas para verificar. O teste de bot em 07/10 não comprova os novos fluxos de #1044/#1046.

- [ ] Incorporar falhas atuais de diagnóstico da impressora à fonte canônica de incidentes/atenção. No D8, o cartão de impressão mostrou estado degradado por erro local, enquanto a lista de incidentes retornou vazia; centralizar essa evidência no owner de incidentes, reutilizando a leitura existente de agentes e preservando a distinção entre fila e impressão física.

- [x] Impressão no 360° já tem diagnóstico de agente/fila e links operacionais em #1021; não criar outro executor ou painel concorrente.
- [x] Linear/PostHog já têm registry, links e rastreabilidade por restaurante em #1021; não reimplementar KOM-8/9/10.
- [ ] Validar a utilidade do dashboard PostHog com eventos de negócio reais e janela explícita. Projeto conectado: KÔMA Production `648305`; consulta de erros ativos de sete dias retornou vazia em 07/10, sem provar ausência de falhas. Na consulta de 07/10, dados de teste do tenant #8 estavam excluídos por padrão no projeto; respeitar esse filtro e explicitar quando comparar esse restaurante.
- [ ] Reconciliar a PR #1027 com a implementação de CRM #1026 já incorporada em `2fd88b38875d` e preservada na rodada de segurança. #1027 segue aberta; revisar diferenças úteis sem duplicar painel, rotas ou schema.
- [x] Telegram: bot, destino e participação verificados por leitura em produção em 07/10 às 01:51 (Fortaleza). Nenhuma mensagem enviada; entrega continua não testada.
- [ ] Habilitar acesso do backend ao Linear se a criação de issues dentro do KÔMA for usada: a última leitura autenticada de 07/10 informou `LINEAR_API_KEY` ausente; reconsultar antes de configurar. Plugin conectado no Codex não configura o runtime do produto.
- [ ] Reavaliar a consulta administrativa do Resend que retornou HTTP 401 em 07/10, separando permissão de consulta e permissão de envio. Não trocar uma chave de envio funcional para corrigir leitura administrativa sem necessidade; os novos avisos exigem prova de entrega própria.

### P2 — eficiência e redução de ruído

- [ ] Reconciliar PRs sobrepostas antes de outra implementação: #1027 frente ao CRM incorporado; #1037 frente ao rodapé/escolhas já entregues em #1038; #1022 frente à ordenação canônica #1025. #1042 (pagamento dividido) continua aberta e não é funcionalidade entregue. As ondas #1006 (impressão) e #1010/#1011/#1012 (entrega/atribuição) também permanecem abertas; revisar diferenças e checks sem merge em lote ou encerramento automático.
- [ ] Revisar as novas telas de cobrança/rede/leads pela regra Estado → Evidência → Próximo passo, preservando paginação limitada e atualização por navegação/ação; padronizar datas pelo conversor canônico antes de acrescentar métricas.

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

## Segurança e RLS — rodada publicada em 07/10/2026

Evidência canônica: [contrato, simulações e publicação](../security/tenant-boundaries-20261007.md).
Backend servido `be7c39639867`, após publicação compatível em duas etapas.

- [x] Restringir contatos e impressão do evento ao Super Admin; preservar CRM paralelo e proteger contatos existentes de alterações por reenvio público.
- [x] Preparar lookup mínimo para callbacks assinados e ativar ENABLE/FORCE RLS nas notificações WhatsApp, com leitura/escrita cross-tenant bloqueadas nas simulações PostgreSQL.
- [x] Revogar grants/policies browser legados, preservando o cardápio pela API.
- [x] Manter SQL do callback fora do event loop; testar resposta concorrente, replay, contexto e estado monotônico.
- [x] Corrigir dependências vulneráveis, limitar importação XML e publicar scans de dependências/segredos. PRs #1031/#999 incorporadas; #1032 encerrada como incluída em #999.
- [x] Confirmar versão servida, migração/policy reais e saúde passiva, sem QA destrutivo no D6. Cadastro e contagens preservados; cardápio HTTP 200.
- [ ] Ensaiar restauração do backup em banco isolado.
- [ ] Medir capacidade sob carga multitenant fora do D6; preservar orçamento de conexões e validar overlap de deploy antes de aumentar workers/réplicas.

As pendências de impressão física, incidentes e integrações acima não são encerradas por esta rodada de segurança.
