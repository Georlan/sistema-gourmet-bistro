import assert from 'node:assert/strict';
import test from 'node:test';
import { getOperatorSession, getPersistedOperationalPortal } from '../src/utils/authSession';

const shared = new Map<string, string>();
const tab = new Map<string, string>();
function storage(values: Map<string,string>) {
  return { getItem: (key:string) => values.get(key) ?? null,
    setItem: (key:string,value:string) => values.set(key,value), removeItem: (key:string) => values.delete(key) };
}
(globalThis as any).localStorage = storage(shared);
(globalThis as any).sessionStorage = storage(tab);

test('sessão antiga compartilhada não pode ser atribuída a uma aba e exige novo login', () => {
  shared.set('koma_operator_session', JSON.stringify({token:'wrong-tenant-token',user:{id:'other',role:'caixa',restaurante_id:2},expiresAt:Date.now()+60000}));
  shared.set('koma_caixa_token','wrong-tenant-token');
  tab.set('koma_active_operational_portal','caixa');
  assert.equal(getOperatorSession(),null);
  assert.equal(getPersistedOperationalPortal(),null);
  assert.equal(shared.get('koma_caixa_token'),undefined);
  assert.equal(tab.get('koma_caixa_token'),undefined);
});
