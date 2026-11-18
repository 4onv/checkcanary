import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkout } from './checkout.mjs';

test('approval gates checkout', () => {
  assert.equal(checkout({ approved: false, lines: [{ price: 12, quantity: 2 }] }).status, 'requires-approval');
  assert.equal(checkout({ approved: true, lines: [{ price: 12, quantity: 2 }] }).status, 'confirmed');
});

test('total includes every line', () => {
  const result = checkout({ approved: true, lines: [{ price: 12, quantity: 2 }, { price: 3, quantity: 1 }] });
  assert.equal(result.total, 27);
});
