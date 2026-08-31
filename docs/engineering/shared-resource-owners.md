# Responsáveis compartilhados — 31/08/2026

Implementação sobre `826e549`, na branch `codex/shared-resource-owners`.
Este documento descreve o código local; não comprova publicação em produção.
Critério: extrair somente responsabilidades equivalentes com consumidores reais.
Não criar um framework universal nem tornar os canais iguais.

## SmartPOS e criação de pedidos

Os dois caminhos existentes já delegam ao Order Core:

- Venda rápida: `/comandas/venda-direta` → `PosAdapter` → `OrderApplicationService.create_order`.
- Mesa: `/comandas/{id}/lancamentos` → `WaiterAdapter` → o mesmo serviço.

A origem SmartPOS é preservada. Abertura da conta, entitlement do aparelho,
pagamento e comunicação física têm contratos próprios. O teste
`backend/tests/adapters/test_smartpos_core_delegation.py` acompanha chamadas
reais ao Core em banco isolado; não certifica uma transação na maquininha.

## Onde fazer uma alteração

| Responsabilidade | Responsável e consumidores |
| --- | --- |
| Catálogo operacional atômico | `src/components/app/data/useOperationalCatalog.ts`; App, PDV e catálogo administrativo |
| Seleção administrativa / próximo código | `src/components/caixa/catalog/useCashierCatalog.ts`; sem GET ou cópia de estado |
| Ordem das categorias | `backend/app/routes/products.py:ordered_categories`; import explícito no cardápio público |
| Perfil público e edição online | `src/components/cardapio/CardapioDigitalSettingsPanel.tsx`; montado diretamente por CashierOnlineMenu |
| Upload de logo ou banner | `src/components/CardapioAssetUploader.tsx`; recebe tipo, valor e callback; não monta páginas |
| Campos equivalentes do perfil no backend | `backend/app/services/restaurant_profile.py`; duas rotas mantêm autorização, transação e eventos |
| Leitura / atualização de estoque | `src/components/caixa/inventory/useCashierInventoryData.ts`; abas e formulários invalidam recursos nomeados |
| Relação aba → recursos | `src/components/caixa/inventory/inventoryResources.ts` |
| Aplicação da contagem física | `backend/app/services/inventory_count.py`; criar, editar e confirmar inventário |
| Definições das permissões do garçom | `src/components/caixa/settings/waiterPermissions.ts`; controller e lista de configurações |
| Preferências e atalhos comuns dos menus | `src/components/caixa/navigation/CashierSidebarFooter.tsx`; desktop e mobile |
| Rótulos de cargos / alias de apresentação | `src/components/equipe/teamRoles.ts`; Pessoas e Cargos |
| Máscara de telefone | `src/utils/phonePresentation.ts`; App reutiliza o helper existente |

Catálogo: snapshot vinculado a portal/token, cancelamento e descarte de respostas
antigas, inclusive 401 de sessão anterior. Inativos continuam visíveis no cadastro
e não vendáveis no PDV. O fallback de deploy 404/405 é preservado.
SmartPOS e storefront público mantêm suas leituras por contexto/autorização;
não passam a compartilhar memória de sessão entre canais.

Estoque: um responsável cancela leituras ultrapassadas por recurso; formulários
não implementam GETs paralelos. Ingredientes usam insumos/fichas, fornecedores
usam distribuidores, inventário usa insumos/contagens e histórico carrega seus
registros e os dados necessários aos diálogos. Mutações recarregam os recursos
afetados. Editar fornecedor não recarrega ingredientes/fichas.

Pedidos/mesas: o fallback de 8 s permanece no App; o timer de 12 s do Caixa
fica restrito a turno/delivery. Não foi criado outro coordenador genérico.
Atalhos e WebSocket acompanham o callback atual do catálogo ao trocar sessão.

Permissões: as 15 definições alimentam uma lista e um estado controlado;
as sete integrações pendentes continuam desabilitadas. Metadados de UI não
autorizam operações. O servidor continua sendo a autoridade.

## Destino dos pontos da auditoria

| Ponto | Decisão nesta etapa |
| --- | --- |
| R01 — configuração escondida | Removida; apenas o painel canônico e seu uploader |
| R02 — catálogo duplicado | Snapshot do App reutilizado; ordem de categorias explícita no backend |
| R03 — polling de pedidos em dois lugares | Removido do timer do Caixa |
| R04 — leituras repetidas de estoque | Um responsável e invalidação por recurso |
| R05 — operações de estoque | Contagem compartilhada; políticas de custo preservadas |
| R06 — sobreposições de rotas | Removida a substituição implícita de categorias; demais overlays não migrados |
| R07 — configuração repetida | Perfil no backend e permissões no frontend compartilham definições |
| R08 — apresentação repetida | Telefone, metadados de cargos e rodapé dos menus compartilhados |
| R09 — carrinhos | Não unificados: seleção, modificadores, notas e persistência têm contratos distintos |
| R10 — impressão | Preservada para a etapa própria do agente e seus contratos |
| R11 — código sem consumidor | Removidos EstoqueEntradasTab e EstoqueMovimentacoesTab; histórico ativo preservado |
| R12 — financeiro | Sem mudança de cálculos, liquidação, status ou Item.pago |

Não há justificativa para juntar carrinhos apenas pela semelhança do JSX.
Uma extração futura precisa demonstrar repetição equivalente de regras,
preservando os adaptadores por canal. Assets e demais candidatos sem import
não foram apagados automaticamente: há referências em testes e proveniência.

O custo médio de entrada XML/manual diverge para saldo negativo. Não escolher
uma fórmula silenciosamente. Exemplo já auditado: saldo −5, custo 10, entrada
10 a custo 20 produz 30 no XML e 20 na entrada manual. Exige decisão de produto.
Overlays financeiros e carregadores legados pedem uma etapa de contratos;
a eliminação de um monkeypatch não encerra R06 inteiro.

## Verificação e medidas

- `tests/sharedResourceOwners.test.ts`: limites de responsabilidade, plano de
  recursos, permissões, papéis e máscara.
- `backend/tests/test_shared_resource_helpers.py`: contagem, trilha e whitelist
  de perfil; helpers não fazem commit nem ampliam campos por conta própria.
- `e2e/shared-resource-owners.spec.ts`: produção/dev, navegação, rascunho,
  falha/repetição de publicação, upload, leituras, respostas antigas, sessão,
  produtos inativos e rollback de permissões.
- Suítes existentes protegem checkout, fatias do Kanban, mesa/garçom, carrinho
  público e autenticação. Testes usam API e banco locais de fixture.
- `npm run lint`, `npm run test:unit`, `npm run build`;
  `node scripts/audit-cashier-loading.mjs`; pytest completo.

Comparar fonte incluindo arquivos novos/deletados, separada de testes/docs.
Menos linhas facilita localizar a regra e pode reduzir contexto consultado;
não é medição de tokens reais. O grafo inicial do Caixa continua abaixo do
orçamento existente de 950 kB; não afirmar melhora de latência sem medição.
Em desenvolvimento StrictMode repete a montagem de verificação; contagens
exatas de carregamento real devem ser conferidas também no build de produção.

### Resultado final local

Todos os resultados abaixo são posteriores às correções e à interrupção da
primeira rodada. As fontes ficaram congeladas durante cada execução E2E.

- TypeScript e 196 testes unitários: aprovados.
- Backend completo: 795 aprovados; três ignorados por dependerem do PostgreSQL
  efêmero dos workflows dedicados; aviso existente de depreciação do TestClient.
- Produção, suíte completa em 360/1366: 173 aprovados e um cenário exclusivo
  de desktop ignorado no celular.
- Produção, áreas afetadas + densidade em 390/412/768/1024/1440/1920:
  99 aprovados; três cenários exclusivos de desktop ignorados nas telas menores.
- Desenvolvimento, sete cenários novos em 360/1366: 14 aprovados, incluindo
  o ciclo extra de montagem/cleanup do StrictMode.
- Build e orçamento de carregamento aprovados. Grafo inicial de JS do Caixa:
  857.651 bytes, 242.541 gzip; orçamento vigente de 950.000 bytes sem compressão.

O corpo do uploader extraído foi comparado por impressão normalizada da AST:
é igual ao AssetEditor já visível na base. Dois testes antigos de código-fonte
foram atualizados para apontar ao uploader e ao rodapé compartilhados, mantendo
a proteção de layout e da operação de tema; não se mudou a tela para satisfazê-los.
Falhas intermediárias de navegador incluíram fontes externas pendentes e
ERR_NETWORK_CHANGED em módulos locais; a rodada final acima passou. O teste
novo de comportamento isola o CDN de fontes, sem alterar os estilos da aplicação.

| Fonte alterada, incluindo módulos novos e deletados | Base 826e549 | Atual |
| --- | ---: | ---: |
| Linhas de produção nos 34 caminhos afetados | 13.616 | 12.084 |
| Bytes de produção nesses caminhos | 542.578 | 472.147 |
| Total TypeScript/TSX em src | 52.679 | 51.210 |

Economia líquida: 1.532 linhas e 70.431 bytes de código de produção, sem testes
e documentação. Contagem de linhas por quebras de linha (wc -l). Não são tokens
medidos nem redução equivalente de download. Remover código morto também ajuda
a leitura, mesmo quando ele já não entrava no pacote de produção.

Relatórios locais ficam em `../shared-resource-test-results/`: backend.xml
e pastas browser, responsive e development. Nenhum commit, push, merge ou deploy
foi realizado nesta etapa.
