# Super Admin — Aceitação da Fase 2

Este roteiro valida o onboarding real de um novo restaurante sem SQL manual.

## Pré-condições

- backend e frontend publicados a partir da mesma `main`;
- acesso válido ao Super Admin;
- nenhum dado de produção existente deve ser apagado;
- usar um restaurante de QA dedicado para a validação.

## Fluxo de aceitação

1. Acesse `/super-admin` e autentique-se.
2. Abra **Restaurantes** → **Novo restaurante**.
3. Cadastre um novo tenant de QA com:
   - nome identificável como QA;
   - slug inédito;
   - um dos planos oficiais Pocket, Pro ou Premium;
   - administrador inicial com e-mail controlado pelo operador;
   - senha temporária forte.
4. Confirme a criação e registre os dados exibidos na tela de sucesso.
5. Verifique imediatamente na listagem:
   - tenant novo presente;
   - status SaaS `ACTIVE`;
   - plano correto;
   - Mercado Pago `disconnected`;
   - pedidos e recebimentos zerados;
   - nenhuma informação fictícia.
6. Abra o Cardápio pelo link exibido e confirme catálogo vazio.
7. Saia do Super Admin e faça login com o administrador inicial usando o `restaurante_id` criado.
8. Confirme que o administrador entra no tenant novo e não enxerga dados de outros restaurantes.
9. No Super Admin, altere o plano do tenant de QA, informando motivo, e confirme que a alteração aparece na listagem.
10. Suspenda o tenant de QA com motivo explícito e confirme bloqueio de acesso da equipe/criação de novos pedidos.
11. Reative o tenant e confirme o retorno do acesso.
12. Consulte a Auditoria e confirme registros do onboarding, alteração de plano, suspensão e reativação sem senha/token/segredo.

## Critérios de aprovação

A Fase 2 está aceita quando o restaurante é criado integralmente pela interface, autentica com seu administrador inicial, nasce isolado e vazio, pode ser administrado pelo Super Admin e nenhuma etapa exige SQL manual.

## O que não faz parte desta fase

- conexão Mercado Pago do novo restaurante;
- cobrança recorrente automatizada;
- Modo Suporte/impersonação;
- n8n e webhooks externos;
- Central de Incidentes.

Esses itens seguem para as próximas fases e não bloqueiam a aceitação do onboarding multi-tenant.
