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

## Fluxo alvo

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
                              v
                    documento canônico
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

## Etapa 1 — ponte segura (esta PR)

- cria `PrintIntent` e `PrintingApplicationService`;
- cria `POST /impressao` sem remover contratos existentes;
- transforma o comprovante de fechamento em alias da entrada universal;
- transforma a reimpressão de pedido em alias do Core;
- Retirada/Delivery com todos os itens `NENHUM` passam a gerar uma via operacional;
- em pedido remoto misto, itens `NENHUM` acompanham somente a via setorial primária,
  sem duplicação em todas as impressoras;
- primeira via automática de Retirada/Delivery continua usando
  `PrintDocumentService.generate_production`, portanto recebe a mesma política;
- reimpressão de Retirada/Delivery passa a usar o mesmo `OrderPrintData` e formatter
  da primeira via, com `REIMPRESSÃO` como único marcador visual adicional;
- consumo local, extrato de mesa, fechamento financeiro e hardware permanecem com
  os renderers validados existentes atrás da nova camada.

## Etapa 2 — migrar produtores restantes

Migrar um consumidor por vez, preservando URL e resposta:

1. criação/aceite de pedido remoto;
2. PDV/SmartPOS;
3. lançamento automático do Garçom;
4. extrato e fechamento de mesa;
5. expedição/motoboy;
6. fechamento de caixa e documentos auxiliares.

Após cada migração, adicionar proteção arquitetural para impedir que aquele
consumidor volte a criar `PrintJob` ou chamar formatter diretamente.

## Etapa 3 — modelo visual único

Depois que todos os produtores estiverem atrás do Core, consolidar os modelos
visuais. O objetivo não é um formatter monolítico cheio de condicionais, mas um
único contrato canônico de documento com seções opcionais. Cabeçalho, identidade,
itens, valores, observações, rodapé e metadados são compartilhados; cada tipo de
documento habilita somente as seções necessárias.

Mudança de layout só começa depois da Etapa 2 para separar risco visual de risco de
roteamento. Assim uma alteração de modelo não precisa tocar Garçom, Caixa,
Cardápio ou SmartPOS individualmente.

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
