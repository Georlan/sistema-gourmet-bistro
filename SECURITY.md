# Política de segurança

## Reporte privado de vulnerabilidades

Não publique vulnerabilidades, credenciais, dados pessoais, comprovantes, chaves, tokens, URLs assinadas ou instruções de exploração em issues, discussions, pull requests ou outros canais públicos.

Canal preferencial: use **Report a vulnerability** na aba Security do GitHub, quando a opção estiver habilitada para este repositório:

<https://github.com/Georlan/sistema-gourmet-bistro/security/advisories/new>

Se o formulário não estiver disponível, peça ao mantenedor, por mensagem privada, um canal de recebimento antes de enviar detalhes técnicos. Não inclua o conteúdo da vulnerabilidade nesse primeiro contato.

> **Bloqueio antes do go-live comercial:** criar um endereço de segurança monitorado no domínio oficial da Kôma, publicá-lo aqui, habilitar o reporte privado do GitHub e testar ambos os canais.

## O que incluir no reporte

- commit, versão ou ambiente afetado;
- componente e pré-condições necessárias;
- passos mínimos e reprodutíveis, sem atacar dados ou contas de terceiros;
- impacto observado e impacto potencial;
- prova de conceito segura, quando necessária;
- sugestão de correção, se houver;
- forma privada de contato para coordenação.

Remova segredos e dados pessoais de logs, capturas e anexos. Use registros sintéticos sempre que possível. Não envie dumps de banco, arquivos `.env` ou credenciais reais.

## Versões suportadas

O projeto ainda não mantém uma matriz de releases versionadas com suporte de segurança formal.

| Linha | Situação |
|---|---|
| Revisão atualmente implantada, identificada por commit | Correções em melhor esforço durante a fase de desenvolvimento |
| `main` ainda não implantada | Avaliada para a próxima liberação; não representa automaticamente produção |
| Commits e builds anteriores | Sem suporte, salvo acordo escrito específico |

Antes do uso profissional, cada implantação deve registrar o commit exato, migrações aplicadas, data, responsável e procedimento de rollback. Esta política não cria SLA contratual.

## Tratamento esperado

O mantenedor deve:

1. confirmar o recebimento pelo canal privado;
2. classificar impacto, explorabilidade, tenants e dados atingidos;
3. preservar evidências sem ampliar a exposição;
4. conter o incidente e revogar acessos comprometidos;
5. corrigir a causa, adicionar teste de regressão e revisar variantes do mesmo problema;
6. validar a correção em ambiente isolado antes de liberar;
7. coordenar a divulgação somente depois da contenção e de uma versão corrigida;
8. registrar linha do tempo, decisões e ações preventivas em um pós-incidente privado.

Prazos e comunicação pública dependem do risco, dos contratos e das obrigações regulatórias. Nenhuma divulgação deve expor vítimas, segredos ou detalhes que facilitem abuso antes da correção.

## Resposta a credenciais ou artefatos expostos

O histórico público deste projeto já conteve credenciais e artefatos sensíveis. Excluir um arquivo do branch atual não encerra o incidente: clones, forks, caches, artefatos de CI e commits antigos podem preservar o conteúdo.

Para cada item afetado:

1. identifique o provedor, escopo, ambientes e período de exposição sem imprimir o valor em logs;
2. revogue ou invalide a credencial no provedor;
3. gere uma substituta com o menor privilégio e prazo compatíveis;
4. armazene-a no gerenciador de segredos e atualize somente os ambientes autorizados;
5. reimplante e invalide sessões, tokens derivados, webhooks ou material cifrado quando necessário;
6. revise logs de uso e permissões para sinais de acesso indevido;
7. reemita documentos, convites, QR codes ou links que continuem utilizáveis;
8. avalie impacto sobre titulares, clientes e fornecedores com os responsáveis jurídicos e de privacidade;
9. somente depois da rotação, planeje a sanitização coordenada do histórico e a invalidação de caches;
10. avise colaboradores de que será necessário descartar clones antigos e reclonar.

Uma reescrita de histórico é destrutiva e não garante remoção de cópias externas. Ela deve ser planejada, revisada e comunicada; nunca substitui rotação, revogação ou análise do incidente.

## Controles mínimos de release

Uma versão candidata não deve ser promovida apenas porque compila. O gate de segurança deve incluir:

- testes de autorização entre tenants e perfis;
- varredura de segredos e PII em arquivos, histórico aplicável e artefatos;
- análise de dependências e SBOM;
- revisão de migrações, backup e restauração;
- validação de autenticação, sessões, webhooks, CORS, rate limiting e logs;
- confirmação de que integrações simuladas ou não homologadas permanecem desabilitadas;
- inventário de dados, retenção, fornecedores e fluxos internacionais;
- plano de rollback e monitoramento pós-release.

Consulte também [README.md](README.md), [LICENSE](LICENSE) e [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Esta política descreve o processo técnico do projeto e não substitui obrigações legais, regulatórias ou contratuais.
