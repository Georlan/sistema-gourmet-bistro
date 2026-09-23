# SmartPOS presencial com split — validação antes da integração

**Estado em 23/09/2026:** estudo técnico e comercial. Nenhum processamento presencial real ou divisão de recebíveis foi habilitado por este documento.

## Decisão de sequência

Validar primeiro se um parceiro oferece **pagamento presencial integrado com split ou remuneração contratual do KÔMA** para os restaurantes e terminais pretendidos. Só escolher o SDK, adaptar o backend ou publicar aplicativo no terminal depois de obter essa resposta por escrito. Um aplicativo instalado na maquininha, por si só, não dá ao KÔMA participação nas transações.

O primeiro candidato para a conversa comercial e um teste isolado é o **Stone Connect Split**: sua documentação pública descreve criação de pedido via API Pagar.me, regra de split no pedido, pagamento em terminal integrado e retorno por webhook. A documentação também restringe os dispositivos compatíveis e exige split na autorização. Isso demonstra uma rota técnica possível, **não** comprova aprovação comercial, tarifa ou elegibilidade do KÔMA. [Visão geral](https://connect-stone.stone.com.br/reference/vis%C3%A3o-geral-1) · [Split na criação do pedido](https://connect-stone.stone.com.br/reference/split-no-pedido) · [Dispositivos suportados](https://connect-stone.stone.com.br/reference/dispositivos-suportados-1).

O **PagBank** continua candidato porque o KÔMA já tem uma ponte Android orientada a ele. A [documentação de split do PagBank](https://developer.pagbank.com.br/reference/como-utilizar-a-divisao-de-pagamento) cobre a API de pedidos e certos meios de pagamento, mas **não demonstra** que a mesma remuneração esteja disponível para pagamentos feitos na SmartPOS via SDK. Essa ligação precisa ser confirmada com o PagBank antes de implementar a ponte real.

## O que já existe no KÔMA

| Camada | Evidência no código | Estado observado |
|---|---|---|
| Interface | `src/smartpos/SmartPosPage.tsx`, `SmartPosPaymentFlow.tsx` e fluxo no Caixa | Cria intenção de recebimento e apresenta modos integrado, externo e manual |
| Domínio financeiro | `backend/app/smartpos_models.py`, `smartpos_payment_state.py`, `smartpos_settlement.py` | Intenção vinculada a restaurante, turno, mesa, operador, chave de idempotência, provider, terminal e pagamento canônico |
| Provider | `backend/app/services/payment_providers/` | Contrato abstrato e simulador PagBank; nenhum adapter real encontrado |
| Terminal Android | `smartpos-android/` | APK de desenvolvimento e `FakeTerminalPaymentBridge`; sem cobrança real |
| Segurança de ativação | `registry.py` e `smartpos-android/README.md` | Provider desabilitado por padrão; simulador só disponível em desenvolvimento/teste |
| Monetização presencial | Busca em código SmartPOS por `split`, `application_fee`, `recipient`, `recebedor` e `revenue_share` | Nenhuma regra de divisão/receita presencial encontrada |

O registro de cartão recebido em **outra maquininha** é útil para o Caixa, mas não permite ao KÔMA comandar nem monetizar aquela transação. A intenção `provider_integrado` também não significa que exista processamento real: em produção, a disponibilidade do provider continua desabilitada com o código atual.

## Duas arquiteturas candidatas

### A. Integração pelo Caixa com terminal parceiro

`Caixa/SmartPOS web → PaymentIntent KÔMA → backend do parceiro com split → terminal integrado → webhook/consulta → PaymentIntent aprovado → pagamento canônico do Caixa`.

É a hipótese que testa mais cedo a monetização presencial, usando o domínio que já existe. Não exige publicar o APK Android do KÔMA na primeira prova. O conector deve ser específico do parceiro, mantendo o restante do domínio independente dele.

### B. Aplicativo KÔMA no SmartPOS

`APK KÔMA → SDK do adquirente → maquininha → resultado autenticado/reconciliado → backend KÔMA`.

O projeto Kotlin reduz trabalho de sessão, idempotência e recuperação local. Ainda faltam SDK real, homologação, distribuição, terminal físico e acordo de split/revenue share. Só priorizar se o parceiro confirmar a remuneração presencial e houver valor operacional claro em usar a tela do próprio terminal.

## Perguntas que precisam de resposta escrita do parceiro

1. O split ou revenue share vale para **débito, crédito à vista, parcelado e Pix presencial**? Quais modalidades ficam fora?
2. O KÔMA pode ser recebedor secundário em vendas de restaurantes terceiros? É necessária conta, cadastro, homologação, reserva ou volume mínimo?
3. A remuneração sai da venda do restaurante ou da margem comercial do parceiro? Quais são MDR, tarifa por transação, aluguel/compra do terminal, custo de split e prazo de repasse?
4. Quem responde por chargeback, fraude, estorno parcial e total, taxas de processamento e eventual saldo negativo? Como esses eventos revertem a parcela do KÔMA?
5. Qual dispositivo e versão de software suportam esse fluxo? Há sandbox, terminal de homologação, documentação de webhook e consulta de transação por referência estável?
6. O parceiro permite que o **PDV web** crie o pedido com split sem app próprio no terminal? Há aprovação e suporte para restaurante pequeno?
7. Como o parceiro fornece conciliação por transação e por recebedor? Quais identificadores devem ser persistidos no KÔMA?

Sem essas respostas, a economia e a arquitetura de produção permanecem **não determinadas**.

## Critérios do primeiro teste técnico

Fazer o primeiro experimento em sandbox e em branch separada, com um único parceiro:

1. Criar um pedido de valor conhecido, vinculado a `SmartPosPaymentIntent` e a um terminal específico.
2. Enviar regra de split calculada **no servidor** a partir de termos aceitos e congelados para o restaurante; a interface não define percentuais livremente.
3. Confirmar que um retry com a mesma chave não cria segunda cobrança. Timeout e reinício exigem consulta/reconciliação, nunca nova cobrança automática.
4. Tratar aprovação, recusa, pendência, cancelamento e estorno sem marcar a mesa como paga antes da confirmação confiável do parceiro.
5. Comparar pedido, transação externa, dois recebedores, tarifas e pagamento canônico do Caixa. A soma dos valores deve fechar em centavos.
6. Registrar referência e eventos externos suficientes para auditoria, preservando isolamento por restaurante e sem dados sensíveis de cartão.

**Saída do teste:** relatório com evidência de transação simulada, split observado no sandbox, conciliação e comportamento de falhas. Um teste de sandbox não autoriza cobrança real nem prova a condição comercial.

## Critérios do piloto real

Somente após contrato com o parceiro, preço aceito pelo restaurante, homologação e plano de suporte: **1 restaurante, 1 terminal, 1 caixa**. Conferir pagamento integral e parcial, reversão, queda de conexão, duplicidade, fechamento de turno e repasse efetivo para as duas contas. A rotina de conciliação deve mostrar separadamente valor bruto, tarifa do parceiro, valor do restaurante e remuneração KÔMA.

O [roadmap SmartPOS existente](../../ROADMAP_KOMA_SMARTPOS_ATOMICO.md) já coloca o primeiro provider real e o piloto após o contrato financeiro, a idempotência e a recuperação de falhas. Esta validação define o portão comercial do split antes de escolher qual adapter construir.
