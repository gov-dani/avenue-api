import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireWhitelisted } from '../auth.js';
import { env } from '../env.js';
import { run } from '../db.js';
import { findById, toPrivate } from '../users.js';
import { ValorantError, fetchSnapshot, parseRiotId } from '../valorant.js';
import { saveSnapshot } from '../valorant-store.js';

const bodySchema = z.object({ riotId: z.string().trim().min(1, 'Informe seu Riot ID').max(40) });
const limit = (max: number) => ({ config: { rateLimit: { max, timeWindow: '1 minute' } } });

export default async function valorantRoutes(app: FastifyInstance) {
  const me = async (id: number) => toPrivate((await findById(id))!);

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ValorantError) return reply.code(err.notFound ? 404 : 502).send({ error: err.message });
    reply.send(err);
  });

  // Salva o Riot ID. Com chave da HenrikDev, confere que existe e já traz o rank
  app.put('/me/valorant', { preHandler: requireWhitelisted, ...limit(10) }, async (req, reply) => {
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]!.message });
    const id = parseRiotId(parsed.data.riotId);
    if ('error' in id) return reply.code(400).send({ error: id.error });

    const userId = req.currentUser!.id;
    // Consulta antes de gravar: Riot ID que não existe não entra
    const snap = env.HENRIK_API_KEY ? await fetchSnapshot(id.name, id.tag, env.HENRIK_API_KEY) : null;

    await run(
      `INSERT INTO user_valorant (user_id, name, tag) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE name = VALUES(name), tag = VALUES(tag), region = '', level = 0, card_url = '',
         tier = '', tier_id = 0, rr = 0, peak_tier = '', peak_tier_id = 0, synced_at = NULL`,
      [userId, id.name, id.tag],
    );
    if (snap) await saveSnapshot(userId, snap);
    return me(userId);
  });

  app.post('/me/valorant/refresh', { preHandler: requireWhitelisted, ...limit(6) }, async (req, reply) => {
    const u = req.currentUser!;
    if (!u.valorant_name) return reply.code(409).send({ error: 'Nenhum Riot ID informado' });
    if (!env.HENRIK_API_KEY) return reply.code(409).send({ error: 'O rank automático não está ligado neste site' });
    await saveSnapshot(u.id, await fetchSnapshot(u.valorant_name, u.valorant_tag, env.HENRIK_API_KEY));
    return me(u.id);
  });

  app.delete('/me/valorant', { preHandler: requireWhitelisted, ...limit(10) }, async (req) => {
    await run('DELETE FROM user_valorant WHERE user_id = ?', [req.currentUser!.id]);
    return me(req.currentUser!.id);
  });
}
