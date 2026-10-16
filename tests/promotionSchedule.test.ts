import assert from 'node:assert/strict';
import test from 'node:test';
import { campaignInstant, campaignLocalTime } from '../src/utils/promotionSchedule';

test('horário de Fortaleza é preservado independentemente do fuso do dispositivo', () => {
  assert.equal(campaignInstant('2026-10-16T12:30', 'America/Fortaleza'), '2026-10-16T15:30:00.000Z');
  assert.equal(campaignLocalTime('2026-10-16T15:30:00Z', 'America/Fortaleza'), '2026-10-16T12:30');
  assert.equal(campaignInstant('', 'America/Fortaleza'), null);
  assert.equal(campaignInstant('2026-10-16T12:30', 'America/Manaus'), '2026-10-16T16:30:00.000Z');
});
