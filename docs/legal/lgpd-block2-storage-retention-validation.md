# KÔMA — LGPD Bloco 2: armazenamento, proteção e retenção

Data de referência: 29/09/2026.

Este documento registra as decisões técnicas do Bloco 2. Ele não substitui
parecer jurídico e não declara certificação formal de conformidade. A revisão
pública de Termos, Política de Privacidade e DPA acontece somente depois dos
blocos técnicos de LGPD.

## 1. Objetivo

Reduzir exposição de dados pessoais sem destruir o histórico comercial necessário
ao restaurante e ao futuro CRM.

Regra estrutural:

- `Cliente.id` é a identidade canônica;
- telefone, e-mail, nome e endereço não são chaves de relacionamento quando
  `cliente_id` existe;
- histórico comercial é derivado de fatos do pedido e `cliente_id`;
- PII necessária permanece protegida em repouso e disponível apenas em contexto
  autorizado;
- inatividade comercial, isoladamente, não dispara exclusão automática.

## 2. Controles técnicos validados pelo desenho

### Cliente

- nome, telefone, e-mail e endereço criptografados em repouso;
- telefone/e-mail pesquisáveis por blind indexes HMAC tenant-scoped;
- unicidade preservada sem índice em plaintext;
- login, cadastro, reconhecimento interno e recuperação de senha usam o lookup
  canônico, não comparação com ciphertext;
- a migração bloqueia colisões legadas em vez de fundir clientes silenciosamente.

### Pedidos e relacionamento

- `Comanda.cliente_id` preserva a ligação histórica;
- nome/telefone/endereço operacionais da comanda são criptografados;
- o read model `customer_relationship` calcula pedidos concluídos, gasto total,
  ticket médio, última compra, dias sem comprar e segmento usando
  exclusivamente `cliente_id`;
- dados sensíveis em observações continuam no contexto do pedido e não viram
  atributo comercial/segmentação automaticamente.

### Pagamentos

- `Pagamento.cliente_id` é a chave canônica quando disponível;
- snapshots legados `cpf_cliente` e `nome_cliente` ficam criptografados;
- nenhum índice plaintext é mantido em `cpf_cliente`.

### WhatsApp e rascunhos

- telefone, conteúdo e transcrição de mensagens são criptografados;
- telefone, conteúdo JSON e sugestão de IA dos rascunhos são criptografados;
- eliminação/anonymização por solicitação de titular será consolidada no Bloco 3,
  reaproveitando o fluxo já existente.

### PostgreSQL / RLS

- aplicação valida a role de runtime no startup;
- SUPERUSER, BYPASSRLS, ownership de tabela tenant ou ausência de membership em
  `koma_app` bloqueiam startup;
- em produção o bloqueio não pode ser desabilitado por
  `STRICT_RLS_ROLE_CHECK=false`;
- override inseguro existe apenas em ambientes não produtivos explicitamente
  reconhecidos.

## 3. Retenção

O KÔMA não codifica um prazo destrutivo universal para consumidor/pedido.

A lógica é:

1. preservar fatos comerciais e evidências necessárias;
2. minimizar PII redundante quando a finalidade terminar e não houver hipótese
   de conservação aplicável;
3. não apagar automaticamente a identidade canônica apenas porque o cliente
   ficou inativo;
4. permitir que o CRM saiba há quanto tempo o cliente não compra por
   `cliente_id`, sem depender de telefone/endereço repetidos;
5. backups seguem ciclo técnico próprio e não devem reintroduzir dado eliminado
   ao uso operacional normal.

Referências de prazo que são específicas, e portanto podem ser tratadas
separadamente:

- registros de acesso à aplicação: 6 meses quando o art. 15 do Marco Civil da
  Internet for aplicável;
- registros de incidentes de segurança abrangidos pelo RCIS: ao menos 5 anos.

## 4. Reuso deliberado de arquitetura

Este bloco não cria uma segunda camada de clientes ou CRM.

Foram reaproveitados:

- `services/clientes.py` para identidade e lookup;
- `services/customer_relationship.py` para métricas comerciais;
- criptografia Fernet já utilizada por Comanda/WhatsApp;
- tenant isolation/RLS existente em `database.py`;
- padrão de dry-run, fingerprint, transação, lock e validação do
  `safe_data_purge.py` como referência para futuras rotinas destrutivas;
- `ActivityLog`/auditoria existente;
- política interna de retenção e resposta a incidentes.

## 5. Critérios de fechamento do Bloco 2

- migrations com uma única head e upgrade/downgrade/re-upgrade verdes;
- Backend Full Suite verde;
- Koma Minimal Gate verde;
- regressões de autenticação/cadastro/recuperação verdes;
- teste de PII canônica em ciphertext;
- teste de snapshots de pagamento em ciphertext;
- teste provando que a trava RLS não é desabilitável em produção;
- documentação de retenção/ROPA alinhada ao comportamento real.

## 6. Itens deliberadamente posteriores

Bloco 3:
- solicitação de acesso/correção/eliminação/anonymização por identidade canônica;
- preferências de comunicação;
- opt-out comercial separado de mensagens operacionais;
- auditoria do atendimento ao titular.

Fechamento LGPD:
- confirmar configuração real de produção/Railway e backup;
- revisar fornecedores e retenção efetiva externa;
- atualizar Termos de Uso, Política de Privacidade, DPA e aviso do Cardápio
  conforme o produto efetivamente implementado.
