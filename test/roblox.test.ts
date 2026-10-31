import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { ROBLOX_NAME, RobloxError, fetchSnapshot, findByName, newCode } from '../src/roblox.ts';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

afterEach(() => mock.restoreAll());

describe('roblox', () => {
  it('só aceita @ de 3 a 20 letras, números ou _', () => {
    for (const ok of ['abc', 'Some_User9', 'a'.repeat(20)]) assert.ok(ROBLOX_NAME.test(ok), ok);
    for (const bad of ['ab', 'a'.repeat(21), 'com espaço', 'a/../b', 'nome?x=1']) assert.ok(!ROBLOX_NAME.test(bad), bad);
  });

  it('gera um código diferente a cada vez', () => {
    const a = newCode();
    assert.match(a, /^avenue-[0-9a-f]{8}$/);
    assert.notEqual(a, newCode());
  });

  it('acha a conta pelo nome e devolve null quando não existe', async () => {
    mock.method(globalThis, 'fetch', async () => json({ data: [{ id: 1, name: 'Roblox', displayName: 'Roblox' }] }));
    assert.deepEqual(await findByName('Roblox'), { id: '1', name: 'Roblox', displayName: 'Roblox' });

    mock.method(globalThis, 'fetch', async () => json({ data: [] }));
    assert.equal(await findByName('ninguem_aqui'), null);
  });

  it('monta o snapshot e segue sem avatar e contagens se eles falharem', async () => {
    mock.method(globalThis, 'fetch', async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes('/v1/users/7')) return json({ name: 'dani', displayName: 'Dani', description: 'avenue-abcd1234', created: '2020-01-01T00:00:00Z', isBanned: false });
      return json({}, 500);
    });
    const s = await fetchSnapshot('7');
    assert.equal(s.name, 'dani');
    assert.equal(s.description, 'avenue-abcd1234');
    assert.equal(s.avatarUrl, '');
    assert.equal(s.friends, 0);
  });

  it('recusa conta banida e traduz a falha do Roblox', async () => {
    mock.method(globalThis, 'fetch', async () => json({ name: 'x', displayName: 'x', description: '', created: '', isBanned: true }));
    await assert.rejects(fetchSnapshot('9'), RobloxError);

    mock.method(globalThis, 'fetch', async () => json({}, 429));
    await assert.rejects(findByName('abc'), /esperar/);
  });
});
