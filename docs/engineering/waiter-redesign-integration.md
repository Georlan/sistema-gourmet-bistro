# Garçom: integração do redesign aprovado

A composição nova é a tela normal do papel `garcom`, nos pontos de entrada já existentes. Os servidores de prévia em `scripts/preview-waiter-salon.mjs` e as fixtures são ferramentas locais; não fazem parte da montagem da aplicação nem do build publicado.

## Responsabilidades e continuidade

- `MesaCard` conserva dois destinos: corpo ocupado abre consumo, ação Lançar abre catálogo, mesa livre abre novo pedido. `SharedTableCard` seleciona a composição `WaiterTableSurface` apenas quando solicitado; o Caixa conserva a composição compartilhada anterior.
- Cor e glifo identificam o estado canônico da mesa. O nome completo e a descrição acessível continuam disponíveis. Sem lugares ou rótulos repetidos no mapa. Três colunas em 360–430 px; texto gigante e telas menores podem usar duas para preservar leitura.
- `MenuPanel` habilita o contador padrão somente no Garçom. Produtos com configuração obrigatória continuam abrindo o configurador. Cliente é opcional e limitado aos nomes já presentes nesta mesa; unidades personalizadas não entram no contador padrão.
- `waiterRepeatItem` reconstrói uma nova unidade pelo catálogo atual, preservando composição, cliente e observação quando válidos. Nunca reprecifica consumo antigo. Alteração de opções obrigatórias exige configuração.
- `useOperationalDrafts` mantém o contrato `koma_drafts_v4:<tenantId>:<operatorId>`. Recarregar não envia nem elimina rascunhos. Desfazer restaura o item completo enquanto a tela e o mesmo escopo continuam ativos, sem reabrir operações já enviadas.
- O snapshot inicial espera mesas, contas e configuração; não apresenta mesas livres antes de conhecer as contas. Atualizações do Caixa reaproveitam os eventos existentes, agrupam leituras e fazem uma releitura caso chegue invalidação durante a primeira requisição. Revogações recompõem abas e controles sem apagar rascunhos.

## Presença e isolamento

A presença continua informativa, por WebSocket, sem trava ou HTTP adicional. Chegadas tardias provocam replay dos estados ativos dos colegas. Uma nova conexão limpa avisos antigos antes desse replay: saídas perdidas durante desconexão não permanecem no mapa. Trocar sessão/tenant também limpa a presença. O servidor obtém identidade e restaurante da autenticação, não do nome enviado pelo navegador.

A regressão de distribuição registra 10.000 pares simulados de conexão em 5.000 salas e comprova que presença alcança somente os dois peers internos do restaurante alvo. Não abre sockets reais nem mede capacidade de produção. O dimensionamento real depende de mensagens por segundo, latência, memória, processos e pico de pedidos; não há promessa de capacidade a partir dessa simulação.

## Histórico econômico

O histórico reutiliza `Lancamento`, `Comanda`, identidades persistidas e itens existentes. Não cria tabela, migration ou cópia do histórico. Abre em Hoje (America/Fortaleza), mais recentes primeiro, do operador autenticado. A página padrão tem 20 lançamentos, máximo 30, com cursor. Detalhes só são lidos ao abrir o pedido. Sem consulta enquanto fechado e sem polling novo: os eventos já existentes atualizam o painel aberto.

Número humano vem da identidade persistida; ausência fica explícita e não é preenchida pelo número da conta. Itens cancelados permanecem legíveis e não entram no total dos itens ativos. O histórico mostra a associação atual entre conta e mesa; não promete reconstituir o nome ou a mesa original após transferências históricas. Os registros operacionais existentes preservam sua retenção; não são apagados ao terminar o turno.

## Telemetria e segurança de scripts

O SDK usa o entry point `posthog-js/no-external`, com observador de exceções local, e o provider React slim recebe a mesma instância. Não libera scripts externos na CSP. A prova em build local utiliza token fictício e intercepta rede: confirma `script-src 'self'`, zero scripts externos e a exceção automática chegando ao SDK. Não comprova recebimento pelo provedor.

O beacon Cloudflare mostrado na captura de produção não é declarado pelo frontend deste repositório; depende da injeção/configuração da hospedagem. Não flexibilizar a CSP como correção automática desse aviso. A leitura direta de produção nesta execução retornou 403, portanto não confirma configuração ou SHA servido.

## Validação e publicação

A suíte focada de navegador cobre entrada tardia/reconexão de presença, falha de entrega, atualização de permissões, bootstrap sem falso Livre, rascunhos após reload, composição/cliente, repetição, desfazer, histórico e ajuda. O workflow `waiter-config-layout.yml` inclui os cenários operacionais e testes de histórico/isolamento, além do layout em cinco larguras. A suíte do Caixa cobre consumo, modalidade, pagamento e transferência sem mudar seus contratos.

A medição local alternada em cinco contextos frios por build manteve cinco leituras iniciais da API e trinta requisições totais, antes/depois. Medianas locais de 1.077 ms e 1.031 ms são observacionais; não demonstram ganho no celular durante o rush. O histórico fechado não acrescenta leituras ao salão.

Publicar somente por PR, com checks verdes no SHA final e autorização de merge. Após a publicação, verificar independentemente SHA da API e frontend, login do Garçom, snapshot, consumo/catálogo e conexão WebSocket. Não criar pedidos, mensagens de suporte ou impressões sintéticas no tenant 6.

Reversão: reverter a PR pelo fluxo normal e republicar as versões anteriores de frontend/backend. Não há migration ou transformação destrutiva a desfazer; não apagar rascunhos, contas ou filas. Os caminhos de impressão e o protocolo de agentes instalados permanecem os existentes.
