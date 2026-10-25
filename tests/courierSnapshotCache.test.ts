import assert from 'node:assert/strict';
import test from 'node:test';
import { COURIER_CACHE_PREFIX, createCourierSnapshotCache } from '../src/components/courier/courierSnapshotCache';
function storage() {
  const data: Record<string,string>={};
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:new Proxy({getItem:(key:string)=>data[key]??null,setItem:(key:string,value:string)=>{data[key]=value;},removeItem:(key:string)=>{delete data[key];}}, {ownKeys:()=>Object.keys(data),getOwnPropertyDescriptor:()=>({enumerable:true,configurable:true})})});
  return data;
}
const panel={motoboy:{id:99051,nome:'Lucas',telefone:'private-own-phone'},entregas:[{id:'delivery-a',delivery_status:'transito',cliente_nome:'Maria',delivery_endereco:'Rua particular, 10',delivery_telefone:'customer-private-phone',receiptCode:'1234',destination:{latitude:-3,longitude:-38},requires_delivery_code:true}]};
test('offline data is authenticated ciphertext, allowlisted and scoped by credential',async()=>{
 const raw=storage(),cache=createCourierSnapshotCache('credential-one');
 assert.equal(await cache.write(panel),true);
 const serialized=JSON.stringify(raw);
 for(const secret of ['credential-one','Maria','Rua particular','customer-private-phone','1234'])assert.equal(serialized.includes(secret),false);
 assert.ok(Object.keys(raw)[0].startsWith(COURIER_CACHE_PREFIX));
 const restored=await createCourierSnapshotCache('credential-one').read();
 assert.equal(restored?.entregas[0].cliente_nome,'Maria');
 assert.equal(restored?.entregas[0].delivery_telefone,undefined);
 assert.equal(restored?.entregas[0].receiptCode,undefined);
 assert.equal(await createCourierSnapshotCache('credential-two').read(),null);
});
test('completed deliveries are removed from persisted data; clearing beats an in-flight write',async()=>{
 storage();const cache=createCourierSnapshotCache('session');await cache.write(panel);
 await cache.write({...panel,entregas:[]});assert.deepEqual((await cache.read())?.entregas,[]);
 const pending=cache.write(panel);await cache.clear();await pending;
 assert.equal(await cache.read(),null);
});
test('expired, tampered and oversize snapshots cannot be restored',async()=>{
 const raw=storage();const cache=createCourierSnapshotCache('expiry');
 await cache.write(panel,Date.now()-4*60*60*1000-1);assert.equal(await cache.read(),null);
 await cache.write(panel);const key=Object.keys(raw)[0];const record=JSON.parse(raw[key]);record.data='broken';raw[key]=JSON.stringify(record);
 assert.equal(await cache.read(),null);
 assert.equal(await cache.write({...panel,entregas:[{...panel.entregas[0],cliente_nome:'x'.repeat(1_000_001)}]}),false);
});
