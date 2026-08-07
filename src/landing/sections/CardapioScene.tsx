import React, { useRef } from 'react';
import { motion, useInView } from 'motion/react';
import { PhoneFrame } from '../product/PhoneFrame';

export function CardapioScene() {
  const ref = useRef<HTMLElement>(null);
  const isInView = useInView(ref, { once: true, amount: 0.2 });

  return (
    <section ref={ref} className="koma-section-dark" style={{ background: '#0a0a0a', padding: 'clamp(5rem, 10vw, 10rem) clamp(1.5rem, 5vw, 6rem)', position: 'relative' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', alignItems: 'center', gap: '4rem' }}>
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.8 }}
        >
          <span style={{ fontFamily: 'Space Grotesk', fontSize: '0.85rem', fontWeight: 800, color: '#00b894', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            04 / CARDÁPIO DIGITAL
          </span>
          <h2 style={{ fontFamily: 'Montserrat', fontSize: 'clamp(2.5rem, 6.5vw, 5.5rem)', fontWeight: 900, lineHeight: 0.88, letterSpacing: '-0.04em', textTransform: 'uppercase', color: '#fff', margin: '0.5rem 0 1.5rem 0' }}>
            AUTONOMIA<br />NA MESA.
          </h2>
          <p style={{ fontFamily: 'Inter', fontSize: 'clamp(1rem, 1.3vw, 1.2rem)', color: 'rgba(255,255,255,0.75)', maxWidth: '38ch', lineHeight: 1.5 }}>
            O cliente lê o QR Code, consulta os itens, escolhe adicionais e envia o pedido direto para a cozinha. Sem filas, sem espera por garçom.
          </p>

          <div style={{ borderLeft: '2px solid #00b894', paddingLeft: '1.25rem', marginTop: '2rem' }}>
            <div style={{ fontFamily: 'Space Grotesk', fontSize: '0.75rem', fontWeight: 800, color: '#00b894', letterSpacing: '0.08em' }}>
              AGILIDADE NO ATENDIMENTO
            </div>
            <p style={{ fontSize: '0.875rem', color: 'rgba(255,255,255,0.6)', margin: '0.25rem 0 0 0' }}>
              Redução comprovada no tempo de espera do pedido e maior rotatividade de mesas.
            </p>
          </div>
        </motion.div>

        {/* Smartphone Product Object */}
        <motion.div
          style={{ width: 'clamp(260px, 26vw, 340px)', margin: '0 auto' }}
          initial={{ opacity: 0, scale: 0.95 }}
          animate={isInView ? { opacity: 1, scale: 1 } : {}}
          transition={{ duration: 0.9, delay: 0.2 }}
        >
          <PhoneFrame />
        </motion.div>
      </div>
    </section>
  );
}
