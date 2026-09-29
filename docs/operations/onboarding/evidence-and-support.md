# Evidências e suporte da implantação

## Guardar no relatório privado

Use o [modelo canônico](../first-client-acceptance-report-template.md). Guarde:

- Tenant/slug, responsável, plano/ciclo/proposta e aceite comercial.
- Protocolo/contratação, liberação de acesso e entrega/ativação de convite (sem tokens).
- Benefício de impressão: baseline, override, efetivo, motivo R$ 0/primeiro cliente, ator/data e registro da Auditoria.
- Configuração inicial conferida, print do checkout com somente meios habilitados e link público.
- Liberação operacional, início/fim do trial e evidência de cobrança SaaS alinhada após sete dias.
- IDs de pedido/pagamento/turno/PrintJobs; totais por meio e conciliação.
- Impressora/modelo/conexão, agente/versão, diagnóstico/preflight, fotos de cupons e confirmação de reinício/logon.
- PR/checks/revisão servida, decisão APROVADO/BLOQUEADO/REPROVADO, pendências com responsável/prazo.

Sem online, marcar transação Mercado Pago/estorno online NÃO APLICÁVEL e justificar.
Cobrança do plano SaaS continua sendo conferida separadamente. Não gravar contatos,
documentos, credenciais ou fotos identificáveis em pasta pública do repositório.

## Troubleshooting básico

| Sintoma | Conferir / ação | Não avançar quando |
|---|---|---|
| Convite não chegou | Super Admin: fila, destinatário e reenvio de primeiro acesso; spam com a cliente | Sem acesso validado pelo responsável |
| Caixa/Vendas bloqueados | Implantação inicial: quatro essenciais; Super Admin → Períodos grátis: liberação explícita | Trial/configuração ou sincronização com provedor falhou |
| Impressão sumiu no Pocket | Recursos/Benefícios: efetivo printing; recarregar sessão; cargo/permissão | Override ausente/revogado ou acesso insuficiente |
| Não sai papel | [Roteiro Windows](windows-printing.md), driver, tarefa, agente online, fila e PrintJob | Sem teste físico aprovado |
| Checkout mostra opção errada | Cardápio online → Pagamentos: salvar lista explícita, recarregar link da loja certa | Desabilitada continua aparecendo |
| Pix não aparece no público | Pix público exige conta online ativa; para cliente offline usar Dinheiro/cartão externo | Escopo exige Pix manual público, ainda não oferecido |
| Catálogo abre mas não pede | Automático, horários, pausa, Caixa aberto e modalidades | Operador tenta forçar abertura sem entender regra |
| Link indisponível/vazio | ID/slug correto, tenant ativo e produtos publicados | Não confundir suspensão/catálogo vazio com horário fechado |
| Recebimento diverge | Turno, forma real, troco, sangria/suprimento e estado dos pedidos | Diferença não reconciliada |

Incidente reproduzível: registrar hora, tenant, pedido/turno/job e mensagem,
seguir [resposta a incidentes](../first-client-incident-response.md). Nunca apagar
dados de produção nem usar SQL manual para conceder benefício ou esconder falha.
