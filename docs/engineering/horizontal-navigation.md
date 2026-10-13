# Navegação horizontal e configuração por assunto

## Problema e escopo

As dez áreas do operador mantinham barras superiores com listas e filtros diferentes do menu lateral. No celular, alguns destinos eram escondidos; nomes genéricos confundiam operação, cadastro e análise. A taxa de serviço tinha uma aba para uma única configuração.

`cashierNavigation.ts` passa a fornecer ambas as apresentações. `CashierSubNavigation` usa os destinos e ações canônicos, inclusive a inicialização do PDV, capacidades efetivas e restrições da implantação. A barra permanece horizontal, com rolagem local, indicação de overflow, seleção visível e alvos de 44px no celular. ResizeObserver e scroll são eventos locais; nenhuma consulta ou polling foi acrescentado.

## Decisões da revisão

- Vendas: Pedidos, Novo pedido, Salão, Cozinha/Preparo, Retiradas e Entregas. Retiradas e Entregas são visões operacionais úteis, não duplicações descartáveis. Os atalhos inferiores do celular permanecem.
- Caixa: Turno atual, Movimentações e Fechamento representam etapas financeiras distintas.
- Cardápio: Produtos, Complementos, Preparo e impressão; o plano sem impressão usa Preparo.
- Cardápio online: Dados da loja, Marca, Horários e pedidos, Bloqueios, Entrega, Pagamentos, Divulgação. Bloqueios é específico do canal; configurar recebimento online não é acompanhar pedidos em Vendas.
- Estoque & compras: Ingredientes, Compras, Inventário, Fornecedores. Cadastro, entrada e contagem não são equivalentes.
- Clientes: cadastro, fidelidade e cupons preservam regras e capacidades distintas.
- Relatórios: Visão geral, Recebimentos, Vendas por produto, Inteligência do Cardápio, Desempenho da equipe. Cadastro de produtos/equipe continua nas suas áreas.
- Equipe: Pessoas e Funções e acessos separam identidade de permissões.
- Configurações: Mesas, Atendimento, Impressão, Fiscal, Integrações, Aparência, Implantação inicial. Atendimento reúne taxa de serviço visível e permissões do App do Garçom em seção expansível. A taxa não depende da disponibilidade do aplicativo. Rotas antigas garcom/taxa continuam reconhecidas.
- Conta & assinatura: plano atual, comparação de planos e documentos permanecem distintos.

Também inspecionados: SuperAdmin (clientes/implantação, restaurantes, financeiro; saúde/integrações/auditoria), cardápio público (ofertas/créditos/pontos), ações de mesa, visões produto/complemento e Diagnóstico/Matriz/Oportunidades/Simulador da inteligência. Esses agrupamentos representam tarefas diferentes. Não foram fundidos nem tiveram conteúdo visual redesenhado nesta etapa. Garçom e entregador preservam seus fluxos especializados.

## Próximas etapas visuais

Simplificar filtros e ações compartilhados; reduzir textos instrutivos repetidos; priorizar resultados e próximas ações na inteligência do cardápio; revisar cartões e formulários móveis. Cada etapa deve manter alertas, contexto financeiro e funções úteis, validando fluxos com fixtures.

## Validação e reversão

Typecheck, suíte unitária, build e navegador com dados locais. Produção somente leitura, sem alterações na loja 6. Nenhuma alteração de backend, agentes, impressão, autenticação ou pagamento. Reverter a PR restaura apresentação e catálogo anteriores; configurações persistidas mantêm o mesmo contrato.
