# KÔMA — Onboarding rápido (proposta operacional e diretriz de produto)

> **Objetivo:** colocar um restaurante em condição de **acessar, configurar e testar o KÔMA pelo celular o quanto antes**, sem transformar contrato, gateway, fiscal ou impressora em pré-requisito do primeiro acesso.
>
> **Estado do documento:** diretriz de produto e roteiro de implementação. **Não afirmar que todas as transições abaixo já existem no código.** A implementação canônica atual está descrita em [signup-automation.md](../signup-automation.md) e nas rotas Super Admin. Validar cada etapa contra o runtime real.

## Por que existe (lições do JE Lanches, ID 1, novembro/2026)

- O desejo de ocupar um ID específico exigiu investigar resíduos históricos de backups/Storage e criar um fluxo de reutilização segura. **Padrão futuro:** sugerir automaticamente um ID elegível; só investigar um ID exato quando houver motivo explícito e bloqueio real. Não limpar dados de produção para preencher buracos por padrão.
- O cadastro administrativo/provisório e a contratação pública eram caminhos distintos. Criou-se o tenant sem assinatura, depois foi necessário construir a transição provisório → comercial. **Padrão futuro:** um único assistente de onboarding com estados progressivos; nunca duplicar tenant, usuário, catálogo ou trial.
- CPF/CNPJ, nome legal, e-mail definitivo e billing bloquearam o andamento mesmo quando a tarefa era **configurar e testar**. **Padrão futuro:** coleta progressiva; diferenciar identidade para acesso, aceite mínimo dos termos, dados fiscais e meio de cobrança, cada qual no momento exigido por segurança e lei.
- A indisponibilidade do gateway SaaS e o desejo de Pix manual levaram a workarounds de faturamento antes da primeira utilização. **Padrão futuro:** método de cobrança separado do primeiro acesso. Não fingir pagamento, aceite, billing ready nem confirmação bancária.
- Importar produtos não resultou automaticamente em boa experiência de escolha. **Padrão futuro:** catálogo utilizável, com agrupamento por família (tamanho/sabor) e complementos fáceis de manter, é mais importante que um número bruto de SKUs.
- O Android Print ficou misturado à implantação. **Padrão futuro:** impressora é melhoria opcional para primeiro acesso e teste de catálogo; sua homologação física é obrigatória antes de declarar a **impressão automática** pronta.
- Vários PRs, branches e cópias locais atrasadas prolongaram o trabalho. **Padrão futuro:** partir da `origin/main` atual; branch/PR por bloqueio real, CI verde, merge e teste mobile. Não abrir auditorias gerais repetidas.

## Os três marcos que NÃO devem ser confundidos

### A. Criado e configurável (primeiro valor, SEM trial)

**Dados mínimos:** nome comercial, plano pretendido, perfil operacional, contato/login **realmente controlado** por fundador ou lojista e ID elegível escolhido automaticamente (ID manual apenas quando justificado). Senha gerada e entregue por meio seguro, com troca posterior; não usar senha publicada em chat.

**Resultado verificável:** tenant isolado criado uma única vez; administrador consegue entrar pelo celular, editar perfil, escolher retirada/entrega, cadastrar/importar produtos e abrir prévia do cardápio. Não exigir Google OAuth, Mercado Pago, Banco do Brasil, impressora, CPF/CNPJ nem cobrança para concluir **somente essa etapa**, salvo necessidade legal específica identificada.

**Gate:** sem aceite comercial verdadeiro e sem liberação, operação real bloqueada; oferecer simulação segura de jornada do pedido em ambiente isolado. `saas_status=active` por si só **não** comprova liberação; usar estado de implantação e regra canônica.

### B. Funcional em teste de 7 dias (trial, operação autorizada)

**Meta de produto:** após um onboarding curto, o lojista confirma os dados mínimos necessários, recebe os termos de teste e os aceita pessoalmente; o Super Admin valida o essencial (perfil, horário/abertura manual verdadeira, >=1 produto ativo, modalidades), concede a liberação operacional e inicia exatamente **7 dias**, com início/fim visíveis e idempotência.

**Decisão para implementação:** avaliar e implementar um **caminho de trial sem exigir gateway financeiro previamente configurado**, quando juridicamente e operacionalmente permitido, usando aceite mínimo autêntico. **Não** pular consentimento, identidade exigida por lei, ou termos aplicáveis. Se a legislação/contrato atual exigir dados adicionais antes de vendas reais, manter o bloqueio e pedir **apenas os dados estritamente necessários**, explicando o motivo.

**Sem pagamento adiantado:** nenhuma mensalidade é devida durante implantação ou antes de D+7. Evitar cobrança automática inesperada. O modo de pagamento comercial só passa a ser necessário para a cobrança conforme regras jurídicas e comerciais validadas. Não simular gateway ou Pix.

### C. Contratado e faturável (comercial completo)

Concluir identificação jurídica e fiscal exigível, aceite comercial e autorização de cobrança conforme o método escolhido. Usar a assinatura, contrato, billing e auditoria canônicos. Pix administrativo manual requer referência bancária verificada no extrato, valor exato, idempotência, vencimento e renovação corretos; nunca marcar pago só porque chegou um comprovante.

Separar os fluxos: **mensalidade KÔMA** é diferente de **pagamentos dos pedidos do restaurante**. Eventual migração de conta/gateway não bloqueia a configuração inicial.

## Caminho padrão (sem desvios)

1. **Verificar se tenant já existe** por identificador real/slug e assinatura; no JE Lanches o ID 1 já existe. Retomar em vez de recriar.
2. **Criar/acessar:** Super Admin provisiona no ID elegível, com plano previsto, administrador sob controle autorizado e modo de preparação. Mostrar link de login e status.
3. **Configurar essencial no celular:** nome, operação, abertura manual ou horários verdadeiros, catálogo mínimo, formas de recebimento de pedidos realmente suportadas.
4. **Importar/ajustar cardápio:** produtos com preços verdadeiros, fotos disponíveis, famílias de variantes sem inventar combinações, adicionais pagos opt-in, sugestão contextual de acompanhamentos/bebidas. O dono edita sem SQL/JSON.
5. **Testar antes de liberar:** login, editar produto, indisponibilidade, montagem, sacola, total, retirada, preview mobile 360/390/412 px e bloqueio de pedidos reais no estado de preparação. Impressão e entrega só se fizerem parte do primeiro uso.
6. **Pronto para trial:** apresentar um único painel de pendências **bloqueantes de verdade**, sem esconder questões contratuais/legalmente exigíveis. Obter aceite mínimo real, cumprir requisitos de liberação e **acionar explicitamente D+7** pelo fluxo canônico.
7. **Depois:** dados fiscais adicionais quando legalmente adiáveis, forma definitiva de cobrança, integrações bancárias, impressão Android, app de entregador, relatórios avançados e personalização. Nenhum item opcional impede as fases anteriores.

## UX e automatização desejadas (não presumir implementadas)

- Uma única página **"Novo restaurante"**: nome + plano + e-mail controlado/convite + tipo de operação → **Criar e configurar**. Outras perguntas aparecem quando necessárias. Permitir salvar e voltar depois.
- Estados claros: `preparando` → `pronto_para_teste` → `trialing` → `active/past_due`, implementados com **fonte canônica de estado**, evitando flags paralelas e rótulo enganoso `active` antes da liberação.
- Checklist visível com duas colunas: **bloqueia primeira utilização** / **pode ser configurado depois**. Não exigir que usuário escolha tecnologias (OAuth, SDK, RLS etc.).
- Assistência de importação de cardápio via texto/foto/PDF/WhatsApp; quando insuficiente, deixar produto pendente de revisão, nunca inventar preço ou ingrediente.
- Após confirmar a loja, oferecer link administrativo e prévia imediatamente. O painel mostra se está em preparação e **quando** começa o trial.
- Medir tempo de **criação → primeiro login → primeiro cardápio utilizável → trial ativado**, número de passos manuais/PRs por cliente e quantos bloqueios não eram indispensáveis.

## Invariantes e critérios de aceite

- Nunca inventar CPF/CNPJ, senha de terceiro, aceite, pagamento ou horários; validar direitos sobre e-mail/conta e preservar administrador provisório até transferência segura.
- Nunca iniciar trial automaticamente ao **criar** o restaurante; iniciar **uma única vez** quando autorizado e realmente pronto, sem reset por reentrada.
- Impedir pedidos reais na preparação; política pública e backend precisam apresentar o mesmo estado, **mesmo com turno de Caixa aberto**.
- Tenant isolado, recursos por plano/overrides auditáveis, preservação de outros tenants (ID 6 tem operação real protegida). Zero SQL manual para provisionar ou eliminar resíduos em produção.
- Um login funcional e um catálogo editável **não são** prova de contratação nem de operação comercial. Um build/HTTP 200 **não** é papel impresso.
- Toda mudança vai em PR pequeno, tests focais, gates verdes e merge seguro; telas mobile testadas pelo navegador, não só por API.
- Reportar sempre `Concluído / Bloqueia agora / Pode ficar para depois`, com evidência. Evitar ampliar escopo ou iniciar nova auditoria quando existe um impedimento focal.

## Caso de regressão obrigatório — JE Lanches (ID 1)

O ID 1 já foi provisionado com Pocket, 28 produtos, 5 categorias, opções pagas e recursos de impressão/entregador concedidos. A transição atual para comercial depende de contrato real e assinatura `onboarding`, seguida da liberação explícita do trial. O novo fluxo deve **retomar o tenant**, preservar catálogo, administrador e concessões, e evitar depender da API do Mercado Pago para **configurar** a loja. Não afirmar trial ou vendas reais liberados antes de evidência concreta.

**Roteiro e contratos técnicos relacionados:** [checklist de implantação](README.md), [inscrição/assinatura](../signup-automation.md), `backend/app/routes/super_admin_profile_onboarding.py`, `backend/app/routes/super_admin_contracts.py`, `backend/app/services/onboarding_trial.py`, `backend/app/services/restaurant_provisioning.py`.