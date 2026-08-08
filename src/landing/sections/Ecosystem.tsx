import React, { useRef, useState } from 'react';
import { motion, useInView } from 'motion/react';
import { FrontalLaptopFrame } from '../product/FrontalLaptopFrame';
import { TabletFrame } from '../product/TabletFrame';
import { PhoneFrame } from '../product/PhoneFrame';

type ActiveDevice = 'laptop' | 'tablet' | 'phone' | null;

export function Ecosystem() {
  const sectionRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const isInView = useInView(sectionRef, { once: true, amount: 0.15 });

  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [activeDevice, setActiveDevice] = useState<ActiveDevice>(null);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!stageRef.current) return;
    const rect = stageRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5; // -0.5 to 0.5
    const y = (e.clientY - rect.top) / rect.height - 0.5; // -0.5 to 0.5
    setMousePos({ x, y });
  };

  const handleMouseLeave = () => {
    setMousePos({ x: 0, y: 0 });
    setActiveDevice(null);
  };

  return (
    <section ref={sectionRef} className="koma-ecosystem-section" aria-label="Ecossistema">
      <div className="koma-eco-grid-container">
        {/* Left Column: Editorial Headline, Tag & Functional Labels */}
        <motion.div
          className="koma-eco-editorial-col"
          initial={{ opacity: 0, x: -30 }}
          animate={isInView ? { opacity: 1, x: 0 } : {}}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        >
          <span className="koma-eco-tag">04 / ECOSSISTEMA</span>

          <h2 className="koma-eco-title">
            UMA OPERAÇÃO.<br />
            EM QUALQUER TELA.
          </h2>

          <p className="koma-eco-subtitle">
            Caixa, salão e cliente conectados pelo KÔMA em uma única base operacional.
          </p>

          <div className="koma-eco-functional-list">
            <div
              className={`koma-eco-func-item ${activeDevice === 'laptop' ? 'koma-eco-func-item--active' : ''}`}
              onMouseEnter={() => setActiveDevice('laptop')}
              onMouseLeave={() => setActiveDevice(null)}
            >
              <span className="koma-eco-func-num">01 / CAIXA</span>
              <h3 className="koma-eco-func-title">NÚCLEO OPERACIONAL</h3>
              <p className="koma-eco-func-desc">Abertura de caixa, gestão financeira e controle central.</p>
            </div>

            <div
              className={`koma-eco-func-item ${activeDevice === 'tablet' ? 'koma-eco-func-item--active' : ''}`}
              onMouseEnter={() => setActiveDevice('tablet')}
              onMouseLeave={() => setActiveDevice(null)}
            >
              <span className="koma-eco-func-num">02 / SALÃO</span>
              <h3 className="koma-eco-func-title">OPERAÇÃO EM MESAS</h3>
              <p className="koma-eco-func-desc">Atendimento ágil do garçom e mapa de mesas em tempo real.</p>
            </div>

            <div
              className={`koma-eco-func-item ${activeDevice === 'phone' ? 'koma-eco-func-item--active' : ''}`}
              onMouseEnter={() => setActiveDevice('phone')}
              onMouseLeave={() => setActiveDevice(null)}
            >
              <span className="koma-eco-func-num">03 / CARDÁPIO</span>
              <h3 className="koma-eco-func-title">EXPERIÊNCIA MÓVEL</h3>
              <p className="koma-eco-func-desc">Cardápio QR Code direto no celular do cliente para pedidos sem fila.</p>
            </div>
          </div>
        </motion.div>

        {/* Right Column: Cohesive 3D Spatial Scene with Unified Parallax */}
        <div
          ref={stageRef}
          className="koma-eco-cluster-stage"
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        >
          {/* Background Ambient Parallax Surface */}
          <div
            className="koma-eco-stage-bg-surface"
            aria-hidden="true"
            style={{
              transform: `translate3d(${mousePos.x * 2}px, ${mousePos.y * 2}px, 0px)`,
              transition: 'transform 0.2s ease-out',
            }}
          />

          {/* LEVEL 1: Dominant Frontal Laptop (Caixa / PDV) */}
          <motion.div
            className={`koma-eco-device-laptop ${activeDevice === 'laptop' ? 'koma-eco-device--hovered' : ''}`}
            onMouseEnter={() => setActiveDevice('laptop')}
            onMouseLeave={() => setActiveDevice(null)}
            initial={{ opacity: 0, y: 40 }}
            animate={isInView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.9, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
            style={{
              transform: `perspective(1200px) rotateY(${-5 + mousePos.x * 3}deg) rotateX(${2 - mousePos.y * 2}deg) rotateZ(-0.5deg) translate3d(${mousePos.x * 4}px, ${mousePos.y * 4 + (activeDevice === 'laptop' ? -6 : 0)}px, 0px) scale(${activeDevice === 'laptop' ? 1.01 : 1})`,
              transition: 'transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1), filter 0.25s ease',
              zIndex: activeDevice === 'laptop' ? 4 : 1,
            }}
          >
            <FrontalLaptopFrame view="pdv" />
          </motion.div>

          {/* LEVEL 2: Tablet (Salão / Mesas) - 70-75% scale of Laptop */}
          <motion.div
            className={`koma-eco-device-tablet ${activeDevice === 'tablet' ? 'koma-eco-device--hovered' : ''}`}
            onMouseEnter={() => setActiveDevice('tablet')}
            onMouseLeave={() => setActiveDevice(null)}
            initial={{ opacity: 0, y: 55, x: 30 }}
            animate={isInView ? { opacity: 1, y: 0, x: 0 } : {}}
            transition={{ duration: 0.9, delay: 0.25, ease: [0.16, 1, 0.3, 1] }}
            style={{
              transform: `perspective(1000px) rotateY(${-9 + mousePos.x * 4}deg) rotateX(${3 - mousePos.y * 2.5}deg) rotateZ(2deg) translate3d(${mousePos.x * 7}px, ${mousePos.y * 6 + (activeDevice === 'tablet' ? -8 : 0)}px, 0px) scale(${activeDevice === 'tablet' ? 1.015 : 1})`,
              transition: 'transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1), filter 0.25s ease',
              zIndex: activeDevice === 'tablet' ? 4 : 2,
            }}
          >
            <TabletFrame view="mesas" />
          </motion.div>

          {/* LEVEL 3: Smartphone (Cardápio Mobile) */}
          <motion.div
            className={`koma-eco-device-phone ${activeDevice === 'phone' ? 'koma-eco-device--hovered' : ''}`}
            onMouseEnter={() => setActiveDevice('phone')}
            onMouseLeave={() => setActiveDevice(null)}
            initial={{ opacity: 0, y: 70, x: 40 }}
            animate={isInView ? { opacity: 1, y: 0, x: 0 } : {}}
            transition={{ duration: 0.9, delay: 0.4, ease: [0.16, 1, 0.3, 1] }}
            style={{
              transform: `perspective(800px) rotateY(${-6 + mousePos.x * 5}deg) rotateX(${2 - mousePos.y * 3}deg) rotateZ(-1.5deg) translate3d(${mousePos.x * 10}px, ${mousePos.y * 8 + (activeDevice === 'phone' ? -10 : 0)}px, 0px) scale(${activeDevice === 'phone' ? 1.02 : 1})`,
              transition: 'transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1), filter 0.25s ease',
              zIndex: activeDevice === 'phone' ? 4 : 3,
            }}
          >
            <PhoneFrame />
          </motion.div>
        </div>
      </div>
    </section>
  );
}
