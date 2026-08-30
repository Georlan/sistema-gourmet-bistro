import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { OperationalDrawerProps } from '../src/components/app/OperationalDrawer';
import type { OperationalLoginProps } from '../src/components/auth/OperationalLogin';
import type { Order } from '../src/types';

// node:test renders the real logo too; SVG imports are URLs in Vite, not JS.
register('./helpers/staticAssetsLoader.mjs', import.meta.url);
const { OperationalDrawer } = await import('../src/components/app/OperationalDrawer');
const { OperationalLogin } = await import('../src/components/auth/OperationalLogin');

const order: Order = {
  id: 'check-shell',
  numeroPedido: 24,
  mesaId: 7,
  garcomId: 'waiter-shell',
  garcomNome: 'Garçom Shell',
  timestamp: Date.UTC(2026, 7, 30, 15),
  itens: [
    { id: 'ready', produtoId: 'product', nome: 'Prato pronto', preco: 48, observacao: '', clienteNome: '', status: 'pronto' },
    { id: 'cancelled', produtoId: 'product', nome: 'Cancelado', preco: 10, observacao: '', clienteNome: '', status: 'cancelado' },
  ],
};

const drawerProps = (overrides: Partial<OperationalDrawerProps> = {}): OperationalDrawerProps => ({
  portal: 'garcom',
  restaurantName: 'Restaurante Shell',
  activeWaiterName: 'Garçom Shell',
  waiterAvailable: true,
  orders: [order],
  tableCounts: { libre: 2, ocupada: 1, pronto: 2 },
  turnoResumo: null,
  settings: { exibirImagens: true, exibirDescricoes: false },
  theme: 'dark',
  onWaiterAvailabilityChange: () => {},
  onSettingsChange: () => {},
  onToggleTheme: () => {},
  onClose: () => {},
  onLogout: () => {},
  onSyncSalon: () => {},
  ...overrides,
});

const loginProps = (overrides: Partial<OperationalLoginProps> = {}): OperationalLoginProps => ({
  portal: 'garcom',
  theme: 'dark',
  username: 'garcom@koma.test',
  password: 'fixture-password',
  error: '',
  isLoggingIn: false,
  onToggleTheme: () => {},
  onUsernameChange: () => {},
  onPasswordChange: () => {},
  onSubmit: () => {},
  ...overrides,
});

function elements(node: ReactNode): ReactElement<Record<string, any>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, any>>(node)) return [];
  const element = node as ReactElement<Record<string, any>>;
  return [element, ...elements(element.props.children)];
}

function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  return isValidElement<{ children?: ReactNode }>(node) ? textOf(node.props.children) : '';
}

test('login controlado preserva campos, autocomplete, rótulo do portal e valores', () => {
  const html = renderToStaticMarkup(createElement(OperationalLogin, loginProps()));
  assert.match(html, /Portal do Garçom/);
  assert.match(html, /id="login-username" type="email" autoComplete="username" inputMode="email" required=""[^>]*name="email"/);
  assert.match(html, /value="garcom@koma.test"/);
  assert.match(html, /id="login-password" type="password" autoComplete="current-password" required=""[^>]*name="password"/);
  assert.match(html, /value="fixture-password"/);
  assert.match(html, /Alternar tema claro e escuro/);
  assert.match(html, /Modo Claro/);
});

test('login exibe erro e estado de autenticação sem manter estado próprio', () => {
  const html = renderToStaticMarkup(createElement(OperationalLogin, loginProps({
    portal: 'caixa', theme: 'light', isLoggingIn: true, error: 'Credenciais inválidas',
  })));
  assert.match(html, /Painel de Gerenciamento &amp; Caixa/);
  assert.match(html, /Credenciais inválidas/);
  assert.match(html, /type="submit" disabled=""/);
  assert.match(html, /Autenticando\.\.\./);
  assert.match(html, /Modo Escuro/);
});

test('login encaminha submit e edição exatamente aos callbacks do App', () => {
  const calls: unknown[] = [];
  const formEvent = { preventDefault: () => {} };
  const nodes = elements(OperationalLogin(loginProps({
    onUsernameChange: value => calls.push(['username', value]),
    onPasswordChange: value => calls.push(['password', value]),
    onSubmit: event => calls.push(['submit', event]),
  })));
  nodes.find(node => node.props.id === 'login-username')!.props.onChange({ target: { value: 'new@koma.test' } });
  nodes.find(node => node.props.id === 'login-password')!.props.onChange({ target: { value: 'new-password' } });
  nodes.find(node => node.type === 'form')!.props.onSubmit(formEvent);
  assert.deepEqual(calls, [['username', 'new@koma.test'], ['password', 'new-password'], ['submit', formEvent]]);
});

test('drawer Garçom preserva métricas canônicas, identificação e controles existentes', () => {
  const html = renderToStaticMarkup(createElement(OperationalDrawer, drawerProps()));
  assert.match(html, /id="sidebar-backdrop"/);
  assert.match(html, /id="close-sidebar-btn"/);
  assert.match(html, /Garçom Shell/);
  assert.match(html, /Restaurante Shell/);
  assert.match(html, /3<\/strong> ocupadas \/ 2 livres/);
  assert.match(html, /1 p\/ servir/);
  assert.match(html, /Disponível no Salão/);
  assert.match(html, /Sincronizar Salão/);
  assert.match(html, /id="sidebar-toggle-images"[^>]*checked=""/);
  assert.doesNotMatch(html, /id="sidebar-toggle-descriptions"[^>]*checked=""/);
});

test('drawer não reseta disponibilidade controlada e fecha antes de sincronizar', () => {
  const calls: unknown[] = [];
  const tree = OperationalDrawer(drawerProps({
    waiterAvailable: false,
    onWaiterAvailabilityChange: value => calls.push(['available', value]),
    onClose: () => calls.push('close'),
    onSyncSalon: () => calls.push('sync'),
  }));
  const nodes = elements(tree);
  const availability = nodes.find(node => node.type === 'button' && textOf(node.props.children).includes('Ocupado / Em Atendimento'))!;
  availability.props.onClick();
  const sync = nodes.find(node => node.type === 'button' && textOf(node.props.children).includes('Sincronizar Salão'))!;
  sync.props.onClick();
  assert.deepEqual(calls, [['available', true], 'close', 'sync']);
  assert.match(renderToStaticMarkup(tree), /Ocupado \/ Em Atendimento/);
});

test('preferências do drawer encaminham nova configuração sem alterar a configuração recebida', () => {
  const settings = Object.freeze({ exibirImagens: true, exibirDescricoes: false });
  const changes: unknown[] = [];
  const nodes = elements(OperationalDrawer(drawerProps({ settings, onSettingsChange: value => changes.push(value) })));
  nodes.find(node => node.props.id === 'sidebar-toggle-images')!.props.onChange({ target: { checked: false } });
  nodes.find(node => node.props.id === 'sidebar-toggle-descriptions')!.props.onChange({ target: { checked: true } });
  assert.deepEqual(changes, [
    { exibirImagens: false, exibirDescricoes: false },
    { exibirImagens: true, exibirDescricoes: true },
  ]);
  assert.deepEqual(settings, { exibirImagens: true, exibirDescricoes: false });
});

test('ramo Caixa do drawer preserva fallback legado e atalhos para sessões de cozinha', () => {
  const legacyDelivery = Object.assign({ ...order }, { tipo: 'DELIVERY', status: 'PENDENTE', total: '17.50' });
  const legacyOpen = { ...order, id: 'open', status: 'OPEN' };
  const html = renderToStaticMarkup(createElement(OperationalDrawer, drawerProps({ portal: 'caixa', orders: [legacyDelivery, legacyOpen] })));
  assert.match(html, /Operador do Caixa/);
  assert.match(html, /R\$ 17\.50/);
  assert.match(html, /1 ativas/);
  assert.match(html, /1 p\/ aceitar/);
  for (const label of ['Agente de Impressão', 'Suprimento de Caixa', 'Sangria de Segurança', 'Sincronizar Dados']) {
    assert.ok(html.includes(label), label);
  }
  assert.doesNotMatch(html, /Sincronizar Salão/);
});

test('atalhos alternativos fecham o drawer antes de despachar cada evento existente', () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const calls: string[] = [];
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { dispatchEvent: (event: Event) => { calls.push(event.type); return true; } },
  });
  try {
    const nodes = elements(OperationalDrawer(drawerProps({ portal: 'caixa', onClose: () => calls.push('close') })));
    for (const label of ['Agente de Impressão', 'Suprimento de Caixa', 'Sangria de Segurança', 'Sincronizar Dados']) {
      nodes.find(node => node.type === 'button' && textOf(node.props.children).includes(label))!.props.onClick();
    }
    assert.deepEqual(calls, [
      'close', 'koma-open-impressoras',
      'close', 'koma-open-suprimento',
      'close', 'koma-open-sangria',
      'close', 'koma-sync-all',
    ]);
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});
