import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sniff } from '../src/sniff.ts';

const pad = (head: number[] | string) =>
  Buffer.concat([typeof head === 'string' ? Buffer.from(head, 'latin1') : Buffer.from(head), Buffer.alloc(16)]);

test('reconhece imagens pelo conteúdo', () => {
  assert.deepEqual(sniff(pad([0x89, 0x50, 0x4e, 0x47])), { ext: 'png', kind: 'image' });
  assert.deepEqual(sniff(pad([0xff, 0xd8, 0xff, 0xe0])), { ext: 'jpg', kind: 'image' });
  assert.deepEqual(sniff(pad('GIF89a')), { ext: 'gif', kind: 'image' });
});

test('reconhece áudio', () => {
  assert.deepEqual(sniff(pad('OggS')), { ext: 'ogg', kind: 'audio' });
  assert.deepEqual(sniff(pad('ID3')), { ext: 'mp3', kind: 'audio' });
});

test('recusa o que não é mídia, mesmo com cara de imagem', () => {
  assert.equal(sniff(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
  assert.equal(sniff(Buffer.from('<script>alert(1)</script>')), null);
  assert.equal(sniff(Buffer.from('MZ\x90\x00 executavel'.padEnd(20))), null);
  assert.equal(sniff(Buffer.alloc(4)), null);
});
