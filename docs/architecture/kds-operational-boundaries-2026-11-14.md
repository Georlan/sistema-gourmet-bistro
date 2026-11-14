# KÔMA — KDS: limites operacionais e evolução segura

Data: 14/11/2026
Origem: revisão de código em main, regras do AGENTS.md, documentos de ciclo canônico e padrões publicados de KDS. Não houve cópia de código de terceiros.

## Fonte de verdade e consumidores

- A unidade de produção é o Item, vinculado a um Lancamento (Pedido), vinculado à Comanda. A tela de cozinha não administra a Comanda, a Mesa, a cobrança nem o delivery.
- A mesma apresentação CashierKitchen atende a entrada standalone KitchenPanel (papel cozinha) e a aba Cozinha do Caixa. As transições usam o mesmo backend, sem duplicar máquina de estados.
- A projeção kdsProjection agrupa pelo lançamento persistido, ordena FIFO e separa itens preparando/pronto. O backend pode confirmar um lançamento em uma transação (máximo 40 IDs, mesmo lançamento, tenant único e bloqueio de Comanda).
- A expedição, a baixa de serviço, a retirada, o despacho e o fechamento continuam nos módulos canônicos de Caixa, Salão e Entregas. PRONTO do item não significa ENTREGA efetuada ou pagamento liquidado.
- A fila é atualizada por WebSocket e fallback de polling já existente. A ação Atualizar fila solicita uma nova leitura canônica; seu acionamento não prova sincronização bem-sucedida. O banner offline indica apenas conectividade do dispositivo, nunca saúde da API.

## Correções de segurança, coerência e operação neste PR

1. Cozinha pode pedir apenas pronto na rota genérica de status de item. Um replay do item já pronto preserva a conciliação de lifecycle canônico; não reinicia o preparo. Itens entregues/cancelados não voltam a pronto pelo operador da cozinha.
2. Não aceitar preparo da cozinha em Comanda fechada, pendente de aprovação, recusada, despachada ou finalizada. A validação ocorre no backend mesmo se a tela estiver desatualizada.
3. Separar a permissão pedidos:operar_logistica para status de entrega, listagem/associação/reassociação de entregadores e despacho. Apenas admin, gerente e caixa retêm essa capacidade.
4. A regra de elegibilidade da projeção da cozinha exclui pedidos despachados/finalizados, alinhada às rotas de preparo. Pedidos já prontos e ainda à espera de retirada/serviço continuam em Prontos para conferência.
5. Operadores de cozinha e caixa podem solicitar refresh da fila pelo menu da mesma tela; a ação é somente leitura. Em dispositivo offline, informar explicitamente que a fila pode estar desatualizada.

## Não implementado deliberadamente

- Estações por produto, timers de início real de preparo, metas de SLA, priorização por prazo, alertas sonoros e um novo estado persistente de expedição. Todos exigem decisões de produto/armazenamento e testes próprios; não inferir dados que não existem.
- Alterações de pagamento, esquema de itens, status financeiro, delivery ou impressão física.
- Novos serviços, Redis, filas/DB paralelos, polling mais agressivo ou dependências de KDS externos.

## Referências de arquitetura (ideias, não dependências)

- Toast KDS e Square KDS: separação de produção/expedição, visão de quantidade total e ferramentas de recuperação. Usar essas referências como hipóteses de operação, não copiar interfaces nem supor que todo restaurante precisa de estações.
- OpenKDS (BenClementt/OpenKDS): separação API, UI e estações; repositório GPL-3.0 com documentação incompleta. Não reutilizar código no produto.
- roobandev/kds-restaurant-system: exemplo de mensagens em tempo real com React e Django; não substituir transporte WebSocket existente por solução paralela.
- Design do KÔMA: docs/design-system/DESIGN_SYSTEM.md, docs/design/kds-raised-controls-2026-11-14.md e docs/architecture/product_intent_protection.md.

## Gates e rollback

- Backend: testes HTTP de autorização, tenant e transições de item; testes de ciclo e logística. Frontend: lint, unitários, build, Playwright em mobile/desktop, read-only refresh em ambos os papéis e regressões de lote/reconexão.
- Validar CI no SHA final, integrar por PR sem forçar, checar Cloudflare Pages, /meta.json e smoke público somente GET/OPTIONS.
- Sem schema/migração. Rollback técnico: revert do PR; não executar purge, pedidos ou pagamentos em produção.

## Próxima evolução sugerida (PRs separados)

A. Definir a responsabilidade operacional de conferência: quem confirma montagem, em que momento e qual status canônico recebe o evento. Sem esta decisão, não criar botão de despacho na cozinha.
B. Definir estação opcional e roteamento baseado em cadastro explícito, preservando fila única por padrão.
C. Adicionar timestamps reais de início e término, metas configuráveis e métricas. Tempo desde lançamento não é tempo efetivo de preparo.
D. Testar com cozinhas pequenas, tablet e desktop sob carga realista usando fixtures de homologação descartável; avaliar critérios de utilidade antes de automatizar priorização.

## Evidências de testes finais desta rodada

- Lint, build e 1.259 testes unitários frontend aprovados.
- Backend: 169/169 testes selecionados de autorização KDS, ciclo canônico, conversão delivery/retirada, entregadores e logística aprovados em banco SQLite isolado.
- Playwright: 18/18 em Chromium (mobile-390 e desktop-1366), 8/8 em Firefox-390. Incluem leitura manual sem PUT, indicador offline, autenticação cozinha standalone, lote atômico/retry, fila FIFO e modo foco.
- Suíte completa do backend (milhares de casos) não foi concluída nesta rodada. A execução antiga foi interrompida após mudança de código; não usar como evidência de gate. O CI deve validar o commit final antes do merge.
