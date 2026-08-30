import React from 'react';
import { MonitorSmartphone, PlayCircle, CheckCircle2 } from 'lucide-react';

export function SocialProof() {
  return (
    <section className="koma-confidence-strip" id="credibilidade" aria-label="Antes de contratar">
      <div><MonitorSmartphone aria-hidden="true" /><p><strong>Use o que já tem</strong><span>Celular, tablet ou computador.</span></p></div>
      <div><CheckCircle2 aria-hidden="true" /><p><strong>Equipamentos conferidos</strong><span>Compatibilidade avaliada antes de contratar.</span></p></div>
      <a href="#como-funciona"><PlayCircle aria-hidden="true" /><p><strong>Veja antes de decidir</strong><span>Explore as telas do produto →</span></p></a>
    </section>
  );
}
