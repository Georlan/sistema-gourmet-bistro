# KÔMA Legal 2.0 — base de conformidade e auditoria

Data de referência: 13/09/2026.

Documento interno. A fonte pública canônica da Legal 2.0 é `src/legal/legalContentRecurring.ts`, congelada inicialmente no commit `977e1c58aa85334bfa8242ff51a834dec969f4e8`, blob `df18bdef93332c07ca049e59bf7a2d739194df36`.

Este documento registra as premissas jurídicas e os fatos técnicos usados na reescrita integral. Ele não substitui revisão de advogado ou contador sobre a situação concreta do prestador e de cada contratação.

## 1. Por que a versão 2.0 foi criada

A versão 1.3 corrigia a política de trial e cobrança recorrente, mas ainda herdava quase todo o conteúdo público da versão 1.2 por composição de código. Desde então o produto consolidou checkout recorrente, Pix Automático, liberação administrativa, clickwrap com evidência, split em pagamentos online, cardápio próprio, SmartPOS em estágio condicionado, sessões operacionais e fluxos de dados mais amplos.

A Legal 2.0 elimina a herança em runtime e passa a declarar todos os oito documentos públicos diretamente na fonte canônica.

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

- Planos: Pocket R$ 109 + 1,49%; Pro R$ 209 + 0,69%; Premium R$ 309 + 0,29%.
- Anual: 10% de desconto apenas no componente fixo.
- Trial padrão: 7 dias, iniciados na liberação efetiva do restaurante.
- Novas assinaturas: autorização recorrente antes da liberação e primeira cobrança fixa somente após o trial.
- Métodos recorrentes modelados: cartão de crédito e Pix Automático.
- Pix avulso antecipado não é método válido para novas assinaturas SaaS.
- O cardápio online está incluído nos planos e não depende de WhatsApp para concluir a compra.
- Taxa KÔMA incide somente sobre pagamentos online elegíveis processados pelo fluxo integrado.
- Mercado Pago pode executar split; tarifas do provedor são independentes da taxa KÔMA.
- Comandas, conferências, históricos SmartPOS e impressões operacionais são documentos não fiscais.
- Não existe, nesta versão, promessa geral de emissão de NFC-e/NF-e/NFS-e pelo KÔMA.
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
- Resolução CD/ANPD nº 19/2024, com alterações vigentes, sobre transferências internacionais e cláusulas-padrão.
- Lei nº 12.965/2014 (Marco Civil da Internet), especialmente obrigações de registros de acesso quando juridicamente aplicáveis.
- Lei nº 15.211/2025 e regulamentação correlata aplicável à proteção de crianças e adolescentes no ambiente digital e a fluxos de produtos restritos.
- Regras contratuais e técnicas do Mercado Pago aplicáveis a OAuth, pagamentos, split, recorrência, reembolso e chargeback.

## 5. Papéis de proteção de dados

### Restaurante como Controlador

Para consumidores, pedidos, endereços, clientes, equipe operacional e demais dados processados conforme decisões do estabelecimento, o restaurante é, em regra, Controlador.

### KÔMA como Operador

O KÔMA processa esses dados para executar a plataforma, seguindo contrato, configurações e instruções legítimas do restaurante.

### KÔMA como Controlador independente

O KÔMA define finalidade própria apenas onde necessário, incluindo contratação, cobrança do SaaS, segurança, prevenção a fraude, suporte, prova do aceite, cumprimento legal e exercício de direitos.

### Dados sensíveis

Observações de pedido podem conter alergia, intolerância ou outra informação de saúde. A versão 2.0 trata esse conteúdo explicitamente como dado sensível e exige minimização e finalidade relacionada à preparação segura.

## 6. Fornecedores e transferências

Estado identificado no repositório:

- Railway: backend e serviços auxiliares; infraestrutura verificada historicamente na região `sfo`, Estados Unidos.
- Supabase: PostgreSQL/Storage; projeto principal identificado em AWS `us-west-2`, Oregon, Estados Unidos.
- Cloudflare: entrega do frontend e borda em rede global.
- Mercado Pago: OAuth, pagamentos online, Pix, split e billing recorrente quando habilitados.
- Resend: envio de e-mail transacional quando configurado.
- WhatsApp/Meta + conector: comunicações quando habilitadas.
- Google Fonts: dependência remota ativa no frontend na auditoria de 13/09/2026.
- Sentry backend: SDK presente e inicialização condicional a `SENTRY_DSN`; deve ser declarado como condicional enquanto o código permitir ativação.

A presença nesta lista não significa que todos os fornecedores atuem como suboperadores em todos os fluxos. Mercado Pago, por exemplo, pode exercer papel independente próprio de pagamento.

## 7. Pendências jurídicas/operacionais que texto não resolve

### P0 — identificação jurídica e fiscal do prestador

O backend exige `KOMA_LEGAL_PROVIDER_NAME`, `KOMA_LEGAL_PROVIDER_TAX_ID`, `KOMA_LEGAL_PROVIDER_ADDRESS` e localização antes da contratação definitiva. A Legal 2.0 não publica documento fiscal pessoal no Git, mas o fluxo contratual deve apresentar a identificação completa exigível ao contratante.

A formalização do KÔMA em pessoa jurídica e o enquadramento tributário devem ser tratados com contador/advogado. A mudança futura de pessoa física para pessoa jurídica exigirá atualização da identificação pública e avaliação sobre cessão/migração dos contratos.

### P0 — transferência internacional

Não declarar conformidade apenas porque o fornecedor possui DPA estrangeiro. Para fluxos sujeitos à LGPD, confirmar mecanismo válido conforme a Resolução CD/ANPD nº 19/2024 e manter documentação probatória.

### P0 — itens 18+

Não liberar conclusão online de item cuja venda exija verificação robusta de idade enquanto o produto não possuir mecanismo compatível com a legislação aplicável. Autodeclaração isolada não deve ser tratada como solução suficiente quando a norma exigir mecanismo mais confiável.

### P1 — registros de acesso

Avaliar formalmente o enquadramento do KÔMA no art. 15 do Marco Civil. Se a obrigação de guarda por seis meses incidir, garantir solução própria, minimizada, segura e com controle de acesso; retenção eventual do provedor de nuvem não deve ser presumida suficiente sem verificação.

### P1 — documento fiscal do próprio SaaS

A cláusula pública promete apenas emissão do documento exigível conforme o enquadramento vigente. Definir com contador qual recibo/NFS-e/documento é obrigatório para a forma jurídica adotada e implementar o processo antes da escala comercial.

### P1 — Google Fonts e Sentry

Google Fonts permanece como chamada remota. Sentry permanece condicional no backend. Se forem removidos ou desabilitados de modo permanente, atualizar o inventário público na próxima revisão sem manter fornecedor inexistente.

## 8. Evidência contratual

A contratação já possui arquitetura para registrar versão jurídica, hashes dos documentos, snapshots de Termos/Condições/DPA/Privacidade, plano, ciclo, preço, taxa, identidade, IP e User-Agent. A Legal 2.0 mantém esse modelo e aponta a proveniência para o commit/blob da fonte jurídica canônica.

Contratos antigos devem continuar vinculados às versões e snapshots aceitos na data correspondente; não migrar retroativamente o texto de uma contratação concluída para 2.0 sem novo aceite quando a mudança for material.

## 9. Regra de manutenção

Qualquer mudança futura em billing, planos, pagamentos online, armazenamento, suboperadores, documentos fiscais, idade mínima, papéis LGPD ou retenção deve disparar revisão jurídica do documento afetado.

Evitar patches que importem integralmente uma versão antiga e troquem apenas uma seção. A fonte jurídica vigente deve permanecer completa, legível e auditável como snapshot canônico.
