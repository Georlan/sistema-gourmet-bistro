# Identidade na implantação comercial

A partir desta alteração, `steps.profile` exige nome público, endereço e WhatsApp (`Restaurante.socials.whatsapp`) quando a assinatura está em `onboarding`/`suspended` e `trial_started_at` é nulo. Valores vazios ou apenas espaços não concluem o passo. O formato JSON legado de `socials` continua aceito.

Slogan, logo, banner, sobre o restaurante, Instagram e Maps não concluem o essencial. A tela canônica continua sendo `/api/cardapio-digital/config`; não há outro formulário ou persistência.

Restaurantes já liberados e ambientes administrativos conservam a avaliação histórica de perfil. Esta mudança não deve bloquear uma operação existente. O Super Admin consome o mesmo snapshot, sem regra paralela: `readyForRelease` segue calculado pelo backend com os quatro essenciais.

O cardápio recebido indica preparação assistida, não publicação. Só um produto ativo conclui `steps.catalog`. Mesas cadastradas e tipo salvo comunicam preparação real, sem aumentar o contador de essenciais.

No cadastro comercial ainda não liberado, dados e horários usam os componentes canônicos dentro de `/ativar`: “Salvar e continuar” confirma o PUT existente e consulta uma vez `/api/onboarding/status` antes de abrir a próxima etapa pendente. Revisar um essencial concluído não abre o Caixa. Trocar entre formulários com alterações não salvas exige confirmação. Fora do cadastro guiado, o botão contextual conserva o retorno para `/ativar?resume=1` após sucesso. Em falha, mantém campos e mensagem da API. Linhas de horário incompletas não são descartadas silenciosamente. Horários permanecem informativos; não controlam abertura do caixa ou início do trial.

Nenhuma ação deste fluxo inicia trial ou libera vendas. A revisão e a liberação explícita permanecem canônicas.


## Cadastro guiado e integração com a revisão KÔMA

- O formulário mostra apenas nome público, WhatsApp e endereço como informações principais. Informações adicionais continuam recolhidas; a prévia do celular e o slogan não competem com esta etapa. Valores opcionais já gravados são preservados pelo payload canônico.
- Horários reutilizam o editor de dias agrupados e horários após meia-noite. Pedidos agendados ficam fora desta etapa e sua configuração não é consultada no modo embutido.
- PUT com erro mantém os campos; falha/timeout de confirmação ou `steps[etapa] != true` mantém a etapa e permite tentar novamente mesmo depois de o PUT ter sido confirmado. A chamada de confirmação tem timeout.
- Após dados e horários, o envio assistido do cardápio aparece antes dos atalhos. Criar produtos manualmente e preparar modalidades/equipe seguem disponíveis em paralelo.
- Arquivo recebido não conclui catálogo. Durante preparação assistida pendente/processando, a consulta de prontidão reutiliza o único timer existente, a cada 30 segundos, apenas com página visível e sem alterações não salvas. A espera pela liberação conserva o intervalo existente de 8 segundos.
- Não há cálculo local alternativo de progresso, nem endpoint novo. O snapshot consumido pelo Super Admin continua canônico; a consulta após salvar preserva o alerta idempotente de 4/4 integrado em #1013. Isso não comprova entrega de e-mail/Telegram.
- Nenhuma simulação grava em restaurante real. O E2E intercepta as APIs para verificar falha de PUT, falha de confirmação, retomada, revisão sem descartar mudanças e passagem para espera KÔMA sem início de trial.
