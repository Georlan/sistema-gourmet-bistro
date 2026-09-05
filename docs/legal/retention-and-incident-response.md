# KÔMA — Política interna de retenção e resposta a incidentes

Data de referência: 05/09/2026.

Documento interno. Não publicar detalhes operacionais que facilitem abuso; a versão pública da Política de Privacidade comunica somente o necessário aos titulares.

## 1. Princípios

- coletar e reter somente dados necessários à finalidade;
- separar dados operacionais do restaurante de dados próprios do KÔMA;
- nunca usar hard delete como resposta automática à inadimplência;
- preservar evidências necessárias a segurança, obrigação legal e defesa de direitos;
- eliminar ou anonimizar quando a finalidade terminar e não houver base para conservação;
- backups seguem ciclo próprio e não devem voltar ao uso operacional sem motivo legítimo de restauração.

## 2. Matriz de retenção inicial

| Categoria | Regra inicial | Observação |
| --- | --- | --- |
| Cadastro e contrato do restaurante | vigência + prazo necessário a obrigações e defesa de direitos | revisar com enquadramento fiscal definitivo |
| Aceite eletrônico, hashes e comprovante | em regra até 5 anos após encerramento | preservar versão exata e snapshot comercial |
| Dados operacionais do restaurante | vigência + 30 dias de janela de exportação | depois eliminar/anonimizar salvo retenção legal específica |
| Pedidos e registros financeiros | conforme obrigação do restaurante e necessidade de conciliação/defesa | não prometer prazo único sem mapear obrigação fiscal/consumerista |
| Logs de aplicação e segurança | prazo legal aplicável | P0: validar/implementar guarda de 6 meses quando Marco Civil exigir |
| Registros de incidentes de segurança | mínimo de 5 anos quando submetidos ao regulamento da ANPD | inclui incidentes comunicados e não comunicados quando aplicável |
| Backups manuais de produção | seguir procedimento de backup vigente | cópia externa protegida continua obrigatória para continuidade |
| Sessões/tokens temporários | somente enquanto válidos ou necessários a auditoria de revogação | nunca guardar token em log |
| Suporte | período necessário à resolução e defesa de direitos | evitar dados pessoais excessivos em WhatsApp/screenshots |
| Dados de alergia/saúde em observação | vinculados ao pedido e sua retenção legítima | não extrair para marketing ou perfilamento |

## 3. Encerramento de restaurante

1. Registrar data e motivo do encerramento.
2. Revogar novos acessos operacionais conforme regra contratual.
3. Manter janela de 30 dias para exportação dos dados disponibilizados pela plataforma.
4. Após a janela, identificar tabelas/objetos que podem ser eliminados, anonimizados ou devem permanecer por base legal específica.
5. Não apagar registros de aceite, auditoria, incidente ou conciliação que ainda tenham finalidade legítima.
6. Backups antigos expiram pelo ciclo técnico normal; não reintroduzir dados apagados no ambiente ativo sem necessidade de restauração.

## 4. Classificação inicial de incidentes

Ao detectar evento suspeito, registrar pelo menos:

- data/hora de detecção;
- data/hora estimada de início;
- sistemas e restaurantes possivelmente afetados;
- categorias de titulares e dados;
- se houve perda de confidencialidade, integridade ou disponibilidade;
- se há dado sensível, criança/adolescente, credencial ou informação financeira;
- causa conhecida ou hipótese ainda não confirmada;
- medidas imediatas de contenção;
- responsável pela investigação;
- decisão sobre comunicação e justificativa.

## 5. Fluxo de resposta

### 5.1 Detectar e conter

- revogar sessões/tokens comprometidos;
- isolar integração, usuário ou serviço afetado quando possível;
- preservar logs e evidências sem expor segredos;
- impedir alteração destrutiva que dificulte a investigação;
- acionar fornecedor envolvido se a origem estiver fora do KÔMA.

### 5.2 Confirmar escopo

Um alerta só deve ser tratado como incidente confirmado após evidência razoável de comprometimento. Não atrasar contenção enquanto a confirmação é investigada.

### 5.3 Avisar restaurante controlador

Quando o incidente confirmado afetar dados tratados pelo KÔMA em nome de um restaurante:

- notificar sem demora injustificada;
- prazo contratual máximo: 24 horas após confirmação, salvo impedimento técnico/legal justificado;
- informar em etapas se todos os detalhes ainda não estiverem disponíveis.

A primeira comunicação deve conter, na medida do conhecido:

- natureza e período;
- categorias de dados e titulares;
- quantidade estimada quando possível;
- medidas de contenção;
- riscos conhecidos;
- ações recomendadas ao restaurante;
- canal de acompanhamento.

### 5.4 Avaliar comunicação à ANPD/titulares

Quando o KÔMA for Controlador do tratamento afetado, avaliar o Regulamento de Comunicação de Incidente de Segurança da ANPD e os prazos vigentes. Quando o restaurante for Controlador, fornecer informação suficiente para que ele faça sua própria avaliação.

Não comunicar publicamente incidente apenas para reduzir ansiedade; comunicação deve ser precisa, útil e compatível com as obrigações legais.

## 6. Registro e pós-incidente

- manter registro do incidente pelo prazo regulatório aplicável, no mínimo 5 anos quando exigido pela Resolução CD/ANPD 15/2024;
- registrar causa raiz, impacto, decisões, comunicações e medidas corretivas;
- criar teste de regressão para falha técnica corrigível sempre que possível;
- revisar ROPA, fornecedores, política de retenção e DPA se o incidente revelar fluxo não documentado;
- não incluir credenciais, tokens ou segredos em issue pública ou commit.

## 7. Pendências antes do primeiro cliente

- confirmar retenção de registros de acesso compatível com Marco Civil;
- garantir cópia externa protegida do backup real;
- desabilitar/remover Sentry backend conforme decisão de não uso;
- migrar Google Fonts para hospedagem local quando possível;
- revisar retenção efetiva de logs/mensagens da Evolution API;
- criar canal dedicado de privacidade quando houver domínio/e-mail próprio.
