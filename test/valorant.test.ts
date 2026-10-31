import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { ValorantError, fetchSnapshot, parseRiotId, trackerUrl } from '../src/valorant.ts';

const json = (data: unknown, status = 200) => new Response(JSON.stringify({ status, data }), { status });

afterEach(() => mock.restoreAll());

describe('valorant', () => {
  it('lê Nome#TAG e recusa o que não é um Riot ID', () => {
    assert.deepEqual(parseRiotId('Dani Gg#BR1'), { name: 'Dani Gg', tag: 'BR1' });
    assert.deepEqual(parseRiotId('  dani#1234 '), { name: 'dani', tag: '1234' });
    for (const bad of ['dani', '#BR1', 'ab#BR1', 'dani#', 'dani#toolong1', 'dani#br!', 'a/b/c#BR1', 'x'.repeat(17) + '#BR1']) {
      assert.ok('error' in parseRiotId(bad), bad);
    }
  });

  it('monta o link do tracker.gg com o # escapado', () => {
    assert.equal(trackerUrl('Dani Gg', 'BR1'), 'https://tracker.gg/valorant/profile/riot/Dani%20Gg%23BR1/overview');
  });

  it('junta conta e rank, mandando a chave no header', async () => {
    const seen: string[] = [];
    mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
      seen.push(`${url} ${(init?.headers as Record<string, string>).Authorization}`);
      if (String(url).includes('/v2/account/'))
        return json({ region: 'na', account_level: 120, name: 'Dani', tag: 'BR1', card: 'cd3bab1a-412a-807b-bb5c-a48be2fea2a1' });
      return json({ current: { tier: { id: 25, name: 'Immortal 2' }, rr: 45 }, peak: { tier: { id: 26, name: 'Immortal 3' } } });
    });
    const s = await fetchSnapshot('Dani', 'BR1', 'KEY');
    assert.deepEqual(s, {
      name: 'Dani', tag: 'BR1', region: 'na', level: 120, cardUrl: 'https://media.valorant-api.com/playercards/cd3bab1a-412a-807b-bb5c-a48be2fea2a1/smallart.png',
      tier: 'Immortal 2', tierId: 25, rr: 45, peakTier: 'Immortal 3', peakTierId: 26,
    });
    assert.ok(seen.every((l) => l.endsWith(' KEY')));
    assert.ok(seen[1]!.includes('/v3/mmr/na/pc/Dani/BR1'));
  });

  it('segue sem rank se o MMR falhar ou a conta for unranked', async () => {
    mock.method(globalThis, 'fetch', async (url: string | URL | Request) =>
      String(url).includes('/v2/account/') ? json({ region: 'eu', account_level: 5, name: 'a', tag: 'b12', card: 'http://inseguro/x.png' }) : json({}, 500),
    );
    const s = await fetchSnapshot('abc', 'b12', 'KEY');
    assert.equal(s.tier, '');
    assert.equal(s.tierId, 0);
    assert.equal(s.cardUrl, '');
    assert.equal(s.level, 5);
  });

  it('404 vira "não achei" e 429 pede para esperar', async () => {
    mock.method(globalThis, 'fetch', async () => json({}, 404));
    await assert.rejects(fetchSnapshot('abc', 'b12', 'K'), (e: ValorantError) => e.notFound && /Não achei/.test(e.message));

    mock.method(globalThis, 'fetch', async () => json({}, 429));
    await assert.rejects(fetchSnapshot('abc', 'b12', 'K'), /esperar/);
  });
});
