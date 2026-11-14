# KDS KÔMA — produção rápida, sem ruído visual

## Diagnóstico real, 13/11/2026

A captura enviada pelo operador (celular) confirma excesso de hierarquia vertical: topo redundante “Cozinha / Produção e expedição”, três filtros com painel amplo, busca e Produção total ocupando linhas separadas, cartões com faixa de progresso, origem e “Balcão” repetidos por item, botão de lote escondido no rodapé. O primeiro ticket pronto empurra pedidos ativos para baixo. Revisão apenas cosmética não resolve.

Consultamos **somente logs HTTP agregados da Railway** próximos à interação (2026-11-14 00:28Z): três PUTs de atualização de itens com resposta 200 e duração 509/485/953 ms; leituras da lista de comandas na amostra com mediana ~611 ms e pico 1785 ms. O frontend antigo aguardava **PUT + refresh completo** para cada item; o lote processava **serialmente** e bloqueava todos os botões do mesmo ticket, mesmo após uma confirmação de status. Esse é um gargalo de produto real; não há evidência nesses registros de erro HTTP nos três PUTs.

## Direção escolhida

- **Uma linha de controle de fila, sem banner:** filtros compactos Em preparo (padrão), Prontos, Todos; busca e “Produção total” revelados sob demanda. Prontos ficam acessíveis, mas não empurram tarefas de produção.
- **Tickets densos e utilizáveis:** número, destino, tempo e quantidade na primeira leitura; nome dos itens legível; detalhes apenas quando realmente informam algo; não repetir “Balcão” em cada linha, autor ou origem redundante; alvos táteis de 44px; conclusão de múltiplos itens na faixa superior, sem rodapé gigante; blocos com largura fluida, cores de estado e separadores mínimos, sem sombra/banner/arte decorativa. Mostrar pendência relevante, diferenciar estados em confirmação.
- **Modo foco explícito:** permite ocultar chrome do Caixa durante o trabalho, mas sempre oferece saída acessível sem abandonar a fila; opcional por tela, não persistido.
- **Tempo de resposta operacional:** para item único, o KDS só marca pronto após HTTP 200, mas não espera recarregar todos os pedidos. O snapshot continua sendo reconciliado assincronamente (websocket + refresh), e o frontend usa o status confirmado para atualizar o item instantaneamente após ACK; nenhuma falsa confirmação após erro.
- **Lote rápido e atômico:** um novo endpoint autenticado, transacional, limitado a um único lançamento/comanda e à mesma tenant. Valida todos os IDs antes de alterar qualquer um, marca apenas `preparando → pronto`, aceita replay de `pronto`, decide `delivery_status` via lifecycle existente, commita tudo e emite **um** evento. O frontend usa um request por lote; sem loop N× PUT+GET. 409/404 preserva estado, permite retry após reconciliação. Não toca em entregue, pagamentos, caixa ou impressão.
- **Ações independentes:** botões de itens distintos permanecem utilizáveis enquanto um item é gravado. IDs concorrentes sempre travados; confirmação positiva é refletida localmente sem aguardar full GET. Sem exceções escondidas, feedback por item ou lote.
- **Acessibilidade e QA:** 320–430px, desktop, dark/light, teclado, leitor de tela, sem overflow, sem informações/claims fictícios. Testes de latência simulada (GET travado e PUT rápido), lote com 1 HTTP, atomicidade e cross-tenant, efeito no Kanban, falha e retry, reconexão, papel Cozinha.

## Não objetivos

Não criar estados de cocção, cozinhas/estações por produto, SLA contratual, novas cobranças, cronômetro por item, autoentrega, dependência nova, alterar fluxo financeiro ou permitir SQL manual. Não exercitar pedidos reais durante o deploy.

## Evidência de implementação

- Novo KDS: barra de filtros em uma linha (Em preparo padrão), busca/produção total sob demanda, cartões densos com ação de lote na faixa superior, observações visíveis só quando existem, itens prontos parcialmente concluídos recolhidos. Modo foco opcional sem barra do Caixa e com botão de saída.
- Confirmação individual: botão libera logo após PUT 200, estado atualizado localmente somente após ACK; não aguarda GET completo. A conclusão de outro item não é bloqueada. Teste com GET artificialmente atrasado por 3 s passou no navegador.
- Confirmação de lote: 1 PUT autenticado por até 40 IDs do mesmo lançamento, validação de tenant/estado/fechamento, bloqueio de comanda primeiro, transação única e um broadcast; replay idempotente e sem autorização de entrega. A sincronização do snapshot é disparada sem bloquear interações.
- Rastreabilidade sem PII em logs: tempo de execução em ms de PUT individual (opt-in KDS) e de PUT de lote, somente contagem/booleano de alteração no segundo; proxy HTTP segue como fonte de duração total. Não registrar IDs/nomes/telefone/token do pedido em logs da mudança.
- Testes locais após alterações principais: 73 testes Python de autoridade e autorização, 1.259 unitários de frontend, 57 cenários Playwright mobile+desktop aprovados (1 skipped condicional), build e typecheck verdes. Capturas novas testadas em 320/360/430/768px, temas claro/escuro e modo foco. A mudança nunca realizou PUT/POST em pedidos de produção; somente dados artificiais nos testes.

## Rollback

Revert do PR sem migração/alteração de schema; a versão anterior permanece compatível com endpoints individuais. Nenhum contrato financeiro, Pix, caixa, impressão, autenticação ou tenant externo foi alterado.
