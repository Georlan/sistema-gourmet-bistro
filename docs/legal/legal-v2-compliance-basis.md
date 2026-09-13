# KÔMA Legal 2.0 — base de conformidade e auditoria

Data de referência: 13/09/2026.

Documento interno. A fonte pública da Legal 2.0 é composta por `src/legal/legalContentV2.ts` (snapshot integral dos oito documentos) e `src/legal/legalContentRecurring.ts` (fachada vigente, que mantém a lista de meios recorrentes sincronizada ao produto). O commit de proveniência inicial é `22df9ec64ce2391ee78630598ea0852a85aab4c1`; o blob da fachada jurídica é `d7f1d9279bba4049e50c23b305f45d374cb24767` e o snapshot integral v2 é `df18bdef93332c07ca049e59bf7a2d739194df36`.

Este documento registra premissas jurídicas e fatos técnicos usados na revisão. Ele não substitui revisão profissional sobre o enquadramento concreto do prestador, tributação, transferências internacionais ou relações específicas com clientes.

## 1. Por que a versão 2.0 foi criada

A versão 1.3 corrigia a política de trial e cobrança recorrente, mas ainda herdava quase todo o conteúdo da versão 1.2. O produto passou a incluir uma contratação muito mais estruturada, clickwrap com evidências, autorização recorrente, liberação administrativa, pagamentos online com split, Pix Automático, Saldo Mercado Pago, cardápio próprio, SmartPOS condicionado a homologação, sessões operacionais segregadas e fluxos de dados mais amplos.

A Legal 2.0 reescreve integralmente os oito documentos públicos. A v1.2 permanece apenas como snapshot histórico e não deve ser usada para montar novos contratos.

## 2. Documentos públicos cobertos

- Termos de Contratação e Uso do KÔMA.
- Condições Comerciais dos Planos KÔMA.
- Política de Privacidade do KÔMA.
- Anexo de Tratamento de Dados Pessoais (DPA).
- Fornecedores, Suboperadores e Transferências.
- Política de Cookies e Armazenamento Local.
- Termos de Uso do Cardápio Digital.
- Política de Privacidade do Cardápio Digital.

## 3. Fatos de produto congelados nesta versão

- Pocket: R$ 109/mês + 1,49% sobre pagamentos online aprovados elegíveis.
- Pro: R$ 209/mês + 0,69%.
- Premium: R$ 309/mês + 0,29%.
- Anual: 10% de desconto apenas no componente fixo.
- Trial padrão: 7 dias, iniciados na liberação efetiva do restaurante.
- Novas assinaturas: autorização recorrente antes da liberação e primeira cobrança fixa somente após o trial.
- Métodos recorrentes modelados: cartão de crédito, Pix Automático e Saldo Mercado Pago (`account_money`), sempre sujeitos às capacidades publicadas pelo backend e à homologação do provedor.
- Pix avulso antecipado não é método válido para novas assinaturas SaaS.
- O cardápio online está incluído nos planos e não depende de WhatsApp para concluir a compra.
- A taxa KÔMA incide somente sobre pagamentos online elegíveis processados pelo fluxo integrado.
- Mercado Pago pode executar split; tarifas do provedor são independentes da taxa KÔMA.
- Comandas, conferências, históricos SmartPOS, pedidos e impressões operacionais são documentos não fiscais.
- Não existe, nesta versão, promessa geral de emissão de NFC-e, NF-e ou NFS-e pelo KÔMA.
- SmartPOS real depende de provider/homologação; simuladores e bridges de desenvolvimento não são oferta comercial.
- Janela padrão de exportação após encerramento: 30 dias.
- Inadimplência: tolerância de 5 dias; possibilidade de encerramento após 30 dias, sem hard delete automático.

## 4. Base normativa principal

A redação foi estruturada com referência principal em:

- Código Civil, incluindo boa-fé, interpretação e alocação de riscos em contratos empresariais.
- Código de Defesa do Consumidor, preservando sua aplicação quando a relação concreta preencher os requisitos legais.
- Decreto nº 7.962/2013, como referência para transparência em contratação eletrônica, identificação do fornecedor, resumo da contratação e meio reproduzível.
- Medida Provisória nº 2.200-2/2001 e regras brasileiras sobre prova e contratação eletrônica.
- Lei nº 13.709/2018 (LGPD).
- Resolução CD/ANPD nº 15/2024, sobre comunicação de incidentes de segurança.
- Resolução CD/ANPD nº 19/2024 e alterações vigentes, sobre transferências internacionais e cláusulas-padrão.
- Lei nº 12.965/2014 (Marco Civil da Internet), especialmente obrigações de registros de acesso quando juridicamente aplicáveis.
- Lei nº 15.211/2025 e regulamentação correlata aplicável à proteção de crianças e adolescentes no ambiente digital e a fluxos de produtos restritos.
- Regras contratuais e técnicas do Mercado Pago aplicáveis a OAuth, pagamentos, split, recorrência, reembolso e chargeback.

## 5. Papéis de proteção de dados

### Restaurante como Controlador

Para consumidores, pedidos, endereços, clientes, equipe operacional e demais dados processados conforme decisões do estabelecimento, o restaurante é, em regra, Controlador.

### KÔMA como Operador

O KÔMA processa esses dados para executar a plataforma, seguindo contrato, configurações e instruções legítimas do restaurante.

### KÔMA como Controlador independente

O KÔMA define finalidade própria onde necessário, incluindo contratação, cobrança do SaaS, segurança, prevenção a fraude, suporte, prova do aceite, cumprimento legal e exercício de direitos.

### Dados sensíveis

Observações de pedido podem conter alergia, intolerância ou outra informação de saúde. A Legal 2.0 trata esse conteúdo explicitamente como dado sensível e exige minimização e finalidade relacionada à preparação segura.

## 6. Fornecedores e transferências

Estado identificado no repositório:

- Railway: backend e serviços auxiliares; infraestrutura historicamente verificada na região `sfo`, Estados Unidos.
- Supabase: PostgreSQL/Storage; projeto principal identificado em AWS `us-west-2`, Oregon, Estados Unidos.
- Cloudflare: entrega do frontend e borda em rede global.
- Mercado Pago: OAuth, pagamentos online, Pix, split e billing recorrente quando habilitados.
- Resend: envio de e-mail transacional quando configurado.
- WhatsApp/Meta + conector: comunicações quando habilitadas.
- Google Fonts: dependência remota ativa no frontend na auditoria de 13/09/2026.
- Sentry backend: SDK presente e inicialização condicional a `SENTRY_DSN`; deve ser declarado como condicional enquanto o código permitir ativação.

Nem todo fornecedor atua como suboperador em todos os fluxos. O Mercado Pago, por exemplo, pode exercer papel independente próprio de pagamento.

## 7. Pendências jurídicas e operacionais que o texto não resolve

### P0 — identificação jurídica e fiscal do prestador

O backend exige `KOMA_LEGAL_PROVIDER_NAME`, `KOMA_LEGAL_PROVIDER_TAX_ID`, `KOMA_LEGAL_PROVIDER_ADDRESS` e localização antes da contratação definitiva. A Legal 2.0 não publica documento fiscal pessoal no Git, mas o fluxo contratual deve apresentar a identificação completa exigível ao contratante.

A formalização futura do KÔMA em pessoa jurídica e o enquadramento tributário devem ser tratados com contador e advogado. Mudança de pessoa física para pessoa jurídica exige atualização da identificação pública e avaliação sobre cessão ou migração contratual.

### P0 — transferência internacional

Não declarar conformidade apenas porque o fornecedor possui DPA estrangeiro. Para fluxos sujeitos à LGPD, confirmar e documentar mecanismo válido conforme a Resolução CD/ANPD nº 19/2024 e suas alterações vigentes.

### P0 — itens 18+

Não liberar conclusão online de item cuja venda exija verificação robusta de idade enquanto o produto não possuir mecanismo compatível com a legislação aplicável. Autodeclaração isolada não deve ser tratada como suficiente quando a norma exigir verificação mais confiável.

### P1 — registros de acesso

Avaliar formalmente o enquadramento do KÔMA no art. 15 do Marco Civil. Se a obrigação de guarda por seis meses incidir, garantir solução própria, minimizada, segura e com controle de acesso; retenção eventual do provedor de nuvem não deve ser presumida suficiente sem verificação.

### P1 — documento fiscal do próprio SaaS

A cláusula pública promete apenas emissão do documento exigível conforme o enquadramento vigente. Definir com contador qual recibo, NFS-e ou documento é obrigatório para a forma jurídica adotada e implementar o processo antes da escala comercial.

### P1 — Google Fonts e Sentry

Google Fonts permanece como chamada remota. Sentry permanece condicional no backend. Se forem removidos ou desabilitados de modo permanente, atualizar o inventário público na próxima revisão.

## 8. Evidência contratual

A contratação possui arquitetura para registrar versão jurídica, hashes dos documentos, snapshots de Termos, Condições, DPA e Privacidade, plano, ciclo, preço, taxa, identidade, IP e User-Agent. A Legal 2.0 mantém esse modelo e fixa proveniência no commit e blob da fonte vigente.

Contratos anteriores devem continuar vinculados às versões e snapshots aceitos na data correspondente. Não migrar retroativamente contratação concluída para 2.0 sem novo aceite quando a mudança for material.

## 9. Regra de manutenção

Mudanças futuras em billing, planos, pagamentos online, armazenamento, suboperadores, documentos fiscais, idade mínima, papéis LGPD ou retenção devem disparar revisão do documento jurídico afetado.

A fonte integral de cada grande versão deve permanecer preservada e auditável. Ajustes posteriores dentro da mesma versão devem ser pequenos, explícitos e protegidos por testes, evitando voltar ao modelo de herdar integralmente uma versão jurídica antiga.
