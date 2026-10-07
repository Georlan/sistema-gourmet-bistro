# Rodada de segurança e RLS — 7 de outubro de 2026

## Contrato de isolamento

O backend autentica o usuário e vincula cada transação ao restaurante através de
`TenantSession` e `app.current_restaurante_id`. A role de produção `koma_runtime`
é membro de `koma_app`, não é proprietária das tabelas, superuser ou BYPASSRLS.
As tabelas de operação devem ter ENABLE e FORCE RLS, com USING e WITH CHECK;
SQL bruto também deve respeitar a fronteira. Uma sessão sem identidade não pode
ler ou escrever dados de restaurantes. O contexto é transacional, restaurado
após fluxos públicos, e não deve ser alterado com operações pendentes.

O banco não autentica o JWT próprio do KÔMA: a autenticidade da identidade ainda
é responsabilidade do backend. RLS é defesa adicional contra consultas sem
filtro; não protege contra comprometimento completo da credencial do runtime.

## Correções e publicação compatível

1. Listagem global dos contatos do Ceará Tech e impressão promocional exigem
   `get_current_admin`, incluindo identidade, tenant zero e geração vigente do
   Super Admin. Antes, aceitavam qualquer usuário de restaurante autenticado.
   A submissão pública e a deduplicação continuam funcionando.
2. A migração `34636096d350` prepara somente a resolução mínima de identidade
   das notificações WhatsApp; **não ativa RLS ainda**. O helper interno devolve
   apenas id/restaurante de um wamid único. IDs desconhecidos ou ambíguos não
   resolvem identidade. SECURITY DEFINER tem search_path fixo, referências
   qualificadas, PUBLIC/browser revogados e execução exclusiva de `koma_app`.
3. O callback exige assinatura e phone-number-id válidos antes de resolver a
   identidade, abre uma transação do restaurante, bloqueia a linha para evitar
   corridas e preserva estados monotônicos. Fecha cada atualização antes de
   restaurar o contexto. Não grava o corpo integral do webhook.
4. Só após confirmar esta versão servida pode outra migração ativar a RLS de
   `notificacoes_whatsapp`. Assim o processo antigo durante rolling deploy não
   ignora callbacks porque perdeu acesso à consulta global. Nenhuma migração
   desta rodada deve excluir ou reescrever notificações, pedidos ou restaurantes.

## Dependências vulneráveis

O lock fixava PyJWT 2.13.0 e urllib3 2.7.0, com 16 avisos conhecidos na auditoria
anterior. Esta etapa atualiza somente PyJWT para 2.15.1 e urllib3 para 2.8.0,
com pisos correspondentes no requirements. Todas as demais versões são mantidas.
[Changelog PyJWT](https://pyjwt.readthedocs.io/en/latest/changelog.html) e
[release urllib3](https://github.com/urllib3/urllib3/releases/tag/2.8.0).
Regressões de autenticação devem passar com essas versões antes da publicação.

## Exceções verificadas e diagnóstico inicial

- `notificacoes_whatsapp`: gap confirmado, tenant-owned com DML direto e sem RLS.
  A migração `47a6b7c8d9e0` aplica ENABLE/FORCE e política com USING/WITH CHECK.
  Linhas legadas com restaurante nulo devem ser preservadas e permanecer negadas.
- `koma_event_leads`: contatos globais da plataforma, sem restaurante_id. A API
  pública pode somente submeter; a leitura é exclusiva do Super Admin. Não impor
  uma política por restaurante que interrompa a landing. Não há grants browser.
- `restaurant_signups`, `saas_billing_setups`, `email_delivery_receipts`: runtime
  sem DML direto; operações privilegiadas passam pelas fronteiras internas.
- `contract_acceptances` e `signup_notifications`: runtime pode inserir, não
  consultar/alterar diretamente. São fluxos de cadastro/control-plane, cuja
  segurança deve ser testada nos helpers, não com um tenant fictício obrigatório.
- `fiscal_official_reference_*`: referências oficiais globais, não dados de
  clientes. Alterar sua política exige preservar manutenção fiscal.
- `koma_internal.transaction_reset_backups`: RLS sem política é negação total
  intencional; não criar USING(true) para silenciar o advisor.
- Produção apresentou grants anon SELECT em restaurantes, categorias e produtos
  que não constam mais no contrato de acesso canônico (frontend consulta API).
  A segunda etapa revoga a permissão legada, com simulação real do cardápio sob a role restrita. Sem grants de
  escrita browser e sem views públicas privilegiadas observadas.
- Storage `cardapio-assets`: público para servir imagens; limite 5 MiB, MIME de
  imagem restrito, nenhuma policy de objetos. Isso não libera upload/listagem
  browser. Upload/otimização seguem pelo backend. Não executar GC destrutivo.
- PR #999 publicou a etapa de RLS preparada em #1032 junto ao hardening de
  importação XML e scans. A importação lê no máximo 10 MB + 1 byte, fecha o
  arquivo e devolve erro sanitizado. Auditorias Python/npm e histórico de
  segredos ficaram verdes; #1032 foi encerrada como incorporada.

## Eficiência preservada

A ordenação recente repetia a leitura de `restaurante_operation_profiles` no
snapshot público. A mesma leitura agora decide o modo de marmitaria e fornece o
perfil ao resolvedor canônico de ordenação. O fallback de nicho não habilita o
modo de marmitaria sozinho. O orçamento do cardápio volta a 15 SELECTs, mantendo
os testes de composição e prioridade de perfil explícito.

## Evidência e limites

A primeira etapa tem regressões de autorização negativa/positiva, assinatura,
replay e PostgreSQL real com role restrita, dois tenants sintéticos, identidade
ambígua e restauração do contexto. CI `Security tenant boundaries` repete a cadeia
Alembic num PostgreSQL descartável. Testes nunca apontam ao Supabase de produção.

Leitura inicial de produção: 14 conexões, zero lock waiters e zero idle-in-
transaction. Tenant 6: um restaurante, 127 comandas e 507 notificações. Essas
contagens são referência passiva, não cenário congelado: a operação pode crescer.
Backup validado/upload S3 em 2026-10-07T03:03:48.640Z. Freshness não equivale a
restauração ensaiada; manter exercício de recuperação separado.

Fontes: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security),
[funções e privilégios](https://supabase.com/docs/guides/database/functions),
`docs/engineering/infra-contract.md` e migrações Alembic atuais. Esta rodada não
é certificação de ausência de todas as vulnerabilidades; registrar publicação,
SHA servido e validação passiva antes de considerar as correções concluídas.

## Ativação da segunda etapa

A migração `47a6b7c8d9e0` deve ser publicada somente após observar a primeira
versão servida. Trata tanto schema criado do zero (policy já existe) quanto o
schema de produção com drift (policy ausente/RLS desativada). Recria somente a
policy canônica em transação, com lock_timeout de cinco segundos. Não altera
nenhuma linha nem cria índices: os índices de restaurante/wamid já existem.
Revoga grants browser em notificações e nas três tabelas legadas do cardápio; remove também suas policies anônimas antigas.

Os testes PostgreSQL cobrem SQL bruto sem tenant, leitura/escrita/movimentação
entre tenants, contexto não retido após rollback, preservação de órfãos legados,
callback de ambos os tenants, privilégios browser, cardápio pela API e ciclo de
migração com comparação integral dos registros sintéticos. O downgrade é
intencionalmente sem reabertura de permissões; para rollback do backend manter
pelo menos a implementação compatível da primeira etapa.

O processamento SQL do callback é executado fora do event loop. A simulação
mantém a atualização do banco pendente enquanto outra requisição responde;
uma rajada de callbacks não deve bloquear a execução das demais rotas async.

A auditoria npm revelou source-map-js 1.2.1 (dependência transitiva). O lock
atualiza somente esse pacote para 1.2.2, com integridade conferida no registry.
CI passa a auditar também o lock do frontend. Referência:
[advisory](https://github.com/advisories/GHSA-68fv-2mgg-jv7q).

Reenvio público de lead não é autorização para editar um contato global já
existente. A segunda etapa mantém a resposta de sucesso/deduplicação, mas não
reescreve nome, empresa, telefone ou recibo de consentimento. Além da proteção
contra alteração por quem apenas conhece o telefone, o retry dispensa commit.
Correções cadastrais pertencem ao fluxo administrativo autenticado.

## Publicação e verificação passiva concluídas

- PR [#1031](https://github.com/Georlan/sistema-gourmet-bistro/pull/1031):
  head final `f17b6ef3d25e`, todos os checks verdes e 2.209 testes aprovados.
  Merge `4215087db42c`; versão servida e migração `34636096d350` verificadas
  antes da ativação de RLS.
- PR [#999](https://github.com/Georlan/sistema-gourmet-bistro/pull/999):
  head final `16306f6c63e9`, 2.212 testes aprovados (46 skips declarados) e
  todos os checks verdes. Contém a etapa #1032 sem diferenças, além dos quatro
  arquivos de importação XML/scans. A suíte dedicada aprovou 43 testes,
  incluindo PostgreSQL real; testes de navegador e corridas de estoque passaram.
  Merge e backend servido `be7c39639867`, Railway SUCCESS em
  `2026-10-07T06:21:31Z`. Checks pós-merge também passaram.
- Supabase: Alembic `47a6b7c8d9e0`, notificações com ENABLE/FORCE RLS e policy
  `tenant_isolation` exclusiva de `koma_app`, com USING e WITH CHECK. Nenhum
  grant browser nas quatro tabelas verificadas; anon/authenticated sem DML
  efetivo em notificações.
- D6: fingerprint integral do cadastro preservado durante a publicação;
  127 comandas e 507 notificações nas comparações passivas. Cardápio HTTP 200,
  duas categorias e dez produtos. Nenhum reset, seed, pedido, cobrança,
  envio de mensagem ou impressão de QA executado em produção.
- Saúde: readiness HTTP 200, banco healthy (~100 ms na última leitura), zero
  lock waiters e zero idle-in-transaction. Conexões totais variaram de 14 a 22
  durante as trocas; leitura seguinte registrou 20, incluindo serviços
  gerenciados, e 12 conexões idle `koma_runtime`/Supavisor. Não interpretar
  o total como tamanho do pool da aplicação; nenhum pool/worker/réplica foi
  ampliado. Na janela de uma hora posterior à publicação, 0 de 533 requisições
  retornaram 5xx. São amostras de baixa carga, não prova de capacidade máxima.
- Smoke público GET/OPTIONS concluído sem falhas. Backup validado e enviado ao
  S3 em `2026-10-07T03:03:48.640Z`. Auditorias de dependências sem avisos
  conhecidos e scan do histórico aprovado, sem afirmar ausência de todo risco.
- Advisor: apenas INFO de `transaction_reset_backups` sem policy, negação
  intencional. [Referência do aviso](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).

## Próximas prioridades de manutenção

1. Ensaiar restauração do backup em banco isolado; freshness do arquivo não
   comprova recuperação. Não restaurar nem fazer reset no D6.
2. Validar capacidade sob carga multitenant em ambiente distinto, incluindo
   orçamento de conexões durante deploy, percentis e falhas. Esta rodada não
   certifica 10/100/1.000 restaurantes.
3. Manter os scans semanais, auditar o schema real após migrações e conferir
   a versão servida. Evitar QA destrutivo e política permissiva para silenciar
   advisors. Incidentes e prova física de impressão continuam em seu tracker.
