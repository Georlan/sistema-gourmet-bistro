# KÔMA — checklist de migração para repositório privado

> Estado: preparação técnica; **não autoriza mudar visibilidade automaticamente**.
> Data de referência: 2026-10-10. Confirmar novamente imediatamente antes da mudança.
> Não incluir senhas, tokens, dados pessoais, strings de conexão ou logs brutos nas evidências.

## Evidências verificadas na preparação

- Repositório `Georlan/sistema-gourmet-bistro`: público, `main` padrão, nenhum fork público reportado na API e GitHub Pages desabilitado em 10/10/2026.
- Ruleset **Protect main branch** ativo na visibilidade pública, com PR obrigatório e status `Merge verdict` obrigatório.
- `.github/workflows/secret-scan.yml` usa Gitleaks com checkout do histórico completo; a conclusão recente foi sucesso. Isso **não prova ausência de segredos** em commits anteriores.
- `docs/security-credential-rotation.md` reconhece uma senha embutida numa migração antiga. A versão atual não contém a senha, mas o commit antigo permanece no histórico.
- O Print Agent usava URLs anônimas do repositório monolítico. Os instaladores foram desacoplados da main pública e aceitam pacote completo. O workflow `Print agent` produz ZIP interno e o workflow `Publish public Print Agent release` prepara publicação **somente do pacote de impressão** em GitHub Releases de **outro repositório público**.

## Bloqueios de liberação (não tratar como aprovados sem evidência)

1. **Governança de `main`**: os rulesets e branch protection **não são aplicáveis em repositório privado no GitHub Free pessoal**. No GitHub Pro (pessoal) ou Team (organização), conferir que o ruleset continua ativo, com `Merge verdict` obrigatório, PR sem bypass e proibição de force-push. Se estiver em Free, a mudança reduz a garantia técnica de "merge somente CI verde": **não executar o corte até decidir entre GitHub Pro/Team ou outro mecanismo de enforcement efetivo**. CI executando após push não bloqueia commits ruins na `main`.
2. **Credencial histórica**: responsável de infraestrutura deve confirmar diretamente no PostgreSQL que a senha da antiga role `koma_app` foi revogada/desativada em todos os ambientes que a aplicaram, e que a role de runtime usa credenciais rotacionadas. Não copiar o valor antigo dos commits, não compartilhar saída sensível e não reescrever histórico de forma unilateral. Qualquer dúvida: tratar credencial antiga como comprometida e rotacionar com janela de segurança, plano de rollback e validação operacional.
3. **GitHub privado + ChatGPT/Codex**: em repositório privado de teste, verificar que a conexão ao GitHub permite leitura, alteração em branch, abertura de PR e consulta a CI no plano/experiência ChatGPT realmente usados. Não presumir que acesso de leitura implica capacidade de escrita.
4. **Deploys**: conferir, em ambiente administrativo próprio, que os GitHub Apps de **Railway** e **Cloudflare Pages** têm acesso autorizado ao repositório privado. Não remover integrações antigas antecipadamente. Confirmar webhook/push e preview em branch **sem mexer na produção**. Depois da mudança, confirmar os deploys da `main` e health/smoke não destrutivo (GET/OPTIONS).
5. **GitHub Actions no privado**: conferir saldo/limite de minutos e orçamento, uma vez que jobs em repositórios privados passam a consumir cota. Confirmar Gitleaks e `Merge verdict` funcionando com as permissões existentes; não expor segredos em outputs nem artefatos.
6. **Distribuição pública do Print Agent**: criar um repositório GitHub **público, inicializado com README e sem código do SaaS**, específico para downloads (não pode ser fork do SaaS nem receber todo o repositório). A integração atual não permite criar o repo automaticamente; fazer pelo GitHub do proprietário/organização. Em Settings → Secrets and variables → Actions, configurar `KOMA_PRINT_AGENT_DISTRIBUTION_REPO` com o endereço real `OWNER/REPO` e `KOMA_PRINT_AGENT_DISTRIBUTION_TOKEN` (fine-grained PAT com `Contents: write` **somente** no repositório distribuidor). Preferir armazenar token no environment `print-agent-public-release` com aprovação para publicação; nunca expor o valor em arquivos, prints ou mensagens. Executar manualmente o workflow `Publish public Print Agent release` na `main` aprovada e conferir o alvo como público: se o alvo for privado/inexistente, o workflow falha. Ele envia somente `KOMA-print-agent.zip` e `KOMA-print-agent.zip.sha256` como assets de GitHub Release; não faz git push da main ou do histórico privado. Abrir a página pública da release sem login, testar os downloads e a verificação SHA-256 e validar instalação/atualização física de impressão Windows antes da mudança de visibilidade.

7. **Outras dependências públicas**: pesquisar por downloads anônimos de `github.com/Georlan/sistema-gourmet-bistro` e `raw.githubusercontent.com` fora da documentação interna. Links para README/código deixarão de funcionar para visitantes anônimos; substituir somente materiais que precisam de acesso externo.
8. **Cópias externas**: verificar forks e publicações existentes perto do corte; forks públicos pré-existentes não se tornam privados. Código baixado antes da mudança, indexação e credenciais em histórico não são apagados pelo ato de privatizar.

## Sequência segura do corte (executada pelo proprietário)

- [ ] Guardar SHA e resultado de todos os gates obrigatórios da `main`, sem fazer merge de PRs com CI vermelho.
- [ ] Criar repositório **separado e público** para distribuir somente o Print Agent; registrar `OWNER/REPO` real na variável de Actions e token fine-grained restrito a esse repositório, protegido no environment.
- [ ] Executar o publicador manual, baixar `KOMA-print-agent.zip` e `KOMA-print-agent.zip.sha256` anonimamente de GitHub Releases (sem login) e validar hash, conteúdo e instalação/atualização num Windows com impressora física; manter ZIP de fallback.
- [ ] Confirmar rotação da credencial histórica e role PostgreSQL segura; sem dumps, seeds, purge ou SQL de escrita em produção.
- [ ] Confirmar plano GitHub e enforcement de PR/`Merge verdict` para branch privada.
- [ ] Confirmar permissões Railway e Cloudflare para o repositório privado e fluxo de IA conectado.
- [ ] Confirmar orçamento/minutos Actions; manter `secret-scan` habilitado.
- [ ] Em GitHub → Settings → General → Danger Zone → Change repository visibility, selecionar **Private**.
- [ ] Imediatamente conferir ruleset `Protect main branch`, Action `Merge verdict`, Gitleaks, PR teste sem merge, webhooks e acesso de provedores.
- [ ] Confirmar smoke não destrutivo dos serviços públicos, status do frontend e API; nada de pedido/pagamento de teste em produção.
- [ ] Publicar a URL real do repositório público de distribuição do agente nos canais de suporte; usar URL de Releases sem token, jamais a URL da `main` privada.
- [ ] Solicitar ao Google a atualização de resultados desatualizados; não considerar isso exclusão de cópias previamente acessadas.

## Se algo falhar

Parar novos merges e deploys até identificar a causa. Restaurar permissões da instalação de GitHub Apps e corrigir integrações sem expor o código novamente. **Não voltar automaticamente o repositório para público como medida de recuperação**, porque isso reabre toda a superfície de exposição. Usar o ZIP local previamente validado para impressão enquanto a distribuição for ajustada.

## Referências oficiais

- [GitHub: visibilidade de repositórios](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility)
- [GitHub: regras de proteção e planos](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
- [GitHub: rulesets e disponibilidade](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets)
- [Cloudflare Pages: integração Git](https://developers.cloudflare.com/pages/configuration/git-integration/)
- [GitHub Actions: cobrança e uso](https://docs.github.com/en/actions/concepts/billing-and-usage)
