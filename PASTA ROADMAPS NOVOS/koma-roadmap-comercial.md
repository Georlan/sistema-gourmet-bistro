# Roadmap Comercial — KÔMA Gourmet Bistrô

> Documento de contexto para orientar decisões de desenvolvimento. Baseado em análise comparativa de 4 concorrentes diretos do mercado brasileiro de PDV/gestão para restaurantes (BeeFood, Barika, Multipedidos, Anota Ai), realizada em 31/07/2026.

## Contexto do produto

KÔMA é um sistema SaaS multi-tenant de gestão de restaurante, desenvolvido e operado solo por Georlan (mechatronics/waiter/dev). Já possui:
- Cardápio digital público (`/c/:slug`)
- PDV, Kanban de cozinha, gestão de turno de caixa
- WebSockets em tempo real
- Print agent multiplataforma para impressoras térmicas (ex. GERTEC G250)
- 100% de isolamento multi-tenant verificado por testes automatizados
- Deploy em produção (Railway + Cloudflare Pages)

O objetivo deste roadmap é fechar as lacunas que impedem o KÔMA de competir no tier "sistema profissional completo" — hoje ele é tecnicamente sólido mas comercialmente incompleto frente ao mercado.

## Panorama comparativo (concorrentes analisados)

| Feature | BeeFood | Barika | Multipedidos | Anota Ai | KÔMA (hoje) |
|---|---|---|---|---|---|
| PDV / mesa / comanda | ✅ | parcial | ✅ (plano pago) | ✅ | ✅ |
| KDS / Kanban cozinha | ✅ | ✅ | — | ✅ | ✅ |
| Emissão fiscal (NFC-e/NF-e) | ✅ | ❌ | ❌ | ✅ | ❌ |
| Integração marketplace (iFood etc.) | ✅ | ❌ (nega de propósito) | ✅ | ✅ | ❌ |
| Cardápio digital QR Code | ✅ | ✅ | ✅ | ✅ | parcial |
| Robô de atendimento WhatsApp | ✅ | ✅ | ✅ (carro-chefe) | ✅ | ❌ |
| Controle de estoque / CMV | ✅ | ❌ | — | ✅ | ❌ |
| Dashboard financeiro / relatórios | ✅ | básico | ✅ | ✅ | ❌ |

**Observação:** BeeFood e Anota Ai são os concorrentes de tier "profissional completo" (fiscal + marketplace + estoque). Barika e Multipedidos operam no tier "delivery pequeno/hamburgueria", sem fiscal, com preço muito mais baixo — não são o benchmark relevante pro posicionamento que o KÔMA busca.

## Roadmap priorizado

### Tier 1 — Bloqueadores de venda (sem isso não se compete no mercado formal)

1. **Emissão de NFC-e/NF-e integrada ao PDV**
   - É o item que separa "sistema sério" de "ferramenta de delivery pequeno" no mercado observado.
   - Sem isso, o KÔMA fica estruturalmente restrito a um nicho informal, independente da qualidade técnica do resto.
2. **Integração com iFood (mínimo viável)**
   - Presente em 3 dos 4 concorrentes analisados; restaurante que já usa iFood não migra de sistema sem essa centralização de pedidos.

### Tier 2 — Diferenciação competitiva

3. **Controle de estoque com CMV** — vendido pelos concorrentes como ferramenta de margem/lucro, não só operacional.
4. **Robô/atendimento automatizado via WhatsApp** — presente nos 4 concorrentes; hoje é expectativa de mercado, não diferencial.
5. **Dashboard financeiro/relatórios gerenciais** (fluxo de caixa, ticket médio, vendas por canal).

### Tier 3 — Maturidade de plataforma (só após Tiers 1 e 2)

6. CRM/fidelidade (cupons, histórico de cliente).
7. Pixel Facebook/Google Ads embutido no cardápio digital.
8. Multicanal avançado (dark kitchen / multicardápio) — só relevante se o público-alvo operar múltiplas marcas na mesma cozinha.

## Como usar este documento

Ao trabalhar em qualquer feature nova do KÔMA, verificar se ela pertence a algum tier acima. Prioridade de esforço deve seguir a ordem dos tiers — recursos de Tier 3 não devem ser desenvolvidos antes dos bloqueadores de Tier 1, mesmo que sejam tecnicamente mais simples ou atraentes de implementar.
