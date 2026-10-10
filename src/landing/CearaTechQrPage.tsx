import React from 'react';
import { ArrowUpRight, Instagram } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';

const LEAD_URL = 'https://komafood.com.br/siaratech?source=qr_tela';

export default function CearaTechQrPage() {
  return <main className="siara-page siara-screen">
    <header className="siara-header">
      <img className="siara-koma-logo" src="/koma-event-wordmark.svg" alt="KÔMA" />
      <img className="siara-event-logo" src="/siara-tech-summit.svg" alt="Siará Tech Summit 2026" />
    </header>
    <div className="siara-screen-grid">
      <section className="siara-screen-pitch">
        <p className="siara-eyebrow">SISTEMA PARA RESTAURANTES</p>
        <h1>SEU PRÓXIMO<br /><span>PASSO.</span></h1>
        <p className="siara-screen-subtitle">Mais controle da operação.<br />A conversa começa no seu celular.</p>
        <div className="siara-screen-instruction"><ArrowUpRight aria-hidden="true" /><p>Aponte a câmera.<br /><strong>Conheça o KÔMA no seu restaurante.</strong></p></div>
      </section>
      <section className="siara-qr-panel" aria-label="Cadastro pelo QR Code">
        <div className="siara-qr-caption"><span>ESCANEIE E VAMOS CONVERSAR</span><span>01 / KÔMA</span></div>
        <QRCodeSVG value={LEAD_URL} level="M" marginSize={4} title="QR Code para conhecer o KÔMA" />
        <p className="siara-qr-url">komafood.com.br/siaratech</p>
        <p className="siara-qr-help">Nome + WhatsApp. Sem compromisso.</p>
      </section>
    </div>
    <footer className="siara-screen-footer"><span>PEDIDOS · COZINHA · CAIXA</span><a href="https://instagram.com/georlanjunior" target="_blank" rel="noopener noreferrer"><Instagram size={20} /> @georlanjunior</a></footer>
  </main>;
}
