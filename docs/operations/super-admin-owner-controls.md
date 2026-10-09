# Controle do proprietário no Super Admin

## Recursos por loja

Em **Clientes → Restaurantes → Abrir 360° → Recursos e exceções**, escolha o recurso e uma ação: liberar para esta loja, bloquear para esta loja ou seguir o plano novamente. A tabela mostra o que o plano inclui, a exceção individual e o resultado atual. Confira o antes/depois, informe o motivo e salve. Plano e cobrança permanecem iguais; o restaurante precisa recarregar sua sessão para receber o novo conjunto de recursos.

As mudanças usam o GET/PATCH canônico `/api/super-admin/restaurantes/{id}/capabilities`, autenticação Super Admin, escopo do tenant, trava e auditoria existentes. Não há executor paralelo ou chave administrativa pública.

## Caminhos curtos para operação manual e pelo Codex

- Recursos: `https://central.komafood.com.br/?tenant=ID&panel=resources`
- Ficha 360°: `https://central.komafood.com.br/?tenant=ID`
- Financeiro: `https://central.komafood.com.br/?panel=finance`

Substitua ID pela loja desejada. Esses links apenas abrem controles e exigem sessão administrativa válida. Uma solicitação pelo chat precisa identificar loja, recurso/ação e motivo. O Codex pode abrir o controle direto, conferir o estado, aplicar a alteração autorizada e verificar o resultado/auditoria sem percorrer todas as telas ou criar PR para uma concessão individual. Não extrair tokens do navegador nem criar um acesso que dispense autenticação.

Atalhos de suporte do cockpit usam os destinos da árvore canônica do Caixa. A rota interna `/?view=caixa&support=1` continua válida e depende do contexto auditado de suporte; não trocar de domínio perdendo esse contexto.

## Financeiro KÔMA

**Início → Financeiro KÔMA** ou **Clientes → Financeiro KÔMA**. Escolha o mês. Recebido soma taxas e mensalidade de faturas consolidadas pagas dentro do mês de Fortaleza, pela data efetiva de pagamento; em aberto usa a competência da fatura. Vendas das lojas e preços do catálogo não entram como receita da empresa.

Informe os custos efetivamente cobrados em reais. Campo vazio representa informação ausente; 0 confirma que não houve custo. Para cobrança em dólar use o valor real em reais, sem conversão presumida. Informe motivo e salve. Custos e auditoria ficam no schema privado `koma_internal`, com acesso exclusivamente pelo backend autenticado; a auditoria guarda responsável, motivo e valores antes/depois.

**Resultado registrado** = faturas consolidadas recebidas menos custos conhecidos, calculado somente quando todas as categorias tiverem valor confirmado. Recebimentos recorrentes e avulsos externos não estão incluídos. Mesmo completo, esse resultado não comprova lucro total. A busca nos chats acessíveis em 09/10 não encontrou os valores informados anteriormente pelo proprietário; o formulário permanece em branco.

## Integrações e evidências

Saúde prioriza API, banco e canal WhatsApp. Railway/DNS são consultas administrativas opcionais, disponíveis em seção recolhida. Integrações apresenta um inventário único e mantém a leitura do Telegram sem enviar mensagem. Resend distingue acesso administrativo de entrega. Projeto PostHog `648305` e dashboard existente permanecem como destinos de consulta; acesso pelo plugin não configura o backend automaticamente.

Toda mudança operacional deve distinguir implementação, merge, revisão publicada, configuração da loja e efeito observado. Incidente antigo, fila vazia ou heartbeat não comprova impressão física; nenhum documento é reenviado automaticamente por estes controles.
