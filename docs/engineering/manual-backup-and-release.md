# Backup manual e publicação do piloto

Decisão: manter os planos atuais e fazer cópias manuais até os primeiros clientes.
Responsável operacional: proprietário do Kôma. Backup manual depende de execução;
não existe agenda automática configurada por este documento.

## Rotina diária

Faça uma cópia após o fechamento de cada dia e imediatamente antes de migrações.
Guarde pelo menos sete cópias diárias e quatro semanais, em pasta criptografada
fora do computador do restaurante e com acesso restrito. Uma cópia no mesmo
disco não protege contra perda do computador. Não envie backups ao GitHub.

O roteiro tem quatro partes:

1. **Banco do Kôma:** `scripts/manual_database_backup.py` exporta `public` e
   `koma_internal`, incluindo dados, funções, políticas, permissões e histórico
   Alembic. O arquivo inclui todos os restaurantes e informações sensíveis.
2. **Imagens:** copie os arquivos do bucket de imagens do Supabase Storage,
   preservando nomes/pastas, e registre as configurações/políticas do bucket.
   As linhas do banco que apontam para uma imagem não contêm seu arquivo.
3. **Configuração:** guarde as variáveis de produção Railway em um cofre seguro,
   especialmente `ENCRYPTION_KEY`, que é necessária para ler os campos cifrados.
   Registre também domínios, região, comandos e as credenciais da role de runtime.
4. **Conector:** preserve `journal.db`, configuração e credenciais locais do
   agente. Não compartilhe esses arquivos em chamados de suporte. Se precisar
   copiá-los diretamente, pare o conector fora do atendimento e preserve os
   arquivos SQLite auxiliares existentes; prefira a API de backup SQLite.

O PostgreSQL/Redis/Evolution API do Railway são serviços separados do banco
principal Supabase. Se o WhatsApp entrar no escopo da operação, também precisam
de um procedimento próprio de recuperação. Não excluir seus volumes.

## Gerar a cópia do banco

Requisitos: Python com as dependências do backend e utilitários oficiais
PostgreSQL (`pg_dump`, `pg_restore`) da mesma versão principal do servidor ou
mais recente. Para copiar o banco atual, use a conexão administrativa direta
ou o **Session pooler**, nunca o pooler de transações nem a role limitada do app.
Obtenha a conexão em **Supabase → Connect**. Mantenha TLS na conexão remota.
Não redefina a senha apenas para fazer o backup: isso pode quebrar a aplicação.

Na raiz do repositório, em um computador confiável:

```text
python scripts/manual_database_backup.py --output-dir CAMINHO_DA_PASTA_SEGURA
```

Cole a conexão no prompt oculto. Não a envie por chat, não a coloque no histórico
do terminal e não a salve no repositório. Para execução controlada também existe
`KOMA_BACKUP_DATABASE_URL`, lida apenas do ambiente.

O script só lê o banco e usa um mesmo retrato transacional para a cópia e para
as contagens de registros. Ele falha se a role puder omitir dados por RLS,
se `pg_dump` falhar ou se o arquivo não puder ser listado por `pg_restore`.
O pacote contém `application.dump` e `manifest.json` com contagens e SHA-256.
Essas verificações detectam falhas de cópia, mas **não substituem restauração**.

Escopo explícito: este é o backup da aplicação, não um clone completo do projeto
Supabase. Schemas gerenciados como `auth`, `storage`, Vault e histórico da CLI
Supabase não entram nesse script. O Kôma usa seus usuários no schema `public`.
Se o produto passar a depender desses serviços, ampliar o backup segundo a
[documentação oficial de backup/restauração](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).
Para arquivos Storage, seguir o [procedimento específico](https://supabase.com/docs/guides/platform/backups).

## Ensaiar a restauração

Uma restauração deve ser feita primeiro em um banco **novo, isolado e descartável**.
Não executar comandos de limpeza contra produção. O script de backup não tem
opção de restaurar, para evitar confundir origem e destino.

O responsável técnico deve:

1. Criar PostgreSQL compatível, as roles mencionadas no arquivo (`anon`,
   `authenticated`, `service_role`, `koma_app` e proprietários/grantees adicionais)
   e as extensões que existiam na origem. O dump não inclui senhas de roles.
2. Restaurar com `pg_restore --single-transaction --exit-on-error`, usando uma
   role administrativa. Em PostgreSQL vazio, o schema `public` pré-criado pode
   conflitar com o arquivo; tratar isso exclusivamente no banco descartável.
   No Supabase de destino, avaliar objetos gerenciados antes de restaurar.
3. Comparar **todas** as contagens com `manifest.json`, conferir a revisão Alembic,
   as policies RLS e as permissões. Recriar o usuário de runtime sem superuser,
   BYPASSRLS ou propriedade das tabelas e vinculá-lo a `koma_app`.
4. Executar os testes de isolamento no destino de teste; validar login, consulta
   de uma mesa, lançamento, total financeiro e leitura do cardápio. Não conectar
   esse ensaio a impressoras, pagamentos ou WhatsApp reais.
5. Registrar data, arquivo/hash, destino, resultado e tempo de recuperação.

Ensaio inicial em 05/09/2026: cópia e restauração de dados sintéticos no PostgreSQL
17 concluídas; contagens das **68 tabelas** coincidiram e **79 policies RLS**
foram restauradas. Isso valida o procedimento local; não significa que já existe
uma cópia restaurável dos dados de produção. A primeira cópia real continua
obrigatória antes da migração de valores monetários.

## Publicação

Dois conjuntos de alterações: conector local e confiabilidade da aplicação.
O conector pode ser validado primeiro. O segundo conjunto exige backup real,
revisão e todos os checks aprovados antes de integrar a branch principal.

Configuração alvo do serviço **Kôma**, sem alterar Evolution/Postgres/Redis:

- `Wait for CI` ligado.
- Prontidão em `/health/ready`, que consulta o banco.
- Root directory `/backend`, migrações por `alembic upgrade head` antes do start.
- Python `3.13.15`, a versão já observada em produção e agora usada no CI.
- Runtime PostgreSQL restrito; conexão administrativa exclusiva das migrações.

O painel Railway informa que **novos serviços não podem aderir ao Config as Code
legado desde 28/08/2026**. Por isso esta entrega não acrescenta um `railway.toml`
que o serviço não poderia usar. Para versionar infraestrutura posteriormente,
importar o projeto na opção [Infrastructure as Code](https://docs.railway.com/infrastructure-as-code)
e revisar o plano antes de aplicá-lo.

Existe uma alteração anterior pendente na Evolution API que o Railway rejeita
por incompatibilidade entre volume e múltiplas regiões. Não aplicar o botão
global de deploy sem resolver essa alteração. As duas configurações do Kôma
foram apenas preparadas no painel; ainda precisam ser aplicadas.

As migrações novas convertem sete campos monetários para `Numeric(14,2)`,
permitem convites sem senha e otimizam a avaliação de contexto de policies RLS.
Valores são arredondados a centavos; overflow aborta a transação. Preservar backup
prévio. Preferir correção progressiva a downgrade: converter decimal de volta a
float perde a representação exata, e a nulidade dos convites não é revertida.

Após publicar: validar `/health/ready`, login dos perfis, mesas/garçom, cardápio
com retirada, bloqueio real de entrega quando `delivery_ativo=false`, impressão
na G250 e reconexão de aba. Sessões antigas de SuperAdmin precisarão novo login.

Ainda não coberto por esta entrega: MFA do SuperAdmin, restauração real de todos
os serviços, instalador assinado/atualizador automático e medições de carga em
produção. Essas pendências devem permanecer visíveis, sem serem marcadas como
resolvidas apenas porque a suíte automatizada passou.
