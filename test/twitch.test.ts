import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { TWITCH_LOGIN, TwitchError, fetchLive, fetchSnapshot, findByLogin } from '../src/twitch.ts';

const creds = { clientId: 'cid', clientSecret: 'sec' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const user = {
  id: '141981764', login: 'twitchdev', display_name: 'TwitchDev', profile_image_url: 'https://static-cdn.jtvnw.net/x.png',
  description: 'avenue-abcd1234', broadcaster_type: 'partner', created_at: '2016-12-14T20:32:28Z',
};

/** Responde o token e deixa cada teste decidir o que a Helix devolve. */
function twitch(helix: (url: string) => Response) {
  const calls: string[] = [];
  mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push(u);
    if (u.startsWith('https://id.twitch.tv/')) return json({ access_token: `tok${calls.length}`, expires_in: 3600 });
    assert.equal((init?.headers as Record<string, string>)['Client-Id'], 'cid');
    assert.match((init?.headers as Record<string, string>).Authorization!, /^Bearer tok/);
    return helix(u);
  });
  return calls;
}

afterEach(() => mock.restoreAll());

describe('twitch', () => {
  it('só aceita nome de canal de 4 a 25 letras, números ou _', () => {
    for (const ok of ['abcd', 'Some_User9', 'a'.repeat(25)]) assert.ok(TWITCH_LOGIN.test(ok), ok);
    for (const bad of ['abc', 'a'.repeat(26), 'com espaço', 'a/../b', 'nome?x=1']) assert.ok(!TWITCH_LOGIN.test(bad), bad);
  });

  it('acha o canal pelo nome, escapa o que é enviado e devolve null quando não existe', async () => {
    const calls = twitch(() => json({ data: [user] }));
    const s = await findByLogin('twitchdev', creds);
    assert.deepEqual(s, {
      id: '141981764', login: 'twitchdev', displayName: 'TwitchDev', avatarUrl: 'https://static-cdn.jtvnw.net/x.png',
      description: 'avenue-abcd1234', broadcasterType: 'partner', created: '2016-12-14T20:32:28Z',
    });
    assert.ok(calls.some((c) => c.endsWith('/helix/users?login=twitchdev')));

    mock.restoreAll();
    twitch(() => json({ data: [] }));
    assert.equal(await findByLogin('ninguem_aqui', creds), null);
  });

  it('só aceita avatar em HTTPS e ignora tipo de canal desconhecido', async () => {
    twitch(() => json({ data: [{ ...user, id: '5', profile_image_url: 'http://inseguro/x.png', broadcaster_type: 'whatever' }] }));
    const s = await fetchSnapshot('5', creds);
    assert.equal(s.avatarUrl, '');
    assert.equal(s.broadcasterType, '');
  });

  it('reconhece canal ao vivo e offline', async () => {
    twitch(() => json({ data: [{ type: 'live', game_name: 'VALORANT', title: 'Ranked', viewer_count: 42, started_at: '2026-10-31T10:00:00Z' }] }));
    assert.deepEqual(await fetchLive('201', creds), { live: true, game: 'VALORANT', title: 'Ranked', viewers: 42, startedAt: '2026-10-31T10:00:00Z' });

    mock.restoreAll();
    twitch(() => json({ data: [] }));
    assert.deepEqual(await fetchLive('202', creds), { live: false });
  });

  it('pede outro token uma vez se o atual for recusado', async () => {
    let helixCalls = 0;
    twitch(() => (++helixCalls === 1 ? json({}, 401) : json({ data: [user] })));
    assert.equal((await fetchSnapshot('141981764', creds)).login, 'twitchdev');
    assert.equal(helixCalls, 2);
  });

  it('traduz a falha da Twitch', async () => {
    twitch(() => json({}, 429));
    await assert.rejects(fetchSnapshot('9', creds), (e: Error) => e instanceof TwitchError && /esperar/.test(e.message));
  });
});
