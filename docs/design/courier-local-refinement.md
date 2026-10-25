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

Múltiplas entregas por viagem foram confirmadas pelo usuário. A sequência manual pode ser escolhida e reordenada sem alterar o despacho no Caixa. Google Maps continua externo, sem chave ou serviço pago; não há promessa de melhor rota, trânsito ou otimização automática.

## Pesquisa aplicada

- NN/g, reconhecimento em vez de memorização: endereço e cobrança visíveis; detalhes opcionais. https://www.nngroup.com/articles/recognition-and-recall/
- W3C, WCAG 2.2: contraste, foco, estados acessíveis e alvos de toque de 44 px adotados como meta ergonômica (44 px é o critério enhanced, não o mínimo AA de 24 px). https://www.w3.org/TR/WCAG22/
- Google Maps URLs: navegação externa universal sem chave de API. https://developers.google.com/maps/documentation/urls/get-started
- MDN, Page Visibility: atualização orientada ao retorno, sem polling em segundo plano. https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API
- MDN, navigator.onLine não prova conexão com o servidor: evento é um sinal para tentar leitura, nunca bloqueia operações por si só. https://developer.mozilla.org/en-US/docs/Web/API/Navigator/onLine
- Uber, múltiplas entregas: identificação individual por pedido/cliente/endereço, sem misturar cobranças ou presumir otimização de rota. https://help.uber.com/en/driving-and-delivering/article/how-do-i-handle-multiple-deliveries-from-the-same-place----?nodeId=08189aec-c047-49f2-ba2a-64b216a4c3e5

Skills aplicadas: Frontend Design, UI/UX Pro Max e Vercel React Best Practices. Pesquisa direcionada, sem instalação nem assinatura de ferramentas.

## Validação

A primeira prévia usava uma API simulada. A prévia atual usa o frontend e as rotas FastAPI reais com banco SQLite local e identidades fictícias, em restaurante 99051. Não acessa a operação real nem prova publicação. Regressões backend usam banco temporário com dotenv de produção desativado. Aprovação e publicação são etapas posteriores.

Resultados desta etapa: lint e build aprovados, 1.100 testes unitários, 30 cenários do novo painel em cinco larguras (360/390/430/768/1366), seis regressões de timeout/reload nas duas larguras principais e duas regressões backend aprovadas. Capturas locais de 320/390/768 em ambos os temas foram geradas; revisão visual corrigiu uma colisão entre título e arte em 320 px. Sem certificação da suíte backend completa ou jornada operacional real nesta rodada.


## Ajuste de escopo aprovado pelo usuário

O app conecta somente a entregas por motoboy; pedidos de retirada e mesa não aparecem. “Para sair” corresponde a uma entrega `pronto` já atribuída ao entregador; não é retirada pelo cliente. Filtros: Todas, Em rota e Para sair. Múltiplas entregas por viagem confirmadas pelo usuário; navegação permanece por link externo sem API paga.

## Viagem e código de recebimento — incremento local

- Seleção e reordenação de entregas com controles de toque e teclado. Somente IDs ficam em sessionStorage, sob chave derivada do hash da credencial; não são armazenados endereço, nome ou localização. Pedidos removidos/concluídos saem da sequência. Trocar a credencial limpa a tela e restaura apenas sua própria sequência.
- Novas entregas criadas pelo Cardápio recebem código de seis dígitos, gerado no backend, criptografado no pedido e mantido em replays idempotentes. Retiradas não recebem código. Entregas antigas continuam compatíveis, sem exigência retroativa.
- O cliente vê o código no acompanhamento, chat e histórico autorizado. O painel do entregador recebe somente a indicação de que o código é necessário. O código não entra no catálogo público nem na persistência local do histórico.
- Um único campo numérico aceita colar e confirmar com Enter. O sexto dígito não dispara envio automático. A confirmação verifica atribuição e tenant, bloqueia a linha e usa a transição canônica; cinco erros impõem espera de um minuto. Concluir entrega não quita pagamentos.
- As leituras existentes carregam o código sem uma consulta adicional. Nenhum SDK, SMS, API paga, timer de GPS ou novo polling foi incluído.
- Migração f7b8c9d0e1f2 adiciona três campos de recebimento; upgrade e downgrade focais passaram em PostgreSQL 17 local preservando pedido existente. Isso não substitui os gates da futura publicação.

Validação final deste incremento: 1.100 testes unitários, lint e build; 18 cenários de navegador em mobile/desktop; 20 regressões backend, incluindo isolamento, código, idempotência, broadcast de estado e contagem de consultas. Não certifica toda a suíte backend, CI ou entrega em produção. O ensaio de migração foi focal, sem executar toda a cadeia histórica.

Prévia de teste: http://127.0.0.1:4313/ oferece acessos locais ao entregador e aos três clientes fictícios. Abra um cliente, consulte o código e informe no pedido correspondente do entregador. A conclusão altera apenas o banco local. Capturas finais: customer-real-final.png e courier-real-final.png em outputs/courier-refinement.

Pendências deliberadas: homologação real com Caixa aberto, integração iFood, rastreio GPS e roteamento automático. Nenhuma dessas capacidades é simulada como integração pronta. Publicação depende de aprovação posterior.
