# Caixa: módulos e carregamento sob demanda

## Fronteiras

Base de comparação: `b4e1473`, que já inclui a correção de login e seleção multi-tenant (#141).
Não foram alterados autenticação, permissões, preços, projeções de Mesa/Comanda ou ações do Garçom.
Compartilhar contratos, dados e componentes não obriga Caixa e Garçom a oferecerem a mesma interface.

| Responsabilidade | Abrir primeiro em `src/components/caixa/` | Ciclo de vida |
|---|---|---|
| Catálogo disponível para venda e administração | `catalog/useCashierCatalog.ts` | Compartilhado; recebe snapshots do App |
| Produtos, categorias e complementos | `catalog/CashierCatalog.tsx` | Código sob demanda; formulários locais |
| Clientes disponíveis para checkout | `customers/useCashierCustomers.ts` | Compartilhado; listeners com cleanup |
| CRM e programa de fidelidade | `customers/CashierCustomers.tsx` | Código sob demanda; edição local |
| Estoque, entradas, contagens, fornecedores e fichas | `inventory/CashierInventory.tsx` | Código sob demanda; dados/ações/formulários próprios |
| Taxa, permissões do Garçom e configuração de impressão | `settings/useCashierSettings.ts` | Compartilhado; checkout recebe atualização da taxa |
| Configurações e cadastro de mesas | `settings/CashierSettings.tsx` | Código sob demanda; CRUD de mesas pelos callbacks existentes |
| Aparência do cardápio público | `online-menu/CashierOnlineMenu.tsx` | Código sob demanda |
| Pessoas, convites e funções | `team/CashierTeam.tsx` | Código sob demanda; listener ativo apenas na área de equipe |
| Relatórios | `reports/CashierReports.tsx` | Código e biblioteca de gráficos sob demanda |
| Carrinho, busca de cliente, envio e idempotência do PDV | `pdv/useCashierPdv.ts` | Permanece montado ao navegar, inclusive durante envio |
| Interface do PDV | `pdv/CashierPdvView.tsx` | Código sob demanda |
| Rolagem/gestos/ResizeObserver das categorias | `pdv/usePdvCategoryNavigation.ts` | Montado com a view; observer depois da montagem do DOM |
| Relógio KDS | `kitchen/KitchenTimer.tsx` | Identidade estável; não é redefinido a cada render da raiz |
| Carregamento e isolamento de falhas | `loading/DeferredCashierSection.tsx` | Mecanismo único para as oito áreas |

Checkout, SmartPOS, turno e sincronização continuam nos owners descritos em
[`cashier-ownership.md`](cashier-ownership.md). Não colocar esses controllers dentro de um
ramo condicional ou de um módulo que desmonte ao trocar de aba.

## Estado, navegação e falhas

- Uma área é importada apenas no primeiro acesso; o shell, Pedidos e os controllers operacionais não suspendem junto.
- Depois da primeira visita, o componente da área permanece montado e fica oculto quando inativo.
  Isso conserva estado local de formulários e não exige enviá-lo para um contexto global.
  Os filhos continuam seguindo as condições de subaba existentes; não se promete conservar todo estado
  de componentes filhos desmontados nem mudanças após recarga/logout.
- HTTP e listeners específicos continuam condicionados à área correspondente. O monitor de impressão
  é desmontado quando sua view não está ativa; o listener de equipe possui cleanup.
- Catálogo, clientes e taxa continuam disponíveis fora das telas administrativas porque alimentam vendas/checkout.
- O hook de navegação das categorias do PDV mora na view: instalar o ResizeObserver no controller
  antes de o chunk chegar deixaria o DOM sem observação no primeiro acesso.
- Uma falha de módulo mostra erro somente naquela área. Navegar continua possível e o carrinho permanece.
  Imports ES que falham podem ficar em cache no navegador; recriar `React.lazy` não garante nova tentativa.
  Por isso a recuperação oferece recarga explícita, com confirmação e aviso sobre rascunhos/pagamentos.
  Nunca recarregar automaticamente para esconder erro de chunk.

## Correção caracterizada do PDV

O botão “Novo pedido” apagava a modalidade e a mesa mesmo quando o carrinho havia sido restaurado
depois de uma falha de envio. `openCounter()` agora só aplica o destino padrão quando não há
carrinho, envio em andamento nem tentativa pendente. O teste força HTTP 503, retorna ao PDV,
confere a mesa e envia novamente com o mesmo corpo/chave de idempotência.

As 35 ações/callbacks nomeados transplantados foram comparados por estrutura AST com a base:
nenhuma diferença nos corpos dessas ações. A nova decisão de navegação `openCounter`, o ciclo de vida
das views e o observer são mudanças explícitas, cobertas em navegador. Essa comparação não substitui
revisão nem prova equivalência de toda a aplicação.

## Medidas observadas

Mesmas dependências, Vite em produção, bytes decimais. Fonte formatada com indentação legível;
a comparação em bytes acompanha LOC para não tratar formatação como ganho de arquitetura.

| Medida | Base `b4e1473` | Após divisão |
|---|---:|---:|
| `CaixaPanel.tsx`, linhas | 7.244 | 3.640 |
| `CaixaPanel.tsx`, bytes de fonte | 390.978 | 147.679 |
| Estado / efeitos / HTTP diretos na raiz | 141 / 17 / 61 | 16 / 7 / 0 |
| Chunk Caixa, minificado | 1.086.468 B | 289.363 B |
| Chunk Caixa, gzip | 269.125 B | 70.360 B |
| JS inicial incluindo dependências compartilhadas | 1.962.592 B | 1.164.956 B |
| Mesmo conjunto, soma gzip por arquivo | 512.867 B | 313.963 B |

O chunk Caixa caiu aproximadamente 73,4%; o conjunto JS inicial caiu 40,6%.
São medidas de build, não promessa de tempo de carregamento, FPS ou economia de tokens.
CSS, imagens, API, latência e cache do navegador não entram nesses totais.

O App continua em aproximadamente 648 kB minificados e não foi dividido neste trabalho.
Relatórios têm aproximadamente 461 kB, mas não são baixados na abertura padrão do Caixa.
Os módulos de Estoque e Configurações ainda têm cerca de duas mil linhas formatadas cada;
agora concentram responsabilidades locais e podem ser subdivididos sem reabrir o shell operacional.
Não houve reescrita dos tipos `any` herdados nem redesenho visual nesta etapa.

## Verificação e manutenção

```sh
npm run lint
npm run test:unit
npm run build
node scripts/architecture-metrics.mjs
node scripts/audit-cashier-loading.mjs
KOMA_E2E_PORT=4285 npm run test:e2e -- --workers=2
KOMA_E2E_PREVIEW=true KOMA_E2E_PORT=4285 npm run test:e2e -- e2e/cashier-loading.spec.ts --project=mobile-360 --project=desktop-1366 --workers=2
```

O audit percorre `imports` reais do manifest Vite, inclui chunks compartilhados, verifica as oito
entradas dinâmicas e rejeita seu retorno à carga inicial. Limites com margem: 400 kB para a entrada Caixa,
1,35 MB para o conjunto inicial. Alterar esses limites exige evidência e decisão explícita.
Os guards de fonte limitam a raiz a 16 estados, sete efeitos e nenhum HTTP direto.

O CI executa a matriz existente e os cenários de carregamento, além de repetir os cenários específicos
contra os assets de produção em mobile e desktop. Artefatos incluem medidas de arquitetura e bundle.
Os cenários verificam download tardio, módulo lento/falhando, recarga confirmada, rascunhos,
carrinho e repetição de envio com a mesma identidade. A fixture de API é compartilhada com os
testes responsivos; não usa contas nem dados de produção.
