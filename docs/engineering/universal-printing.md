# Core Universal de Impressão

Direção aprovada em 31/08/2026: toda solicitação de impressão deve convergir para
uma única entrada de aplicação. A origem (Garçom, Caixa, Cardápio, SmartPOS,
reimpressão, fechamento e alteração de item) declara somente a intenção; política,
snapshot, documento, destino e `PrintJob` pertencem ao Core de Impressão.

## Invariantes

1. Rotas e adapters não escolhem formatter nem montam texto térmico.
2. `destino_impressao=NENHUM` significa "sem via setorial própria", não
   "o pedido inteiro pode desaparecer".
3. Consumo local pode continuar silencioso quando todos os itens são `NENHUM`.
4. Retirada/delivery sempre produzem ao menos uma via operacional quando o pedido
   entra em produção, inclusive pedidos somente de bebidas.
5. Reimpressão usa o mesmo modelo lógico da primeira via e acrescenta apenas
   metadado explícito de reimpressão.
6. Alteração/adição de item usa uma via delta: somente o item afetado é renderizado,
   sem transformar a edição em reimpressão do pedido inteiro.
7. O destino da via delta vem da categoria persistida do produto; a borda não
   escolhe `COZINHA`, `BAR` ou outro setor.
8. `PrintJob` continua sendo a fronteira com o Print Agent; o agente não conhece
   regra de pedido, cliente, modalidade ou produto.
9. Migração é Strangler: URLs antigas podem permanecer como aliases, mas devem
   delegar ao Core antes de serem removidas.
10. Todo `backend/app` é protegido por teste de ownership: criação de `PrintJob`,
    enqueue e chamadas de renderer térmico são proibidas fora do namespace do
    Core e das exceções de infraestrutura explicitamente documentadas.

## Fluxo atual

```text
Garçom / Caixa / Cardápio / SmartPOS / Reimpressão / Fechamento / Edição de item
                                      |
                                      v
                                 PrintIntent
                                      |
                                      v
                        PrintingApplicationService
                         (resolve origem + política)
                                      |
              +-----------------------+-----------------------+
              |                       |                       |
              v                       v                       v
      render_canonical_comanda   renderers validados      item_change
       (pedidos operacionais)  (mesa/caixa/despacho)    (via delta)
              |                       |                       |
              +-----------------------+-----------------------+
                                      |
                                      v
                                 PrintJob
                                      |
                                      v
                                Print Agent
```

A entrada HTTP canônica é `POST /impressao`:

```json
{
  "source_type": "pedido",
  "source_id": "l-12345678",
  "action": "reimprimir",
  "table_id": null,
  "values_only": false
}
```

Uma alteração de item usa a mesma entrada sem enviar texto nem impressora:

```json
{
  "source_type": "item",
  "source_id": "i-12345678",
  "action": "alteracao_item",
  "quantity_added": 2
}
```

O cliente não envia texto, preço, destino de impressora ou nome de formatter.
Esses dados são reconstruídos do banco e da configuração do restaurante.

## Estado atual — 04/09/2026

Os produtores migrados declaram `PrintIntent` e delegam ao
`PrintingApplicationService`. Existe uma única classe pública com esse nome: o
pacote `app.application.printing` reexporta diretamente o orquestrador canônico,
sem wrapper ou segunda implementação. Pedidos remotos são renderizados pelo
modelo canônico de comanda; `PrintItem` e `group_items_by_print_destination`
permanecem como primitivas de domínio para roteamento setorial. Extrato de mesa,
fechamento de caixa e despacho continuam atrás do mesmo serviço de aplicação
usando os renderers já validados para cada documento.

A edição/adição de item também convergiu. `PrintSourceType.ITEM` com
`PrintAction.ITEM_CHANGE` carrega novamente o item persistido, sua comanda,
produto e categoria, renderiza somente a via delta e usa `enqueue_print_job` do
Core. A rota `/comandas/itens/{item_id}` não contém mais texto térmico nem cria
`PrintJob`. O caminho antigo sempre chamava `print_in_background("cozinha", ...)`
depois de apenas testar se o destino não era `NENHUM`; isso podia mandar uma
alteração de item de `BAR` para `COZINHA`. A migração corrige essa divergência e
passa a respeitar o destino real da categoria.

A limpeza pós-migração removeu o antigo `PrintDocumentService`, seus DTOs
`OrderPrintData`/`CommandPrintData`/`DeliveryOrderPrintData` e os formatters de
produção/fechamento/delivery que já não tinham consumidor de produção. Também
foram removidos de `orders_core.py` os helpers antigos que criavam `PrintJob`,
faziam reimpressão fora do Core Universal ou enfileiravam a antiga via delta.

A proteção arquitetural deixou de depender apenas de uma lista fixa de produtores.
O teste de ownership percorre todos os arquivos Python em `backend/app` e falha se
um arquivo novo tentar instanciar `PrintJob`, enfileirar impressão ou chamar os
geradores térmicos diretamente fora do Core. Isso torna a regra executável para
canais futuros, mesmo que quem os implemente não conheça o histórico da migração.

## Exceção de infraestrutura: diagnóstico do Print Agent

`app/routes/print_agents.py` é uma exceção deliberada ao ownership do Core porque
implementa transporte, fila, recuperação e diagnóstico físico. A rota
administrativa `POST /api/print-agents/jobs/inject` pode criar um `PrintJob` com
payload fornecido pelo painel **Imprimir teste** para validar agente, spooler e
impressora sem depender da existência de um pedido.

Essa exceção não é API de negócio. Pedido, mesa, caixa, delivery, item, totem,
marketplace ou qualquer canal futuro não podem usar `/jobs/inject` como atalho;
esses fluxos devem criar `PrintIntent` e passar pelo `PrintingApplicationService`.

## Histórico da migração

### Etapa 1 — ponte segura

A primeira etapa criou `PrintIntent`, `PrintingApplicationService` e `POST
/impressao`, preservando contratos existentes. Comprovante de fechamento e
reimpressão ganharam aliases para a entrada universal. A política de pedidos
remotos foi caracterizada para garantir que Retirada/Delivery com itens
`NENHUM` ainda produzam uma via operacional e que itens sem destino não sejam
duplicados entre setores.

Naquela etapa, partes da geração ainda passavam pelo antigo
`PrintDocumentService`. Esse detalhe é histórico e não descreve mais a base
atual; o serviço e seus formatters foram removidos após os consumidores de
produção migrarem para o renderer canônico.

### Etapa 2 — migração dos produtores

Os produtores foram migrados incrementalmente, preservando URL e resposta:

1. criação/aceite de pedido remoto;
2. PDV/SmartPOS;
3. lançamento automático do Garçom;
4. extrato e fechamento de mesa;
5. expedição/motoboy;
6. fechamento de caixa e documentos auxiliares;
7. edição/adição de item com documento delta próprio.

A proteção arquitetural atual varre `backend/app` inteiro. Qualquer novo produtor
que tente criar `PrintJob`, escolher formatter ou chamar os geradores antigos
fora das fronteiras permitidas faz o CI falhar automaticamente.

### Etapa 3 — convergência visual

O modelo canônico de comanda concentra o layout de pedidos operacionais sem criar
um formatter monolítico para documentos semanticamente diferentes. Cabeçalho,
identidade, itens, valores, observações, rodapé e metadados são compostos pelo
Core; extratos financeiros, documentos de despacho e deltas de item preservam
seus contratos específicos quando a semântica é diferente.

## Validação obrigatória

- local somente `NENHUM` -> zero via automática;
- retirada somente `NENHUM` -> uma via operacional;
- retirada mista -> item `NENHUM` aparece em uma única via primária;
- setores diferentes -> itens setoriais continuam indo ao setor correto;
- alteração de item `BAR` -> via delta em `BAR`, nunca forçada para `COZINHA`;
- alteração de item `NENHUM` -> nenhuma via delta;
- quantidade adicionada -> via delta contém apenas o acréscimo informado;
- reimpressão -> mesmo conteúdo lógico da primeira via + `REIMPRESSÃO`;
- URLs antigas preservam status/resposta enquanto forem aliases;
- nenhuma alteração no Print Agent/hardware nesta etapa.

Antes de merge: backend completo, frontend, browser matrix e PostgreSQL conforme
`AGENTS.md`; sem bypass de branch protection e sem testes destrutivos em produção.


## Simulador térmico local

A bancada em `/ferramentas/simulador-impressao` é uma ferramenta interna de engenharia da plataforma,
não uma funcionalidade do restaurante. Ela exige Super Admin + Modo Suporte auditado no tenant alvo
e não cria um segundo sistema de impressão.

Fluxo:

```text
PrintJob persistido (backend, tenant-scoped, somente leitura)
        |
        v
página do simulador
        |
        | localhost 127.0.0.1:17654-17664
        v
Kôma Print Agent
        |
        | build_escpos_payload(..., encoding="cp860")
        v
bytes ESC/POS exatos
        |
        +--> parser visual / trace de comandos
        |
        X    CUPS / Spooler / /dev/usb/lp* NÃO são chamados
```

A ponte local reaproveita a faixa de portas já autorizada pelo CSP para o
pareamento do agente. Ela permanece bindada exclusivamente em
`127.0.0.1` e aceita as origens oficiais do KÔMA e os hosts loopback usados
em desenvolvimento/teste.

A simulação usa o mesmo `build_escpos_payload` dos adapters Linux/Windows.
Por isso, tamanho RAW, encoding CP860, inicialização, feed e corte são
observações do pipeline real. O parser visual reconhece somente os comandos
que o KÔMA emite hoje (fonte A/B, negrito, altura dupla, espaçamento, quebra de
linha e corte). Sequências desconhecidas são exibidas como desconhecidas em
vez de receberem uma interpretação presumida.

### Tempos

A tela pode exibir somente medidas observáveis:

- `agent_render_ms`: `perf_counter_ns` em torno da construção ESC/POS e do
  parser local;
- roundtrip navegador ↔ agente: medido pelo navegador na requisição localhost;
- fila backend → claim: apenas quando o PrintJob real possui
  `created_at` e `claimed_at`.

Não existe estimativa automática de velocidade do motor, avanço físico ou
guilhotina. O agente atual confirma aceitação pelo spooler, não a saída física
do papel; portanto `physical_print_time_ms` permanece `null`.

### Fonte dos dados

`GET /api/print-agents/simulator/sources` lista metadados recentes e
`GET /api/print-agents/simulator/sources/{job_id}` entrega o `payload_text`
exato somente quando a requisição vem de um Modo Suporte auditado da plataforma.
Um admin/gerente/caixa normal do restaurante recebe `403`. Ambas são leituras
tenant-scoped: não reservam, reabrem, reimprimem nem alteram o job. A ferramenta
não é anunciada nem linkada nas configurações operacionais do restaurante.

O campo de edição manual da página é uma entrada técnica. Regras de pedido,
mesa, delivery, preço e roteamento continuam pertencendo ao Core de Impressão;
o frontend não possui formatter térmico próprio.


### Simulação automática em modo sombra

A bancada interna pode ativar uma observação automática do fluxo real de
PrintJobs. Esse modo existe para medir o caminho **criação do PrintJob → wake-up
do agente → leitura do backend → conversão ESC/POS**, sem confundir a medição com
uma impressão física.

O contrato é deliberadamente não autoritativo:

- a ativação começa com um cursor do relógio do backend e ignora backlog anterior;
- o feed do agente é autenticado pelo token tenant-scoped já usado pelo Print Agent;
- cada item observado mantém o `PrintJob` intacto: sem claim, sem `agent_id`,
  sem `claimed_at`, sem `printed_at` e sem mudança de status;
- o daemon reaproveita `simulate_payload` e, portanto, o mesmo
  `build_escpos_payload(..., encoding="cp860")` da impressão real;
- nenhum adapter físico, CUPS, Spooler ou `/dev/usb/lp*` é chamado;
- a bancada mostra separadamente latência observada no servidor, roundtrip do
  feed e tempo de renderização; um valor agregado é identificado apenas como
  limite superior conservador, nunca como tempo físico.

O modo sombra é opt-in e local. Reiniciar o agente o deixa desligado novamente.
A fila PostgreSQL continua sendo a única autoridade da impressão física.
