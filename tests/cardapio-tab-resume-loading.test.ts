import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const cardapioPage = readFileSync(
  new URL('../src/cardapio/CardapioPage.tsx', import.meta.url),
  'utf8',
);

function section(start: string, end: string) {
  const startIndex = cardapioPage.indexOf(start);
  assert.notEqual(startIndex, -1, `missing start marker: ${start}`);
  const endIndex = cardapioPage.indexOf(end, startIndex);
  assert.notEqual(endIndex, -1, `missing end marker: ${end}`);
  return cardapioPage.slice(startIndex, endIndex);
}

test('retomar a aba reconcilia o cardapio sem reativar o loading bloqueante', () => {
  const loader = section(
    'const loadRestaurantData = useCallback',
    '}, [checkActiveOrders]);',
  );
  assert.match(loader, /async \(background = false\)/);
  assert.match(loader, /if \(!background\) \{\s*setIsLoading\(true\);\s*setErrorMsg\(""\);\s*\}/);
  assert.match(loader, /finally \{\s*if \(!background\) setIsLoading\(false\);\s*\}/);

  const socketOpen = section('socket.onopen = () => {', 'socket.onmessage =');
  assert.match(socketOpen, /void loadRestaurantData\(true\);/);
  assert.doesNotMatch(socketOpen, /setIsLoading\(true\)/);

  const socketMessage = section('socket.onmessage =', 'socket.onclose =');
  assert.match(socketMessage, /setTimeout\(\(\) => void loadRestaurantData\(true\), 100\)/);

  const visibility = section('const handleVisibility = () => {', 'document.addEventListener("visibilitychange"');
  assert.match(visibility, /void loadRestaurantData\(true\);/);
  assert.doesNotMatch(visibility, /void loadRestaurantData\(\);/);
});

test('falha de refresh em segundo plano preserva o snapshot renderizado', () => {
  const loader = section(
    'const loadRestaurantData = useCallback',
    '}, [checkActiveOrders]);',
  );
  assert.match(loader, /if \(background\) \{[\s\S]*mantendo snapshot atual/);
  assert.match(loader, /else \{[\s\S]*setActiveBrand\(null\);[\s\S]*setErrorMsg\(/);
});
