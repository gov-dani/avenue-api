import assert from 'node:assert/strict';
import { test } from 'node:test';
import { profileLevel } from '../src/v2.js';

const DAY = 86_400_000;
const now = Date.parse('2026-11-25T12:00:00Z');
const bornDaysAgo = (d: number) => new Date(now - d * DAY).toISOString().slice(0, 19).replace('T', ' ');

test('conta nova é Novato e falta o caminho até Frequente', () => {
  const l = profileLevel(bornDaysAgo(0), now);
  assert.equal(l.key, 'novato');
  assert.equal(l.tier, 1);
  assert.deepEqual(l.next, { label: 'Frequente', inDays: 7 });
  assert.equal(l.progress, 0);
});

test('sobe de nível nos marcos de dias', () => {
  assert.equal(profileLevel(bornDaysAgo(7), now).key, 'frequente');
  assert.equal(profileLevel(bornDaysAgo(29), now).key, 'frequente');
  assert.equal(profileLevel(bornDaysAgo(30), now).key, 'veterano');
  assert.equal(profileLevel(bornDaysAgo(100), now).key, 'lenda');
  assert.equal(profileLevel(bornDaysAgo(200), now).key, 'imortal');
});

test('último nível não tem próximo', () => {
  const l = profileLevel(bornDaysAgo(900), now);
  assert.equal(l.key, 'eterno');
  assert.equal(l.next, null);
  assert.equal(l.progress, 1);
});

test('data inválida cai em Novato', () => {
  assert.equal(profileLevel('lixo', now).key, 'novato');
});
