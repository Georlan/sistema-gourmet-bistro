# Organização e pesquisa de funções do restaurante

Escopo desta etapa: navegação do painel do restaurante no desktop e mobile. Não redesenha telas, não altera cálculos nem muda a organização do SuperAdmin.

## Organização aprovada

- Operação: Vendas (Pedidos, Novo pedido, Salão, Cozinha/Preparo, Retiradas, Entregas) e Caixa (Turno atual, Movimentações, Fechamento).
- Cardápio e vendas online: Cardápio (Produtos, Complementos, Preparo e impressão) e Cardápio online (Perfil, Marca, Pedidos online, Clientes bloqueados, Entrega, Pagamentos, Divulgação).
- Gestão: Estoque & compras (Ingredientes, Compras, Inventário, Fornecedores), Clientes (Clientes, Programa de Fidelidade, Cupons & Promoções) e Relatórios (Visão Geral, Financeiro, Produtos, Inteligência do Cardápio, Equipe).
- Sistema: Equipe (Pessoas, Funções e acessos), Configurações (Aparência, Impressão, Mesas, App do Garçom, Taxa de Serviço, Implantação inicial, Fiscal, Integrações) e Conta & assinatura (Meu Plano, Planos & Upgrade, Contrato e documentos).

O catálogo `cashierNavigation.ts` conserva IDs, owners e pares tab/subTab existentes. Fiscal ganha destino persistido próprio no mesmo owner técnico. O atalho fiscal da implantação abre esse destino. Histórico/Compras e Estoque/Ingredientes usam rótulos consistentes entre lateral e abas superiores.

Entregas e Retiradas são projeções operacionais úteis e permanecem acessíveis. Entrega em Cardápio online configura taxas/cobertura; Entregas em Vendas acompanha a operação. Equipe em Relatórios mede desempenho; Equipe em Sistema administra pessoas e acessos. Pagamentos online define meios aceitos; Integrações conecta provedores; Conta & assinatura administra o SaaS. Essas distinções não autorizam unificar regras ou dados.

## Pesquisa pelo conteúdo

A pesquisa local indexa rótulos, contexto, assuntos e descrições das funções existentes, sem API adicional nem dados pessoais. Exemplos:

- CMV, margem, engenharia de cardápio e simulação de preço: Relatórios > Inteligência do Cardápio.
- Mais vendidos: Relatórios > Produtos.
- Ficha técnica, receita e baixa automática: Gestão > Estoque & compras > Ingredientes.
- Pontos e cashback: Gestão > Clientes > Programa de Fidelidade.
- Cupons de desconto: Gestão > Clientes > Cupons & Promoções.
- Nota fiscal e certificado digital: Sistema > Configurações > Fiscal.
- PagBank, Mercado Pago e avisos WhatsApp: Sistema > Configurações > Integrações.

Os assuntos devem corresponder a conteúdo verificado no owner. Acrescentar aliases e descrição quando uma tela ganhar uma função; não anunciar funcionalidades futuras. Correspondências exatas têm prioridade, acentos são ignorados e palavras de ligação são descartadas apenas como alternativa. Os resultados usam a mesma navegação do menu, inclusive a ação especial de Novo pedido, e mostram o caminho e o conteúdo do destino.

Fidelidade, cupons, estoque e relatórios seguem as permissões efetivas de funcionalidades já fornecidas pelo servidor. A pesquisa não amplia autorizações. As proteções do backend continuam sendo a autoridade para cada operação. A implantação conserva somente destinos permitidos.

## Próximas etapas

Redução de banners, organização interna de cada formulário, assets e redesign da Inteligência do Cardápio são etapas separadas. Esta alteração não cria nem remove funcionalidades operacionais. Reversão: reverter a PR; a nova rota fiscal não implica migração de banco nem alteração de dados.
