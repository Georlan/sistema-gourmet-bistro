import assert from 'node:assert/strict';
import test from 'node:test';
import { orderCourierStops, validCourierPoint } from '../src/components/courier/courierAutoOrder';

const stop = (id: string, longitude: number, latitude = 1) => ({ id, destination: { latitude, longitude } });
test('sequence starts at the courier, then chooses the nearest remaining stop without mutating input', () => {
  const stops = [stop('far', 5), stop('near', 1), stop('middle', 2)];
  const before = JSON.stringify(stops);
  assert.deepEqual(orderCourierStops(stops, {latitude:1,longitude:0}).ids, ['near','middle','far']);
  assert.deepEqual(orderCourierStops(stops, {latitude:1,longitude:6}).ids, ['far','middle','near']);
  assert.equal(JSON.stringify(stops), before);
});
test('unknown/invalid destinations stay visible, in their current relative order', () => {
  const stops = [{id:'unknown'},stop('bad',Infinity),stop('far',4),{id:'partial',destination:{latitude:1}},stop('near',1)];
  const result = orderCourierStops(stops,{latitude:1,longitude:0});
  assert.deepEqual(result.ids,['near','far','unknown','bad','partial']);
  assert.deepEqual(result.missing,['unknown','bad','partial']);
  assert.equal(result.located,2);
});
test('ties are stable, repeated coordinates are valid and crossing the dateline is nearby', () => {
  assert.deepEqual(orderCourierStops([stop('a',2),stop('b',2)],{latitude:1,longitude:1}).ids,['a','b']);
  assert.deepEqual(orderCourierStops([stop('far',170),stop('across',-179.9)],{latitude:1,longitude:179.9}).ids,['across','far']);
});
test('invalid origin never changes the previous sequence; duplicate IDs never duplicate a card', () => {
  assert.deepEqual(orderCourierStops([stop('far',4),stop('near',1)],{latitude:NaN,longitude:0}).ids,['far','near']);
  assert.deepEqual(orderCourierStops([stop('a',1),stop('a',1)],{latitude:1,longitude:0}).ids,['a']);
  for (const destination of [undefined,{latitude:0,longitude:0},{latitude:91,longitude:1},{latitude:1,longitude:-181},{latitude:1,longitude:NaN}]) assert.equal(validCourierPoint(destination),false);
  assert.equal(validCourierPoint({latitude:0,longitude:20}),true);
});
