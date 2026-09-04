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

## Estado atual — 02/09/2026

Os produtores migrados declaram `PrintIntent` e delegam ao
`PrintingApplicationService`. Pedidos remotos são renderizados pelo modelo
canônico de comanda; `PrintItem` e `group_items_by_print_destination` permanecem
como primitivas de domínio para roteamento setorial. Extrato de mesa, fechamento
de caixa e despacho continuam atrás do mesmo serviço de aplicação usando os
renderers já validados para cada documento.

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
Testes arquiteturais impedem que esses caminhos sejam restaurados silenciosamente.

O Print Agent e suas rotas de diagnóstico permanecem fora desta limpeza.

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

A proteção arquitetural atual impede que os produtores já migrados voltem a
criar `PrintJob`, escolher formatter ou chamar os geradores antigos diretamente.

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
