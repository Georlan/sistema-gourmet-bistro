# Prompt — integração Caixa, Entregador e Cardápio KÔMA

Trabalhe no repositório Georlan/sistema-gourmet-bistro. Primeiro consulte a main remota, o PR/branch do novo app de entregador e os trabalhos ativos para não duplicar mudanças. O trabalho de substituição está na branch design/courier-refinement-20261025; verifique se já foi integrado antes de criar sua branch a partir da main atual. Não parta de um snapshot antigo nem sobrescreva trabalho paralelo.

## Objetivo

Consolidar a integração operacional entre Caixa, app de entregador e acompanhamento do cliente. O novo app aprovado é a única apresentação da rota /entregador; preserve seu visual, uma coluna no celular, assets oficiais, hierarquia, poucos textos e ações simples. Não crie outro app, endpoint paralelo de pedidos, banco, cache ou infraestrutura por tenant.

## Regras já decididas

- O app mostra somente entregas atribuídas ao entregador e efetivamente despachadas pelo Caixa. Não mostra retirada, fila de prontos nem entregas de colegas.
- Pago e entregue são dimensões independentes. Pedidos pagos também exigem código quando o contrato KÔMA o prevê.
- Códigos KÔMA novos têm três números, com zeros iniciais. Códigos antigos de quatro números continuam válidos. O cliente recebe o código; o painel do entregador recebe somente a exigência/comprimento. Validação no backend após tenant, entregador, atribuição, despacho e lock da comanda, com limite de tentativas.
- Confirmar a entrega avança o estado no Caixa por eventos existentes. Não registra pagamento fictício. Se há saldo, a entrega fica concluída operacionalmente e aberta financeiramente na última coluna do Caixa, para registrar a forma de pagamento. Não cobrar novamente pedidos integralmente pagos online.
- Cliente já pagou e perdeu acesso ao código: somente o Caixa poderá autorizar uma exceção com permissão, motivo e autoria registrados. Essa autorização excepcional ainda precisa ser projetada/implementada; não presumir que já existe um fluxo próprio porque o Caixa possui ações de conclusão.
- Pedidos externos inseridos/atribuídos pelo Caixa podem ser concluídos internamente no KÔMA. Isso não confirma entrega à plataforma nem autoriza mudar seu código. Logos/referências não comprovam integração iFood, 99Food ou Keeta; conectores e homologações estão pendentes.
- Cliente ausente, endereço errado ou problema de pagamento: avisar o Caixa e manter a entrega, sem cancelar automaticamente. Fluxo de ocorrência ainda pendente.
- Cache offline guarda a última lista autorizada, cifrada e limitada ao acesso. Não guarda código digitado, telefone do cliente ou trilha GPS. Não enfileirar/repetir POST de conclusão offline. Reconectar e reconciliar antes de permitir nova confirmação.
- WebSocket dedicado tenant+entregador: hints mínimos após commit, reler com coalescência/backoff, revogação e reatribuição invalidam a lista. Caixa usa os eventos existentes. Nada de polling agressivo.
- Maps abre externamente. Ordenação automática é geográfica, executada localmente após toque e permissão do GPS; não é otimização por trânsito nem rastreamento contínuo.

## Onde começar

Leia AGENTS.md, docs/architecture/courier-handoff.md e docs/engineering/route-ownership.md. Inspecione src/components/MotoboyPwaPage.tsx, src/components/courier/, src/components/caixa/orders/, src/cardapio/, backend/app/routes/orders.py, orders_core.py, order_tracking.py, services/courier_order_projection.py, delivery_receipts.py, courier_realtime.py, application/orders/lifecycle.py e os testes correspondentes. Não leia todo o repositório antes de agir.

## Execução esperada

Mapeie responsabilidades e lacunas, faça somente perguntas que decidam uma regra ainda aberta e implemente em fatias pequenas com testes. Priorize uma jornada real isolada: criar pedido no Cardápio → pagamento online ou na entrega → atribuir/despachar no Caixa → receber no app sem refresh → cliente consultar código → entregador confirmar → Caixa avançar → receber saldo quando necessário. Cubra cancelamento, reatribuição, acesso vencido/revogado, perda de rede, retorno, código errado, duplo toque, retry com resposta incerta e isolamento entre tenants.

Não alterar nem testar com escrita no tenant 6. Tenant 8 também não é descartável. Use fixtures e bancos locais isolados, sem provedores/WhatsApp reais e sem custo novo. Preserve identidade persistida do pedido e contratos financeiros. Faça revisão, PR e CI; não faça merge/publicação sem autorização explícita. Ao final, separe código/testes/CI/merge/deploy/prova operacional e pendências. Evite auditoria infinita: implemente e demonstre a próxima fatia útil.
