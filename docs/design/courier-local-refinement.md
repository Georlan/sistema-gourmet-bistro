# Entregador — primeira versão local

Base: origin/main 2fa52fa6. Branch: design/courier-refinement-20261025.
Sem publicação, serviço pago ou dependência nova. Após a primeira proposta, um ajuste focal no backend restringe o painel a entregas atribuídas ao próprio entregador.

## Direção

Identidade comum KÔMA (Inter/Space Grotesk e tokens existentes), com o perfil de Operação. Uma marca completa, arte vetorial pequena de percurso e hierarquia: pedido/cliente → endereço → rota/ligação → cobrança → concluir. Itens e totais adicionais ficam no disclosure nativo “Ver pedido”. Sem mapa embutido, animações decorativas ou promessas de WhatsApp entregue.

O segundo toque de confirmação é local ao card, cancelável por botão ou Escape. Foco entra na confirmação e volta ao gatilho ao cancelar. É uma proposta para aprovação: evita concluir a entrega ao tentar abrir a rota.

## Contratos preservados

- Entrada `/entregador#token=…`, compatibilidade com query antiga e remoção do segredo da URL antes da primeira consulta.
- Token somente em sessionStorage da aba e header `X-Koma-Delivery-Token`; nenhum endereço em cache persistente.
- GET `/comandas/motoboys/painel-entregador` e POST `/comandas/motoboys/pedidos/{comanda_id}/confirmar-entrega`.
- Tenant, plano, revogação, atribuição e transição pertencem ao backend existente. Número humano recebido do servidor; sem inventar sufixos/identidades no frontend.
- Confirmar entrega não registra pagamento; valor a cobrar vem do backend. “Sem cobrança” não afirma que houve pagamento pelo aplicativo.

## Economia e resiliência

Sem timer de polling ou conexão nova. Consulta inicial, atualização manual e ao retornar para a aba/recuperar conexão, coalescidas e espaçadas por pelo menos 15 s nos eventos automáticos. A interface não afirma sincronização em tempo real.

GET e POST têm timeout de 12 s. Dados ficam na tela durante atualização, falhas transitórias preservam a lista, revogação apaga os dados exibidos. GET anterior é abortado antes de concluir uma entrega. Resposta de instância desmontada é descartada; listeners e timers são liberados.

Após POST com resultado desconhecido (timeout/rede), consulta a lista, sem repetir mutação. Se a consulta também falhar, bloqueia nova confirmação até uma leitura bem-sucedida. Não existe fila offline de conclusões.

## Pontos para a próxima integração

A consulta foi corrigida localmente para exigir tipo Delivery/Entrega e vínculo com o entregador do token. O teste reproduziu antes da correção a presença indevida de retirada, mesa e entrega sem atribuição; após a correção, somente as duas entregas próprias foram retornadas, preservando isolamento por tenant e excluindo outro entregador. A confirmação continua protegida no backend. O retorno atual também não informa restaurante nem confirmação de notificação WhatsApp, portanto não os inventamos na tela.

O canal WebSocket operacional usa identidade de operador; o link de entregador tem credencial própria. Não reutilizar token de funcionário nem assinar eventos de todo o restaurante para simular tempo real. Qualquer canal futuro exige escopo mínimo por tenant/entregador e medições, com autorização própria no backend.

Pendente aprovação: uso de várias entregas por viagem, preferência Maps/Waze, hierarquia visual e etapa de confirmação. Mantido Google Maps como comportamento existente nesta primeira versão, aguardando a preferência do usuário. Sem ordenação falsa de “melhor rota”: ordem do servidor preservada.

## Pesquisa aplicada

- NN/g, reconhecimento em vez de memorização: endereço e cobrança visíveis; detalhes opcionais. https://www.nngroup.com/articles/recognition-and-recall/
- W3C, WCAG 2.2: contraste, foco, estados acessíveis e alvos de toque de 44 px adotados como meta ergonômica (44 px é o critério enhanced, não o mínimo AA de 24 px). https://www.w3.org/TR/WCAG22/
- Google Maps URLs: navegação externa universal sem chave de API. https://developers.google.com/maps/documentation/urls/get-started
- MDN, Page Visibility: atualização orientada ao retorno, sem polling em segundo plano. https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API
- MDN, navigator.onLine não prova conexão com o servidor: evento é um sinal para tentar leitura, nunca bloqueia operações por si só. https://developer.mozilla.org/en-US/docs/Web/API/Navigator/onLine
- Uber, múltiplas entregas: identificação individual por pedido/cliente/endereço, sem misturar cobranças ou presumir otimização de rota. https://help.uber.com/en/driving-and-delivering/article/how-do-i-handle-multiple-deliveries-from-the-same-place----?nodeId=08189aec-c047-49f2-ba2a-64b216a4c3e5

Skills aplicadas: Frontend Design, UI/UX Pro Max e Vercel React Best Practices. Pesquisa direcionada, sem instalação nem assinatura de ferramentas.

## Validação

Prévia usa frontend real e uma API local simulada fora do repositório, aceitando somente identidades fictícias. Não comprova a integração operacional ponta a ponta. Regressões backend usam SQLite temporário com dotenv de produção desativado. Aprovação e integração real são etapas posteriores.

Resultados desta etapa: lint e build aprovados, 1.100 testes unitários, 30 cenários do novo painel em cinco larguras (360/390/430/768/1366), seis regressões de timeout/reload nas duas larguras principais e duas regressões backend aprovadas. Capturas locais de 320/390/768 em ambos os temas foram geradas; revisão visual corrigiu uma colisão entre título e arte em 320 px. Sem certificação da suíte backend completa ou jornada operacional real nesta rodada.


## Ajuste de escopo aprovado pelo usuário

O app conecta somente a entregas por motoboy; pedidos de retirada e mesa não aparecem. “Para sair” corresponde a uma entrega `pronto` já atribuída ao entregador; não é retirada pelo cliente. Filtros: Todas, Em rota e Para sair. Múltiplas entregas por viagem confirmadas pelo usuário; navegação permanece por link externo sem API paga.
