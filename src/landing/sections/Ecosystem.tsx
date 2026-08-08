import React, { useRef, useState, useEffect } from 'react';
import { motion, useInView } from 'motion/react';
import { FrontalLaptopFrame } from '../product/FrontalLaptopFrame';
import { TabletFrame } from '../product/TabletFrame';
import { PhoneFrame } from '../product/PhoneFrame';

export function Ecosystem() {
  const sectionRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const isInView = useInView(sectionRef, { once: true, amount: 0.15 });

  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!stageRef.current) return;
    const rect = stageRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5; // -0.5 to 0.5
    const y = (e.clientY - rect.top) / rect.height - 0.5; // -0.5 to 0.5
    setMousePos({ x, y });
  };

  const handleMouseLeave = () => {
    setMousePos({ x: 0, y: 0 });
  };

  return (
    <section ref={sectionRef} className="koma-ecosystem-section" aria-label="Ecossistema">
      {/* Title & Copy */}
      <motion.div
        className="koma-eco-header"
        initial={{ opacity: 0, y: 30 }}
        animate={isInView ? { opacity: 1, y: 0 } : {}}
        transition={{ duration: 0.8 }}
      >
        <h2 className="koma-eco-title">
          TUDO ONDE<br />PRECISA ESTAR.
        </h2>
        <p className="koma-eco-subtitle">
          KÔMA conecta operação, atendimento e experiência em uma única base.
        </p>
      </motion.div>

      {/* 3-Level Overlapping Devices Composition */}
      <div
        ref={stageRef}
        className="koma-eco-stage"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        {/* LEVEL 1 (Back / Main Protagonist): Frontal Laptop */}
        <motion.div
          className="koma-eco-level-laptop"
          initial={{ opacity: 0, y: 40 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.9, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
          style={{
            transform: `perspective(1200px) rotateY(${mousePos.x * 4}deg) rotateX(${-mousePos.y * 3}deg)`,
            transition: 'transform 0.2s ease-out',
          }}
        >
          <FrontalLaptopFrame view="pdv" />
        </motion.div>

        {/* LEVEL 2 (Middle): Physical Tablet */}
        <motion.div
          className="koma-eco-level-tablet"
          initial={{ opacity: 0, y: 55, x: 20 }}
          animate={isInView ? { opacity: 1, y: 0, x: 0 } : {}}
          transition={{ duration: 0.9, delay: 0.25, ease: [0.16, 1, 0.3, 1] }}
          style={{
            transform: `perspective(1000px) rotateY(-12deg) rotateX(4deg) translate3d(${mousePos.x * 14}px, ${mousePos.y * 10}px, 0px)`,
            transition: 'transform 0.2s ease-out',
          }}
        >
          <TabletFrame view="mesas" />
        </motion.div>

        {/* LEVEL 3 (Front / Foreground): Smartphone */}
        <motion.div
          className="koma-eco-level-phone"
          initial={{ opacity: 0, y: 70, x: 30 }}
          animate={isInView ? { opacity: 1, y: 0, x: 0 } : {}}
          transition={{ duration: 0.9, delay: 0.4, ease: [0.16, 1, 0.3, 1] }}
          style={{
            transform: `perspective(800px) rotateY(-8deg) rotateX(3deg) translate3d(${mousePos.x * 24}px, ${mousePos.y * 16}px, 0px)`,
            transition: 'transform 0.2s ease-out',
          }}
        >
          <PhoneFrame />
        </motion.div>
      </div>

      {/* Pure Editorial Labels Grid */}
      <div className="koma-eco-labels-grid">
        <div className="koma-eco-label-item">
          <span className="koma-eco-label-num">01 / BALCÃO</span>
          <h3 className="koma-eco-label-name">OPERAÇÃO NO CAIXA</h3>
          <p className="koma-eco-label-desc">Abertura, fechamento, sangrias e emissão fiscal sem complicações.</p>
        </div>

        <div className="koma-eco-label-item">
          <span className="koma-eco-label-num">02 / MÓVEL</span>
          <h3 className="koma-eco-label-name">GESTÃO DE MESAS</h3>
          <p className="koma-eco-label-desc">Controle em tempo real de ocupação, comanda e atendimento no salão.</p>
        </div>

        <div className="koma-eco-label-item">
          <span className="koma-eco-label-num">03 / CLIENTE</span>
          <h3 className="koma-eco-label-name">CARDÁPIO QR CODE</h3>
          <p className="koma-eco-label-desc">Cardápio digital na mesa para consulta e pedidos sem fila de espera.</p>
        </div>
      </div>
    </section>
  );
}
