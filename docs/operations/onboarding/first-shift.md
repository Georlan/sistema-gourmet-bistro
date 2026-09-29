# Pedido de homologação, Caixa e primeiro turno

Execute depois da liberação operacional/trial. Combine valor e pagamento
controlado com o responsável. No tenant real, não cadastrar catálogo fictício
nem apagar transações para limpar homologação; identificar o pedido de teste e
seguir cancelamento/estorno canônico quando necessário.

## Abrir Caixa

1. Entre como operador autorizado em **Caixa → Turno atual** e clique **Abrir caixa**.
2. Conte dinheiro inicial, informe **Fundo de Troco Inicial (R$)** e clique **Confirmar Abertura**.
3. Confira estado aberto, operador e horário; registre ID do turno e fundo no relatório.
4. Não avance se outro turno estiver aberto, houver erro de acesso ou valor não corresponder ao dinheiro físico.

## Homologar um pedido

1. Em **Configurações → Implantação inicial**, use a ação de pedido de teste após liberação. Ela identifica a prova de prontidão; completar pagamento e fechamento, não apenas criar pedido.
2. Em **Vendas → Novo pedido**, escolha modalidade usada, produto/adicional/observação e confira total antes de enviar.
3. Abra o link de **Cardápio online → Divulgação** no celular e faça um segundo pedido controlado de retirada/delivery quando usados. Com apenas Dinheiro configurado, confira que só Dinheiro aparece em sacola e revisão.
4. Confira pedido chegando em **Vendas → Pedidos**, cliente/modalidade/valor, andamento de preparo e entrega. No Pocket com papel, confira cupons; não exigir KDS pago fora do escopo.
5. Receba no Caixa pelo meio real: Dinheiro com troco, Pix após confirmar transferência ou cartão externo após aprovação na maquininha. Não simular Mercado Pago como obrigatório.
6. Confira saldo zerado, pedido/conta pagos e fechados, estado final e registro do recebimento. Guarde ID do pedido, pagamento, turno e PrintJobs.
7. Se salão/divisão de conta fizerem parte da operação, execute os casos aplicáveis do [aceite canônico](../first-client-acceptance.md).

Não avance se total/troco divergir, pedido duplicar, conta ficar aberta depois de
pagamento, transação perder estado ou cupom faltar quando papel for necessário.

## Fechar Caixa

1. Em **Caixa → Movimentações**, confira sangrias/suprimentos reais com motivo e responsável; não registrar ajuste para esconder divergência.
2. Abra **Caixa → Fechamento**, escolha **Conferência cega** e conte dinheiro físico; declare recebimentos por meio com os comprovantes correspondentes.
3. Revise pendências exibidas e confirme em **Fechar caixa**. Não ignorar trava de pagamentos/pedidos pendentes.
4. Confira fechamento concluído e compare total vendido/recebido com dinheiro, Pix externo e cartões. Guarde relatório e diferença.
5. Divergência sem explicação impede aceite; investigar pelo runbook e repetir o bloco afetado após correção.

## Primeiro turno acompanhado

- O operador abre, cria, acompanha, recebe e fecha sem depender de você clicar.
- Validar cada modalidade habilitada, adicional/observação, cancelamento aplicável e reconexão.
- Conferir fila de preparo/impresso sem perda ou duplicidade.
- Validar catálogo em horário fechado sem esconder produtos; pedidos imediatos bloqueados na política Automático. Restaurar configuração real.
- Fechar e conciliar o turno inteiro. Recursos não contratados são NÃO APLICÁVEIS com justificativa.

Use os critérios do [aceite](../first-client-acceptance.md); aprovar somente os
blocos efetivamente executados com evidência.
