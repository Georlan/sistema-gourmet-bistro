# Escopo da PR B — Segurança Operacional

Incluído nesta branch:

- pausa/reabertura server-side com motivo, duração e auditoria;
- controle de emergência no shell do Caixa (desktop/mobile);
- capacidade configurável e alerta de 80%;
- auto-pausa opcional, default desligado;
- serialização da última vaga via lock transacional;
- bloqueio tenant-local de novos pedidos por cliente;
- fingerprint de telefone para guest sem persistir telefone no bloqueio;
- anti-spam do chat público;
- RLS/grants mínimos;
- testes focais e contrato de migration.

Não incluído / não misturar:

- IA/LLM;
- WhatsApp/Evolution;
- billing;
- Web Push;
- carga destrutiva em produção.

Itens que ainda exigem validação/fechamento antes do merge:

- motivo explícito do cancelamento digital chegar ao lifecycle canônico;
- atalho de "bloquear cliente" integrado ao diálogo de cancelamento do Caixa;
- QA manual em múltiplos viewports;
- burst 10/25/50/100 em ambiente local/staging.
