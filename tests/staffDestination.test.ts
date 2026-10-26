import assert from 'node:assert/strict';
import test from 'node:test';
import { parseStaffLogin, resolveStaffDestination } from '../src/utils/staffDestination';

for (const [role,portal] of [['admin','caixa'],['gerente','caixa'],['caixa','caixa'],['cozinha','caixa'],['atendente','caixa'],['garcom','garcom'],['motoboy','entregador']]) {
  test(`destino canônico de ${role}`,()=>assert.equal(resolveStaffDestination(` ${role.toUpperCase()} `),portal));
}
test('superadmin e perfis desconhecidos não ganham acesso operacional',()=>{
  assert.equal(resolveStaffDestination('superadmin'),null);
  assert.equal(resolveStaffDestination('inventado'),null);
});
test('identidade mínima normaliza cargo legado e descarta dados desnecessários',()=>{
  const result=parseStaffLogin({access_token:'token',usuario:{id:'own',nome:' Ana ',role:null,cargo:'GARCOM',restaurante_id:5,email:'private'}});
  assert.equal(result.destination,'garcom');
  assert.equal(result.user.role,'garcom');
  assert.equal(result.user.nome,'Ana');
  assert.equal('email' in result.user,false);
});
for(const data of [null,{}, {access_token:123,usuario:{}},{access_token:'t',usuario:{id:'a',nome:'a',role:'caixa',restaurante_id:'5'}},{access_token:'t',usuario:{id:'a',nome:' ',role:'caixa',restaurante_id:5}}]) {
  test(`resposta incompleta não cria sessão: ${JSON.stringify(data)}`,()=>assert.throws(()=>parseStaffLogin(data),/incompleta/));
}
