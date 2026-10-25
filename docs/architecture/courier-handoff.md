# Contrato de entrega: Caixa → Pedido → Entregador

Estado: implementação local, branch `design/courier-refinement-20261025`. Não certifica integrações comerciais nem publicação.

## Fonte de verdade e entrada

O app é uma projeção do pedido existente, não um sistema paralelo de pedidos. A origem não muda elegibilidade: exigir o mesmo tenant, entregador ativo atribuído, modalidade Delivery/Entrega, conta aberta e estado `transito`. Atribuir durante preparo/pronto não equivale a despachar. Modalidades retirada e mesa continuam fora.

Futuros conectores iFood, 99Food, Keeta e outros devem usar o adapter existente `MarketplaceProviderAdapter` → `CreateOrderCommand` → `OrderApplicationService`; a referência externa é persistida na mesma transação com unicidade `(tenant, provider, external_order_id)`. Webhooks repetidos não podem duplicar pedido, cobrança, impressão ou despacho. `ExternalOrderReference.internal_order_id` aponta para o Pedido/Lancamento; a leitura também admite vínculos legados diretos à Comanda. O ID técnico para concluir a entrega continua sendo o ID da Comanda logística; referência externa nunca é chave global nem substitui esse ID.

A logística da plataforma e a frota do restaurante são responsabilidades diferentes. Um futuro conector deve mapear esse responsável explicitamente e só oferecer atribuição ao entregador KÔMA quando o restaurante puder executar a entrega. Ter referência de marketplace não prova autorização para usar sua frota, nem que sua API confirmou a entrega.

## Leitura aditiva, versão 2

GET `/comandas/motoboys/painel-entregador` mantém header dedicado e campos legados para publicação incremental. Adiciona `contract_version: 2` e, por entrega:

- `source`: canal, nome legível e referências do parceiro realmente persistidas. Não inferir plataforma pelo texto do cliente. Não devolver `raw_payload`, credenciais ou telefone do cliente. A interface usa os logos públicos oficiais de iFood, 99Food e Keeta, selo KÔMA com o wordmark existente para os canais próprios (`caixa`, `cardapio`, `koma`) e fallback de nome/ícone genérico para outras origens; não apresenta certificação de parceiro.
- `destination`: endereço operacional vigente, complemento e referência separados; consulta a revisão mais recente antes do snapshot original. `route_query` exclui instruções da portaria/complemento para a busca no mapa. Endereço legado é fallback quando não existe snapshot estruturado.
- `payment`: `status` (`collect`, `paid`, `not_due`, `check`), método normalizado, valor a cobrar, valor da cédula informada, troco calculado e indicação de inconsistência. Valores financeiros são do backend; o navegador apenas formata.
- `items`: quantidades agrupadas apenas quando produto, observações, modificadores e preço coincidem. Itens cancelados ficam fora. O preço de catálogo atual não recalcula o pedido já realizado.
- `confirmation`: modo (`local`, `koma_code`, `partner_pending`), disponibilidade e motivo. O backend revalida essa capacidade sob bloqueio da entrega; esconder/desabilitar botão no browser não é autorização.

O total usa `services/order_financials.payable_total`: itens ativos + taxa − cupom − cashback. O saldo usa o mesmo `open_balance`. Pagamento online `approved` é evidência de pagamento integral já existente no KÔMA; não cobrar novamente. Um método chamado Pix, um rótulo de origem ou um payload bruto de marketplace não comprovam pagamento. Parcelas/recebimentos continuam no modelo financeiro para outros canais, mas não aparecem como “Já recebido” na tela do entregador.

Dinheiro: troco = valor informado − saldo restante, somente quando esse valor é suficiente. Troco inconsistente pede conferência e não inventa valor negativo. Cartão informa levar maquininha; troco em dinheiro não é aplicado a cartão/Pix. Concluir entrega não cria pagamento nem movimentação financeira.

## Conclusão e futuros parceiros

POST `/comandas/motoboys/pedidos/{comanda_id}/confirmar-entrega` preserva tenant, atribuição, bloqueio da linha, idempotência e transição canônica. Pedidos próprios do Cardápio usam código aleatório de quatro dígitos, independente de telefone. O entregador nunca recebe o segredo pelo painel.

Referências externas de iFood/99Food/Keeta ou provedor desconhecido recebem `partner_pending` e não podem ser concluídas por esse endpoint até existir um caminho de integração validado. WhatsApp/API próprios permanecem no fluxo local. Não reutilizar código KÔMA como se fosse um código do parceiro, não inventar acknowledgement remoto e não buscar endpoints dos parceiros diretamente no navegador.

Quando um conector real for implementado, é necessário mapear: quem entrega, pagamentos confirmados/pendentes, código e regra de comprovação exigidos pelo parceiro, cancelamento/reembolso, idempotência e confirmação remota. Mudanças do parceiro entram no Core; notificações de saída usam o mecanismo de outbox já existente, sem commit duplicado nem fila nova por restaurante. Só liberar a capacidade de conclusão após comprovar essa jornada e o isolamento. Não adicionar função vazia que devolva sucesso.

## Custo e sincronização

Sem banco novo, tabela nova, SDK de mapa, fonte remota, biblioteca UI, polling periódico ou chamada ao parceiro nesta etapa. Itens/produtos/lançamentos são carregados em lote; referências selecionam somente campos necessários; modificadores reutilizam o loader em lote. Endereços usam window function para trazer só a última revisão por pedido e um segundo lote dos originais faltantes. O teste compara uma e treze entregas e limita o número de SELECTs, evitando N+1.

O Caixa recebe a transição canônica/broadcast `tables_updated` existente. O token próprio do entregador não deve ser usado para assinar o WebSocket de operador. Por enquanto o app relê ao voltar/recuperar conexão, com coalescimento e throttle já existentes. Não chamar isso de WebSocket dedicado nem prometer recepção instantânea em segundo plano. O futuro canal deve ter autorização por tenant/entregador e eventos mínimos; nenhum stream amplo de clientes ou restaurante inteiro.

## Navegação e evidência

Mantida navegação externa existente; sequência por IDs persiste por aba e credencial. Copiar endereço oferece retorno no próprio botão, sem toast de sucesso sobre o botão de concluir. A comparação local em `/navigation.html` no servidor de revisão oferece Google Maps em outra aba, Google Maps na mesma aba, Waze e copiar endereço. São links reais, não um mapa ou rota simulados. Abertura de aplicativo instalado e velocidade de retorno exigem teste de dispositivo; o browser de desktop só comprova o fluxo web. Decisão do usuário em 25/10/2026: Google Maps em outra aba quando necessário, com `target="_blank"` e `rel="noopener noreferrer"`; nenhuma substituição por Waze ou mapa integrado.

A marca de origem usa o canal do contrato e assets oficiais locais em `src/assets/brand/delivery/`, com proveniência, dimensões, tamanho e hash em `sources.json`. Arquivos foram baixados intactos de páginas/CDNs oficiais, sem criar ou alterar os desenhos. Não hotlinkar logos por pedido nem aceitar URL arbitrária de imagem de payload de parceiro. Uso para identificação de origem não é selo de homologação. Os logos somam 11.700 bytes.

## Pesquisa aplicada

- iFood: pagamentos `prepaid`, `pending`, método e `cash.changeFor`: https://developer.ifood.com.br/pt-BR/docs/guides/modules/logistics/details
- iFood Developer: acesso/homologação: https://developer.ifood.com.br/pt-BR/
- 99Food Developer: https://developer-food.99app.com/ (portal requer JavaScript; não foi validado um schema de pagamentos por esse portal nesta etapa).
- Keeta Open Delivery: https://api-docs.mykeeta.com/apis/opendelivery/section/introduction-to-test-store-management (base Open Delivery 1.5 com adaptações próprias; não pressupor contrato idêntico ao iFood).
- Toolkit oficial iFood: https://blog-parceiros.ifood.com.br/materiais-gratuitos/toolkit-editavel-do-ifood/
- Uber, múltiplas entregas: https://www.uber.com/us/en/deliver/basics/making-deliveries/delivering-multiple-orders/
- NN/g, reconhecimento em vez de memorização: https://www.nngroup.com/articles/recognition-and-recall/
- NN/g, progressive disclosure: https://www.nngroup.com/articles/progressive-disclosure/
- Google Maps URLs, sem API key: https://developers.google.com/maps/documentation/urls/get-started
- Waze deep links: https://developers.google.com/waze/deeplinks
- Leaflet não é provedor gratuito ilimitado de tiles/rotas: https://leafletjs.com/examples/quick-start/index.html

Aplicação: cobrança/troco/destino reconhecíveis sem lembrar dados da comanda; itens e identificadores longos sob demanda; uma ação de conclusão clara; cor com ícone/texto, foco, profundidade discreta e alvos de toque de pelo menos 44px. Skills: UI/UX Pro Max, Vertical Logistics, Frontend Design, Vercel React Best Practices. A busca focal de UI/UX não encontrou uma regra específica validada para cognição de entregadores; a referência aplicada nesse ponto é NN/g, sem atribuir evidência científica ao resultado genérico da skill. Não foi necessário copiar código de UI ou instalar ferramentas de terceiros.
