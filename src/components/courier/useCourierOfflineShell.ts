import { useEffect, useState } from 'react';

/** Separate, narrowly scoped worker: never changes the Cardápio/Staff push worker. */
export function useCourierOfflineShell() {
  const [failed,setFailed]=useState(false);
  useEffect(()=>{
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
    let stopped=false,warming=false;
    let timer:ReturnType<typeof setTimeout>|null=null;
    let removeListener=()=>{};
    const warm=async()=>{
      if(stopped||warming||!navigator.onLine)return;
      warming=true;
      const finish=(error:boolean)=>{warming=false;if(timer)clearTimeout(timer);removeListener();if(!stopped)setFailed(error);};
      timer=setTimeout(()=>finish(true),15_000);
      try {
        const registration=await navigator.serviceWorker.register('/courier-sw.js',{scope:'/entregador',updateViaCache:'none'});
        let worker=registration.active;
        if(!worker){
          const pending=registration.installing||registration.waiting;
          if(!pending)throw new Error('No offline worker');
          await new Promise<void>((resolve,reject)=>{
            pending.addEventListener('statechange',()=>{
              if(pending.state==='activated')resolve();
              if(pending.state==='redundant')reject(new Error('Offline worker not activated'));
            });
            if(pending.state==='activated')resolve();
          });
          worker=registration.active;
        }
        if(stopped)return;
        const entry=Array.from(document.scripts).map(script=>script.src).find(url=>new URL(url,location.href).pathname.startsWith('/assets/'));
        if(!entry||!worker)throw new Error('No production entry');
        const receive=(event:MessageEvent)=>{
          if(event.source!==worker)return;
          if(event.data?.type==='COURIER_SHELL_READY')finish(false);
          if(event.data?.type==='COURIER_SHELL_FAILED')finish(true);
        };
        navigator.serviceWorker.addEventListener('message',receive);
        removeListener=()=>navigator.serviceWorker.removeEventListener('message',receive);
        const assets=performance.getEntriesByType('resource').map(resource=>resource.name).filter(url=>new URL(url,location.href).origin===location.origin);
        worker.postMessage({type:'CACHE_COURIER_SHELL',entry,assets});
      }catch{finish(true);}
    };
    void warm();window.addEventListener('online',warm);
    return()=>{stopped=true;if(timer)clearTimeout(timer);removeListener();window.removeEventListener('online',warm);};
  },[]);
  return failed;
}
