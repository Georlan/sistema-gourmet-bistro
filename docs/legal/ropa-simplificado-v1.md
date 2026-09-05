# KÔMA — Registro Simplificado de Operações com Dados Pessoais (ROPA) v1

Data de referência: 05/09/2026.

Documento interno inspirado no modelo simplificado da ANPD para agentes de tratamento de pequeno porte. Deve ser atualizado sempre que uma nova integração ou finalidade entrar efetivamente em produção.

## 1. Contratação e administração do SaaS

- **Titulares:** responsáveis pelo restaurante, representantes, administradores e contatos comerciais.
- **Dados:** nome, e-mail, telefone, CPF/CNPJ do contratante, cargo/função, restaurante, plano, ciclo, preço, aceite, IP/User-Agent e histórico contratual.
- **Finalidades:** procedimentos pré-contratuais, execução do contrato, administração da conta, cobrança, suporte, comprovação do aceite e defesa de direitos.
- **Bases:** execução de contrato; obrigação legal/regulatória quando aplicável; exercício regular de direitos; legítimo interesse compatível para segurança e suporte.
- **Compartilhamentos:** Railway, Supabase, Cloudflare e demais fornecedores necessários ao fluxo; provedor de cobrança quando futuramente integrado.
- **Transferência internacional:** sim — Railway/EUA, Supabase/EUA e Cloudflare/global.
- **Retenção:** vigência contratual; comprovantes e evidências em regra até 5 anos após encerramento, ressalvado prazo legal diverso.
- **Segurança:** autenticação, RLS/multi-tenant, controle de acesso, TLS, auditoria administrativa, hashes/versões no clickwrap quando implementado.

## 2. Usuários e colaboradores do restaurante

- **Titulares:** administradores, gerentes, caixas, garçons, entregadores e demais usuários convidados.
- **Dados:** nome, e-mail, telefone, cargo, permissões, hash de senha, tokens de ativação/sessão, eventos de autenticação e atividade necessária à operação.
- **Finalidades:** autenticação, autorização, execução do serviço, suporte, segurança e auditoria.
- **Bases:** execução do contrato do restaurante; legítimo interesse e segurança; obrigação legal quando aplicável.
- **Papéis:** restaurante controla a decisão de cadastrar sua equipe; KÔMA opera os dados para prestar o SaaS e atua como controlador apenas para segurança própria e registros contratuais aplicáveis.
- **Compartilhamentos:** Railway, Supabase, Cloudflare e WhatsApp/Meta quando o envio de convite ou OTP estiver habilitado.
- **Transferência internacional:** sim.
- **Retenção:** enquanto usuário/contrato estiver ativo e períodos posteriores necessários à segurança, auditoria e exercício de direitos.
- **Segurança:** segregação por restaurante, permissões por papel, hash de senha, tokens com expiração, logs e revogação de sessão.

## 3. Pedido e atendimento do consumidor

- **Titulares:** consumidores dos restaurantes.
- **Dados:** nome, telefone, e-mail quando necessário, endereço/referência de entrega, itens, valores, observações, modalidade, histórico do pedido, status e identificadores internos.
- **Finalidades:** registrar, preparar, cobrar, entregar, acompanhar e prestar suporte sobre o pedido; evitar duplicidade e fraude.
- **Bases:** execução da compra e procedimentos relacionados; legítimo interesse compatível para segurança; obrigação legal e exercício regular de direitos.
- **Papéis:** restaurante = controlador do pedido; KÔMA = operador para a operação; KÔMA = controlador independente apenas em segurança própria e registros técnicos limitados.
- **Compartilhamentos:** Railway, Supabase, Cloudflare, Mercado Pago quando houver Pix e WhatsApp/Meta quando houver notificação.
- **Transferência internacional:** sim.
- **Retenção:** conforme necessidade operacional, contrato do restaurante, obrigações legais e defesa de direitos; após término do SaaS aplica-se janela de exportação e política de eliminação.
- **Segurança:** criptografia de campos aplicáveis, TLS, tenant isolation/RLS, idempotência, autenticação do cliente quando utilizada.

## 4. Observações de alergia ou saúde

- **Titulares:** consumidores que voluntariamente informam restrição ou alergia.
- **Dados:** informação de saúde inserida em campo de observação do pedido.
- **Finalidade:** permitir preparação mais segura e comunicar instrução necessária ao restaurante.
- **Base:** deve ser avaliada conforme o caso concreto e somente utilizada quando indispensável à segurança/prestação do pedido; não utilizar para marketing ou perfilamento.
- **Papéis:** restaurante controlador; KÔMA operador.
- **Compartilhamentos:** somente usuários autorizados do restaurante e infraestrutura necessária ao pedido.
- **Transferência internacional:** sim, pois integra o pedido armazenado/processado na infraestrutura atual.
- **Retenção:** vinculada ao registro do pedido; minimizar e não ampliar finalidade.
- **Risco:** dado pessoal sensível; revisar periodicamente necessidade e retenção.

## 5. Pagamento online Mercado Pago

- **Titulares:** consumidores pagadores e responsáveis pelas contas Mercado Pago dos restaurantes.
- **Dados enviados:** e-mail do pagador, valor, referência do pedido/intenção e application fee.
- **Dados recebidos:** payment id, status, QR/Pix, identificadores da conta conectada, metadados de conciliação e refund.
- **Finalidades:** criar pagamento, conciliar aprovação, aplicar Split 1:1, executar reembolso e comprovar transação.
- **Bases:** execução da compra/contrato; obrigações próprias do provedor financeiro; prevenção a fraude e exercício regular de direitos conforme aplicável.
- **Papéis:** restaurante e KÔMA definem o fluxo comercial; Mercado Pago possui tratamentos próprios e pode atuar como controlador independente para KYC, antifraude, liquidação e obrigação regulatória.
- **Compartilhamentos:** Mercado Pago e infraestrutura KÔMA.
- **Transferência internacional:** região do Mercado Pago não determinada; a infraestrutura KÔMA permanece internacional.
- **Retenção:** registros financeiros e de conciliação conforme obrigações legais e defesa de direitos.
- **Segurança:** OAuth, tokens cifrados, webhooks validados, idempotência, reconciliação e ledger de refund.

## 6. Notificações WhatsApp

- **Titulares:** consumidores e colaboradores destinatários.
- **Dados:** telefone, nome do restaurante, número/status do pedido, link de acompanhamento e códigos OTP quando aplicável.
- **Finalidades:** comunicação operacional solicitada/necessária ao serviço e autenticação.
- **Bases:** execução do contrato/pedido; legítimo interesse compatível e segurança/autenticação, conforme o fluxo.
- **Compartilhamentos:** conector Evolution API auto-hospedado no Railway e infraestrutura WhatsApp/Meta.
- **Transferência internacional:** sim — Railway/EUA e Meta/global.
- **Retenção:** conteúdo/logs somente pelo período técnico e operacional necessário; revisar a retenção efetiva da Evolution API.
- **Segurança:** rede interna Railway até o conector, sessão protegida em volume, minimização do conteúdo enviado.
- **Pendência:** migrar para integração oficial Meta/WhatsApp quando viável.

## 7. Logs, segurança e prevenção a fraude

- **Titulares:** usuários, consumidores, administradores e agentes que acessam a aplicação.
- **Dados:** IP, User-Agent, timestamp, rota, request-id, status HTTP, tenant/restaurante, eventos de autenticação e ações administrativas auditáveis.
- **Finalidades:** segurança, diagnóstico, prevenção a fraude, investigação de incidentes, disponibilidade e cumprimento de obrigação legal.
- **Bases:** legítimo interesse com minimização; cumprimento de obrigação legal; exercício regular de direitos.
- **Compartilhamentos:** Railway e Cloudflare; outros provedores somente se ativados e documentados.
- **Transferência internacional:** sim.
- **Retenção:** deve observar a obrigação de guarda de registros de acesso à aplicação quando aplicável; pendente validar e implementar retenção de 6 meses de forma minimizada e segura.
- **Segurança:** acesso restrito, filtros de logs sensíveis, request-id e ausência deliberada de segredos/tokens nos registros.

## 8. Suporte e atendimento de privacidade

- **Titulares:** usuários, consumidores e representantes que entram em contato.
- **Dados:** contato, conteúdo da solicitação, identificadores necessários para localizar conta/pedido e evidências de atendimento.
- **Finalidades:** suporte, resolução de incidente, exercício de direitos LGPD, reclamação e defesa de direitos.
- **Bases:** execução de contrato; obrigação legal; exercício regular de direitos; legítimo interesse compatível.
- **Compartilhamentos:** WhatsApp/Meta no canal atual e infraestrutura KÔMA quando a informação é registrada internamente.
- **Transferência internacional:** sim.
- **Retenção:** pelo período necessário à resolução, auditoria e eventual defesa de direitos; evitar copiar dados excessivos para canais informais.
- **Segurança:** verificar identidade antes de entregar dados, não solicitar senhas/tokens, redigir dados excessivos em screenshots.

## Revisão

Revisar este ROPA quando ocorrer qualquer um dos eventos abaixo:

- novo fornecedor passa a receber dados reais;
- alteração de região de Railway/Supabase;
- ativação de n8n, e-mail, SMS, analytics ou IA;
- mudança do fluxo de pagamento;
- implementação de verificação de idade;
- mudança relevante na coleta do cardápio;
- nova finalidade de marketing ou perfilamento;
- incidente que revele tratamento não documentado.
