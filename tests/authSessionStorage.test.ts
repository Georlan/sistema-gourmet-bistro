import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import test, { beforeEach } from 'node:test';
import {clearOperatorSession,getOperatorAccessToken,getOperatorSession,getPersistedOperationalPortal,saveOperatorSession} from '../src/utils/authSession';

function storage() {
  const values = new Map<string,string>();
  return {getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,String(value)),removeItem:(key:string)=>values.delete(key),clear:()=>values.clear()};
}
function useTab(tab:ReturnType<typeof storage>) { (globalThis as any).sessionStorage = tab; }
(globalThis as any).localStorage = storage();
beforeEach(()=>{localStorage.clear();useTab(storage());});
const user=(id:string,restaurante_id:number,role='caixa')=>({id,nome:id,restaurante_id,role});

test('sessão mínima completa e aliases ficam exclusivamente na aba',()=>{
  saveOperatorSession('token-a',{...user('caixa-a',1),email:'private@example.test',telefone:'999999',password_hash:'secret'});
  const raw=sessionStorage.getItem('koma_operator_session_caixa')!;
  assert.deepEqual(JSON.parse(raw).user,user('caixa-a',1));
  assert.doesNotMatch(raw,/private|999999|secret/);
  assert.equal(localStorage.getItem('koma_operator_session_caixa'),null);
  assert.equal(localStorage.getItem('koma_caixa_token'),null);
  assert.equal(getPersistedOperationalPortal(),'caixa');
  assert.equal(getOperatorAccessToken(),'token-a');
});

for(const role of ['caixa','garcom','cozinha']) test(`duas abas de ${role} mantêm restaurantes e tokens independentes`,()=>{
  const a=storage(), b=storage();
  useTab(a);saveOperatorSession('token-a',user('a',5,role));
  useTab(b);assert.equal(getPersistedOperationalPortal(),null);saveOperatorSession('token-b',user('b',2,role));
  useTab(a);assert.equal(getOperatorSession()?.user.restaurante_id,5);assert.equal(getOperatorAccessToken(),'token-a');
  useTab(b);assert.equal(getOperatorSession()?.user.restaurante_id,2);clearOperatorSession();assert.equal(getOperatorAccessToken(),'');
  useTab(a);assert.equal(getOperatorAccessToken(),'token-a');assert.equal(getOperatorSession()?.user.id,'a');
});

test('aba de garçom não muda com login de caixa e troca de conta em outra aba',()=>{
  const a=storage(), b=storage();
  useTab(a);saveOperatorSession('waiter',user('waiter',1,'garcom'));
  useTab(b);saveOperatorSession('cashier',user('cashier',1));saveOperatorSession('other',user('other',5));
  useTab(a);assert.equal(getPersistedOperationalPortal(),'garcom');assert.equal(getOperatorAccessToken(),'waiter');
});

test('JWT expirado encerra somente a aba dona da sessão',()=>{
  const a=storage(),b=storage();
  useTab(a);saveOperatorSession('valid',user('a',1));
  useTab(b);const token='header.'+Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)-1})).toString('base64url')+'.signature';
  saveOperatorSession(token,user('b',2));assert.equal(getOperatorSession(),null);assert.equal(sessionStorage.getItem('koma_caixa_token'),null);
  useTab(a);assert.equal(getOperatorAccessToken(),'valid');
});

test('retirada do alias não ressuscita autenticação canônica',()=>{
  saveOperatorSession('waiter',user('waiter',1,'garcom'));sessionStorage.removeItem('koma_waiter_token');
  assert.equal(getOperatorAccessToken(),'');assert.equal(getPersistedOperationalPortal(),null);
});

test('logout preserva preferências compartilhadas e não adota token de outra aba antiga',()=>{
  localStorage.setItem('koma_font_size','grande');saveOperatorSession('own',user('own',5));
  localStorage.setItem('koma_caixa_token','other');
  assert.equal(getOperatorAccessToken(),'own');clearOperatorSession();
  assert.equal(localStorage.getItem('koma_font_size'),'grande');assert.equal(getOperatorAccessToken(),'');
});

test('troca de identidade limpa caches de restaurante somente nesta aba',()=>{
  saveOperatorSession('own',user('own',5));sessionStorage.setItem('koma_restaurant_name_v3','Restaurante 5');
  saveOperatorSession('other',user('other',2));assert.equal(sessionStorage.getItem('koma_restaurant_name_v3'),null);
});

test('expiração restaurada respeita vencimento real do JWT',()=>{
  const exp=Math.floor(Date.now()/1000)+600;
  const token='header.'+Buffer.from(JSON.stringify({exp})).toString('base64url')+'.signature';
  saveOperatorSession(token,user('own',5));assert.equal(getOperatorSession()?.expiresAt,exp*1000);
});

test('logout limpa contexto do restaurante antes de novo login na mesma aba',()=>{
  saveOperatorSession('old',user('old',5));sessionStorage.setItem('koma_restaurant_name_v3','Restaurante 5');
  sessionStorage.setItem('koma_settings_vFinal_v3','old-settings');clearOperatorSession();
  saveOperatorSession('new',user('new',2));
  assert.equal(sessionStorage.getItem('koma_restaurant_name_v3'),null);
  assert.equal(sessionStorage.getItem('koma_settings_vFinal_v3'),null);
});

test('admin no salão legado preserva restaurante e sessão local de garçom',()=>{
  saveOperatorSession('admin',user('admin',5,'admin'),'garcom');
  assert.equal(getPersistedOperationalPortal(),'garcom');
  assert.equal(getOperatorSession()?.user.restaurante_id,5);
  assert.equal(getOperatorAccessToken(),'admin');
});

for (const missing of ['id', 'nome', 'role']) test(`sessão incompleta sem ${missing} exige login e preserva outra aba`, () => {
  const intact = storage(), broken = storage();
  useTab(intact); saveOperatorSession('intact', user('intact', 2));
  useTab(broken); saveOperatorSession('incomplete', user('incomplete', 5, 'admin'));
  const session = JSON.parse(sessionStorage.getItem('koma_operator_session_caixa')!);
  delete session.user[missing];
  sessionStorage.setItem('koma_operator_session_caixa', JSON.stringify(session));
  assert.equal(getOperatorSession(), null);
  assert.equal(getPersistedOperationalPortal(), null);
  assert.equal(sessionStorage.getItem('koma_caixa_token'), null);
  useTab(intact); assert.equal(getOperatorAccessToken(), 'intact');
});
