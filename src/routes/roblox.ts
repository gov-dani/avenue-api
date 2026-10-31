import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireWhitelisted } from '../auth.js';
import { queryOne, run } from '../db.js';
import { ROBLOX_NAME, RobloxError, fetchSnapshot, findByName, newCode } from '../roblox.js';
import { saveSnapshot } from '../roblox-store.js';
import { findById, toPrivate } from '../users.js';

const startSchema = z.object({
  username: z.string().trim().regex(ROBLOX_NAME, 'Use o @ do Roblox: de 3 a 20 letras, números ou _'),
});

const limit = (max: number) => ({ config: { rateLimit: { max, timeWindow: '1 minute' } } });

export default async function robloxRoutes(app: FastifyInstance) {
  const me = async (id: number) => toPrivate((await findById(id))!);

  // Quando o Roblox falha, a mensagem dele já vem em português; o resto é erro nosso
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof RobloxError) return reply.code(502).send({ error: err.message });
    reply.send(err);
  });

  // Passo 1: a pessoa diz qual conta é a dela e recebe um código para colar na bio do Roblox
  app.post('/me/roblox/start', { preHandler: requireWhitelisted, ...limit(10) }, async (req, reply) => {
    const parsed = startSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]!.message });

    const found = await findByName(parsed.data.username);
    if (!found) return reply.code(404).send({ error: 'Não achei essa conta no Roblox' });

    const taken = await queryOne('SELECT 1 FROM user_roblox WHERE roblox_id = ? AND user_id != ?', [found.id, req.currentUser!.id]);
    if (taken) return reply.code(409).send({ error: 'Essa conta do Roblox já está vinculada a outro perfil' });

    await run(
      `INSERT INTO user_roblox (user_id, pending_id, pending_username, pending_code, pending_at)
       VALUES (?, ?, ?, ?, UTC_TIMESTAMP())
       ON DUPLICATE KEY UPDATE pending_id = VALUES(pending_id), pending_username = VALUES(pending_username),
         pending_code = VALUES(pending_code), pending_at = VALUES(pending_at)`,
      [req.currentUser!.id, found.id, found.name, newCode()],
    );
    return me(req.currentUser!.id);
  });

  // Passo 2: lê a bio da conta e confere se o código está lá
  app.post('/me/roblox/verify', { preHandler: requireWhitelisted, ...limit(10) }, async (req, reply) => {
    const user = req.currentUser!;
    const pending = (await me(user.id)).robloxPending;
    const row = await queryOne<{ pending_id: string | null }>('SELECT pending_id FROM user_roblox WHERE user_id = ?', [user.id]);
    if (!pending || !row?.pending_id) return reply.code(409).send({ error: 'Nenhum vínculo em andamento (o código vale 30 minutos). Comece de novo.' });

    const snap = await fetchSnapshot(row.pending_id);
    if (!snap.description.includes(pending.code)) {
      return reply.code(422).send({ error: 'Não encontrei o código na bio do Roblox. Salve a bio lá e tente de novo.' });
    }

    try {
      await run(
        `UPDATE user_roblox SET roblox_id = pending_id, pending_id = NULL, pending_username = '', pending_code = '', pending_at = NULL
         WHERE user_id = ?`,
        [user.id],
      );
    } catch (err) {
      // 1062 = outro perfil verificou essa mesma conta no meio tempo
      if ((err as { errno?: number }).errno === 1062) return reply.code(409).send({ error: 'Essa conta do Roblox já está vinculada a outro perfil' });
      throw err;
    }
    await saveSnapshot(user.id, snap);
    return me(user.id);
  });

  // Puxa os dados de novo na hora (nome, avatar, amigos, seguidores)
  app.post('/me/roblox/refresh', { preHandler: requireWhitelisted, ...limit(6) }, async (req, reply) => {
    const user = req.currentUser!;
    if (!user.roblox_id) return reply.code(409).send({ error: 'Nenhuma conta do Roblox vinculada' });
    await saveSnapshot(user.id, await fetchSnapshot(user.roblox_id));
    return me(user.id);
  });

  app.delete('/me/roblox', { preHandler: requireWhitelisted, ...limit(10) }, async (req) => {
    await run('DELETE FROM user_roblox WHERE user_id = ?', [req.currentUser!.id]);
    return me(req.currentUser!.id);
  });
}
