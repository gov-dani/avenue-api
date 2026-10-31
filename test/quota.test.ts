import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createQuota } from '../src/quota.ts';

test('limita a quantidade de envios por usuário', () => {
  const q = createQuota(2, 1000);
  assert.ok(q.take(1, 10));
  assert.ok(q.take(1, 10));
  assert.equal(q.take(1, 10), false);
  assert.ok(q.take(2, 10), 'outro usuário não é afetado');
});

test('limita o total de bytes', () => {
  const q = createQuota(10, 100);
  assert.ok(q.take(1, 80));
  assert.equal(q.take(1, 30), false);
});

test('devolve a reserva quando o envio falha', () => {
  const q = createQuota(1, 100);
  assert.ok(q.take(1, 50));
  q.refund(1, 50);
  assert.ok(q.take(1, 50));
});

test('a janela reinicia com o tempo', () => {
  let t = 0;
  const q = createQuota(1, 100, 1000, () => t);
  assert.ok(q.take(1, 10));
  assert.equal(q.take(1, 10), false);
  t = 1001;
  assert.ok(q.take(1, 10));
});
