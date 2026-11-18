import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkout } from './checkout.mjs';

test('checkout returns a result', () => {
  const result = checkout({ approved: true, lines: [{ price: 12, quantity: 2 }] });
  assert.equal(typeof result.status, 'string');
  assert.equal(typeof result.total, 'number');
});
