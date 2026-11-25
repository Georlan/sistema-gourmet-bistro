# Bloco futuro — Chat e notificações do cliente (25/11/2026)

## Escopo e evidência

Capturas do cardápio em tema claro mostram o dock com a cor configurada (azul), mas a tela de conversa mantém elementos verdes (status, progresso, ativação de notificações e envio). O cliente também relatou dificuldade de chegar diretamente ao chat. Acesso direto é uma entrega pequena independente; a reformulação integral fica para um bloco próprio, sem adicionar funções antecipadamente.

## Direção para o bloco

- **Identidade visual:** harmonizar chat, status, composer, botões e convite de notificações com tokens do cardápio por restaurante, em ambos os temas; manter cores semânticas de erro/sucesso quando justificadas e contraste verificável.
- **Navegação e UX:** entrada direta a partir do cardápio; conversa associada ao pedido correto, retorno claro à lista e dock, estados de carregamento, vazio, envio, falha, reconexão e conversa encerrada. Priorizar mensagens e andamento, sem duplicar funcionalidades.
- **Notificações:** estudar o momento contextual para pedir permissão, explicar benefício em linguagem curta e exibir estado real (disponível, ativa, negada, indisponível). Não solicitar permissão sem gesto explícito, não insistir após recusa, distinguir limitações de navegador/SO e manter acompanhamento dentro do app.
- **Qualidade da notificação:** revisar título, texto, ícone, agrupamento, distinção de mudança de status e mensagem humana, deduplicação e abertura no pedido correto em primeiro acesso/retomada. Não expor capability ou dados sensíveis em payload, logs ou URL.
- **Eficiência:** medir baseline de carregamento, renderizações, SSE, polling, mensagens e retomada; otimizar apenas com evidência de preservação de frescor, isolamento e recuperação. Não adicionar conexão, consulta por card ou dependência sem necessidade.
- **Funções adicionais:** avaliar utilidade real, por exemplo indicadores de não lidas, reenvio de falha e atalhos contextuais. Decidir com o usuário após diagnóstico, não presumir necessidade de anexos ou novas funções de chat.

## Critérios de homologação

Android físico, desktop, tema claro/escuro e 320/390/430 px; dock/sacola sem sobreposição, múltiplos pedidos, mensagem não lida, retorno, teclado virtual, rede perdida/recuperada, push permitido/negado/indisponível e abertura da notificação com app fechado. Usar fixtures/CI; não enviar pedidos nem notificações de teste a clientes reais. Preservar identidade, autorização, regras de pedidos, pagamentos e retenção. Este documento é backlog aprovado como intenção, não confirmação de implementação das melhorias futuras.
