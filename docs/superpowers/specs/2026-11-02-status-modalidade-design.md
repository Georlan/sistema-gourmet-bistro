# Avisos por modalidade no Cardápio e no WhatsApp

O cliente precisa saber o que já aconteceu e qual é o próximo passo. Os avisos devem vir do estado e da modalidade efetivos do pedido, mantendo pagamento separado de preparo e entrega. A implementação parte da main d4d6818b, que já contém o PR #1244; verificar novamente a main antes de criar branch.

## Abordagens

1. Ajustar apenas os textos da tela: mudança pequena, mas mantém mensagens e notificações divergentes.
2. **Recomendada:** alinhar os textos em um contrato consistente por modalidade e estado, usando os eventos e os canais já existentes. Aplicar ao acompanhamento, chat e mensagens elegíveis; conservar fallback compatível. Não criar infraestrutura nem ativar envios por conta própria.
3. Redesenhar todo o fluxo de notificações: mais abrangente, exige regras novas de frequência/consentimento e não é necessário para corrigir esta confusão.

## Texto proposto

| Estado confirmado | Retirada | Entrega |
|---|---|---|
| Recebido | Aguardando aceite | Aguardando aceite |
| Aceito | Pedido aceito · aguardando preparo | Pedido aceito · aguardando preparo |
| Em preparo, quando realmente informado | Em preparo | Em preparo |
| Pronto | Pronto para retirar — já pode buscar no restaurante | Pronto para sair — aguardando despacho |
| Despachado | Não se aplica | Saiu para entrega — aguarde a chegada |
| Concluído | Retirada concluída | Entrega concluída |
| Recusado/cancelado | Pedido não aceito / cancelado | Pedido não aceito / cancelado |

A jornada de consumo local deve ter texto adequado próprio; não presumir retirada. Pix pendente e falha de pagamento prevalecem conforme contrato atual, sem dizer que houve aceite ou preparo antes da confirmação.

## WhatsApp e outros avisos

Preservar mensagens existentes para pronto de retirada e despacho de entrega, consistentes com o acompanhamento; não enviar aviso de despacho ao ficar pronto e não tratar uma notificação aceita pelo provedor como entregue no aparelho. Manter consentimento, autorização do restaurante, deduplicação, limitação e verificação de estado mais recente. Sem novos tipos de mensagens nem aumento de frequência por padrão; push e eventos de chat devem ter rótulos coerentes quando usam o mesmo estado.

## Validação e integração

Cobrir por modalidade e estado, fallback e resumo canônico, pagamento pendente, eventos SSE e as restrições de WhatsApp com testes locais e dados isolados. Revisar desktop e celular, mantendo visual e trabalho do PR #1244; comparar estado e comportamento na main corrente, testar CI e revisão. Merge autorizado pelo usuário após checks obrigatórios verdes e ausência de conflito com trabalho paralelo; não modificar configurações de produção nem disparar WhatsApp real para teste. Confirmar publicação e versão servida separadamente, sem assumir que merge demonstra entrega física.
