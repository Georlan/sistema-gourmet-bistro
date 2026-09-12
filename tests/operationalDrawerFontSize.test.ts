import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import { isValidElement, type ReactElement, type ReactNode } from 'react';

import type { OperationalDrawerProps } from '../src/components/app/OperationalDrawer';

register('./helpers/staticAssetsLoader.mjs', import.meta.url);
const { OperationalDrawer } = await import('../src/components/app/OperationalDrawer');

function elements(node: ReactNode): ReactElement<Record<string, any>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, any>>(node)) return [];
  const element = node as ReactElement<Record<string, any>>;
  return [element, ...elements(element.props.children)];
}

const props: OperationalDrawerProps = {
  portal: 'garcom',
  restaurantName: 'Kôma QA',
  activeWaiterName: 'Garçom QA',
  waiterAvailable: true,
  orders: [],
  tableCounts: { libre: 3, ocupada: 0, pronto: 0 },
  turnoResumo: null,
  settings: { exibirImagens: false, exibirDescricoes: true },
  theme: 'dark',
  onWaiterAvailabilityChange: () => {},
  onSettingsChange: () => {},
  onToggleTheme: () => {},
  onClose: () => {},
  onLogout: () => {},
  onSyncSalon: () => {},
};

test('controle de tamanho do texto usa a preferência global já existente', () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const writes: Array<[string, string]> = [];
  const events: string[] = [];
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => key === 'koma_font_size' ? 'padrao' : null,
        setItem: (key: string, value: string) => writes.push([key, value]),
      },
      dispatchEvent: (event: Event) => { events.push(event.type); return true; },
    },
  });
  try {
    const nodes = elements(OperationalDrawer(props));
    nodes.find(node => node.props.id === 'drawer-font-grande')!.props.onClick();
    assert.deepEqual(writes, [['koma_font_size', 'grande']]);
    assert.deepEqual(events, ['koma_font_size_changed']);
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});
