import assert from 'node:assert/strict';
import test from 'node:test';
import { projectLoyaltyImpact } from '../src/domain/loyaltyImpact';

test('full-redemption scenario subtracts benefit from contribution, never sales-as-profit', () => {
  assert.deepEqual(projectLoyaltyImpact(100, 5, 30), {benefit:5,contributionBefore:30,contributionAfter:25,exceedsContribution:false});
  assert.equal(projectLoyaltyImpact(100, 40, 30)?.contributionAfter, -10);
  assert.equal(projectLoyaltyImpact(100, 40, 30)?.exceedsContribution, true);
});
test('unknown or invalid cost margin remains unknown while zero is a valid supplied margin', () => {
  for (const value of [null,NaN,Infinity,-1,101]) assert.equal(projectLoyaltyImpact(100,5,value)?.contributionAfter,null);
  assert.equal(projectLoyaltyImpact(100,5,0)?.contributionAfter,-5);
});
test('invalid orders/rates cannot generate misleading projections', () => {
  for (const ticket of [0,-1,NaN,Infinity]) assert.equal(projectLoyaltyImpact(ticket,5,30),null);
  for (const rate of [-1,NaN,Infinity]) assert.equal(projectLoyaltyImpact(100,rate,30),null);
  assert.equal(projectLoyaltyImpact(100,0,30)?.contributionAfter,30);
});
