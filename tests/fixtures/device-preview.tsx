// Local visual QA only. This HTML entry is not part of the production build.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { EditableTabletFrame } from '../../src/landing/product/EditableTabletFrame';
import '../../src/landing/product/editable-tablet.css';
import shell from '../../src/assets/koma-tablet-graphite-shell-v2.png';
import { EditableLaptopFrame } from '../../src/landing/product/EditableLaptopFrame';
import '../../src/landing/product/editable-laptop.css';
import laptopShell from '../../src/assets/koma-notebook-graphite-shell-v2.png';

const capture = (label: string, width: number, height: number, color: string) => (
  'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="${color}"/><rect x="24" y="24" width="${width - 48}" height="${height - 48}" rx="20" fill="none" stroke="white" stroke-width="8"/><text x="50%" y="50%" text-anchor="middle" font-family="sans-serif" font-size="70" fill="white">${label}</text></svg>`)
);
const captures = {
  a: { src: capture('CAPTURA A', 1280, 900, '#00745e'), alt: 'Captura de teste horizontal' },
  b: { src: capture('CAPTURA B', 900, 1280, '#563397'), alt: 'Captura de teste vertical' },
};

function Preview() {
  const [device, setDevice] = useState<'tablet' | 'notebook'>('tablet');
  const [background, setBackground] = useState('#fafafa');
  const [mode, setMode] = useState<'shell' | 'content' | 'a' | 'b'>('shell');
  const Frame = device === 'tablet' ? EditableTabletFrame : EditableLaptopFrame;
  const selectedShell = device === 'tablet' ? shell : laptopShell;
  return (
    <main style={{ padding: 16, fontFamily: 'sans-serif' }}>
      <nav style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
        <button onClick={() => setDevice('tablet')}>Tablet</button>
        <button onClick={() => setDevice('notebook')}>Notebook</button>
        <button onClick={() => setBackground('#fafafa')}>Fundo claro</button>
        <button onClick={() => setBackground('#080a09')}>Fundo escuro</button>
        <button onClick={() => setBackground('#00b894')}>Fundo verde</button>
        <button onClick={() => setMode('shell')}>Moldura</button>
        <button onClick={() => setMode('content')}>Interface</button>
        <button onClick={() => setMode('a')}>Captura A</button>
        <button onClick={() => setMode('b')}>Captura B</button>
      </nav>
      <section aria-label={`Prévia do ${device}`} style={{ background, padding: 12 }}>
        {mode === 'shell' ? (
          <img src={selectedShell} alt={`Moldura transparente do ${device}`} style={{ display: 'block', width: '100%', maxWidth: 820, margin: 'auto' }} />
        ) : (
          <Frame shellSrc={selectedShell} screenshot={mode === 'a' || mode === 'b' ? captures[mode] : undefined}>
            <div style={{ height: '100%', background: '#13221d', color: 'white', fontSize: 64, display: 'grid', placeItems: 'center' }}>INTERFACE EM HTML</div>
          </Frame>
        )}
      </section>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<Preview />);
