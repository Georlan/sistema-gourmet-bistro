# Identidade na implantação comercial

A partir desta alteração, `steps.profile` exige nome público, endereço e WhatsApp (`Restaurante.socials.whatsapp`) quando a assinatura está em `onboarding`/`suspended` e `trial_started_at` é nulo. Valores vazios ou apenas espaços não concluem o passo. O formato JSON legado de `socials` continua aceito.

Slogan, logo, banner, sobre o restaurante, Instagram e Maps não concluem o essencial. A tela canônica continua sendo `/api/cardapio-digital/config`; não há outro formulário ou persistência.

Restaurantes já liberados e ambientes administrativos conservam a avaliação histórica de perfil. Esta mudança não deve bloquear uma operação existente. O Super Admin consome o mesmo snapshot, sem regra paralela: `readyForRelease` segue calculado pelo backend com os quatro essenciais.

O cardápio recebido indica preparação assistida, não publicação. Só um produto ativo conclui `steps.catalog`. Mesas cadastradas e tipo salvo comunicam preparação real, sem aumentar o contador de essenciais.

O botão contextual de dados/horários usa o PUT existente e volta para `/ativar?resume=1` somente após sucesso. Em falha, mantém campos e mensagem da API. Linhas de horário incompletas não são descartadas silenciosamente. Horários permanecem informativos; não controlam abertura do caixa ou início do trial.

Nenhuma ação deste fluxo inicia trial ou libera vendas. A revisão e a liberação explícita permanecem canônicas.
