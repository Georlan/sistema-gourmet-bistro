# Benchmark público — chat no cardápio online

Data da auditoria: 10/09/2026.

## Objetivo

Registrar um benchmark público e defensável para orientar a experiência de Pedido/Chat do KÔMA sem copiar interface, fluxo ou linguagem de concorrentes.

## Referência principal observada: Consumer / MenuDino

A documentação pública do MenuDino descreve um chat entre cliente e estabelecimento ligado ao pedido online. O botão do chat aparece para o cliente após o estabelecimento confirmar o pedido. No PDV, novas mensagens geram notificação, conversas recentes ficam no topo e conversas ainda não respondidas recebem destaque visual. A própria documentação também conecta o pedido recebido no site/app ao fluxo do Consumer Desktop e à atualização de status visível ao cliente.

Fontes públicas consultadas:

- https://ajuda.programaconsumer.com.br/como-usar-o-chat-do-menudino/
- https://ajuda.programaconsumer.com.br/como-receber-pedidos-do-menudino-no-consumer-desktop/

## Comparação de UX: MenuDino x KÔMA

| Dimensão | MenuDino documentado publicamente | KÔMA observado no repositório | Direção recomendada |
|---|---|---|---|
| Entrada no chat | Disponível após confirmação do pedido | Chat ligado ao pedido e acessível pelo header, drawer e atalho flutuante quando há tracking | Manter chat como extensão do pedido, nunca como canal solto |
| Contexto do pedido | Conversa associada ao pedido | Drawer mostra número, status, timeline e conversa | Preservar contexto visível durante toda a conversa |
| Novas mensagens | Notificação no PDV e destaque de não respondidas | Contagem local de não lidas e prioridade para conversa com resposta | Reforçar hierarquia visual sem aumentar ruído |
| Status | Cliente acompanha alterações do delivery | KÔMA já combina acompanhamento e chat no mesmo drawer | Tratar status e conversa como uma única jornada |
| Permanência no cardápio | Site/app mantém experiência própria | Link legado restaura o pedido e retorna ao cardápio; drawer abre sem sair da página | Esse é um diferencial central e deve permanecer explícito |
| Canal externo obrigatório | Não para o chat nativo documentado | Não: WhatsApp não é requisito para comprar nem conversar sobre o pedido | Preservar independência de WhatsApp |

## Diferenciais defensáveis do KÔMA

O KÔMA **não deve** se posicionar como “o único cardápio com chat”, porque há concorrentes com recurso equivalente. A formulação defensável é mais específica:

> Pedido, acompanhamento de status e conversa com o restaurante no mesmo fluxo, sem sair do cardápio e sem exigir WhatsApp.

Diferenciais que o repositório já sustenta ou que são alvo direto de UX, sem depender de alegações exclusivas de mercado:

1. **Conversa contextual ao pedido** — o chat é aberto a partir de um pedido identificado, não como atendimento genérico.
2. **Acompanhamento + chat no mesmo drawer** — timeline/status e mensagens pertencem à mesma jornada visual.
3. **Retorno por link/push ao pedido correto** — o cardápio consegue restaurar o contexto do pedido em vez de navegar para uma página paralela desconectada.
4. **Sem WhatsApp obrigatório** — compra e acompanhamento continuam dentro da experiência própria do restaurante.
5. **Priorização de resposta** — mensagens não lidas elevam a conversa relevante e recebem destaque.

## Limites desta comparação

- Esta auditoria usa somente documentação pública acessível em 10/09/2026; não afirma paridade com versões privadas, recursos não documentados ou planos futuros dos concorrentes.
- Não copiar componentes, aparência, textos ou interações proprietárias do MenuDino.
- O benchmark serve apenas para validar problemas de UX e oportunidades de clareza.
