# Universalização incremental do Kôma

Direção aprovada pelo usuário em 31/08/2026: ampliar o Salão do Caixa junto da
universalização, tomando o Core de Pedidos como referência. Prioridades: manutenção
humana, menos contexto de leitura, regras com um responsável e menor peso real.
Não é autorização para mudar contratos financeiros, permissões ou integrações físicas.

## Padrão aplicado

O Core de Pedidos separa canais/adapters, comandos, serviço de aplicação e domínio.
O mesmo princípio orienta os outros módulos; isso não exige copiar classes/camadas
onde seletores puros bastam. No frontend: snapshot existente → índices e fatos
compartilhados → adaptador de cada uso → apresentação e ações próprias.

- Regra e identidade têm uma fonte; não recalcular sufixos nem criar lojas de estado paralelas.
- Compartilhar fatos não torna Caixa e Garçom iguais. Escopo, filtros e ações são explícitos.
- Tipos de view derivam dos produtores. Imports novos apontam a módulos concretos.
- Reduzir ruído sem minificar lógica. Comentários úteis, nomes e confirmações permanecem.
- Menos texto para consultar pode economizar tokens; não houve medição de tokens reais.
- Redução de linhas não prova menor download ou maior fluidez: medir fonte e build separadamente.

## Mesas e contexto: onde manter cada coisa

| Responsabilidade | Fonte |
| --- | --- |
| Índices por mesa, contas ativas e destinos de união | src/domain/tableReadModel.ts |
| Comandas, identidade dos pedidos e atendentes registrados | describeTableOrders no mesmo módulo; reutiliza orderIdentity / orderLots |
| Ocupação, produção, serviço e sinais financeiros | src/domain/operationalState.ts, preservado |
| Escopo de mesa direta e filtros do Garçom | src/domain/waiterSalonProjection.ts |
| Destino das mesas unidas, contas ativas e consumo visual do Caixa | src/domain/cashierSalonProjection.ts |
| Aparência compartilhada de mesa / contexto de pedidos | src/components/shared/SharedTableCard.tsx / TableOrderContext.tsx |
| Ações e composição do card do Caixa | src/components/caixa/salao/CashierSalonCard.tsx / cashierSalonContracts.ts |
| Checkout / envio pelo PDV / transferência | Controllers existentes de checkout, PDV e pedidos; não duplicados |

O App calcula a projeção do Garçom uma vez e reutiliza no drawer e na lista.
MesasView passa o estado calculado ao MesaCard; o card não precisa recalcular.
Os adaptadores usam índices construídos em uma passagem pelo snapshot, em vez de
filtrar o snapshot inteiro novamente para cada mesa. Há teste de equivalência
com a projeção anterior do Caixa, incluindo união, contas fechadas e pagamentos.
O export anterior em cashierOrderProjection permanece como compatibilidade.

## Histórico: evolução funcional do Salão na PR #143

O Caixa vê comandas, pedidos identificados pelo Core, atendentes registrados e
contagens de preparo/prontos/servidos. Uma lista de pedidos não renomeia a Mesa.
IDs ausentes permanecem ausentes. Atendente registrado não significa presença ao vivo.
Consumo visual não se apresenta como novo saldo financeiro.

Ver comanda mantém os detalhes existentes. Adicionar consumo abre o PDV na mesa.
Receber abre o checkout existente sem registrar pagamento ou pedir conta sozinho.
Transferir abre o mesmo fluxo, com foco no destino; só a confirmação efetua a ação.
Mesas unidas não recebem ações duplicadas e mesas sem conta não recebem ações inválidas.
Não houve alteração de permissões, de Item.pago ou da visibilidade de servidos no Kanban.

## Ajuste de densidade aprovado após os prints da PR #143

O usuário aprovou reduzir a informação simultânea, manter os recursos nos detalhes
e evitar emojis decorativos. Não é mudança de domínio ou redução de permissões.

- `SharedTableCard.density`: variante compacta opt-in do mesmo componente;
  Garçom conserva a variante regular. Mesa, estado, tempo, quantidade e valor continuam
  vindo das projeções existentes. Identidades completas ficam nos detalhes e no nome acessível.
- `CashierSalonCard`: uma ação de entrada; sessão sem conta ainda permite adicionar consumo,
  e mesa unida não recebe ações duplicadas. Grade ocupa a largura disponível sem esticar
  cards livres para a altura dos ocupados. Sem diminuir fonte para comprimir conteúdo.
- `KanbanOrderDetails.salonActions`: consumo e recebimento delegam aos mesmos controllers,
  usando a projeção atual da mesa. Transferência continua exigindo destino e confirmação.
  Contexto completo permanece; métricas duplicadas e emojis de movimentação foram retirados.
  Origens de transferência/união usam `getTableMovementContext`, já compartilhado pelo Kanban,
  inclusive quando a origem aparece numa Comanda diferente da primeira.
  O modal tem altura limitada à janela e rolagem própria.
- `CheckoutDialog`: cédulas renderizadas só quando o método é Dinheiro. Trocar método
  não recalcula saldo, não muda valor e não registra pagamento.
- Prova: `salon-density.spec.ts` exercita 30 mesas, altura dos cards, ausência de
  overflow horizontal, alcance das ações e cédulas; `salon-context.spec.ts` protege
  várias comandas, identidade, transferência, recebimento e rascunho via detalhes.

Medida no cenário de 30 mesas, fonte padrão e menu lateral aberto: cards ocupados
~176 px e livres ~153 px; seis mesas completas em 1024×768 e dez em 1366×768.
Em 360×640: ~172/~149 px, duas mesas completas. Nomes longos e fonte ampliada
podem aumentar a altura; não há recorte fixo de texto ou de botões.

## Histórico da limpeza mecânica de estilos

scripts/simplify-static-classes.mjs verifica (padrão) ou simplifica (--write)
somente chamadas clsx formadas por strings literais. Preserva a string resultante,
classes condicionais, bindings locais e comentários. Imports clsx comprovadamente
sem uso também são removidos. Não altera endpoints, cálculos, eventos ou estilos.
O primeiro passe substituiu 881 chamadas e eliminou 106.025 bytes de fonte; imports
sem uso retiraram mais 456 bytes. Os números não representam tokens ou bytes gzip.

Comparação do bloco completo com 4d4d75a (inclui as novas funcionalidades):

| Medida | Antes | Depois |
| --- | ---: | ---: |
| Fonte TypeScript total em src | 56.599 linhas / 2.396.804 bytes | 52.744 linhas / 2.298.095 bytes |
| App.tsx | 1.750 linhas | 1.738 linhas |
| CaixaPanel.tsx | 1.539 linhas | 1.450 linhas |
| CheckoutDialog.tsx | 1.202 linhas | 740 linhas |
| CashierPdvView.tsx | 1.224 linhas | 785 linhas |
| Grafo inicial de JS | 860.265 bytes | 857.516 bytes |
| Grafo inicial gzip | 242.155 bytes | 242.085 bytes |

Economia líquida de fonte: 3.855 linhas e 98.709 bytes, apesar de seis módulos novos.
O ganho de transferência inicial é pequeno; não afirmar aceleração percebida.
31 arquivos alterados coincidem exatamente com a transformação mecânica; sete
consumidores TSX também receberam a migração funcional descrita acima.

## Próximas fronteiras, em ordem

Atualização de 31/08/2026 sobre `826e549`: catálogo, configuração online,
leituras de estoque, contagem física, metadados e preferências receberam
consolidações descritas em [responsáveis compartilhados](shared-resource-owners.md).
O documento registra os 12 pontos da auditoria, os consumidores migrados e as
separações mantidas deliberadamente. A lista abaixo é o roteiro histórico,
não uma declaração de que cada item continua integralmente pendente.

1. Consolidar este bloco com testes completos e integração autorizada.
2. Catálogo: adaptar leituras administrativas/operacionais ao contrato comum já existente,
   preservando produtos inativos no administrativo e a política de vendáveis.
3. Clientes/equipe: consolidar leitura, busca e formulários por entidade; manter autenticação
   e permissões nos responsáveis existentes.
4. Estoque: centralizar contratos e validações de movimentação sem alterar valores/ledger.
5. Sessão/sincronização: reduzir coordenação ainda no App com testes de reconexão e logout.
6. Financeiro: levantamento do contrato e escopo próprio antes de tocar em saldo, Item.pago
   ou liquidação. Não universalizar fórmulas legadas conflitantes por suposição.
7. Agente de impressão e maquininha: etapas próprias, conforme orientação do usuário.

Essa sequência é um mapa de continuação; não declara todo o Kôma já universalizado.
Cada etapa exige consumidores reais migrados, testes e medidas, não só novas pastas.

## Reprodução

- node scripts/architecture-metrics.mjs --ref 4d4d75a e sem --ref: linhas/bytes
  da fonte TypeScript e pacotes de leitura, não contexto transitivo nem tokens.
- npm run build + node scripts/audit-cashier-loading.mjs: grafo de JS inicial,
  incluindo dependências; não LCP/INP medidos.
- npm run lint, npm run test:unit, npm run audit:light.
- KOMA_E2E_PORT=4293 npm run test:e2e -- --workers=2, com fontes congeladas.
- KOMA_E2E_PREVIEW=true KOMA_E2E_PORT=4293 npm run test:e2e -- e2e/salon-context.spec.ts --project=mobile-360 --project=desktop-1366 --workers=2.

O teste inicial de recebimento procurava 160,00 no texto do formulário; o DOM mostrou
o valor correto no campo de entrada. O teste passou a verificar seu valor, sem mudar
cálculo ou UI para contornar a falha. Evidência de execução final fica registrada na PR.
