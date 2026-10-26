import { useEffect, useRef } from 'react';
import { WS_BASE_URL } from '../../config/api';

/** One scoped socket while visible/online; retry only the connection, never a mutation. */
export function useCourierRealtime(token: string, invalidate: () => void, revoked: () => void) {
  const callbacks=useRef({token,invalidate,revoked}); callbacks.current={token,invalidate,revoked};
  useEffect(()=>{
    if (!token) return;
    let socket: WebSocket | null=null, disposed=false, denied=false, attempt=0;
    let retry: ReturnType<typeof setTimeout> | null=null, ping: ReturnType<typeof setInterval> | null=null;
    let lastPong=0;
    let hint: ReturnType<typeof setTimeout> | null=null;
    const invalidate=()=>{if(hint)clearTimeout(hint);hint=setTimeout(()=>{hint=null;if(callbacks.current.token===token)callbacks.current.invalidate();},200);};
    const cleanup=()=>{ if(hint)clearTimeout(hint); hint=null; if(retry)clearTimeout(retry); if(ping)clearInterval(ping); retry=null;ping=null; const old=socket;socket=null;old?.close(); };
    const connect=()=>{
      if(disposed || denied || socket || !navigator.onLine || document.hidden)return;
      let current: WebSocket;
      try {current=new WebSocket(`${WS_BASE_URL}/ws/entregador`,['koma-auth',token]);} catch {schedule();return;}
      socket=current;
      current.onmessage=event=>{
        if(socket!==current || callbacks.current.token!==token)return;
        try{
          const data=JSON.parse(event.data);
          if(data.event==='pong')lastPong=Date.now();
          if(data.event==='courier_ready'){attempt=0;lastPong=Date.now();invalidate();}
          if(data.event==='courier_panel_updated')invalidate();
        }catch{/* A malformed hint is not order data. */}
      };
      current.onopen=()=>{
        if(socket!==current || callbacks.current.token!==token)return;
        lastPong=Date.now();
        ping=setInterval(()=>{
          if(socket!==current || callbacks.current.token!==token)return;
          if(Date.now()-lastPong>75_000){current.close();return;}
          if(current.readyState===WebSocket.OPEN)current.send('ping');
        },30_000);
      };
      current.onclose=event=>{
        if(socket!==current || callbacks.current.token!==token)return;
        socket=null;if(ping)clearInterval(ping);ping=null;
        if(event.code===1008){denied=true;callbacks.current.revoked();return;}
        schedule();
      };
      current.onerror=()=>current.close();
    };
    const schedule=()=>{
      if(disposed||denied||retry||document.hidden||!navigator.onLine)return;
      const delay=Math.min(30_000,1000*2**Math.min(attempt++,5))+Math.random()*500;
      retry=setTimeout(()=>{retry=null;connect();},delay);
    };
    const resume=()=>{if(document.hidden||!navigator.onLine)cleanup();else connect();};
    document.addEventListener('visibilitychange',resume);
    window.addEventListener('online',resume);window.addEventListener('offline',resume);
    connect();
    return()=>{disposed=true;cleanup();document.removeEventListener('visibilitychange',resume);window.removeEventListener('online',resume);window.removeEventListener('offline',resume);};
  },[token]);
}
