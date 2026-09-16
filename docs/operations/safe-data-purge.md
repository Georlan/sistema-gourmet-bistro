# Limpeza segura dos dados de homologação

Este procedimento remove dados históricos de teste sem alterar schema, migrations,
código ou integrações. Ele preserva o restaurante `id=1` e sua estrutura, apaga os
demais restaurantes e limpa os dados operacionais do restaurante preservado.

O comando é `dry-run` por padrão, reflete o schema existente e interrompe a
execução se encontrar uma tabela que não consiga classificar. Ele não usa
`TRUNCATE` e não executa DDL.

## Classificação

### PRESERVAR no restaurante 1

- cadastro do restaurante;
- categorias, produtos, receitas/insumos e modificadores;
- relações de categoria e produto e observações predefinidas;
- definições de mesas (atendimentos, comandas e movimentos são limpos);
- configurações do restaurante, IA e fidelização;
- perfil operacional e capacidades habilitadas;
- contas/configurações de pagamento, fiscal e credenciais fiscais;
- sequências fiscais, para não reutilizar numeração já emitida;
- assinatura/plano SaaS e vínculo de aceite contratual;
- configuração externa do Resend e demais integrações, que não reside nas
  tabelas operacionais apagadas.

Referências fiscais oficiais globais e evidências contratuais globais são
preservadas por serem registros legais, append-only e não participarem das
restrições de unicidade de email ou telefone. Seus vínculos tenant-scoped são
apagados com restaurantes removidos.

### LIMPAR no restaurante 1

Todas as tabelas alcançáveis por FK a partir do restaurante são limpas, exceto a
lista estrutural acima. Isso inclui:

- usuários/funcionários, versões de sessão, tokens e auditoria operacional;
- clientes, avaliações, fidelidade e bloqueios/controles de pedidos online;
- cupons promocionais criados durante os testes;
- comandas, lançamentos, itens, modificadores de item, pedidos agendados,
  conversas e notificações push;
- pagamentos, estornos, intenções, webhooks e eventos operacionais;
- entregas, motoboys e seus tokens;
- turnos/movimentos de caixa e atendimentos de mesa;
- documentos/eventos fiscais derivados das vendas;
- estoque operacional: entradas, notas, contagens e movimentações;
- WhatsApp operacional, impressão, outbox e referências externas.

Cadastros prévios/incompletos em `restaurant_signups`, notificações de signup e
setups SaaS sem restaurante também são apagados. São dados históricos, não o
código nem a configuração do Resend.

### APAGAR junto com restaurantes diferentes de 1

Para cada tabela tenant-scoped, direta ou indiretamente ligada por FK, o comando
apaga todas as linhas dos restaurantes removidos. O próprio cadastro desses
restaurantes é removido por último. Essa regra também se aplica às tabelas que
estão na lista de preservação do restaurante 1.

## Fontes de conflito de email e telefone

O mapeamento encontrou dados de contato em usuários, clientes, motoboys,
cadastros/onboarding, notificações, contas de pagamento e registros operacionais
derivados. A classificação por relações de FK remove as linhas tenant-scoped; as
tabelas globais de signup são limpas explicitamente.

A conta de Super Admin não é uma linha de `usuarios`: a autenticação global usa
credenciais de ambiente. Por isso a limpeza de usuários tenant-scoped não remove
o acesso global à plataforma.

## Uso

Use uma credencial administrativa somente para esta operação:

```bash
export PURGE_DATABASE_URL='postgresql+psycopg://...'
python backend/tools/purge_homologation_data.py \
  --report-json purge-dry-run.json
```

O JSON mostra contagem por tabela, dados preservados, tabelas não classificadas e
uma impressão digital. Revise o arquivo. Qualquer tabela não classificada bloqueia
a aplicação.

Antes da execução real:

1. valide a rotina e os testes em banco descartável restaurado de um backup;
2. gere e teste um snapshot restaurável imediatamente antes da limpeza;
3. reduza concorrência/escritas durante a janela;
4. gere um novo dry-run e use exatamente os valores emitidos;
5. guarde os relatórios do dry-run e da aplicação.

Exemplo de aplicação — somente após essas etapas:

```bash
python backend/tools/purge_homologation_data.py --apply \
  --expected-database NOME_EXATO \
  --expected-fingerprint SHA256_DO_DRY_RUN \
  --confirm PURGE_KEEP_RESTAURANT_1 \
  --backup-reference ID_DO_SNAPSHOT_RESTAURAVEL \
  --report-json purge-aplicado.json
```

O comando adquire lock transacional no PostgreSQL, recalcula o plano e recusa a
execução se o banco tiver mudado. Ao final, ainda dentro da transação, valida que:

- somente o restaurante 1 permanece;
- nenhuma linha classificada para remoção permanece;
- todas as contagens estruturais preservadas são idênticas ao dry-run.

Qualquer falha causa rollback integral.
