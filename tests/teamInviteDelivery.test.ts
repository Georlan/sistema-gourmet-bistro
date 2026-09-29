import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('team UI distinguishes a created person from a scheduled WhatsApp invite', () => {
  const team = source('../src/components/caixa/team/CashierTeam.tsx');

  assert.match(team, /data\.convite_agendado === false/);
  assert.match(team, /Pessoa cadastrada, mas o WhatsApp do convite está indisponível/);
  assert.match(team, /data\.convite_mensagem/);
});

test('backend invite flow checks communication readiness before resend token rotation', () => {
  const auth = source('../backend/app/routes/auth.py');
  const caixa = source('../backend/app/routes/caixa.py');
  const notifications = source('../backend/app/services/notificacoes.py');

  assert.match(auth, /rest_id = require_tenant_id\(\)/);
  assert.match(auth, /prontidao = obter_prontidao_convite_equipe\(\)/);
  assert.ok(
    auth.indexOf('prontidao = obter_prontidao_convite_equipe()')
      < auth.indexOf('usuario.token_convite = str(uuid.uuid4())'),
  );
  assert.match(caixa, /convite_status="agendado" if convite_agendado else "indisponivel"/);
  assert.match(notifications, /KOMA_WHATSAPP_AUTOMATION_ENABLED/);
  assert.match(notifications, /obter_status_evolution\(\)/);
});
