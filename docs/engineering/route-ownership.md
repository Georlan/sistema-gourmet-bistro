# Rotas: responsáveis explícitos

Consolidação sobre `4e6445f`, branch `codex/canonical-route-owners`.
Complementa [responsáveis compartilhados](shared-resource-owners.md), encerrando
as sobreposições HTTP de R06. Não é comprovante de deploy.

## Onde alterar

| Responsabilidade | Ponto de entrada / implementação |
| --- | --- |
| Composição dos namespaces | `backend/app/main.py`; cada router incluído uma vez |
| SmartPOS autenticado | `routes/auth.py` inclui `smartpos`, `smartpos_provider` e `smartpos_cash_projection` |
| Mesa, conta, família e compatibilidade de criação | `routes/atendimentos.py`; callbacks explícitos em `orders.py` / `orders_core.py` delegam aos adapters e ao Order Core |
| Status e despacho delivery | `routes/orders.py`; sem versões concorrentes no core |
| Reimpressão de lançamento | `routes/atendimento_printing.py`; impressão física e agente inalterados |
| Catálogo e categorias | `routes/products.py`; cardápio público importa a ordenação existente |
| Perfil e compatibilidade | `routes/caixa.py` mantém aliases de escrita; o GET `/caixa/config-cardapio` pertence somente a `cardapio_config_bridge.py` |
| Relatórios | `routes/relatorios.py` registra handlers de `financial_read_routes.py` e `financial_product_routes.py` |
| Indicadores do painel | `routes/optimization.py` registra `financial_read_routes.get_dashboard_financeiro` |
| Fechamento e estornos | `routes/caixa.py` registra handlers de `financial_cash_routes.py` e `financial_refund_listing.py` |
| Totais e atividade do turno | imports diretos de `services/cash_reconciliation.py` e `services/cash_activity.py` |
| Proteções de estorno | `services/refund_guard.py`; o serviço transacional chama explicitamente o saldo protegido |

Os módulos `financial_*_routes` definem handlers, mas não modificam routers de
outros módulos. `routes/__init__.py` mantém somente registro de modelos e
constraints: não substitui funções nem monta a API por efeito colateral.
Aliases de URLs continuam válidos e apontam para a mesma função. Não confundir
alias necessário com duas implementações registradas para o mesmo método/URL.

O saldo base de estorno tem nome explícito (`base_remaining_refund_allocations`).
A entrada pública (`remaining_refund_allocations`) aplica o guard já vigente,
inclusive fora do servidor HTTP. Seu import local resolve a dependência com o
serviço transacional sem depender de uma substituição global feita pelas rotas.
Não trocar pelo saldo base em chamadas transacionais.

## Validação e limites

- Leitura online autenticada: catálogo com 90 produtos, 89 disponíveis e um
  pausado; abas de estoque, configurações e cardápio público acessíveis. O produto
  pausado não apareceu na busca pública. Nenhuma gravação em produção.
- O estoque online estava vazio. Entradas, XML, contagens, erros e isolamento
  foram exercitados somente por testes com banco/API locais.
- Antes da consolidação: 48 testes backend de catálogo/cardápio/estoque e 24
  cenários de navegador em produção local (360/1366) passaram.
- As 223 operações efetivas preservam handler, request/response, permissões,
  status HTTP e OpenAPI efetivo, comparados antes/depois. O OpenAPI de referência
  usa o primeiro handler, como o despacho HTTP; duplicatas antes podiam documentar
  a última definição, diferente daquela executada.
- Regras financeiras, idempotência, tenant, cálculo de estoque, payloads de
  SmartPOS, telas e agente de impressão não foram redesenhados.
- A divergência já conhecida do custo médio XML/manual com saldo negativo
  continua pendente de decisão de produto; não foi escolhida outra fórmula.

## Medidas reproduzíveis

`scripts/audit_route_owners.py` importa a aplicação sem iniciar o servidor nem
consultar banco. Executar em processo novo com `ENVIRONMENT=test`, SQLite
isolado, configurações fictícias e `PYTHONPATH=backend`. `--output` gera JSON
local com os responsáveis e contratos para comparação; não versionar snapshots
gigantes da API. O tempo de importação é apenas observacional.

| Medida | Antes | Depois |
| --- | ---: | ---: |
| Objetos APIRoute construídos na importação | 248 | 225 |
| Registros HTTP resolvidos | 235 | 223 |
| Operações efetivas distintas | 223 | 223 |
| Método/URL com duplicidade | 12 | 0 |
| Linhas nos 16 arquivos de produção alterados | 9.484 | 7.820 |
| Bytes nesses arquivos | 344.232 | 282.347 |

São 23 construções de rota a menos (9,3%) e redução líquida de 1.664 linhas /
61.885 bytes de fonte, excluídos testes, script de auditoria e documentação.
Não são tokens medidos, economia de download ou ganho comprovado de latência.
Nenhuma consulta por requisição foi eliminada nesta consolidação. O JS inicial
do Caixa permanece em 857.651 bytes (242.541 gzip), abaixo do orçamento existente.

`backend/tests/test_route_ownership.py` impede duplicatas, protege os handlers
efetivos e aliases, verifica montagem sem conexão ao banco e compara três ordens
de importação em processos novos. Também verifica numeração e guard financeiro
sem importar `main`. Rodar com a suíte completa; os testes financeiros, de
atendimento e de SmartPOS continuam cobrindo comportamento, não só o registro.

## Resultado final local

- Main original em checkout isolado: 795 testes backend aprovados, três skips.
- Consolidação: 813 aprovados (18 proteções novas), os mesmos três skips.
- Concorrência executada separadamente em PostgreSQL 15 efêmero: um aprovado;
  não substitui o gate PostgreSQL 17 do CI. Os dois smokes B1.4 continuam para
  o workflow dedicado.
- Reforço após a suíte completa: 76 cenários de pico, SmartPOS, permissões e
  notificações aprovados.
- Frontend: TypeScript, 196 unitários, contraste, build, orçamento de
  carregamento e auditoria npm aprovados (nenhuma vulnerabilidade reportada).
- Browser com build de produção: 173 aprovados em 360/1366, um cenário exclusivo
  de desktop ignorado no celular; mais 108 aprovados nas outras seis larguras,
  cobrindo catálogo/estoque/cardápio e limites entre módulos. Fontes congeladas.
- Agente de impressão: 32 testes aprovados, sem alteração do agente ou hardware.

A primeira execução completa foi invalidada: um segundo pytest no mesmo
checkout recriou o SQLite fixo do fixture, provocando falhas em cascata. As URLs
distintas informadas não isolavam esses processos; ver a restrição em
[governança](change-governance.md). A repetição acima foi serializada por checkout.
O teste novo de ordem de imports também foi corrigido para comparar processos
novos dos dois lados, excluindo a URL artificial criada pela suíte de CORS.

As evidências desta sessão ficam em `/tmp/koma-route-validation.2hcZHv/`
(`routes-before.json`, `routes-final.json`, `backend-retry.xml`,
`baseline-full.xml`, `stress-confirmation.xml`, `concurrency.xml`, `print-final.xml`).
Relatórios browser: `../route-validation-production` e `../route-validation-responsive`.
As evidências acima foram coletadas antes da publicação. O resultado do CI e o
estado de integração devem ser consultados na PR desta branch; este documento
não comprova merge nem deploy.
