# KDS KÔMA — Fila única de produção e sincronização operacional

## Objetivo

Reconstruir a experiência de Cozinha para funcionar no celular e em monitor, priorizando tickets, tempo de espera, itens e ações seguras, sem reproduzir o Kanban financeiro nem criar um novo estado de pedidos.

## Alternativas

1. Apenas cosmética sobre CashierKitchen: risco baixo, não resolve a divergência entre os dois portais nem erros parciais.
2. Nova máquina de estados/KDS service: oneroso, conflita com o ciclo do pedido, teste e permissão; descartado.
3. **Escolhida — projeção canônica e apresentação compartilhada:** os dois portais usam agrupamento por lançamento; mudanças de item usam a rota autoritativa e opt-in de avanço do ciclo; Kanban deriva os estados do mesmo snapshot. Não acrescentar serviços, tabelas ou polling.

## Comportamento

- Fila em ordem de chegada (identificador por lançamento; mesa, origem, autor e observações) e estados **em preparo** e **pronto para retirada pelo serviço** sem confundir pronto com entregue.
- Apenas `preparando → pronto` é ação de produção do KDS. A entrega pertence ao fluxo do Garçom/Retiradas/Entregas e nunca é marcada pela cozinha. O ticket pronto continua visível até ser consumido por esse fluxo.
- Mostrar tempo decorrido desde o lançamento, sem afirmar que mede exclusivamente o trabalho de preparo. Alertas de 10/15 min são avisos orientativos, não SLA por produto.
- Ações individuais com feedback de gravação; operação em lote interrompida em falha e exibe progresso/erro sem alegar sucesso total. Não ocultar falha via Promise.all.
- Cozinha do Caixa e conta de acesso Cozinha compartilham o mesmo componente visual e projeção, com adaptação mínima de callbacks; preservam permissões do backend.
- Interface sem banner gigante nem ilustração vazia, densidade por dispositivo, tipografia Inter/Space Grotesk, verde usado como ação e não decoração, resiliência a 320px, foco/teclado e movimento reduzido.

## Fonte e limites

`src/components/caixa/kitchen/{CashierKitchen.tsx,kdsProjection.ts,KitchenTimer.tsx}`, `src/components/KitchenPanel.tsx`, `src/components/caixa/orders/useCashierOrders.ts`, `src/App.tsx`, testes focais. Contratos preservados: `orders` do snapshot autenticado, IDs persistidos de lançamentos e itens, `PUT /comandas/itens/{id}/status?status=pronto&avancar_pedido=true`, Kanban derivado de `deliveryStatus`, RLS/tenant, preço e impressão. Não alterar backend, pagamentos, banco, endpoints ou o layout do Kanban financeiro.

## Verificação

Projeta mesma identidade por lançamento, ordenação determinística, tickets parciais e sincronização ready com Kanban; dois portais; falha de status e operação de lote; retorno de reconexão via snapshot existente; celular 320/390/430 e desktop; tema claro/escuro, sem overflow horizontal, pronto não é entregue. PR pequeno, checks verdes, deploy verificado via meta.json e smoke somente leitura.

## Implementação e achados de homologação

- `CashierKitchen` concentra apresentação e interação dos dois portais. `KitchenPanel` tornou-se adapter para a sessão do papel Cozinha, sem política própria ou segundo renderizador de tickets.
- `projectKdsTickets` preserva ordem de itens e ordena lançamentos por timestamp persistido; não sintetiza identificador de pedido a partir de UUID. Origem, mesa, tipo e aceitação são mantidos. Pedidos `pendente`, `analise` e `recusado` não entram na fila; `aceito` pode entrar com sinalização explícita, sem afirmar que foi iniciado.
- `getKdsWaitInfo` mede espera **desde o lançamento**, não tempo efetivo do cozinheiro. O KDS usa um único intervalo de 30 s, interrompido ao sair da tela, e atualização de visibilidade; o cronômetro anterior abria um intervalo de 1 s **por ticket**.
- `projectKdsDemand` agrupa apenas itens ainda em preparo com mesmo produto, nome, composição e observação. Sem substituições misturadas. Respeita contagem real de linhas de item persistidas.
- O backend `PUT /comandas/itens/{itemId}/status?status=pronto&avancar_pedido=true` continua autoridade. Ambos os portais passam o parâmetro explícito; o handler **aguarda o PUT e o snapshot** antes de mostrar o item pronto. Uma falha no backend não produz progresso otimista fictício. Uma falha no segundo item de uma ação em lote é reportada com a contagem confirmada e interrompe a operação.
- Item pronto permanece pronto; **nenhuma ação `entregue` existe no KDS**. Kanban, Retiradas, Entregas e Garçom controlam a próxima etapa pelo ciclo canônico. Não converter status pronto em pagamento/fechamento.
- CSS `kdsWorkspace.css` específico, Inter e Space Grotesk, estados claros, alvos de ação de pelo menos 44 px, sem banners, ilustrações decorativas ou cor neon espalhada. Sem novas dependências, tabelas ou polling de pedidos.

### Evidência e limitações

- Os testes sintéticos do KDS cobrem 320/360/390/430/768px + desktop, dark/light, identidade, FIFO, observações, busca, filtros, demanda com substituições, atualização autoritativa, roteamento para pronto e erro parcial em lote.
- Em execução ampliada de regressão local, alguns testes **legados não relacionados** de Cardápio, Relatórios, Estoque, Salão e Kanban ainda esperavam rótulos antigos ou controles substituídos por PRs anteriores. Reexecução de 2 testes no `origin/main` sem esta alteração reproduziu ambas as falhas; execução de outros 6 no baseline também reproduziu os 6 erros antigos. Não esconder testes nem alterar contratos financeiros para acomodar assertions obsoletos. Os novos testes do KDS e os checks de CI devem passar independentemente.
- **Não implementado:** roteamento por estações, operação offline autônoma, edição do pedido na cozinha, tempo real de cocção por item, SLA configurável por restaurante, reversão por tempo limitado após marcar pronto. Isso requer arquitetura/regras próprias e testes específicos antes de prometer suporte.
- Reversão por revert do PR, sem migração e sem impactar pagamentos, impressora, dados reais ou isolamento multi-tenant.
