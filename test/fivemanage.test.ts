import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.FIVEMANAGE_API_KEY = 'chave-de-teste';
const { uploadImage } = await import('../src/fivemanage.ts');

const reply = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;

test('envia com a chave e devolve a url', async () => {
  let seen: RequestInit | undefined;
  const fake = (async (_u: string, init: RequestInit) => {
    seen = init;
    return new Response(JSON.stringify({ id: '1', url: 'https://r2.fivemanage.com/x.png' }));
  }) as unknown as typeof fetch;
  assert.equal(await uploadImage(Buffer.alloc(20), 'png', 'image/png', fake), 'https://r2.fivemanage.com/x.png');
  assert.equal((seen!.headers as Record<string, string>).Authorization, 'chave-de-teste');
});

test('aceita a resposta embrulhada em data', async () => {
  const url = await uploadImage(Buffer.alloc(20), 'png', 'image/png', reply(200, { data: { url: 'https://r2.fivemanage.com/y.png' }, status: 'ok' }));
  assert.equal(url, 'https://r2.fivemanage.com/y.png');
});

test('falha quando o Fivemanage recusa ou devolve url estranha', async () => {
  await assert.rejects(uploadImage(Buffer.alloc(20), 'png', 'image/png', reply(401, { error: 'x' })));
  await assert.rejects(uploadImage(Buffer.alloc(20), 'png', 'image/png', reply(200, { url: 'javascript:alert(1)' })));
});
