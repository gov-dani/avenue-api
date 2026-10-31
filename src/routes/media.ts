import { randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { requireUser } from '../auth.js';
import { env } from '../env.js';

type Kind = 'image' | 'audio';
const LIMIT: Record<Kind, number> = { image: 5 * 1024 * 1024, audio: 10 * 1024 * 1024 };

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
};

/** Descobre o tipo real pelo conteúdo; o que o cliente declara não é confiável. */
function sniff(b: Buffer): { ext: string; kind: Kind } | null {
  const at = (s: string, o = 0) => b.subarray(o, o + s.length).toString('latin1') === s;
  if (b.length < 12) return null;
  if (b[0] === 0x89 && at('PNG', 1)) return { ext: 'png', kind: 'image' };
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: 'jpg', kind: 'image' };
  if (at('GIF8')) return { ext: 'gif', kind: 'image' };
  if (at('RIFF') && at('WEBP', 8)) return { ext: 'webp', kind: 'image' };
  if (at('RIFF') && at('WAVE', 8)) return { ext: 'wav', kind: 'audio' };
  if (at('OggS')) return { ext: 'ogg', kind: 'audio' };
  if (at('ID3') || (b[0] === 0xff && (b[1]! & 0xe0) === 0xe0)) return { ext: 'mp3', kind: 'audio' };
  if (at('ftyp', 4)) return { ext: 'm4a', kind: 'audio' };
  return null;
}

export default async function mediaRoutes(app: FastifyInstance) {
  await mkdir(env.UPLOAD_DIR, { recursive: true });

  // Corpo bruto (o arquivo em si), sem multipart
  app.addContentTypeParser(/^(image|audio)\//, { parseAs: 'buffer' }, (_req, body, done) => done(null, body));

  app.post<{ Params: { kind: string } }>(
    '/me/upload/:kind',
    {
      preHandler: requireUser,
      bodyLimit: LIMIT.audio,
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const want = req.params.kind as Kind;
      if (want !== 'image' && want !== 'audio') return reply.code(404).send({ error: 'Tipo inválido' });
      if (!Buffer.isBuffer(req.body)) return reply.code(415).send({ error: 'Envie o arquivo' });

      const found = sniff(req.body);
      if (!found || found.kind !== want) {
        return reply.code(415).send({
          error: want === 'image' ? 'Use PNG, JPG, WEBP ou GIF' : 'Use MP3, OGG, WAV ou M4A',
        });
      }
      if (req.body.length > LIMIT[want]) {
        return reply.code(413).send({ error: `Arquivo grande demais (máx. ${LIMIT[want] / 1024 / 1024} MB)` });
      }

      const name = `${randomBytes(16).toString('hex')}.${found.ext}`;
      await writeFile(join(env.UPLOAD_DIR, name), req.body);
      return { url: `/api/media/${name}` };
    },
  );

  // Entrega com suporte a Range, para o navegador conseguir avançar a música
  app.get<{ Params: { file: string } }>('/media/:file', async (req, reply) => {
    const { file } = req.params;
    if (!/^[a-f0-9]{32}\.(png|jpg|gif|webp|mp3|ogg|wav|m4a)$/.test(file)) {
      return reply.code(404).send({ error: 'Não encontrado' });
    }
    const path = join(env.UPLOAD_DIR, file);
    const info = await stat(path).catch(() => null);
    if (!info) return reply.code(404).send({ error: 'Não encontrado' });

    const type = MIME[file.split('.')[1]!]!;
    reply
      .header('Content-Type', type)
      .header('Accept-Ranges', 'bytes')
      .header('Cache-Control', 'public, max-age=31536000, immutable')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cross-Origin-Resource-Policy', 'cross-origin');

    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
    if (range && (range[1] || range[2])) {
      let start = range[1] ? Number(range[1]) : info.size - Number(range[2]);
      let end = range[1] && range[2] ? Number(range[2]) : info.size - 1;
      start = Math.max(0, start);
      end = Math.min(end, info.size - 1);
      if (start > end) return reply.code(416).header('Content-Range', `bytes */${info.size}`).send();
      return reply
        .code(206)
        .header('Content-Range', `bytes ${start}-${end}/${info.size}`)
        .header('Content-Length', end - start + 1)
        .send(createReadStream(path, { start, end }));
    }
    return reply.header('Content-Length', info.size).send(createReadStream(path));
  });
}
