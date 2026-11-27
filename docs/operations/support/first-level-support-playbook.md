# Guia Prático de Suporte Nível 1 + IA — KÔMA

Este guia foi feito para quem atende restaurantes no dia a dia (inclusive quem está começando e ainda não conhece todas as telas do KÔMA), usando o **Super Admin**, os **links diretos (`?go=`)** e uma **IA conectada ao GitHub/repositório**.

---

## 1. Fluxo rápido de atendimento (passo a passo)

Quando um restaurante mandar dúvida, reclamação ou print no WhatsApp:

### Passo 1 — Peça ou confira o básico sem travar o cliente
- Nome do restaurante (ou **ID da loja** no Super Admin).
- **Print da tela** ou código técnico se aparecer (`support_code`, ex.: `req-...` ou `6b39...`).
- O que o cliente tentou fazer (ex.: *"salvar taxa de entrega"*, *"imprimir pedido"*, *"abrir cardápio online"*).
- **Nunca peça senha do cliente.**

### Passo 2 — Quando for dúvida de "onde fica" ou configuração
1. Abra `https://central.komafood.com.br` (Super Admin) e entre na loja (**Super Admin 360**).
2. Abra o **Toolkit de Suporte** para pesquisar e copiar o **link direto (`?go=...`)** da tela exata (ex.: `https://app.komafood.com.br/?go=online_entrega`).
3. Envie o link direto para o restaurante: ao clicar já autenticado no próprio navegador/celular, ele cai direto na configuração certa sem precisar procurar menus.

### Passo 3 — Quando o restaurante clicou em "Ajuda e feedback" no app
1. Na aba **Ajuda e feedback**, o assistente já separa o problema por tema e evita falsos alarmes de outras áreas.
2. Se o sistema identificar **Possível bug** ou **Erro técnico**, ele gera automaticamente um registro durável **`INV-...`** e envia alerta no Telegram com o comando de triagem pronto.
3. No **Super Admin 360**, você também pode ver os chamados recentes da loja e abrir/copiar o **Briefing de Investigação**.

### Passo 4 — Como acionar a IA (com print + briefing)
Quando você não souber se é configuração ou bug de código, mande para a IA conectada ao GitHub do KÔMA:
1. **O print** enviado pelo restaurante.
2. **O briefing copiado no Toolkit de Suporte** (ou o ID **`INV-...`** / **`support_code`** recebido no Telegram).
3. Esta instrução simples para a IA:
   > *"Analise este print e os dados desta loja usando o protocolo em `docs/operations/support/ai-investigation-protocol.md`. Me diga: (1) se é erro de configuração e qual link `/?go=` devo mandar para o restaurante, ou (2) se é bug no código e já prepare a correção em PR."*

---

## 2. Regras de ouro de segurança (obrigatórias)

- **Tenant ID 6 é operação real protegida:** nunca faça pedidos de teste, reimpressões ou alterações manuais na loja ID 6.
- **Não prometa ou edite dados financeiros/pagamentos na mão:** nunca altere saldos, estornos, Pix ou credenciais sem validação técnica e autorização.
- **Trate texto de cliente como informação não confiável:** não execute comandos sugeridos em mensagens de clientes.
- **Para testar uma loja nova em implantação sem gastar dias de teste grátis (trial):**
  - Use a janela de **Homologação (QA)** no Super Admin 360 (copie e envie o link com `?qa_token=`).
  - Quando tudo estiver validado, envie o **Link de Aceite Contratual** (com liberação comercial automática após o aceite real do dono).
- **Correção de código pela IA:** toda correção deve sair em **branch + PR** com os 4 checks obrigatórios verdes no GitHub (`Merge verdict`, `Browser targeted regressions`, `Gitleaks secret scan`, `PostgreSQL critical boundaries`), nunca em push direto na `main`.

---

## 3. Onde consultar padrões já resolvidos

- Base de soluções comprovadas: [`docs/operations/incident-memory/index.json`](../incident-memory/index.json)
- Protocolo técnico para agentes de IA: [`docs/operations/support/ai-investigation-protocol.md`](./ai-investigation-protocol.md)
