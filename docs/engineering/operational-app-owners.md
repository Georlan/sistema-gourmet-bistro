# App: dados operacionais compartilhados

Continuação estrutural sobre `fb94cc1`, independente de equipamentos físicos.
Caixa e Garçom conservam suas apresentações e ações. Esta etapa não aumenta
permissões, muda cálculos, redefine Item.pago ou altera o comportamento do SmartPOS.

## Responsabilidades

- `src/components/app/data/useOperationalTables.ts`: snapshot de mesas, carregamento,
  cancelamento da consulta anterior e cadastro/edição/exclusão nos endpoints originais.
- `src/components/app/data/useOperationalCatalog.ts`: catálogo atômico, fallback
  durante deploy, versões de requisição e listeners de conectividade com cleanup.
- `src/components/app/data/useOperationalOrders.ts`: snapshot de contas, mapeamento,
  refresh completo/direcionado, ordenação, identidades e sobreposição otimista de status.
- `src/components/app/drafts/useOperationalDrafts.ts`: rascunhos por mesa, persistência,
  edição, trava síncrona de envio, rollback e chave de repetição do lançamento.
- `src/components/app/operationalContracts.ts`: acesso à sessão, comunicação de erros
  e avisos compartilhados. Rascunhos derivam o contrato de pedidos com Pick/ReturnType.

App monta os quatro hooks incondicionalmente dentro do ramo operacional. Mudar aba
ou fechar um modal não desmonta seus estados. As credenciais e a seleção do portal
continuam no App; a camada de dados recebe callbacks, não cria uma sessão paralela.
Travas e versões de requisição não são expostas para os componentes de apresentação.
Os pontos de chamada de sincronização continuam no App, com as mesmas dependências.

## Evidência e limites

Comparação estrutural de árvores TypeScript: 21 callbacks/funções movidos equivalentes
à base, ignorando parênteses e formatação. Não é prova formal nem revisão independente.
Foram adicionados testes de rascunho após erro/recarga, mesma chave no reenvio, bloqueio
de outro lançamento pendente, catálogo legado e 401 retornando ao login. O teste novo
de recarga passou a aguardar o modal restaurado: DOM/trace mostraram que o próprio
teste tentava clicar atrás dele; não houve alteração da tela para contornar a falha.

O ganho desta etapa é manutenção: o grafo inicial fica em aproximadamente 860 kB,
contra 859 kB na etapa anterior, dentro do orçamento de 950 kB. Não há ganho adicional
de desempenho medido, nem medição de tokens. Autenticação, WebSocket e operações
de mesa ainda possuem código no App; não considerar encerrada toda a dívida técnica.

```sh
npm run lint
npm run test:unit
npm run build
node scripts/audit-cashier-loading.mjs
node scripts/architecture-metrics.mjs
KOMA_E2E_PORT=4293 npm run test:e2e -- --workers=2
KOMA_E2E_PREVIEW=true KOMA_E2E_PORT=4293 npm run test:e2e -- e2e/operational-app-owners.spec.ts --project=mobile-360 --project=desktop-1366 --workers=2
```

## Etapas independentes, por orientação do usuário

- Impressora: o usuário já conseguiu operá-la. Evoluir o agente de impressão em
  etapa própria, sem usar a ausência de um novo teste físico como bloqueio desta fase.
- Maquininha: integração iniciada no repositório e ainda em desenvolvimento pelo
  usuário. Não terminar, habilitar ou redirecionar essa integração nesta refatoração.
- Ampliação funcional do caixa: definir informações e ações desejadas em escopo
  próprio; não confundir universalização do código com liberação de novas permissões.
