# Contratação, liberação e benefício individual

## Contratar e provisionar

1. Abra a contratação pela página de planos do KÔMA. Selecione **Pocket** e o ciclo combinado; confira a revisão de preço, dados e termos com a cliente.
2. Salve os dados mínimos, registre aceite e conclua a autorização recorrente pelo método disponível. Resultado esperado: mensalidade fixa R$ 0 hoje e recorrência pausada durante implantação; não interpretar autorização como pagamento recebido.
3. Entre em **/super-admin → Inscrições** e localize pelo protocolo/e-mail. Se estiver **Aguardando liberação**, confira a autorização e clique **Liberar acesso**. Quando o fluxo apresentar contratação na aba **Contratações**, use **Ativar restaurante** somente após conferir aceite e billing; não criar outro tenant para a mesma inscrição.
4. Confirme tenant único, plano Pocket, administrador e convite. **Restaurantes → Novo restaurante** é provisionamento administrativo/QA, sem aceite comercial; não substitui esta contratação.
5. Se convite não chegar, confira fila/status e reenvie pelo fluxo de primeiro acesso do Super Admin. Não exponha link/token em relatório público nem crie outra assinatura para resolver falha de e-mail.

Fonte: [inscrição automatizada](../signup-automation.md). As credenciais SaaS do
KÔMA são separadas do Mercado Pago do restaurante: a cliente pode receber pedidos
offline sem conectar conta Mercado Pago para esses pedidos.

## Pocket + impressão de cortesia

Depois do provisionamento, entre em **Super Admin → Restaurantes**, localize o
ID/nome correto e clique **Recursos/Benefícios**.

1. Confira **Plano comercial: pocket**, baseline Impressão **Não**, e overrides atuais.
2. Escolha **Impressão → Conceder**.
3. Informe motivo explícito, por exemplo:

   `Primeiro cliente KÔMA; plano Pocket; impressão de cortesia; valor extra R$ 0; pagamento online não habilitado inicialmente; validade: [condição acordada].`

4. Clique **Salvar benefício**. Resultado: baseline continua Não, override manual Liberado, efetivo Sim e plano pocket.
5. Abra **Auditoria**, localize `SUPERADMIN_CAPABILITY_UPDATE` pelo restaurante e confirme ator, motivo, antes/depois e data. Guarde o ID/evidência no relatório privado.
6. Recarregue a sessão do restaurante e confira **Configurações → Impressão**. Valide papel pelo [guia Windows](windows-printing.md).

**Revogar** grava override false, bloqueando mesmo um recurso incluído no plano.
**Voltar ao baseline do plano** remove o override; no Pocket a impressão volta a
Não. Toda ação exige motivo e fica auditada. Não mudar plano para Pro.

O motivo auditado registra a cortesia R$ 0 e condições combinadas; esta tela não
é um motor de cobrança de add-ons e não altera fatura/contrato. Não há expiração
automática do benefício: se combinar prazo, registre e revogue pela tela na data
acordada. Complete a condição comercial na proposta aceita pela cliente.

## Iniciar os sete dias

**Liberar acesso** para configurar e **liberar operação** são ações distintas.
O trial comercial não começa por criar senha ou cadastrar o primeiro produto.

1. No restaurante, conclua os quatro essenciais em **Configurações → Implantação inicial**: dados/perfil, horários, produto ativo publicado e modalidades.
2. Confira com a cliente cardápio, formas offline, equipe e impressora. A tela do restaurante deve mostrar configuração concluída e aguardando liberação KÔMA.
3. No **Super Admin → Períodos grátis**, localize o restaurante e clique **Ver implantação e liberar**.
4. Confira os quatro itens, plano, ciclo e autorização. Clique **LIBERAR OPERAÇÃO E INICIAR 7 DIAS** somente quando pronto para homologar a operação.
5. Registre início/fim do trial e primeira cobrança após sete dias completos. Atualize o primeiro acesso; Vendas/Caixa devem liberar. Reabrir a tela não renova trial.

Não avançar se faltar essencial ou se houver erro de sincronização da cobrança
no provedor. Corrija o estado indicado e repita pela tela; não usar SQL, criar
trial paralelo ou alterar datas manualmente. A rota antiga do administrador
`/api/onboarding/start-trial` não libera operação comercial.
