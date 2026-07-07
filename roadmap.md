# Roteiro de Desenvolvimento — Sistema Restaurante Kôma

Este documento atua como o guia oficial de evolução do sistema Kôma. Cada fase termina em algo funcional e testável de forma isolada. O sistema é baseado em níveis de acesso (Garçom, Caixa e Dono/Admin) que compartilham o mesmo banco de dados SQLite local.

## Progresso Atual: 58% (11/19 Fases Concluídas)
*   **Fases Completas:** 11 (Fases 1, 2, 3, 4, 5, 8, 9, 10, 11, 16, 17)
*   **Fases Simuladas (A Completar / Integração de Hardware):** 6 (Fases 6, 7, 12, 13, 14, 15)
*   **Fases Pendentes:** 2 (Fases 18, 19)

---

## Fase 1 — Modelagem de Dados Relacional ✅ CONCLUÍDA
- [x] Schema relacional finalizado (`Garcom`, `Produto`, `Mesa`, `Comanda`, `Lancamento`, `Item`).
- [x] Regras de negócio de trava de cancelamento de único item ativo para garçons.
- [x] Divisão de comanda compartilhando o mesmo `numero_pedido`.
- [x] Script de simulação em Python (`fase1_simulacao.py`) validando todos os cenários lógicos.

---

## Fase 2 — Backend Mínimo (API FastAPI) ✅ CONCLUÍDA
- [x] Engine SQLite configurado com WAL (`journal_mode=WAL`) e `PRAGMA foreign_keys=ON`.
- [x] Mapeamento ORM SQLAlchemy completo.
- [x] Criptografia de senhas (`bcrypt`) e tokens JWT seguros (expiração em 30 dias para garçons).
- [x] Rotas REST HTTP para logins, produtos, mesas, comandas e itens.
- [x] Suíte de testes automatizados integrada (`test_orders.py`) rodando isolada sobre banco `test.db`.

---

## Fase 3 — Interface do Garçom (React + Polling) ✅ CONCLUÍDA
- [x] Grid responsivo de mesas com 3 estados de cores vibrantes (Livre, Ocupada, Pronto p/ Servir).
- [x] Cardápio completo categorizado com atalhos de observação inteligentes extraídos dos ingredientes.
- [x] Integração completa com o backend local substituindo a lógica antiga de `localStorage`.
- [x] Sistema de login por garçom persistente e interface restrita a garçons no salão.
- [x] Controle de quantidade no rascunho e ações de transferência/cancelamento individual por item.

---

## Fase 4 — Tempo Real (WebSocket) ✅ CONCLUÍDA
- [x] Canal WebSocket `/ws/{garcom_id}` no backend integrated via `BackgroundTasks`.
- [x] **Signal-Pull:** Disparo de sinal do servidor acionando atualizações instantâneas no React dos clientes.
- [x] **Sincronização de Concorrência:** Compartilhamento dinâmico de status de carrinhos. Exibição do triângulo `⚠️ Editando: Nome` nos celulares de outros garçons para a mesa em edição.
- [x] **Resiliência:** Lógica de auto-reconexão no frontend e fallback para Polling de 4s em caso de queda de sinal.

---

## Fase 5 — Persistência e Recuperação de Estado ✅ CONCLUÍDA
- [x] Rascunhos do carrinho persistidos sob a chave `koma_drafts` (o garçom pode fechar o app e o carrinho continua intacto).
- [x] Estado central das comandas guardado no SQLite no servidor.
- [x] Desconexão física do garçom é detectada e limpa os alertas de edição do mapa de mesas global.

---

## Fase 6 — Integração da Impressora USB (Isolada) 🧪 SIMULADO (A COMPLETAR)
- [x] **Simulação local:** Geração de arquivos `.txt` contendo a formatação e comandos ESC/POS na pasta `print_jobs/`.
- [x] **Mockup em tela:** Visualização gráfica do cupom térmico simulado que atualiza em tempo real nas configurações do salão.
- [ ] Conexão e comunicação de baixo nível física via `win32print` em rede/Windows (necessita hardware local).

---

## Fase 7 — Lógica de Impressão (Disparos e Reimpressões) 🧪 SIMULADO (A COMPLETAR)
- [x] **Visualização:** Lógica de extratos parciais de mesa e deltas de cozinha simuladas por arquivos de texto gerados no servidor.
- [x] Integração com gatilhos de impressão de via da cozinha ao finalizar rascunho de garçom.

---

## Fase 8 — Frente de Caixa (PDV) e Operação Local Básica ✅ CONCLUÍDA
- [x] **Migração de Autenticação:** Permissões baseadas em roles (`garcom`, `caixa`, `admin`).
- [x] **PDV Balcão/Mesa:** Grid completo de produtos, rascunho de carrinho integrado, associação de mesas ou cliente balcão.
- [x] **Controle de Turno:** Abertura e fechamento de caixa com declaração manual de gaveta de dinheiro/Pix/Cartão.
- [x] **Movimentações de Caixa:** Lançamento de suprimentos de troco e sangrias operacionais.
- [x] **Divisão de Contas:** Lógica de pagamento parcial por valor ou por itens selecionados.

---

## Fase 9 — Painel do Gestor (Configurações de Cadastro) ✅ CONCLUÍDA
- [x] **Gestão de Salão:** Cadastro completo (CRUD) de equipe de garçons e operadores via API `/auth/usuarios`.
- [x] **Estrutura de Mesas:** Adicionar, renomear e excluir mesas dinamicamente pelo painel do caixa com validação de comanda.
- [x] **Taxas:** Configuração de Taxa de Serviço ativa com porcentagem regulável (10%, etc.).

---

## Fase 10 — Painel do Gestor (Estoque e Inteligência Financeira) ✅ CONCLUÍDA
- [x] **Controle de Insumos:** CRUD completo de insumos associados ao estoque do estabelecimento.
- [x] **Sugestão de Reposição Clássica:** Alertas de ponto de ressuprimento dinâmico baseado em estoque atual menor ou igual ao estoque mínimo.
- [x] **Faturamento e Horários de Pico:** Query SQL SQLite pura e otimizada que compila dias e horários de maior venda sem overhead de IA.
- [x] **Relatório de Garçons:** Detalhamento financeiro individual de faturamento por garçom calculando comissões dinamicamente sobre comandas fechadas.

---

## Fase 11 — Módulo Cozinha (KDS - Kitchen Display System) ✅ CONCLUÍDA
- [x] **Interface KDS:** Painel de produção que exibe em tempo real pratos lançados em preparação.
- [x] **Lógica de Preparação:** Mudança rápida de status (Pendente $\rightarrow$ Preparando $\rightarrow$ Pronto) com feedback integrado e WebSocket.

---

## Fase 12 — Módulo Delivery, Entregas e Motoboys 🧪 SIMULADO (A COMPLETAR)
- [x] **Interface:** Tela de cadastro de motoboys e controle de taxas fixas por bairro de entrega.
- [x] Controle de entregas pendentes e despacho de motoboys no painel do caixa.

---

## Fase 13 — Integração Oficial com o iFood 🧪 SIMULADO (A COMPLETAR)
- [x] **Triagem Delivery:** Kanban simulando a chegada de pedidos do iFood/WhatsApp para fins demonstrativos e toggle de auto-aceite.
- [ ] Conexão real com a API de parceiros do iFood (necessita credenciais de produção de estabelecimento comercial).

---

## Fase 14 — Pagamentos Seguros Integrados (TEF / Smart POS) 🧪 SIMULADO (A COMPLETAR)
- [x] **Interface:** Toggles de ativação de Pix automático in-app, cartões de crédito e simulação de fechamento.
- [ ] Integração real com Stone SDK, Skytef ou Cielo (necessita de hardware físico integrado e homologação).

---

## Fase 15 — Módulo Fiscal (NFC-e / Emissão SEFAZ) 🧪 SIMULADO (A COMPLETAR)
- [x] **Interface:** Painel com o status e histórico de notas fiscais prontas para demonstração de emissão de NF-e.
- [ ] Emissão real integrada com FocusNFe ou PlugNotas (necessita de certificado digital A1 e token fiscal válidos).

---

## Fase 16 — Tratamento de Falhas e Robustez Geral ✅ CONCLUÍDA
- [x] **Logs de Auditoria Imutáveis:** Implementação do modelo `ActivityLog` gravando acessos e cancelamentos de itens sem permissão de alteração (delete/update bloqueados).
- [x] **Segurança e Isolamento de Testes:** Definição rigorosa de variáveis de ambiente isolando os bancos de dados de teste da base oficial de produção `bistro.db`.
- [x] **Resiliência e Travas:** Trava de comanda fechada bloqueando lançamentos e controle de concorrência.

---

## Fase 17 — Refatoração, Otimização e LGPD ✅ CONCLUÍDA
- [x] **Otimizações PDV (60 FPS):** Uso de `React.memo` e `useCallback` no grid de mesas, evitando re-renderizações desnecessárias.
- [x] **Limpeza do Frontend:** Substituição de nós DOM excessivos na interface do robô chatbot por um console textarea leve de playground.
- [x] **Conformidade LGPD:** Telefone de clientes criptografado com chave Fernet AES-256 no banco de dados SQLite e mascarado como `(XX) 9XXXX-XX45` nos cupons impressos.
- [x] **Configurações do Vite:** Watcher configurado para ignorar arquivos SQLite (`bistro.db*`) e a pasta `print_jobs/`, prevenindo recarregamentos indevidos da tela.
- [x] **Configurações Dinâmicas e Persistência:** Modelo de configurações de restaurante integrado ao banco de dados SQLite, permitindo toggles em tempo real para taxa de serviço e unificação de vias de delivery.
- [x] **Prevenção de Concurrência Fantasma:** Evento `waiter_connected` adicionado ao WebSocket para limpar de imediato alertas e rascunhos fantasmas de garçons que sofreram oscilação de sinal.
- [x] **Impressão Agrupada por Cliente:** Via de conferência agrupada e subtotalizada automaticamente por `cliente_nome` em formato monospaçado.

---

## Fase 18 — Teste em Modo Sombra (Ambiente Real) ⏳ EM EXECUÇÃO
- [ ] Instalação e execução do Kôma na rede local do restaurante em paralelo com o sistema atual.

---

## Fase 19 — Virada de Chave e Monitoramento ⏳ PENDENTE
- [ ] Desativação do sistema antigo e treinamento completo do staff.
- [ ] Ativação de rotinas de backup local automatizado do arquivo `bistro.db`.
