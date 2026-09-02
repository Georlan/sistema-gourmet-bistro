# Core Universal de Impressão

Direção aprovada em 31/08/2026: toda solicitação de impressão deve convergir para
uma única entrada de aplicação. A origem (Garçom, Caixa, Cardápio, SmartPOS,
reimpressão, fechamento) declara somente a intenção; política, snapshot,
documento, destino e `PrintJob` pertencem ao Core de Impressão.

## Invariantes

1. Rotas e adapters não escolhem formatter nem montam texto térmico.
2. `destino_impressao=NENHUM` significa "sem via setorial própria", não
   "o pedido inteiro pode desaparecer".
3. Consumo local pode continuar silencioso quando todos os itens são `NENHUM`.
4. Retirada/delivery sempre produzem ao menos uma via operacional quando o pedido
   entra em produção, inclusive pedidos somente de bebidas.
5. Reimpressão usa o mesmo modelo lógico da primeira via e acrescenta apenas
   metadado explícito de reimpressão.
6. `PrintJob` continua sendo a fronteira com o Print Agent; o agente não conhece
   regra de pedido, cliente, modalidade ou produto.
7. Migração é Strangler: URLs antigas podem permanecer como aliases, mas devem
   delegar ao Core antes de serem removidas.

## Fluxo atual

```text
Garçom / Caixa / Cardápio / SmartPOS / Reimpressão / Fechamento
                              |
                              v
                         PrintIntent
                              |
                              v
                PrintingApplicationService
                 (resolve origem + política)
                              |
              +---------------+----------------+
              |                                |
              v                                v
      render_canonical_comanda           renderers validados
       (pedidos operacionais)          (mesa/caixa/despacho)
              |                                |
              +---------------+----------------+
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

O cliente não envia texto, preço, destino de impressora ou nome de formatter.
Esses dados são reconstruídos do banco e da configuração do restaurante.

## Estado atual — 02/09/2026

Os produtores migrados declaram `PrintIntent` e delegam ao
`PrintingApplicationService`. Pedidos remotos são renderizados pelo modelo
canônico de comanda; `PrintItem` e `group_items_by_print_destination` permanecem
como primitivas de domínio para roteamento setorial. Extrato de mesa, fechamento
de caixa e despacho continuam atrás do mesmo serviço de aplicação usando os
renderers já validados para cada documento.

A limpeza pós-migração removeu o antigo `PrintDocumentService`, seus DTOs
`OrderPrintData`/`CommandPrintData`/`DeliveryOrderPrintData` e os formatters de
produção/fechamento/delivery que já não tinham consumidor de produção. Também
foram removidos de `orders_core.py` os helpers antigos que criavam `PrintJob` ou
faziam reimpressão fora do Core Universal. Testes arquiteturais impedem que esses
caminhos sejam restaurados silenciosamente.

`print_in_background` ainda existe em `orders_core.py` porque a edição de item
continua emitindo uma via de alteração por esse caminho. Ele é dívida explícita:
deve ser migrado para uma intenção adequada antes de ser apagado. O Print Agent e
suas rotas de diagnóstico permanecem fora desta limpeza.

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
6. fechamento de caixa e documentos auxiliares.

A proteção arquitetural atual impede que os produtores já migrados voltem a
criar `PrintJob`, escolher formatter ou chamar os geradores antigos diretamente.

### Etapa 3 — convergência visual

O modelo canônico de comanda concentra o layout de pedidos operacionais sem criar
um formatter monolítico para documentos semanticamente diferentes. Cabeçalho,
identidade, itens, valores, observações, rodapé e metadados são compostos pelo
Core; extratos financeiros e documentos de despacho preservam seus contratos
específicos quando a semântica é diferente.

## Validação obrigatória

- local somente `NENHUM` -> zero via automática;
- retirada somente `NENHUM` -> uma via operacional;
- retirada mista -> item `NENHUM` aparece em uma única via primária;
- setores diferentes -> itens setoriais continuam indo ao setor correto;
- reimpressão -> mesmo conteúdo lógico da primeira via + `REIMPRESSÃO`;
- URLs antigas preservam status/resposta enquanto forem aliases;
- nenhuma alteração no Print Agent/hardware nesta etapa.

Antes de merge: backend completo, frontend, browser matrix e PostgreSQL conforme
`AGENTS.md`; sem bypass de branch protection e sem testes destrutivos em produção.
