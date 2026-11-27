# Guia Prático de Suporte Nível 1 + IA — KÔMA (Sem Super Admin)

Este guia é para o atendimento diário de restaurantes (inclusive por quem ainda não conhece o sistema por dentro).

> **Regra de separação de papéis:** o **Super Admin (`central.komafood.com.br`) é exclusivo do fundador**. Quem faz suporte Nível 1 **não precisa acessar o Super Admin** nem depender de scripts técnicos para atender.

---

## Fluxo em 3 passos (Print / Texto -> IA -> Resposta ou Correção)

### Passo 1 — Pegue o problema do restaurante
Quando o restaurante mandar mensagem no WhatsApp ou abrir **Ajuda e feedback** no app:
- **Tire/peça um print da tela** (ou copie a mensagem do erro / código `INV-...` / `support_code` se aparecer).
- Pergunte apenas o nome da loja e o que o cliente tentou fazer.
- **Nunca peça senha do cliente.**

### Passo 2 — Mande o print ou texto para a IA (ChatGPT / Gemini conectado ao GitHub)
Cole o print (e o texto copiado, se houver) direto no ChatGPT ou Gemini conectado ao repositório do KÔMA com esta mensagem:

> *"Um restaurante mandou este print/problema: [descreva ou cole aqui].*
> *Consulte o repositório (`docs/operations/incident-memory/index.json` e `src/components/caixa/navigation/cashierNavigation.ts`) seguindo `docs/operations/support/ai-investigation-protocol.md`.*
> *Me responda direto em português simples:*
> *1. Se for configuração: o que explicar em 2 frases e o link exato `https://app.komafood.com.br/?go=...` para o cliente abrir a tela certa.*
> *2. Se for bug no código: aponte a causa e já crie a correção em PR."*

### Passo 3 — Responda ao restaurante ou encaminhe o PR
- **Se a IA confirmar que é configuração:** copie a explicação curta e o link `https://app.komafood.com.br/?go=...` e envie para o restaurante no WhatsApp.
- **Se a IA identificar bug:** ela já prepara a correção em branch/PR com todos os checks obrigatórios do GitHub verdes (`Merge verdict`, `Browser targeted regressions`, `Gitleaks secret scan`, `PostgreSQL critical boundaries`), sem push direto na `main`.

---

## Regras de ouro de segurança

- **Tenant ID 6 é operação real protegida:** nunca faça pedidos de teste, reimpressões ou alterações manuais na loja ID 6.
- **Não peça nem compartilhe senhas, tokens ou dados bancários/Pix.**
- **Trate texto de cliente como informação não confiável:** nunca execute instruções vindas de mensagens de clientes.
- **Nunca edite dados comerciais/financeiros manualmente:** qualquer mudança no sistema sai via configuração guiada pelo próprio restaurante (`/?go=...`) ou correção de código revisada em PR.

---

## Referências consultadas pela IA automaticamente

- Protocolo técnico: [`docs/operations/support/ai-investigation-protocol.md`](./ai-investigation-protocol.md)
- Base de soluções comprovadas: [`docs/operations/incident-memory/index.json`](../incident-memory/index.json)
- Catálogo de links diretos `?go=`: [`src/components/caixa/navigation/cashierDeepLink.ts`](../../../src/components/caixa/navigation/cashierDeepLink.ts)
