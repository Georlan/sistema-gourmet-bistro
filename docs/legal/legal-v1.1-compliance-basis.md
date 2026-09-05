# KÔMA Legal v1.1 — base de conformidade

Data de referência: 05/09/2026.

Este documento registra as decisões de produto, premissas jurídicas e pendências de implementação que sustentam a Legal v1.1. Ele é interno e não substitui os documentos públicos renderizados em `src/legal/legalContent.ts`.

## Decisões comerciais congeladas

- Prestador inicial: pessoa física, operando sob a marca KÔMA. O CPF completo não deve ser hardcoded no repositório público; ele será incluído no Comprovante de Contratação individual.
- Identidade pública do prestador nesta versão: Georlan Gomes e Silva Júnior, Limoeiro do Norte/CE.
- Contratante: pessoa física ou jurídica identificada por nome/razão social e CPF/CNPJ.
- O representante deve declarar que possui poderes para contratar pelo estabelecimento.
- Pocket: R$ 109/mês + 1,49% dos pagamentos online aprovados elegíveis.
- Pro: R$ 209/mês + 0,69%.
- Premium: R$ 309/mês + 0,29%.
- Anual: cobrança única antecipada equivalente a 12 mensalidades fixas com 10% de desconto. A taxa por pagamento online não recebe desconto.
- Trial padrão: 7 dias sem mensalidade fixa; a taxa transacional continua incidindo sobre pagamentos online reais.
- Cobrança atual: manual. Cobrança automática futura depende de autorização específica do contratante.
- Cancelamento mensal: a qualquer momento, com acesso até o fim do período pago e sem nova renovação.
- Cancelamento anual: recalcular o período utilizado pelo preço mensal normal; fração do mês por dia usando 1/30; devolver o saldo positivo; nunca gerar dívida adicional apenas por esse recálculo.
- Inadimplência: tolerância de 5 dias corridos; depois, suspensão reversível. Sem hard delete por atraso.
- Upgrade e downgrade: efeito funcional imediato, com ajuste financeiro proporcional informado antes da confirmação.
- Reajuste: a cada 12 meses pelo IPCA; mudança extraordinária exige 30 dias de aviso e direito de cancelar antes da vigência.
- Suporte: WhatsApp, todos os dias, 09h–23h, horário de Brasília. Sem SLA percentual de uptime nesta versão.
- Redução material de recurso: 30 dias de aviso quando possível, salvo segurança, fraude, emergência ou obrigação legal.
- Janela de exportação após encerramento: 30 dias.
- Marketing automático: não utilizado nesta versão.
- DPA: KÔMA avisa o restaurante em até 24h após confirmar incidente relevante que afete dados tratados em nome dele; cooperação em direitos de titulares em até 5 dias úteis quando tecnicamente dependente do KÔMA.
- Foro B2B: Limoeiro do Norte/CE, preservadas competências obrigatórias e direitos cogentes.

## Arquitetura e fornecedores verificados em produção

- Railway: backend KÔMA e serviços auxiliares em `sfo`, San Francisco/CA, Estados Unidos.
- Supabase PostgreSQL principal: AWS `us-west-2`, Oregon, Estados Unidos.
- Supabase Storage: imagens de cardápio no mesmo projeto, quando utilizado.
- Cloudflare Pages: frontend em rede global Anycast.
- Mercado Pago: OAuth, Pix e Split 1:1 ativos; região de processamento não determinada pelo painel.
- Evolution API auto-hospedada no Railway: conector atual de WhatsApp; entrega final pela infraestrutura Meta/WhatsApp.
- Google Fonts: carregamento remoto atual no navegador.
- n8n: não ativo em produção.
- Sentry frontend: inativo. Sentry backend estava ativo na auditoria e deve ser removido/desabilitado antes da primeira contratação definitiva, conforme decisão do responsável pelo KÔMA.
- E-mail/SMS transacional dedicado: não existe nesta versão.

## Base normativa adotada

A Legal v1.1 foi estruturada com referência principal em:

- Código Civil — boa-fé, liberdade contratual, contratos de adesão e alocação de riscos.
- Código de Defesa do Consumidor e Decreto 7.962/2013 — usados também como padrão voluntariamente forte de transparência no checkout: identificação do fornecedor, resumo antes do aceite, correção de erros, confirmação imediata e disponibilização do contrato em meio reproduzível.
- MP 2.200-2/2001 — admite meios eletrônicos de prova de autoria e integridade além de ICP-Brasil quando aceitos pelas partes.
- Lei 13.709/2018 (LGPD) — bases legais, direitos, papéis de controlador/operador, segurança, retenção e transferências internacionais.
- Resolução CD/ANPD 2/2022 — regime simplificado para agentes de pequeno porte quando aplicável.
- Resolução CD/ANPD 15/2024 — comunicação e registro de incidentes de segurança.
- Resolução CD/ANPD 19/2024 — transferências internacionais e cláusulas-padrão contratuais brasileiras.
- Lei 15.211/2025 (ECA Digital) — acesso provável por crianças/adolescentes e mecanismos confiáveis de verificação de idade para conteúdo/produto proibido a menores.
- Marco Civil da Internet — guarda e proteção de registros de acesso à aplicação quando aplicável.
- Regras públicas do Mercado Pago Split 1:1 — taxa de marketplace e reembolso proporcional entre seller e marketplace.

## Pendências P0 antes do self-service definitivo

1. **Clickwrap persistente**
   - gravar versão e hash de cada documento aceito;
   - snapshot de plano, ciclo, preço fixo e taxa percentual;
   - identidade do contratante e representante;
   - data/hora, usuário/sessão, IP e User-Agent como evidência proporcional;
   - gerar Comprovante de Contratação reproduzível e disponibilizá-lo na área do cliente;
   - confirmar o aceite por e-mail quando houver provedor transacional, ou por outro meio eletrônico conservável até lá.

2. **Identificação jurídica sem vazamento no Git**
   - CPF completo do prestador entra apenas no instrumento individual/registro seguro;
   - não inserir CPF completo em commits, código público, testes ou screenshots;
   - coletar CPF/CNPJ do contratante com validação backend antes do aceite definitivo.

3. **Transferências internacionais**
   - manter inventário de país/região e papel de cada fornecedor;
   - verificar/celebrar o mecanismo exigido pela Resolução 19/2024 para Railway, Supabase, Cloudflare e demais fluxos aplicáveis;
   - Railway publica DPA, mas o texto público consultado é centrado em GDPR/UK/Swiss e não incorpora expressamente as cláusulas-padrão brasileiras;
   - Supabase prevê ajuste quando a jurisdição do exportador adotar novo mecanismo padrão; solicitar/confimar instrumento suplementar compatível com as cláusulas da ANPD;
   - Cloudflare também deve ter o mecanismo brasileiro confirmado para o fluxo aplicável;
   - não declarar internamente que mera execução de contrato resolve automaticamente todos os fluxos internacionais.

4. **Registros de acesso à aplicação**
   - validar a obrigação de guarda por 6 meses prevista no Marco Civil para o KÔMA como provedor com finalidade econômica;
   - a retenção atual dos logs de borda do Railway pode ser inferior a esse prazo;
   - implementar solução própria e minimizada caso a obrigação seja aplicável, com controle de acesso e política de descarte.

5. **Crianças, adolescentes e produtos 18+**
   - simples autodeclaração de idade não é suficiente para produto/serviço proibido a menores;
   - até existir mecanismo confiável compatível com a regulamentação, bloquear conclusão online de itens 18+ no cardápio;
   - mapear fluxo de menores para pedidos comuns e documentar o melhor interesse/minimização.

6. **Canal de privacidade**
   - canal temporário: WhatsApp oficial do KÔMA;
   - domínio/e-mail próprio é recomendado, mas não é tratado neste projeto como requisito literal da LGPD;
   - quando criado, publicar canal dedicado de privacidade e suporte sem quebrar versões contratuais anteriores.

7. **Sentry e Google Fonts**
   - remover/desabilitar Sentry backend conforme decisão do responsável e confirmar em produção;
   - avaliar hospedagem local das fontes para retirar Google Fonts da cadeia de terceiros;
   - até a remoção efetiva, o inventário deve refletir o estado real.

8. **WhatsApp**
   - Evolution API/Baileys é integração atual auto-hospedada;
   - tratar migração para API oficial Meta/WhatsApp como pendência operacional de conformidade e estabilidade;
   - não prometer disponibilidade do canal como garantia absoluta do SaaS.

## Critério para congelar a v1.1

Os textos públicos podem ser revisados e publicados antes da implementação do clickwrap, mas o botão definitivo de aceite/provisionamento self-service não deve produzir contrato final até que os blockers 1 e 2 estejam resolvidos. Para o primeiro cliente pagante, os itens 3, 4 e 5 devem possuir solução documentada ou restrição operacional explícita que impeça o fluxo não conforme.
