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

O Caixa recebe a transição canônica/broadcast `tables_updated` existente. O token próprio do entregador não deve ser usado para assinar o WebSocket de operador. O canal próprio agora está implementado no bloco “Persistência offline e WebSocket dedicado” abaixo; a leitura ao retornar continua necessária para reconciliar eventos perdidos. Não prometer recepção instantânea em segundo plano nem expor stream amplo de clientes ou restaurante inteiro.

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

## Incremento de pesquisa e resiliência — 25/10/2026

Pesquisa adicional em fontes dos próprios produtos:

- Uber Help, entregas agrupadas: identificar os itens de cada pedido e seguir uma sequência de destinos. Aplicação: manter número, cliente e endereço reconhecíveis em cada card; a sequência KÔMA é escolhida pelo entregador, não apresentada como otimização geográfica. https://help.uber.com/en/driving-and-delivering/article/how-do-i-handle-multiple-deliveries-from-the-same-place----?nodeId=08189aec-c047-49f2-ba2a-64b216a4c3e5
- iFood, cliente não localizado: mensagens sugeridas e acionamento explícito de suporte. Aplicação: um problema deve estar ligado ao pedido; não copiar regras de espera, cancelamento ou contato da plataforma como se fossem regras KÔMA. https://entregador.ifood.com.br/noticias/novo-cliente-nao-localizado-2-dicas-pra-voce-economizar-tempo/
- DoorDash, suporte durante a entrega: ajuda contextual para endereço incorreto, pedido ou pagamento. Aplicação: futuro aviso ao Caixa dentro do pedido, sem criar um menu de suporte genérico. https://dasher.doordash.com/en-us/blog/contact-dasher-support
- NN/g, visibilidade do estado: retorno claro permite saber se uma ação foi realizada; não confundir lista antiga com sincronização confirmada. https://www.nngroup.com/articles/visibility-system-status/
- NN/g, reconhecimento e divulgação progressiva: identificar pedido/endereço/cobrança à primeira leitura, expandir os itens quando necessário. São diretrizes de usabilidade; não representam um estudo de campo com entregadores KÔMA. https://www.nngroup.com/articles/recognition-and-recall/ e https://www.nngroup.com/articles/progressive-disclosure/

Skills usadas: Vertical Logistics (domínio), UI/UX Pro Max e Frontend Design (apresentação), UX Heuristics (clareza, recuperação e feedback) e Vercel React Best Practices (efeitos e economia de rede). Não foi encontrada uma skill especializada que constitua validação científica do trabalho de entregadores; as orientações genéricas foram confrontadas com as fontes primárias acima e com os contratos reais do repositório. Nenhum pacote ou serviço foi contratado/instalado.

### Mudança implementada neste incremento

O status discreto de atualização muda para “Sem conexão · entregas mantidas” quando o navegador sinaliza offline. A lista já carregada e os links de endereço permanecem; concluir/confirmar fica indisponível. Não se promete navegação Maps offline nem recuperação da lista após recarregar sem rede: os endereços não são copiados para armazenamento persistente neste incremento.

Ao reconectar, uma leitura confere a atribuição atual, mesmo dentro dos 15 segundos de throttle de retorno. Eventos simultâneos são coalescidos; uma operação em andamento termina antes da conferência adicional necessária. Nenhum POST é enfileirado ou repetido. Se o servidor não responder, o aviso “Atualização pendente · tente atualizar” permanece mesmo após o toast desaparecer. `navigator.onLine` é somente um indício; falhas reais de HTTP continuam tratadas pelo caminho de erro e pela reconciliação existente.

Avaliação heurística restrita a conexão e ajuda: baseline 8/10 (duas linhas do diagnóstico com problema menor, severidade 2: feedback persistente de conexão e recuperação via ajuda contextual). Após este incremento: 9/10, por revisão especializada, não por medição com usuários. O ponto restante para 10/10 neste recorte é implementar e validar o aviso ao Caixa abaixo; essa nota não avalia o produto inteiro nem certifica operação em campo.

### Decisão aprovada: aviso ao Caixa sem cancelar

O usuário aprovou “Avisar o Caixa e manter a entrega”. Esta é a próxima fatia funcional, ainda não implementada. Não usar o chat cliente/restaurante para esse aviso: ele tem participantes e contratos públicos diferentes, e poderia expor uma ocorrência interna ao cliente. A auditoria de reatribuição também não é uma caixa genérica para ocorrências.

Contrato necessário antes da implementação:

1. A entrada deve pertencer à entrega atribuída em rota, com os mesmos gates de token, plano, entregador ativo e tenant já usados no painel/conclusão. Revalidar atribuição sob bloqueio; não confiar no card antigo. Pedido retirado/reatribuído/encerrado não recebe novo aviso desse entregador.
2. Motivos curtos: cliente ausente, endereço incorreto, pagamento e outro. O número exibido é o identificador persistido do pedido; o vínculo técnico usa a Comanda logística vigente. Não enviar telefone, código secreto, payload de parceiro nem localização contínua.
3. Registrar ocorrência durável com autoria do entregador, motivo, horário do servidor e chave de idempotência. Repetir a mesma requisição não pode duplicar aviso; não simular isso apenas em memória do navegador. A gravação não altera status, saldo, pagamento, taxa, atribuição ou confirmação de parceiro.
4. O Caixa precisa receber e exibir a ocorrência no pedido de entrega existente, inclusive após recarregar; evento WebSocket só invalida essa leitura e carrega o identificador necessário, sem dados pessoais amplos. Não criar novo polling por pedido ou serviço por restaurante.
5. “Caixa avisado” só aparece depois da gravação confirmada. Se a resposta se perder, verificar pela mesma chave antes de repetir. Falta de rede não deve exibir sucesso nem disparar WhatsApp automaticamente. Sem endpoint e consumidor reais, não colocar botão que aparenta enviar.
6. Resolver o aviso é uma ação própria do Caixa; não equivale a concluir, cancelar ou receber pagamento. Validar fluxo de criação, repetição, recarga, reatribuição concorrente, revogação e isolamento entre restaurantes antes de liberar.

### Limites das conexões

Caixa → Core → painel e confirmação → Core → broadcast do Caixa já têm caminhos reais locais e testes anteriores. Não existe ainda assinatura dedicada de eventos para a credencial de entregador. Não adicionar o token ao WebSocket de operador: requer escopo próprio e revalidação de acesso. iFood/99Food/Keeta permanecem projeções de referência preparadas para conectores futuros; logomarca não significa API homologada. Rastreio contínuo, solver de rota e notificações push permanecem fora desta rodada, pois exigem contratos adicionais de privacidade, navegador e operação.

## Sequência automática pela posição do navegador — implementação local

O botão “Ordenar automático” usa um único `getCurrentPosition` solicitado pelo toque. Não usa `watchPosition`, serviço de geocodificação, endpoint de GPS ou mapa pago. A posição atual permanece somente em memória durante o cálculo; a persistência existente contém apenas IDs de pedidos por credencial/aba. O acesso manual à sequência permanece num botão de lista com nome acessível.

`destination` passa a incluir `latitude` e `longitude` opcionais na mesma leitura v2, extraídas do snapshot/revisão vigente que já era carregado em lote. A projeção valida par completo, números finitos, intervalos e rejeita (0,0). Endereço corrigido sem coordenadas não reaproveita o pin antigo. Não há migração, SELECT por card, chamada externa ou alteração de saldo/estado.

O algoritmo local escolhe sucessivamente o destino conhecido mais próximo da posição corrente (Haversine), depois da última parada escolhida. É uma heurística por proximidade geográfica, sem estimativa de trânsito, tempo, sentidos, vias ou promessa de ótimo global. Empates preservam a ordem anterior. Destinos sem coordenadas permanecem visíveis no fim, na ordem relativa anterior, com aviso e ajuste manual. Sem nenhum destino localizado, não pedir GPS nem alterar a sequência. O cálculo automático limita-se a 100 entregas por operação, compatível com o limite de persistência já existente; exceder esse número mostra orientação sem esconder cards.

Permissão negada, indisponibilidade, timeout ou precisão pior que 500m mantêm a sequência. Posição com precisão inválida também é rejeitada. Pedido de posição usa `enableHighAccuracy: true`, `maximumAge: 30000` e `timeout: 10000`, com limite próprio de 12s para prompts pendentes. Duplo toque não duplica a busca; callback tardio, acesso trocado ou componente desmontado não altera a viagem. Revalidar a lista corrente ao receber a posição para não ressuscitar entrega concluída/reatribuída. Nenhum POST é disparado ao ordenar. O aviso de ordenação é removido ao abrir ajuste manual.

O navegador exige contexto seguro e permissão; um desktop pode fornecer localização por meios disponíveis no navegador, sem necessitar chip GPS dedicado. Não depender de detecção de sistema operacional. As políticas já existentes permitem `geolocation=(self)` tanto no frontend quanto no backend. Fonte oficial do comportamento: https://developer.mozilla.org/en-US/docs/Web/API/Geolocation/getCurrentPosition . Acesso HTTP por IP de rede local não equivale à versão HTTPS para testar permissão em celular.

Validação: geolocalização simulada nos testes, inclusive falha, atraso, precisão, mudança de acesso, reatribuição, destinos faltantes e persistência sem coordenadas do entregador. API real local com restaurante fictício 99051 + geolocalização emulada testada em 320px escuro e 390px claro; nenhuma escrita HTTP ao ordenar e sem overflow. Permissão/precisão no dispositivo físico continuam para validação manual; não foram certificadas por emulação.

## Persistência offline e WebSocket dedicado — implementação local de 25/10/2026

Este bloco substitui as limitações anteriores de cache apenas em memória e ausência de canal próprio. Não certifica publicação nem teste de dispositivo físico.

### Última lista disponível

`courierSnapshotCache.ts` guarda a última leitura autorizada em `localStorage`, com AES-GCM, IV aleatório e chave derivada da credencial de alta entropia. Nome do registro usa hash com separação de domínio; nunca o JWT bruto. Campos permitidos são selecionados explicitamente: identificação do pedido/cliente, endereço vigente, cobrança/troco, itens, origem e capacidade de confirmação. Telefone, payload de parceiro, código digitado/segredo de entrega e posição GPS do entregador ficam fora. A criptografia reduz exposição acidental em armazenamento; não substitui autorização no backend nem protege de código malicioso executando na mesma origem com acesso à sessão.

A leitura tem limite de quatro horas e nunca ultrapassa o `exp` do link. O TTL existente do acesso não foi estendido. Cada credencial tem registro próprio; acesso novo não herda dados de outro operador/tenant. Link revogado/expirado ou HTTP 401/403 apaga a cópia correspondente. Enquanto offline, a revogação só pode ser conhecida na próxima conexão; nenhuma escrita operacional fica disponível offline.

Sem rede, hidratar a lista salva sem exibir cards vazios. Online, a cópia inicial permanece somente para consulta até conferir o servidor. O resultado autoritativo substitui o cache, inclusive quando a lista fica vazia. Após conclusão HTTP, persistir a remoção antes de mostrar sucesso. Escrita tardia não vence exclusão por revogação. Limite de payload de 1MB, remoção de registros expirados e aviso discreto se faltar espaço/armazenamento. Não há fila de POST offline ou salvamento do código de recebimento.

### Reabrir/atualizar offline

`courier-sw.js` é um worker separado, com escopo `/entregador`; o worker de push raiz e as outras telas permanecem independentes. Somente no build de produção: preparar o HTML estático da rota, assets locais com hash e o bootstrap de tema. Nenhuma resposta de API, token em URL, escrita, conteúdo remoto ou HTML do Caixa/Cardápio entra no Cache Storage.

Uma primeira abertura com internet prepara o app. Navegação tenta rede e usa o shell salvo na falta de conexão. Assets estáticos usam cache, ignorando apenas diferenças de `Vary` na busca de arquivos públicos da lista permitida; isso corrige a falha real observada com `Vary: Origin` no servidor de prévia. A validação repetiu instalações novas: não basta a navegação funcionar por acaso com o cache HTTP do browser. A versão é ligada ao entrypoint com hash; uma aba antiga não pode gravar HTML novo com JavaScript antigo. Os assets referidos no próprio HTML também são preparados, cobrindo mudança de CSS sem mudança do entrypoint. Recursos de versões antigas são descartados após preparo completo da nova.

Em desenvolvimento Vite, esse worker não intercepta módulos. A prévia local final usa o build de produção para permitir teste real de F5 offline. Fonte de comportamento da plataforma: https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers . Navegador deve suportar armazenamento/worker e contexto seguro; isso não transforma um endereço HTTP de rede local em origem HTTPS.

### Eventos privados por entregador

`/ws/entregador` autentica a credencial dedicada no subprotocolo existente `koma-auth` (sem query string), valida assinatura, expiração, JTI ativo, entregador e entitlement no banco. Não aceita JWT de operador e não permite escolher tenant/entregador no caminho ou em mensagens. Origem segue a allowlist atual. Conexão entra somente em `courier:<id>` do tenant autorizado, fora dos públicos `internal`, `client` e `all`. O payload enviado ao dispositivo é exclusivamente `{event: 'courier_panel_updated'}`; nem mesmo o ID de outro entregador ou payload de operador atravessa esse limite.

Os hints usam o `OperationalRealtimeBus` já existente (PostgreSQL LISTEN/NOTIFY e commit-safe queue), sem serviço/banco novo. Lifecycle canônico agenda o hint no despacho, conclusão e cancelamento; reatribuição avisa os dois entregadores. Reparação logística e conversão para retirada também invalidam o vínculo anterior. Rollback não publica. Geração manual/revogação de link encerra sockets do entregador por meio do mecanismo de revogação compartilhado existente. Expiração é respeitada e há revalidação de sessão a cada 60s no socket, com sessões de banco curtas em threadpool; ping/pong não consulta banco.

O cliente mantém uma conexão enquanto visível e online, com heartbeat, reconexão exponencial até 30s e jitter. Em segundo plano o browser pode suspender trabalho: ao retornar, conectar e reler. Hints são coalescidos em 200ms; releitura espera qualquer GET/POST em andamento, preservando a reconciliação de resposta perdida. Evento não repete confirmação. Callback de socket antigo não pode invalidar nova credencial. WebSocket não é fonte de verdade nem transporte do pedido inteiro; o GET existente revalida tenant, atribuição, plano e estado em cada leitura.

### Evidência e limites

- Backend real local: despacho → hint → card sem refresh; código do cliente → conclusão canônica → `tables_updated` recebido pelo socket do Caixa. A confirmação não cria pagamento. Exercitado no restaurante fictício 99051; nenhum acesso/mutação do tenant real 6.
- Reatribuição real em teste: ambos recebem hint, o anterior perde a entrega no GET e o novo a recebe. Testados segmentos de tenant/entregador e rejeição de token de operador/revogado.
- PostgreSQL temporário local: dois processos reais receberam apenas os hints do entregador autorizado, com transporte existente e reconexão do listener. Container de teste removido ao terminar.
- Produção simulada local: recarga com rede totalmente desligada, cards restaurados, botão de concluir indisponível, nova leitura ao reconectar. Três instalações independentes em mobile e desktop. Dados de API não aparecem no cache de assets.
- Limites de requisição existentes foram preservados. Os testes de entitlement rodam em processo separado para não compartilhar artificialmente o contador IP de toda a suíte; não foi desativado o limitador para obter aprovação. Não se trata de certificação de carga de milhares de restaurantes ou teste físico de celular.

Permanecem pendentes: conectores comerciais/homologação de parceiros, aviso de problema ao Caixa aprovado em bloco anterior, CI/PR/publicação e conferência de dispositivo real. Nenhuma promessa de receber eventos instantaneamente com a aba suspensa ou sem internet.

#### Painéis locais de itens e confirmação (25/10/2026)

`CourierOrderDialog` usa os dados já carregados no painel; não busca cada pedido novamente. O diálogo nativo contém foco e bloqueia o fundo. Seu fechamento é impedido durante envio; remoção/revogação da entrega desmonta o painel. O POST permanece no owner `MotoboyPwaPage`, com os mesmos bloqueios de conexão, reconciliação e unicidade em voo. `CourierPayment` continua apresentando o read model autorizado, sem registrar recebimentos. `CourierGlyph` contém apenas vetores autorais inline. `courierTypes.ts` compartilha o contrato frontend já existente entre apresentação e owner, sem alterar o payload do backend.

### Atualização local — 26/10/2026

- Recibos novos KÔMA usam três dígitos, incluindo zeros iniciais. Recibos já emitidos de quatro dígitos mantêm a validade; comprimento segue a projeção autorizada do pedido.
- A conferência continua após autenticação do entregador, escopo por tenant, atribuição e despacho, sob lock da comanda e limite de tentativas. Código não é buscado globalmente nem exposto no painel do entregador.
- Referências externas admitem conclusão interna no KÔMA (`local_internal`), sem alterar códigos do parceiro, simular homologação ou enviar reconhecimento à plataforma.
- Conclusão pelo entregador não registra recebimento. Se houver saldo (e pagamento online não estiver aprovado), a comanda fica operacionalmente finalizada e financeiramente aberta; o Caixa a mantém na última coluna com a ação Receber pagamento. Pedido integralmente pago continua exigindo seu recibo KÔMA e não gera nova cobrança.
- Nenhuma chamada nova, polling ou migração de tabela foi introduzida. A atualização usa a projeção e os eventos existentes.
