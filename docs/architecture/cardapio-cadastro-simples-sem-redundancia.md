# KÔMA — contrato de produto: cadastro simples, sem redundância

> Decisão do proprietário em 07/11/2026, após homologação do restaurante ID 1 (JE Lanches). Este documento é a regra de trabalho para o cardápio, inclusive em futuras implementações feitas por IA.

## Princípio

O administrador de restaurante deve conseguir montar e manter o cardápio **sem conhecer tabelas, SKUs, modificadores ou regras de banco**. Um cadastro tem uma única fonte de verdade. Não criar grupos, produtos paralelos ou campos de escolha para contornar problemas da interface. O cliente deve tomar poucas decisões, com nomes legíveis e preços corretos.

## Vocabulário canônico (sem confundir conceitos)

1. **Produto** é o que o estabelecimento vende (por exemplo, Batata Frita Tradicional, Pastel Médio, Pastelão). Identifica preparo e apresentação.
2. **Variação do produto** é uma versão vendável da mesma oferta (tamanho 200/300/400 g, sabor, embalagem), com seu preço e, quando necessário, identidade operacional de SKU. A gestão deverá mostrá-las *dentro de um único cadastro de produto*, mesmo quando o backend persistir SKUs separados para estoque, relatórios ou pedidos.
3. **Complemento ou escolha incluída** altera ou compõe o produto sem cobrar valor extra: ponto da carne (mal passado, ao ponto, bem passado), molho incluso, proteína ou acompanhamento já previsto no preço. Não confundir "opcional/obrigatório" com "pago/grátis": são eixos independentes.
4. **Adicional pago** é uma escolha que acrescenta valor ao produto, como bacon extra ou ovo extra; o preço e a quantidade devem ser explícitos no pedido e conferidos no Order Core. Não criar um segundo produto só para representar um adicional.
5. **Pausa** = indisponibilidade temporária reversível. **Remoção/Exclusão** = sair do cadastro ativo e da gestão operacional; não pode significar simplesmente "pausar".

## Regra de deduplicação obrigatória

Quando uma implantação/refatoração substituir um cadastro redundante, **o registro antigo deve ser removido como parte da mesma entrega**, e não deixado apenas pausado para sempre. O fluxo é:

- Auditar as referências antes de modificar: pedidos, itens, pagamentos, fiscais, estoque, campanhas, modificadores, imagens e outros vínculos.
- Se não houver uso histórico nem dependências: excluir o registro obsoleto e os grupos/opções exclusivamente ligados a ele, em transação segura, com snapshot de auditoria e contagem pós-operação; não apagar arquivos de imagens reutilizados por produtos válidos.
- Se houver pedidos, uso fiscal, conciliação ou qualquer vínculo histórico: **não executar hard-delete**. Arquivar o registro de forma irreversível para os canais e ocultá-lo da listagem normal do dono, mantendo acesso histórico/auditável. Distinguir claramente *arquivado* de *pausado*; não reativar registros obsoletos por engano.
- Não apagar nem modificar produtos ativos que tenham propósito próprio. Bloquear a migração caso os fatos do banco divirjam do plano; nenhuma alteração entre tenants.
- Não supor que dois produtos com nomes semelhantes são redundantes; comparar identidade, preço, composição e uso antes de mesclar.

**Aplicação registrada no ID 1:** 7 produtos legados (1 batata e 6 pastéis), 3 grupos antigos de tamanho e 7 opções foram removidos de fato em 08/11/2026 após verificar 0 usos históricos, mantendo 36 produtos ativos e auditoria `SUPERADMIN_JE_LEGACY_CATALOG_HARD_DELETE`.

## UX para quem cadastra

Padrão de edição sugerido (mobile-first):

1. Nome, categoria, descrição e foto do produto.
2. "**Esse produto tem tamanhos ou sabores?**" — botão Adicionar variação. Linhas com *nome da variação, preço, disponibilidade*; um único card de produto na gestão e na vitrine. Opções sem variação dispensam essa etapa. Para manter consistência, não usar um grupo comum de Complementos como mecanismo oculto de tamanho.
3. "**O cliente pode personalizar?**" — duas possibilidades claras: escolhas incluídas (R$ 0) e adicionais cobrados (R$ > 0). Exemplos reais, não terminologia técnica.
4. "**Precisa escolher?**" — presets: opcional (até uma escolha), obrigatório (uma escolha); limites min/max e múltiplas escolhas ficam em Avançado. Regras aplicam-se apenas aos produtos aos quais o grupo está vinculado.
5. Teste de preview do cliente antes de publicar: abrir card, variante, total, adicionar à sacola. Uma família nunca é enviada ao checkout como SKU fictício.

## Arquitetura e limites de implementação

- **Feito no ID1:** o cardápio público já agrupa batatas por tamanho e pastéis por tipo/sabor, mas a regra foi identificada por nomes e restaurante ID 1. Isso é **ponte transitória**, não a implementação final multitenant.
- **Pendente — prioridade arquitetural:** família/variações explícitas e configuráveis no backend e na gestão; vínculos estáveis por IDs, não regex de nome, IDs fixos do JE Lanches nem grupos de Complementos disfarçados. O agrupamento público, destaques, recomendações, Caixa, impressão, estoque, relatórios e checkout precisam ler a mesma configuração canônica.
- Separar *finalidade* (produto, variação, personalização inclusa, adicional cobrado) de *obrigatoriedade* (mínimo e máximo) e *precificação* (preço base e acréscimo), sem inferir finalidade somente de nome.
- Na Marmitaria, tamanhos P/M/G permanecem **produtos**, com regras de composição por produto/tamanho e grupos compartilhados de Proteínas/Guarnições/Saladas, como já homologado. Não extrapolar um modelo de variantes para quebrar essa regra ou os modos Hambúrguer/Pizza.
- Qualquer alteração no motor: PR focal, testes de preço e seleção, compatibilidade do Order Core, isolamento tenant, publicação verificada; nunca apagar referências históricas nem inventar preço.

## Definição de concluído

Um dono deve cadastrar "Batata Frita" uma vez, adicionar 200g/300g/400g e seus preços na mesma tela, configurar separadamente molhos gratuitos ou extras pagos, ver **um** card na gestão e na vitrine, concluir um pedido válido com preço e SKU corretos, e não encontrar produtos/grupos antigos esquecidos. Isso ainda exige a etapa de famílias editáveis; esconder SKUs por CSS não conclui o trabalho.
