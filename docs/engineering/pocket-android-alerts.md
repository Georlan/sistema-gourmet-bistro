# Pocket: operação Android e avisos da equipe

## Escopo

Pedidos novos do cardápio podem gerar Web Push para operadores autenticados que
ativaram avisos no próprio aparelho. Entrega e retirada continuam usando as
transações e permissões existentes. Não há transporte WhatsApp novo neste patch.

Sem impressão, os cards mostram todos os itens e observações. Pocket mobile usa
texto legível e ações de pelo menos 44 px. Lojas sem consumo local, sem trabalho
local ativo e sem impressão iniciam na etapa Preparo; atendimentos locais ativos
continuam visíveis. Perfis com impressão preservam o comportamento anterior.

## Ativação gradual

- Aplicar a migration pelo mecanismo Alembic existente, sem SQL manual em lojas.
- Manter `STAFF_PUSH_RESTAURANT_IDS` vazio até confirmar a loja de homologação.
- Reutilizar `WEB_PUSH_ENABLED` e o par VAPID existente; não substituir chaves
  que já tenham assinaturas de clientes. As variáveis devem estar disponíveis
  também no processo de outbox que despacha os eventos.
- Incluir somente IDs aprovados. Restaurante 6 está explicitamente fora desta
  implantação e não pode ser usado para testes ou receber mudança de configuração.
- A retirada de um ID interrompe novos eventos e o despacho pendente desse ID.
- Cada pessoa com acesso ao Caixa ativa no próprio Android. Em celular compartilhado,
  o último operador que ativa assume a assinatura. Desativar antes de entregar o
  aparelho a outra pessoa. A revogação não remove assinaturas do acompanhamento do cliente.

## Evidência necessária no aparelho

1. Usar Android/Chrome, adicionar KÔMA à tela inicial e permitir notificações.
2. Ativar no Caixa e criar um pedido em loja de homologação por fluxo canônico.
3. Com tela bloqueada e com outra aplicação aberta, conferir o aviso e o toque.
4. Confirmar que o toque abre os pedidos e exige sessão quando não autenticado.
5. Repetir em dois operadores. Aceitar e avançar o mesmo pedido simultaneamente,
   conferindo o estado confirmado no servidor e ausência de efeito financeiro duplicado.
6. Conferir entrega e retirada, itens, adicionais e observações em 360–412 px.
7. Desativar um aparelho e confirmar que o outro continua recebendo.
8. Pedido com pagamento online pendente só deve avisar quando liberado à operação.

## Segurança e limites

A tabela possui FORCE RLS, permissão de Caixa e endpoints/chaves cifrados. O push
não contém nome, telefone, endereço, token ou conteúdo do pedido. O dispatcher
libera a conexão SQL antes do envio; 404/410 desativam aparelhos expirados. A outbox
usa ID estável por pedido e tenant; a tag do push evita alertas repetidos audíveis
em retries, mas não promete entrega exatamente uma vez na rede.

Internet, permissão, bateria, modo Não Perturbe e configurações do Android podem
impedir ou atrasar entrega. Teste simulado não prova recebimento na tela bloqueada.

## WhatsApp Business pendente

O número Business do KÔMA precisa de instância separada e conexão autorizada; a
instância pessoal existente não deve ser substituída. Para o dono, o destinatário
é o telefone dele, diferente do remetente Business. Para o cliente: recebido e
saiu para entrega/pronto para retirada, com autorização para esses avisos e opt-out.
Dados dinâmicos devem identificar o pedido; intervalos controlam carga e não
servem para disfarçar automação. Evolution via WhatsApp Web continua sujeito a
restrições; apenas instalar Business não elimina esse risco.
