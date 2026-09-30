# Disponibilidade do cardápio online

Decisão de produto de 30/09/2026: horários cadastrados são informativos e
continuam disponíveis para consulta. O catálogo permanece consultável com
caixa fechado. Novos pedidos, inclusive agendados, exigem turno de caixa aberto
no restaurante; horário ausente, fechado ou override Forçado Aberto não substituem
essa exigência. Pausa operacional, fechamento manual e restrições de modalidade
continuam aplicáveis.

O servidor valida o turno persistido antes de aceitar novos pedidos. Abrir ou
fechar caixa publica `store_status_changed` sem dados financeiros, limitado ao
tenant; o cardápio busca novamente a disponibilidade. Reconexão e retorno à aba
também atualizam o estado. Ausência de disponibilidade confirmada pelo servidor
não libera pedidos no cliente. Replays idempotentes preservam o contrato existente.
