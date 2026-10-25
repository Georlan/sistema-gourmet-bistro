# Fundação visual KÔMA — primeira etapa

Direção aprovada: fundação comum com perfis Compra, Operação e Gestão/Análise;
Inter e Space Grotesk; verde oficial `#05C49D`; aproveitar os assets existentes.
Esta etapa não redesenha Caixa/PDV nem muda regras, consultas ou permissões.

## Fontes e compatibilidade

- `src/styles/komaFoundation.css` contém marca, famílias, superfícies, texto,
  bordas, foco e ações compartilhadas. Os nomes `--koma-*` existentes continuam
  sendo o contrato público; seus valores anteriores foram preservados.
- Gestão/Análise começa com esse contrato neutro existente, sem novo tema ou
  aplicação automática de um template às telas.
- `src/index.css` importa a fundação antes dos consumidores. Mantém os tokens
  legados `--color-brand-*`, estados, estágios e regras de compatibilidade.
  A identidade fixa não substitui a configuração visual de cada restaurante.
- `--kw-*`, em `waiterOperational.css`, são aliases de `--koma-operation-*`.
  Cores, estados, geometria, densidade e tipografia do Garçom foram preservados.
  Rosa de atendimento não é sinônimo global de erro.
- `--art-bg`, `--art-card-bg`, `--art-text-main`, `--art-emerald` e seu hover
  passam a apontar para `--koma-purchase-*`. Dossel, ondas, sombras e fotografia
  continuam locais ao Cardápio; `--menu-*` e `cardapioTone.css` continuam sendo
  a compatibilidade das apresentações anteriores.
- `--font-sans` e `--font-display` usam as famílias da fundação. Não há troca de
  fontes, novos downloads ou alteração da ampliação operacional de texto.

## Pares de ação

O verde oficial é `--koma-brand-reference`, constante entre temas. Não confundir
marca com a cor de toda ação: os perfis preservam seus verdes aprovados.

- Compartilhado escuro: fundo `#05C49D`, texto `#071C17`.
- Compartilhado claro: fundo `#00745F`, texto branco.
- Compra escuro: mantém `#10B981` e os gradientes existentes, com texto `#071C17`.
- Compra claro: mantém `#00875A` e texto branco; o hover do gradiente foi
  escurecido para conservar contraste AA. `--art-on-accent` acompanha o perfil.
- Operação: mantém `#35D9B0`/`#05271D` no escuro e `#006C53`/branco no claro.

Esta etapa corrige as ações artísticas, sem substituir indiscriminadamente as
classes globais de botões. A migração de outros consumidores e estados é posterior.

## Modal de produto

O modal canônico continua sendo `CardapioProductModal`. A rotina leve
`containModalFocus` gerencia foco inicial, Tab/Shift+Tab, Escape, fundo `inert`
e retorno ao acionador. O portal tem anel de foco explícito nos dois temas.
Restaura valores anteriores no cleanup, inclusive no
StrictMode e ao editar sobre a sacola. Não recria listeners a cada alteração
de quantidade/opção, nem interfere na história de navegação já existente.

## Regressão e revisão

- `e2e/cardapio-foundation-accessibility.spec.ts`: contraste normal/hover nos
  dois temas, foco, reabertura, Voltar e edição com montagem preservada.
- `e2e/waiter-salon-wave1.spec.ts`: cores efetivas do Garçom nos dois temas e
  fluxos operacionais existentes.
- Capturas opcionais: definir `KOMA_VISUAL_CAPTURE_DIR` ao executar o teste novo.
  São telas reais com fixture local, não pedidos de produção. O claro do Cardápio
  exercita o CSS de compatibilidade; não foi criado um seletor público de tema.
- O workflow existente `cardapio-browser-targeted.yml` inclui a nova regressão.

Sem novas bibliotecas, serviços, imagens, gravações no backend ou alterações de
assets. Desfazer o PR restaura os estilos e o comportamento anteriores. O rollout
aguarda revisão e autorização explícita de merge.
