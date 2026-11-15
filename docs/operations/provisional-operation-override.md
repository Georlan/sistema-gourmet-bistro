# Exceção operacional provisória por tenant

A configuração `KOMA_PROVISIONAL_OPERATION_ALLOWLIST` é um mecanismo emergencial de operação **excepcional**, opt-in, para um restaurante em preparação provisória cujo operador foi autorizado pelo responsável pelo ambiente. O valor é uma lista estrita de IDs positivos separados por vírgula, por exemplo `1`. O padrão (variável ausente ou vazia) **não concede acesso**.

## Restrições e finalidade

- A exceção só altera a decisão de `is_provisional_preparation` quando existe auditoria original `SUPERADMIN_TENANT_ONBOARD` com `trial_status=pending_setup`, não há assinatura SaaS nem aceite comercial vinculado, e `saas_status=active`.
- As demais regras de operação, cobrança direta, caixa, estoque, pedidos, tenant/RLS, modalidades e pagamentos continuam em vigor.
- Nenhum contrato, aceite, pagamento, assinatura, trial, plano ou estado de faturamento é criado ou inferido pela exceção.
- A variável não é um meio de onboarding padrão nem substitui regularizar a contratação comercial. Aplicar apenas mediante autorização explícita do operador e registrar na trilha de alterações do Railway a motivação e o ID exato.
- O valor `*`, valores negativos, espaços dentro dos números e tokens inválidos fazem o parse falhar fechado: nenhuma exceção é concedida.
- O efeito é imediato no backend após implantação da variável. A reversão é remover o ID da lista e reiniciar/reimplantar o serviço.
- Não é necessário configurar ou criar mesas para restaurantes exclusivamente de retirada/delivery. O atalho de criação de mesas é opcional e separado da liberação.

## Homologação e rollback

1. Rodar testes de `test_super_admin_provisional_transition.py`, `test_onboarding_status.py`, testes de interface e os gates obrigatórios do CI.
2. Confirmar que a aplicação em produção já tem a implementação antes de ativar qualquer variável.
3. Autorizar **apenas** o tenant solicitado, confirmar os outros IDs fora da lista, verificar as métricas/logs, não lançar pedido de produção fictício.
4. Para voltar ao bloqueio provisório, remover o ID da variável; não apagar/alterar dados nem reverter assinatura.
