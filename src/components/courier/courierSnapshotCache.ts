/** Device snapshot, encrypted and scoped to the high-entropy courier credential.
 * No HTTP caching, receipt code, customer phone, or courier GPS position. */
export const COURIER_CACHE_PREFIX = 'koma_courier_snapshot_v1:';
const MAX_AGE = 4 * 60 * 60 * 1000;
const encode = new TextEncoder();
const base64 = (bytes: Uint8Array) => btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''));
const bytes = (value: string) => Uint8Array.from(atob(value), c => c.charCodeAt(0));
const pick = (value: any, fields: string[]) => Object.fromEntries(fields.filter(key => value?.[key] !== undefined).map(key => [key, value[key]]));
function safePanel(panel: any) {
  if (!Number.isInteger(panel?.motoboy?.id) || !Array.isArray(panel.entregas) || panel.entregas.length > 1000) throw new Error('Invalid courier snapshot');
  return {
    motoboy: { id: panel.motoboy.id, nome: String(panel.motoboy.nome || ''), telefone: '' },
    entregas: panel.entregas.filter((item: any) => typeof item?.id === 'string' && item.delivery_status === 'transito').map((item: any) => ({
      ...pick(item, ['id','numero_pedido','requires_delivery_code','cliente_nome','delivery_endereco','delivery_taxa','delivery_status','total','valor_pago','valor_a_cobrar','itens_resumo','criado_em']),
      ...(item.destination ? {destination: pick(item.destination,['label','complement','reference','route_query','latitude','longitude'])} : {}),
      ...(item.payment ? {payment: pick(item.payment,['status','method','amount_due','change_for','change_amount','change_needs_check'])} : {}),
      ...(item.confirmation ? {confirmation: pick(item.confirmation,['mode','enabled','code_length','reason'])} : {}),
      ...(item.source ? {source: {...pick(item.source,['channel','label']),references:(item.source.references || []).map((ref: any)=>pick(ref,['provider','reference']))}} : {}),
      ...(item.items ? {items:item.items.map((entry: any)=>pick(entry,['name','quantity','notes','modifiers']))} : {}),
    })),
  };
}

export function createCourierSnapshotCache(token: string) {
  let revision = 0, invalidated = false;
  const material = (async () => {
    const hash = await crypto.subtle.digest('SHA-256', encode.encode('courier-cache-id-v1:' + token));
    const key = COURIER_CACHE_PREFIX + Array.from(new Uint8Array(hash), b=>b.toString(16).padStart(2,'0')).join('');
    const secret = await crypto.subtle.digest('SHA-256', encode.encode('courier-cache-encryption-v1:' + token));
    const aes = await crypto.subtle.importKey('raw', secret, 'AES-GCM', false, ['encrypt','decrypt']);
    let expires = Infinity;
    try { const exp = JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).exp; if (typeof exp === 'number') expires = exp * 1000; } catch { /* Local opaque fixtures; server-issued credentials are JWTs. */ }
    return {key,aes,expires};
  })();
  // An unavailable WebCrypto implementation must not create an unhandled rejection.
  void material.catch(()=>{});
  return {
    async read() {
      try {
        const {key,aes,expires}=await material;
        const record=JSON.parse(localStorage.getItem(key) || 'null');
        if (!record) return null;
        if (!Number.isFinite(record.at) || record.at > Date.now()+60_000 || Date.now() >= Math.min(record.at+MAX_AGE,expires)) { localStorage.removeItem(key); return null; }
        const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(record.iv)},aes,bytes(record.data));
        return { ...safePanel(JSON.parse(new TextDecoder().decode(plain))), at:record.at };
      } catch { return null; }
    },
    async write(panel: unknown, at = Date.now()) {
      const version=++revision;
      try {
        const {key,aes,expires}=await material;
        if (invalidated || Date.now() >= expires) return false;
        const plain=encode.encode(JSON.stringify(safePanel(panel)));
        if (plain.byteLength > 1_000_000) return false;
        const iv=crypto.getRandomValues(new Uint8Array(12));
        const data=await crypto.subtle.encrypt({name:'AES-GCM',iv},aes,plain);
        if (version !== revision || invalidated) return true;
        // Expired ciphertext from previous links must not accumulate indefinitely.
        for (const storageKey of Object.keys(localStorage)) {
          if (!storageKey.startsWith(COURIER_CACHE_PREFIX)) continue;
          try { if (JSON.parse(localStorage.getItem(storageKey) || 'null')?.at + MAX_AGE < Date.now()) localStorage.removeItem(storageKey); } catch { /* Do not touch unrelated app storage. */ }
        }
        localStorage.setItem(key, JSON.stringify({at,iv:base64(iv),data:base64(new Uint8Array(data))}));
        return true;
      } catch { return false; }
    },
    async clear() {
      invalidated=true; revision++;
      try { const {key}=await material; localStorage.removeItem(key); } catch { /* Memory is cleared by the caller too. */ }
    },
  };
}
