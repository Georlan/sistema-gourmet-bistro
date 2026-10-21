# Relacionamento: padrão de produto operacional

Primeira aplicação incremental da direção de UX do KÔMA. O público é o dono do restaurante ou operador que precisa escolher quem contatar, executar uma ação e verificar o retorno. Não é uma reformulação simultânea dos demais módulos.

## Diagnóstico e decisões

Avaliação heurística de código e capturas, não pesquisa com operadores reais. Baseline: main `a444d0d642a1`.

- Severidade 3: Resultados sem mensuração apresenta cartões vazios sem próximo passo. Usar estado vazio com acesso direto a Campanhas e preservar `Não medido`, distinto de zero observado.
- Severidade 2: gráficos, simulação e indicadores de relacionamento exigem abrir seções para consultar. Deixar informações de decisão visíveis. Reservar expansões para edição, histórico individual e evidências complementares.
- Severidade 2: rótulos, bordas e parágrafos competem com os valores. Usar três níveis tipográficos, métricas compactas, proporções reais e superfícies discretas.
- Severidade 2: no celular, filtros longos ocupam três linhas antes dos indicadores. Agrupar período, janela e atualização na mesma linha, mantendo nomes acessíveis.
- Severidade 2: cores avulsas e botões com branco sobre verde claro podem reduzir contraste. Reutilizar tokens de ação/status, verificar ambos os temas, tornar foco e toque explícitos.

Diagnóstico inicial indicativo: UX 6/10 (ação principal, reconhecimento e informação visível); Refactoring UI 6/10 (5/8 verificações: faltam hierarquia, largura de texto e contraste verificado). Não são medidas de satisfação, conversão ou teste com usuários. O objetivo é resolver os itens concretos e validar os fluxos, não otimizar uma nota subjetiva.

## Direção visual

Preservar Inter, o verde KÔMA e os tokens existentes de `src/index.css`:

- escuro: canvas `#060807`, painel `#121614`, texto `#ffffff`, secundário `#a7b8b0`, ação `#05c49d`, texto da ação `#071c17`;
- claro: painel `#ffffff`, texto `#11181c`, secundário `#52606a`, ação `#00745f`, texto da ação `#ffffff`.

Usar referências sem importar paletas, fontes, bibliotecas ou animações adicionais. A recomendação genérica de landing page de UI/UX Pro Max não se aplica ao caixa e foi rejeitada; a busca restrita encontrou CRM & Client Management. A paleta e identidade do produto prevalecem.

Hierarquia: uma ação principal por etapa, indicadores de 24–30px, rótulos/contexto de 12–14px, controles de pelo menos 44px em toque. Espaçamento usa a escala Tailwind já instalada. Alinhar dados para leitura rápida; evitar cartões dentro de cartões quando não houver uma relação funcional.

## Padrões reutilizáveis

- `KomaMetricGroup`: valores recebidos do domínio, contexto obrigatório e ícone discreto. Barras apenas com fração observada e denominador conhecido. Aplicado em Resultados e Benefícios.
- `KomaEmptyState` com variante `action`: texto curto e ação direta, usando o componente existente. Sem números ilustrativos para preencher lacunas.
- `operationalWorkspace.css`: convenções opt-in de foco, toque, tipografia numérica, movimento reduzido e botões com os tokens atuais. Aplicado inicialmente só no Relacionamento.
- `koma-toolbar`, botões e badges existentes continuam sendo a base. Sem biblioteca paralela, novas fontes ou dependências de produção.
- Preferir etapas reconhecíveis para campanhas: Público → Mensagem → Contatos. A etapa ativa e os bloqueios continuam reais; salvar rascunho não envia mensagens.
- Usar diagramas concretos para fidelidade: compra → benefício, com a regra salva e simulação separada do rascunho. Preservar confirmação antes de salvar.
- Erros mantêm dados anteriores e oferecem recuperação. Estados assíncronos devem ter nome/status acessível.

## Contratos preservados

Sem mudança de API, banco, regras de fidelidade, agregação ou envio de mensagens. Rascunhos permanecem montados entre abas. Confirmar contato manual não comprova entrega. Uso de cupom não comprova conversa; associação temporal não comprova causalidade; valor líquido pago não representa lucro. Recorrência usa todo o histórico, não a conversão do período. Campanhas preservam sua janela salva.

Os gráficos usam eventos datados recebidos do servidor e base zero. Não interpolar totais em datas sem evidência. Dados de teste e capturas locais são fixtures isoladas e devem ser identificados como tal.

## Skills efetivamente aplicadas

Instalação local via `skills@1.7.4`, com scripts de instalação desabilitados, telemetria desabilitada e cópia apenas das skills selecionadas para Codex. Pacote/entrada CLI e scripts de busca foram examinados antes do uso; o mecanismo de busca Python usa biblioteca padrão e arquivos CSV locais. Não foram instaladas dependências do projeto por causa dessas skills.

- [ux-heuristics](https://github.com/wondelai/skills/tree/main/ux-heuristics): reconhecimento, feedback, prevenção de erro, ações explícitas e diagnóstico por severidade.
- [refactoring-ui](https://github.com/wondelai/skills/tree/main/refactoring-ui): hierarquia, agrupamento, escala tipográfica, superfície e visualização de dados.
- [web-design-guidelines](https://github.com/vercel-labs/agent-skills/tree/main/skills/web-design-guidelines): revisão das regras oficiais atuais de foco, controles, temas, números e movimento reduzido.
- [frontend-design](https://github.com/anthropics/skills/tree/main/skills/frontend-design): preservar identidade do restaurante e eliminar ornamentação/template sem função.
- [ui-ux-pro-max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill): busca específica de CRM, foco não encoberto e orientação React. Recomendações são filtradas pelo contexto e versão real da aplicação.
- [vercel-react-best-practices](https://github.com/vercel-labs/agent-skills/tree/main/skills/react-best-practices): manter valores derivados, evitar efeitos/estado redundantes, não adicionar biblioteca pesada e preservar carregamento por área.

## Verificação e sequência de expansão

Antes de integrar: TypeScript, unitários, build e browser; cobrir os oito viewports existentes, resultados medidos/não medidos/zero, filtros com respostas fora de ordem, campanha/contato com confirmação real do servidor, edição de fidelidade e rascunhos entre abas. Revisar capturas de celular e desktop, temas claro/escuro, movimento reduzido, teclado e controles de toque. Medir contraste dos tokens usados; não confundir inspeção automatizada com teste de usabilidade humano.

Após estabilizar Relacionamento, aplicar os mesmos padrões em pequenas PRs: (1) Vendas/Caixa, priorizando localizar pedido e executar ação; (2) Cardápio, edição e prévia; (3) Estoque, pendências e impacto da movimentação; (4) configurações, agrupamento por tarefa. Cada etapa começa com o fluxo real, contratos e baseline próprios. Não alterar essas áreas nesta PR.
