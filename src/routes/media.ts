import { randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { requireWhitelisted } from '../auth.js';
import { env } from '../env.js';
import { fivemanageEnabled, uploadImage } from '../fivemanage.js';
import { uploadQuota } from '../quota.js';
import { LIMIT, MIME, sniff, type Kind } from '../sniff.js';

export default async function mediaRoutes(app: FastifyInstance) {
  await mkdir(env.UPLOAD_DIR, { recursive: true });

  // Corpo bruto (o arquivo em si), sem multipart
  app.addContentTypeParser(/^(image|audio)\//, { parseAs: 'buffer' }, (_req, body, done) => done(null, body));

  app.post<{ Params: { kind: string } }>(
    '/me/upload/:kind',
    {
      preHandler: requireWhitelisted,
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

      const userId = req.currentUser!.id;
      if (!uploadQuota.take(userId, req.body.length)) {
        return reply.code(429).send({ error: 'Limite de envios por hora atingido. Tente mais tarde.' });
      }

      try {
        // Imagens vão para o Fivemanage; áudio (e dev sem chave) fica no disco da VPS
        if (want === 'image' && fivemanageEnabled) {
          return { url: await uploadImage(req.body, found.ext, MIME[found.ext]!) };
        }
        const name = `${randomBytes(16).toString('hex')}.${found.ext}`;
        await writeFile(join(env.UPLOAD_DIR, name), req.body);
        return { url: `/api/media/${name}` };
      } catch (err) {
        uploadQuota.refund(userId, req.body.length);
        req.log.error(err, 'falha ao salvar o arquivo enviado');
        return reply.code(502).send({ error: 'Não foi possível salvar o arquivo. Tente de novo.' });
      }
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
