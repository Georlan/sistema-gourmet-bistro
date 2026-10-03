# Contrato de custo por operação

O objetivo é manter baixo o custo de cada visita, pedido, sessão e impressão,
independentemente do número de restaurantes cadastrados. Quantidade de tenants
não é uma certificação de capacidade nem um orçamento suficiente: frequência
de pedidos, clientes simultâneos, tamanho de cardápios e retenção também importam.

## Regras para implementar e revisar

1. Consultas operacionais devem usar o tenant ativo e índices compatíveis. Não
   percorrer todos os restaurantes para descobrir trabalho ocioso.
2. Ler apenas os campos consumidos pelo contrato. Não carregar JSONs de marca,
   integrações ou relações completas para verificar um booleano.
3. Reutilizar leituras dentro da mesma operação. Vínculos de complementos,
   hierarquia e limites não devem ser lidos novamente por cada consumidor.
4. Agrupar recursos comerciais numa consulta de overrides. Suspensão, revogação,
   versão de sessão, preços e pagamentos continuam autoritativos no servidor.
5. Consultas periódicas são recuperação, não o mecanismo principal de atualização.
   Pausar trabalho em telas ocultas/inativas e consolidar eventos sobrepostos.
6. Memória e conexões permanentes não devem crescer com todos os tenants
   cadastrados. Não criar pool, thread, cache sem limite ou temporizador por tenant.
7. Uma otimização deve preservar isolamento, idempotência, prioridades de vínculo,
   recuperação de conexão e rollback. Reduzir uma consulta não autoriza omitir
   uma validação de segurança ou financeira.

## Implementado neste lote

- Autenticação lê somente `Restaurante.saas_status` para a suspensão. Não há cache
  dessa decisão: uma suspensão é observada na próxima autenticação.
- Benefícios são resolvidos em lote; overrides explícitos, inclusive `False`,
  continuam prevalecendo sobre o plano. O plano é lido uma vez quando necessário.
- Cardápio público usa uma projeção da configuração, sem JOIN automático da marca,
  segredos de integração ou preferências internas de impressão.
- Complementos compartilham uma leitura de vínculos diretos, de categorias e da
  hierarquia. Limites diretos são indexados por produto antes da composição, em
  vez de percorrer todos os vínculos novamente para cada produto.
- O contexto de validação do pedido usa a mesma resolução de grupos e limites,
  sem duplicar consultas. Lê apenas os campos de configuração necessários ao mínimo.
- Perfil de marmitaria e pausa operacional também usam projeções dos campos
  necessários, sem alterar a autoridade da configuração.

Medição antes/depois em SQLite isolado, no mesmo cenário de regressão:
cardápio com complementos, 24 → 15 SELECTs; resolução dos oito benefícios sem
plano previamente fornecido, 16 → 2; contexto mínimo de validação, 8 → 5;
verificação de suspensão, 22 → 1 colunas do restaurante.
Esses resultados são budgets de consultas, não porcentagens da fatura ou prova
de capacidade para uma quantidade de restaurantes. PostgreSQL ainda executa
comandos próprios de sessão/RLS; cardápios reais variam em linhas e bytes.

As estruturas reutilizadas vivem somente na requisição. Não há estado novo
proporcional ao total de restaurantes nem permissões/preços retidos entre pedidos.

## Próximas mudanças que precisam de contratos próprios

- Separar catálogo estável de disponibilidade operacional para permitir cache de
  catálogo por `(tenant, versão)`, com invalidação após commit, limites de bytes/chaves
  e recuperação entre réplicas. Eventos ou TTL, isoladamente, não garantem que um
  preço ou produto removido esteja atualizado. A implementação deste lote não cria
  esse cache nem congela o snapshot público inteiro.
- Reduzir projeções de histórico e transportar detalhes completos apenas quando
  necessários. Preservar totais, busca, paginação e associação persistida dos pedidos.
- Dimensionar workers por trabalho pendente indexado, não pelo total de tenants;
  manter limites por lote, backpressure, recuperação e distribuição justa entre lojas.
- Quando contenção e tamanho reais justificarem, particionar armazenamento e
  processamento preservando o roteamento do tenant. Adicionar réplicas sem reduzir
  fan-out e trabalho duplicado também multiplica custo.

Esses itens são direção arquitetural, não funcionalidades já publicadas. Nenhum
valor de capacidade para 100, 1.000 ou 100.000 restaurantes foi certificado aqui.

## Verificação sem consumir produção

`backend/tests/test_read_query_budget.py` registra SELECTs reais no banco isolado
e impede a volta de consultas duplicadas, projeções privadas e perda da revogação.
Regressões de criação/estoque/pagamentos, complementos herdados, marmitaria,
pausa operacional e tenant fazem parte da validação funcional.

Medições e testes de carga não devem apontar para o Supabase de produção.
As checagens normais de publicação permanecem poucas leituras de saúde e versão,
sem pedidos, pagamentos, importações ou tráfego sintético de clientes.
