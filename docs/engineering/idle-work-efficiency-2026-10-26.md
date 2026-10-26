# Economia de trabalho ocioso — 26/10/2026

Base: main `2fa52fa679e0`. A refatoração paralela do entregador altera projeções
de pedidos/financeiro; este lote mantém esses arquivos e a apresentação intactos.
ID 6 é operação real protegida. Acer é instalação de teste informada pelo titular;
nenhum pareamento, token ou protocolo instalado é alterado neste lote.

## Contratos e comportamento

- `PRODUCT_IMAGE_GC_EXECUTE` ausente, false ou inválida: o sweep automático
  retorna antes de abrir sessão ou descobrir tenants. Não reavalia candidatos
  enquanto a exclusão está desabilitada. O CLI `backend/tools/product_image_gc.py`
  continua oferecendo inventário/dry-run explícito, com escopo obrigatório.
- Flag true: mantém coleta, retenção, proteção de referências globais/aliases,
  isolamento, locks e continuidade após falha de um tenant. Nada ativa a flag.
- Conferência Pix: leitura autenticada na montagem visível/online, evento de
  pedidos relevante, retorno de foco/visibilidade e reconexão. Lista vazia usa
  segurança de 60 s após conclusão da leitura; pendências/erro usam 15 s.
  As leituras têm exclusão mútua, invalidation coalescida, abort/timeout e cleanup.
  Resultado de leitor abortado não atualiza a UI de outro tenant.
- Evento perdido é recuperado pela consulta de segurança. Nenhuma transição
  financeira, confirmação/cancelamento ou referência bancária foi modificada.
- Fonte autoritativa continua sendo o banco, com a mesma rota, JWT/permissões e
  consulta tenant-local. Não introduz cache compartilhado de respostas privadas.

## Baseline e ganho verificável

- Produção, 26/10 12:30–12:40 UTC: três consultas de referência de imagens,
  aproximadamente 8,3 s SQL somados, apesar da exclusão desabilitada.
- Antes: GC abria sessão e percorria tenants/candidatos em cada ciclo horário.
  Depois: quatro ciclos simulados desabilitados abrem zero sessões; flag true
  ainda percorre tenants e tolera falha individual. Não executa DELETE em produção.
- Antes: Caixa visível consultava Pix a cada 15 s mesmo sem pendência.
  Depois: em quatro minutos estáveis e vazios, teste com relógio controlado
  passa de 16 leituras periódicas para quatro (mais a leitura inicial nos dois).
  Redução de 75% nesse trecho; eventos continuam imediatos e pendências usam
  a cadência anterior. Isso não equivale a 75% da fatura ou throughput certificado.
- Testes cobrem lista vazia por múltiplas janelas, evento perdido, rajadas,
  offline/oculto, retorno, falha/hang, desmontagem e troca de tenant. A jornada
  de browser continua cobrindo confirmação manual, falha/retry e rascunho do Pix.

## Variáveis Railway: leitura literal não basta

101 variáveis próprias foram inventariadas no serviço da API, sem salvar valores.
Nove nomes PagBank não aparecem por inteiro no runtime porque
`services/online_payments/pagbank/oauth.py` usa `credential(name, environment)`
com prefixo `PAGBANK_` ou `PAGBANK_PRODUCTION_`. **Não remover** credenciais,
owner e callback de piloto/produção por ausência de ocorrência literal.

Quatro variáveis são legadas sem consumidor atual:

- `KOMA_CENTRAL_WA_OPERATOR_PHONE`
- `KOMA_CENTRAL_WA_PILOT_CUSTOMER_PHONE`
- `KOMA_CUSTOMER_WA_MONTHLY_MESSAGE_LIMIT`
- `KOMA_CUSTOMER_WA_MONTHLY_BUDGET_BRL`

Destinos vêm do cadastro; contadores/custo unitário continuam no mecanismo atual.
Os testes existentes de WhatsApp confirmam que os números legados e limites não
governam despacho. A existência dessas variáveis quase não pesa em recursos;
retirá-las reduz confusão operacional. Não foram removidas pelo deploy deste código.
`RUNTIME_DATABASE_URL` também não é lida diretamente pela API, mas é mantida
enquanto referências externas entre serviços e contratos de operação são revisados.

Não apagar segredos de pagamento, `DATABASE_URL`, `MIGRATION_DATABASE_URL`, flags
de consentimento, configurações de backup ou dependências do Evolution.

## Reversão e publicação

Sem migration, mudança de schema, infra nova ou alteração de env de produção.
Reverter este lote restaura as leituras anteriores; não apaga estado nem reenfileira
efeitos. Manter GC execute false e retenção de chat desligada na reversão.

Antes de integrar: CI no SHA final e revisão, incluindo testes PostgreSQL de
imagens e regressão do agente instalado além dos TTLs. Depois: verificar SHAs
API/frontend, readiness e leitura de logs/contadores durante mais de um ciclo
horário do GC. Um intervalo curto sem consulta não prova o efeito horário.
Para Pix, validar redução no cliente servido quando houver sessão legítima
visível. Não gerar pedido, Pix ou impressão de teste no ID 6.

O aviso Supabase fica sob a providência financeira do titular, que informou
pagamento antes de 02/11; ele não é gate de implementação deste lote.
