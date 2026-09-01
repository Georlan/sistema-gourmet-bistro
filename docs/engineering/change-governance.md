# Governança de mudanças

Fluxo: branch → PR → checks obrigatórios rápidos → merge → validação pesada na main.
Não usar bypass administrativo, force-push ou push direto para acelerar entregas.

## Checks obrigatórios

Os quatro contexts exigidos pela proteção da `main` são preservados para evitar checks pendentes por nome inexistente, mas o caminho crítico de PR deve terminar em poucos minutos:

- `Frontend typecheck + unit + build`: TypeScript, unitários e build de produção.
- `Backend full + critical regression gate`: single-head de Alembic e regressões rápidas de backend/CORS/headers.
- `Browser regression matrix`: smoke E2E em mobile e desktop sobre ownership/contexto operacional.
- `postgres-security-audit`: regressões rápidas de segurança sem subir PostgreSQL adversarial no caminho crítico.

As validações pesadas continuam obrigatórias como observabilidade pós-merge, mas não bloqueiam PRs: matriz E2E completa, suite backend completa, print-agent, npm audit, pip-audit/SBOM, métricas arquiteturais e auditoria PostgreSQL adversarial rodam em `push` para `main`, além dos agendamentos aplicáveis.

Usar atualização estrita da base, resolução de conversas e proteção também para administradores.
A exigência de PR não requer aprovação de um segundo humano indisponível: revisão é registrada no PR,
mas a contagem administrativa mínima de aprovações permanece zero. Não confundir isso com revisão automática.
Workflows de migração/drift/B1.4 continuam adicionais e condicionais; não exigir checks que não são disparados.
Configuração remota deve ser lida de volta após alteração. Não considerar a documentação prova de proteção aplicada.

## Rotina de análise de código

`codeql-analysis.yml` analisa JavaScript/TypeScript e Python em PR, push na main e semanalmente,
com `security-extended`, sem build para essas linguagens interpretadas. Usa a configuração
[oficial do CodeQL Action](https://github.com/github/codeql-action).
Os resultados ficam em Security / Code scanning. Não tratar execução bem-sucedida como ausência
de alertas: triar novas descobertas e registrar falsos positivos com justificativa, sem desativar queries.
CodeQL é rotina adicional aos quatro checks obrigatórios e não deve alongar o caminho crítico do merge.

## E2E e diagnóstico

Backend: `backend/conftest.py` recria `.pytest_koma.db` dentro do checkout e
sobrescreve `DATABASE_URL` no modo SQLite. Não executar duas suítes pytest de
backend simultâneas no mesmo worktree, mesmo passando URLs diferentes: uma pode
apagar o banco da outra. Serializar essas execuções ou usar checkouts isolados.
O modo externo tem validação própria de host/nome e não deve ser usado para
contornar a proteção do banco de testes.

Executar com fontes congeladas e porta exclusiva (`KOMA_E2E_PORT`). O runner falha se a porta estiver ocupada.
Nunca reaproveitar um servidor de outro worktree. Registrar SHA, teste, viewport e DOM/trace antes de mudar seletor.
O runner desliga HMR e usa cache de otimização em `.vite/e2e` dentro do worktree,
mesmo quando `node_modules` é compartilhado. Congelar também documentação e configuração até o fim.
Uma execução local deste bloco foi descartada após o trace mostrar navegação/reconexão do servidor
de desenvolvimento no meio do fechamento do convite de Equipe. O teste não foi alterado;
a validação deve ser repetida com o ambiente isolado.

Em `30acd1a`, oito falhas de `public-menu-order.spec.ts` foram causadas pelo nome acessível
alterado de Delivery para Entrega. O DOM do artefato de CI confirmou o controle Entrega.
A correção preserva endereço, taxa, payload e ausência de OTP e verifica `aria-pressed`.
Na base `5be341b`, a revisão de retirada também mudou de texto: o teste ainda procurava
“Pagamento direto ao restaurante”, enquanto o DOM apresentava “Pagamento escolhido”,
“Pix · na retirada” e o aviso explícito de ausência de cobrança online. A asserção agora
verifica esse resumo selecionado, não apenas um Pix genérico entre as formas aceitas.
As três falhas locais antigas de `cashier-responsive.spec.ts` não foram reproduzidas:
60 passes e quatro skips previstos em oito viewports, sem retries. Faltam logs/SHA originais;
não atribuir causa sem esses artefatos e não alterar seus testes por hipótese.
