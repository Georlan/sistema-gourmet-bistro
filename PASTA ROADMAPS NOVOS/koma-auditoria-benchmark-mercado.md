# Auditoria & Guia Estratégico — KÔMA vs. Mercado (Cardapio.ai)

*Atualizado após varredura do código-fonte real do repositório e do site
cardapio.ai. Este documento corrige e substitui o relatório anterior em
pontos onde a auditoria original não batia com o código.*

---

## 0. Correção importante em relação ao relatório anterior

O documento de auditoria que você me passou antes tinha uma imprecisão
séria que eu preciso apontar antes de qualquer outra coisa: ele
classificava o **"Chef & Garçom Virtual"** como recurso **🟢 Inovador,
integrado com IA Generativa Gemini**, comparado a "chatbots rígidos de
menu de opções".

Isso é falso. Fui conferir `backend/app/routes/ai.py` e o que existe
hoje é uma função `get_local_reply()` que:
- verifica se o nome de um produto aparece na mensagem do cliente,
- responde a saudações (`"oi"`, `"olá"`, `"bom dia"`) com uma frase
  fixa,
- ou devolve os 3 primeiros produtos do cardápio como sugestão.

Não há nenhuma chamada a Gemini, OpenAI ou qualquer LLM. O próprio
comentário no código confirma que isso é proposital: a IA pública não
transmite dado nenhum a provedor externo, é tudo calculado localmente.
Ou seja: hoje o Kôma tem exatamente o tipo de **chatbot rígido baseado
em regras** que o relatório dizia que só os concorrentes tinham. Isso
não é um detalhe menor — é a funcionalidade citada como maior
diferencial do produto, e ela não existe como descrita.

Isso muda a prioridade real: implementar de fato um assistente com LLM
(Gemini, Claude, ou modelo local) é um item pendente de alto valor, não
um recurso já concluído.

Outros pontos que confirmei no código antes de manter no relatório:
- **Cashback**: o relatório original marcava como 🔴 Pendente. Na
  verdade já existe a modelagem de dados (`saldo_cashback`,
  `taxa_conversao` no modelo de cliente) — está parcialmente construído
  na camada de banco, mas falta a lógica de acúmulo/resgate ligada ao
  fechamento de pedido e a interface para o cliente ver e usar o saldo.
  Classifiquei como 🟡 Parcial, não 🔴 Pendente nem 🟢 Pronto.
- **Notificação via WhatsApp**: confirmei que existe um modelo
  `MensagemWhatsApp` e menção a Evolution API na configuração, mas o
  envio real está com um placeholder `[WHATSAPP SIMULADO]` no código de
  caixa — ou seja, a infraestrutura de dados existe, o envio real não.
  Mantive como 🔴 Pendente, mas vale saber que a base já foi pensada.
- **Gestão de mesas/comandas, impressão local, cardápio digital,
  WebSocket com backoff exponencial**: confirmei essas no código real
  (`orders.py`, `printer_service.py`, pausa via `visibilitychange` no
  frontend) — essas classificações do relatório original se sustentam.
- **Ressalva sobre comandas**: em auditoria de código separada eu já
  identifiquei um bug ativo na abertura de comanda por mesa — quando a
  mesa já tem comanda aberta, o sistema devolve a existente sem checar
  o campo `identificador`, quebrando a divisão de conta por nome
  ("Ana" abre mesa, sistema devolve a comanda de outra pessoa). Isso
  não invalida a nota "Avançado" da gestão de mesas em geral, mas é um
  defeito ativo que compromete exatamente o recurso citado como
  diferencial (mesclagem/divisão de comanda) — vale corrigir antes de
  investir em recursos novos.

---

## 1. O que o cardapio.ai realmente oferece (varredura do site)

Cardapio.ai se posiciona como sistema de PDV + cardápio digital para
mais de 5.000 lojas no Brasil, com foco em "vender sem taxa de
comissão" (cobra só mensalidade fixa, diferente de marketplaces tipo
iFood). Pontos relevantes que vi na varredura (descritos em minhas
palavras, sem copiar texto de marketing):

**Robô de pedidos via WhatsApp**
Um bot que apresenta o cardápio, permite pedido direto pelo WhatsApp,
manda atualização automática de status para o cliente, e tenta
recuperar carrinho abandonado. Mensagens totalmente customizáveis pelo
lojista.

**Cardápio digital**
Link próprio (não é só QR code), suporte a múltiplas fotos por
produto, pedido sem necessidade de cadastro, dado salvo para o próximo
pedido, sugestão de produtos, campo de recado no carrinho, pixel de
conversão (Meta/Google) integrado, modo específico para pizzaria
(montagem de sabores), venda por peso.

**Gestão/PDV**
Impressão automática em Windows e Android, painel acessível de
qualquer dispositivo sem limite de usuários, controle de caixa,
relatórios, CRM de clientes, controle de estoque, cadastro de
funcionários com permissões.

**KDS (monitor de cozinha)** — recurso recente deles, então é
oportunidade de paridade, não algo que já ficaram anos à frente:
cards de pedido com alerta visual de atraso, opção de despachar em
lote ou individual, observações do pedido em destaque no card,
aviso quando um item é cancelado, suporte a múltiplos monitores na
cozinha.

**Gestão de entregas** — também lançado recentemente por eles:
cadastro de entregadores, atribuição de pedido por entregador,
relatório de taxas de entrega por motoboy, app próprio para o
entregador, sugestão de rota via Waze/Google Maps.

**Pagamentos**
Pix estático sem taxa (chave exibida ao cliente), Pix/cartão via
integração com Asaas e Mercado Pago com recebimento no mesmo dia,
aceite das principais bandeiras, e nenhuma cobrança de comissão por
venda — só mensalidade fixa. Emissão de NFC-e integrada, inclusive
para pedidos vindos do iFood, com tratamento tributário automático
para gorjeta.

**Estrutura comercial**
Três planos com preço fixo mensal (não escalam com volume de venda):
um plano básico (PDV sem robô/iFood/KDS/caixa), um intermediário
(adiciona robô de WhatsApp e caixa), e um completo (adiciona iFood e
KDS). Todos incluem CRM, cashback/cupom, Pix estático, app garçom e
gestor de área de entrega — a diferença entre planos é sobretudo
robô de WhatsApp, KDS, integração iFood, controle de caixa e limite
de entregadores cadastrados.

**Ferramentas de aquisição gratuitas (lead magnet) no site**
Calculadora de taxas do iFood, calculadora de precificação para quem
vende no iFood, calculadora de taxas de maquininha/cartão. Isso é uma
tática de SEO/aquisição, não recurso de produto — serve de ideia para
o site comercial do Kôma, não para o sistema em si.

**Migração**
Eles importam automaticamente o cardápio do sistema anterior do
lojista (inclusive do iFood) como forma de reduzir fricção de troca.

---

## 2. Matriz comparativa corrigida: KÔMA vs. mercado

| Módulo | Estado real do KÔMA (verificado no código) | Padrão de mercado (cardapio.ai) | Status |
|---|---|---|---|
| Gestão de mesas e comandas | 🟢 Avançado, mas com **bug ativo** na divisão por nome (dedup ignora `identificador`) | Gestor de mesas básico | Kôma supera em conceito, mas precisa consertar o bug antes de vender como diferencial |
| Agente de impressão local | 🟢 Excelente (Python nativo, Linux/Windows, fila por setor, SQLite p/ idempotência) | Impressão automática Windows/Android | Kôma equivalente/superior em robustez técnica |
| Cardápio digital whitelabel | 🟢 Bom (PWA, tema por marca, fallback de imagem) | Link próprio, múltiplas fotos, modo pizza, venda por peso, sugestão de produto, pixel de conversão | Kôma fica atrás em recursos de conversão (falta: múltiplas fotos por produto, modo pizza, recado no carrinho, pixel Meta/Google) |
| Atendimento com IA | 🔴 **Não é IA generativa** — é bot baseado em regra/palavra-chave | Bot de regras (mercado também usa isso, não é generativo) | Nivelado na prática, mas Kôma está vendendo isso como diferencial que não existe. Implementar LLM de verdade aqui seria vantagem real |
| WebSocket/Polling | 🟢 Avançado (backoff exponencial, pausa em `visibilitychange`) | Não divulgado publicamente | Kôma provavelmente à frente tecnicamente aqui |
| KDS (monitor de cozinha) | 🔴 Pendente | 🟢 Lançado recentemente (alerta de atraso, lote/individual, observação em destaque, aviso de cancelamento, múltiplos monitores) | Prioridade alta — mercado tem isso há pouco tempo, é janela de alcançar paridade |
| Gestão de entregadores/motoboy | 🔴 Pendente | 🟢 Lançado recentemente (app do entregador, atribuição, relatório de taxa, rota via mapa) | Prioridade alta, mesma lógica do KDS |
| Notificação automática WhatsApp | 🔴 Pendente (infra de dados existe, envio é simulado) | 🟢 Robô completo de pedidos + notificação | Prioridade alta |
| Pix dinâmico/webhook automático | 🔴 Pendente (webhook mockado no super-admin) | 🟢 Asaas/Mercado Pago com confirmação automática | Prioridade média-alta |
| Cashback/cupom | 🟡 Parcial (modelo de dados existe, falta lógica de acúmulo/resgate e UI) | 🟢 Cashback e cupom incluídos em todos os planos | Prioridade média — você já tem a base, é "terminar", não "começar do zero" |
| Integração iFood | 🔴 Pendente (zero menções no código) | 🟢 Importação de pedido + migração automática de cardápio | Prioridade média |
| Emissão fiscal (NFC-e) | 🔴 Pendente | 🟢 Emissão automática, inclusive de pedidos vindos do iFood, com tratamento de gorjeta | Prioridade futura (exige CNPJ do lojista e certificado digital — dependência externa, não só código) |
| Múltiplas fotos por produto | 🔴 Não verificado no código, provavelmente ausente | 🟢 Sim | Fácil de implementar, baixo esforço/alto retorno de conversão |
| Modo cardápio de pizza (montagem de sabor) | 🔴 Ausente | 🟢 Sim | Nicho, mas usado por segmento inteiro (pizzarias) |
| Pixel de conversão (Meta/Google) | 🔴 Ausente | 🟢 Sim | Fácil, relevante se for vender o cardápio digital como ferramenta de marketing |
| Calculadoras de lead magnet (site comercial) | 🔴 Ausente | 🟢 Calculadora de taxa iFood, precificação, taxa de cartão | Não é recurso de produto — é estratégia de aquisição de cliente para a página de vendas do Kôma |

---

## 3. Ideias de estrutura de planos (inspiração genérica, não cópia)

O cardapio.ai usa preço fixo mensal independente de volume de venda,
como argumento contra marketplaces que cobram comissão. Ideia
adaptável pro Kôma, sem copiar nome de plano nem texto:

- **Plano de entrada**: cardápio digital + PDV + impressão local +
  caixa básico. Sem robô de atendimento, sem KDS.
- **Plano intermediário**: adiciona atendimento automatizado (uma vez
  que você tenha um de verdade, com LLM), controle de caixa completo,
  cashback/cupom.
- **Plano completo**: adiciona KDS, gestão de motoboy/entrega, Pix
  dinâmico automático, integração iFood.
- **Módulo fiscal** como algo à parte ou só no plano completo, já que
  depende de CNPJ e certificado digital do lojista — não é algo que
  todo cliente vai precisar de imediato.

O ponto central da posição deles (sem comissão por venda, preço fixo)
é replicável e é um argumento comercial forte — não é proteção de
propriedade intelectual, é modelo de negócio genérico de mercado.

---

## 4. Roadmap priorizado (revisado)

1. **Corrigir o bug de divisão de comanda por `identificador`** —
   antes de vender "gestão de mesas avançada" como diferencial, o
   recurso citado como exemplo dela precisa funcionar.
2. **KDS** — janela de paridade, mercado lançou recentemente, dá pra
   alcançar sem estar "anos atrás".
3. **Gestão de motoboy/entregas** — mesma lógica do KDS.
4. **Terminar o cashback** — já tem base de dados, é o item de menor
   esforço restante da lista de prioridade alta.
5. **Decidir honestamente sobre o "Chef IA"**: ou implementa de
   verdade com um LLM (Gemini/Claude/local), ou para de vender como se
   já fosse generativo. Ambas são decisões válidas, mas a atual
   ("vender como Gemini sem ser Gemini") não é.
6. **Notificação real via WhatsApp** — a infraestrutura de dados já
   existe, falta o envio de verdade (Evolution API já está referenciada
   na configuração).
7. **Pix dinâmico com webhook real** (Asaas/Mercado Pago) — o mock no
   super-admin mostra que o desenho já foi pensado, falta implementar.
8. **Melhorias de conversão do cardápio digital**: múltiplas fotos por
   produto, pixel de conversão, recado no carrinho, sugestão de
   produto — baixo esforço individual, ganho de conversão real.
9. **Integração iFood** — depende de homologação externa com a
   plataforma, então tem dependência de terceiro além do código.
10. **Emissão fiscal (NFC-e)** — deixar por último, já que depende de
    CNPJ e certificado digital do lojista, não é só desenvolvimento.

---

## 5. Compromisso de originalidade (mantido do relatório anterior)

- Nenhuma cópia de código, texto de marketing, identidade visual ou
  nome de produto do cardapio.ai ou de qualquer concorrente.
- Os conceitos de negócio adotados aqui (KDS, robô de atendimento,
  gestão de motoboy, Pix dinâmico, cashback) são mecânicas genéricas e
  amplamente usadas no setor — não são propriedade de nenhuma empresa
  específica.
- Identidade visual do Kôma (dark mode, tons esmeralda, tipografia
  Outfit/Inter) e stack (React + TypeScript + Python FastAPI +
  Supabase + agente de impressão nativo) seguem 100% autorais.
