import React, {useEffect, useState} from 'react';
import {API_BASE_URL} from '../config/api';
import {whatsappConsentToken} from './whatsappOptOutToken';

type Invitation = {restaurant_name:string;phone_ending:string;whatsapp_url:string};
export default function WhatsAppConsentPage(){
  const [invitation,setInvitation]=useState<Invitation|null>(null);
  const [error,setError]=useState('');
  const token=whatsappConsentToken();
  useEffect(()=>{
    if(!token)return;
    const controller=new AbortController();
    void fetch(`${API_BASE_URL}/api/cardapio/whatsapp/consent/preview`,{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token}),
      signal:controller.signal,cache:'no-store',referrerPolicy:'no-referrer',
    }).then(async response=>{
      if(!response.ok)throw new Error('Convite indisponível. Peça um novo link ao restaurante.');
      const data=await response.json();
      const destination=new URL(data.whatsapp_url);
      if(destination.protocol!=='https:' || destination.hostname!=='wa.me' || !data.restaurant_name || !/^\d{4}$/.test(data.phone_ending))throw new Error('Convite inválido.');
      if(!controller.signal.aborted)setInvitation(data);
    }).catch(()=>{if(!controller.signal.aborted)setError('Convite indisponível ou expirado. Peça um novo link ao restaurante.');});
    return ()=>controller.abort();
  },[token]);
  return <main className="min-h-dvh bg-koma-bg p-4 text-koma-foreground flex items-center justify-center">
    <section className="w-full max-w-md space-y-4 rounded-2xl border border-koma-border bg-koma-card p-6">
      <p className="text-sm font-semibold text-koma-muted">KÔMA | Sua escolha de ofertas</p>
      <h1 className="text-xl font-bold">Receber ofertas pelo WhatsApp</h1>
      {invitation && <>
        <p className="text-lg font-bold break-words">{invitation.restaurant_name}</p>
        <p>Você pode autorizar ofertas somente desta loja, enviadas pelo número do KÔMA. Pode cancelar a qualquer momento, sem desligar os avisos dos seus pedidos.</p>
        <p>Use o seu WhatsApp com final <strong>{invitation.phone_ending}</strong>. Abra a conversa e envie a mensagem de confirmação, sem alterá-la.</p>
        <a className="block w-full rounded-xl bg-emerald-600 p-3 text-center font-bold text-white" href={invitation.whatsapp_url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Confirmar pelo meu WhatsApp</a>
        <p className="text-sm text-koma-muted">Abrir esta página ou a conversa não autoriza ofertas. A confirmação só vale depois que sua mensagem for recebida. Esta escolha não autoriza outras lojas.</p>
      </>}
      {!invitation && !error && token && <p role="status">Conferindo seu convite…</p>}
      {(!token || error) && <p role="alert">{error || 'Abra o convite fornecido pelo restaurante.'}</p>}
    </section>
  </main>;
}
