# KÔMA — Novo pedido: reconstrução progressiva (12/11/2026)

## Objetivo

Construir um PDV mais intuitivo, rápido e reconhecivelmente KÔMA que as referências externas observadas, preservando os comportamentos aprovados, o Core de Pedidos e os custos baixos da operação. Este documento descreve **etapas de trabalho**, não aprovação estética antecipada nem promessa de desempenho.

## Referências e restrições

- Capturas reais do KÔMA (catálogo, carrinho vazio/cheio, retirada, entrega, consumo local, personalização) fornecidas em 12/11.
- Capturas do BeeFood (grade, modais, quantidade selecionada, painel de pedido, atalhos) usadas como **benchmark de tarefas**, nunca como fonte de código, identidade, fotografia ou composição a copiar.
- Fontes de verdade: `docs/design-system/DESIGN_SYSTEM.md`, `docs/design/cashier-visual-direction.md`, `docs/addons-operational-ux.md`, `AGENTS.md`.
- Inter (corpo/controles), Space Grotesk (títulos), tokens de ação/foco claros e escuros. Meta WCAG AA; preferir alvos de 44px para toque.
- Nada de servidor, cache, dependência de UI, script no asset, consulta HTTP ou estado novo para meros elementos visuais.
- Nunca testar lançamentos reais no tenant 6; só fixture local, e2e ou ambiente isolado.

## Etapas independentes

1. **Fundação do catálogo e carrinho** — PR #1302 Draft: cards separados do owner de estado, controle independente de personalização vs inclusão rápida, preço/legibilidade, quantidades selecionadas por produto; SVG próprio de carrinho vazio; suporte de toque e navegação móvel, estilos isolados.
2. **Carrinho e finalização mobile** — implementada em PR Draft #1303, dependente de #1302. `CashierPdvCartLine` mostra nome, preço unitário, quantidade, total de linha, editar/remover. Observações e instruções rápidas ficam em `<details>` nativo, preservando observações históricas e personalização. O carrinho apresenta modalidade como contexto e botão **Continuar para finalizar**; no painel de revisão ficam modalidade, cliente, mesa, entrega e pagamento condicionais. F4 abre primeiro a revisão, só então pode enviar. O owner de venda, preços, validações e idempotência permanecem intactos. Estado de revisão não duplica dados de venda. Validar sticky/footer e teclado em aparelho real.
3. **Modal de produto e complementos** — priorizar foto/descrição somente quando úteis; grupos obrigatórios com estado explícito, adicionais com preço, quantidade e total corretos; folha mobile quase tela cheia com rodapé estável, foco/Escape, leitura por screen reader e recuperação do contexto.
4. **Desktop e densidade adaptativa** — ajustar largura do carrinho, grade de produtos conforme espaço real, barra de categorias, teclado físico e espaço de trabalho, sem repetir o excesso de cards minúsculos das referências.
5. **Qualidade, limpeza e medição** — remover regras legadas somente após mapear consumidores; comparar tamanho de bundle, requests, memória/renderizações, tempo de interação e performance com baseline; ambos temas, 320/360/390/430/768/1366 px, texto gigante, baixo desempenho, listas longas e produtos sem foto.

## Invariantes de UX e negócio

- `+ Adicionar` insere uma unidade limpa; abrir o card personaliza; editar item recupera as escolhas existentes.
- Total, modificadores, disponibilidade, forma de atendimento e estado de envio continuam derivados dos owners de domínio existentes.
- Retirada: identificação e pagamento podem ser opcionais nas condições já suportadas.
- Entrega: requisitos de cliente/endereço são os existentes e nunca são enfraquecidos.
- Consumo local: vínculo com mesa e identificação de atendimento continuam canônicos, inclusive a escolha de não vincular inicialmente quando permitida.
- Nenhum botão visual transforma registro financeiro, cupom, reimpressão ou envio em ação autônoma.
- Mobile: uma rolagem vertical principal; gesto no catálogo não fica preso em regiões aninhadas; ações não encobrem a navegação inferior nem o teclado.

## Definição de pronto para cada etapa

PR pequeno e reversível; TypeScript/testes unitários/build e regressões Playwright focais verdes no **SHA final**; revisão visual em claro/escuro com capturas do preview; sem merge até aprovação; pós-deploy só com evidência da versão entregue. Não afirmar redução de custo sem medida.

## Checklist acumulado

- [x] Diagnóstico dos screenshots e das diferenças KÔMA/BeeFood.
- [x] Separação do card e isolamento do CSS.
- [x] Contador de quantidade existente no pedido.
- [x] Novo SVG específico para carrinho vazio.
- [x] Melhoria da ergonomia mobile de busca, chips, carrinho e alvos.
- [ ] Revalidar os gates no commit final da etapa 1.
- [ ] Homologar o preview em celular (ambos temas).
- [x] Etapa 2 — carrinho/formulários implementados na branch (PR #1303 Draft).
- [ ] Etapa 2 — CI e aprovação estética/operacional em mobile real antes de merge.
- [ ] Etapa 3 — modal e complementos.
- [ ] Etapa 4 — desktop.
- [ ] Etapa 5 — limpeza e métricas.


## Etapa adicional — localização da modalidade (12/11, revisão de 398 px)

### Diagnóstico
As capturas após #1302/#1303 mostram que a alternância Produtos/Carrinho, o cartão de busca/categorias, o contexto de atendimento e o formulário da revisão ainda ocupam muito espaço. O operador precisa entrar na revisão para mudar a modalidade, mesmo sabendo de antemão se é Retirada, Delivery ou Consumo local.

### Simulações funcionais (comparação de tarefa)

**A — Modalidade sempre expandida, antes do catálogo:**
`[ Retirada ][ Delivery ][ Consumo local ]` em uma faixa completa acima da busca.
- + Descoberta instantânea, um toque para escolher.
- - Usa uma linha de 44–60 px o tempo todo, repetindo o contexto do checkout e encurtando a lista de produtos.

**B — Seletor compacto no mesmo eixo das tarefas (selecionado):**
`[ Itens ][ Pedido (4) ]  [ Retirada ⌄ ]` na única faixa da navegação mobile.
- + Mantém uma faixa, usa seletor nativo do sistema (acessível, sem script para modal), permite trocar o tipo antes ou depois de adicionar produtos.
- + No mobile, dispensa repetir três botões de modalidade na revisão. Só aparecem os campos para a modalidade escolhida.
- - Requer dois gestos para alterar o tipo e exige rótulo claro do seletor. O estado corrente está sempre visível.

### Contratos preservados
- Retirada: identificação não obrigatória; se preenchida, nome e telefone validados pelo hook antes do envio.
- Delivery: nome e telefone obrigatórios + snapshot de endereço validado; mudança para delivery limpa mesa alvo, como antes.
- Consumo local: seleção de mesa opcional quando permitido; disponibilidade e status das mesas não mudam.
- F2/F3/F8 atualizam o seletor existente e revelam os campos na revisão; F4 continua exigindo revisão antes do envio.
- Opções disponíveis são filtradas por `allowedPdvOrderTypes`. Nada de nova API, estado duplicado ou dependência.
- Desktop mantém os três botões na revisão; mobile/tablet usa um seletor nativo persistente na faixa de tarefas.

### Critérios de validação
- Teste de mudança de tipo durante o catálogo e a revisão, preservando os itens e voltando ao catálogo.
- A mesma linha de navegação deve caber em 320/390/430 px sem overflow horizontal; seletor deve ter no mínimo 44px de altura.
- Conferir delivery, mesa, tipo permitido, navegação por teclado e os dois temas.
- CI focal e pós-merge verdes antes de declarar conclusão; nenhum pedido real em produção.



## Nova etapa — carrinho unificado e densidade operacional (12/11/2026)

**Problema observado nas capturas:** depois de adicionar itens, o usuário mobile precisava alternar Itens → Carrinho → Continuar para finalizar → Lançar Pedido. O checkout ocupava outra tela apesar de modalidade, itens e cliente já pertencerem ao mesmo pedido. No catálogo, quase todos os produtos repetiam um selo "Personalizável".

**Implementação:**
- Uma só tela do pedido e um único `<form>`: linhas editáveis, observações por item, modalidade, campos contextuais, subtotal/total e botão de lançamento. O carrinho não é copiado para um estado de checkout.
- O CTA persistente "Ver pedido" abre o mesmo carrinho no celular; a ação "Continuar para finalizar" e os estados de etapa foram removidos. O clique explícito em "Lançar Pedido" continua obrigatório.
- Pickup mantém identificação e pagamento opcionais recolhidos por `<details>`. Delivery mostra telefone/nome e expande o endereço ausente imediatamente. Consumo local exibe a mesa, que segue opcional conforme regras existentes.
- No mobile, modalidade continua na faixa fixa de tarefas; no desktop, os botões da modalidade seguem no carrinho.
- F4 não envia na primeira tecla: do catálogo abre/foca o carrinho; dentro do pedido primeiro foca o botão, e somente outro F4 com o botão já focado confirma. F2/F3/F8 preservados.
- Cards: remover selo repetitivo, reduzir espaços sem retirar imagem, nome, preço ou o botão de adição. Alvos de toque mantidos com 44px em coarse pointer.
- CSS antigo de navegação entre etapas removido. Nenhuma chamada de rede, dependência, asset adicional nem alteração em regras de preço, status, pagamento, estoque ou idempotência.

**Verificações essenciais:** tests de unit/static markup, browser mobile 320/390/430, desktop, delivery obrigatório e erro 422, salão/mesa, falhas 502/503 com retry idempotente, tecla F4, temas e Cloudflare pós-merge. Comparar manualmente número de toques para pedido de retirada: **antes** selecionar item → Ver carrinho → Continuar → Lançar; **agora** selecionar item → Ver pedido → Lançar. Não realizar venda real durante revisão estética.

**Próximos refinamentos:** modal de personalização, medição real de bundle/performance e contraste em tema escuro. Mudanças arquiteturais maiores somente com testes de domínio separados.


## Revisão de UX após homologação em celular real — guia de Vendas (12/11/2026)

**Decisão aprovada:** a navegação horizontal de Vendas deve permanecer **sempre visível no celular**. O experimento de escondê-la atrás de um toggle "Vendas" (PR #1307) foi rejeitado após teste físico. Recuperar pixels escondendo navegação recorrente gerou um toque extra e piorou a descoberta das telas operacionais.

**Implementação corretiva:** não reverter as melhorias de catálogo/personalização; remover apenas toggle e seu estado/estilos. Começar o strip de Novo pedido com `scrollLeft = 0` ao entrar/retornar ao PDV, sem centralização automática no segundo item; preservar rolagem feita pelo operador. No celular, retirar as setas que reservavam um espaço vazio à esquerda e manter toque/deslize nativos. Ocultar apenas a aparência da barra cinza de scroll (`scrollbar-width: none`, WebKit scrollbar hidden); não desativar `overflow-x: auto`, foco ou navegação por teclado. Outras áreas e desktop mantêm o fluxo de seleção de destino atual.

**Verificação necessária:** mobile 320/360/390/430 com temas claro/escuro, guia presente, primeira aba no início esquerdo, nenhum toggle e nenhum scrollbar cinza, seleção/retorno de Retiradas→Novo pedido, swipe nativo, fontes grandes, sem overflow horizontal na página. Sem mudança de regras de domínio ou endpoints.

**Regra para refinamentos seguintes:** responsividade deve manter navegação essencial evidente; otimizar espaço reduzindo redundâncias e densidade ornamental, não escondendo destinos usados durante operação.
