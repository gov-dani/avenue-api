import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { requireWhitelisted } from '../auth.js';
import { queryOne, run } from '../db.js';
import { newCode } from '../roblox.js';
import { TWITCH_LOGIN, TwitchError, fetchLive, fetchSnapshot, findByLogin } from '../twitch.js';
import { saveSnapshot, twitchCredentials } from '../twitch-store.js';
import { findById, findByUsername, isWhitelisted, toPrivate } from '../users.js';

const startSchema = z.object({
  login: z.string().trim().regex(TWITCH_LOGIN, 'Use o nome do canal: de 4 a 25 letras, números ou _'),
});

const limit = (max: number) => ({ config: { rateLimit: { max, timeWindow: '1 minute' } } });
const notConfigured = (reply: FastifyReply) => reply.code(503).send({ error: 'A Twitch ainda não foi configurada neste site' });

export default async function twitchRoutes(app: FastifyInstance) {
  const me = async (id: number) => toPrivate((await findById(id))!);

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof TwitchError) return reply.code(502).send({ error: err.message });
    reply.send(err);
  });

  // Se o canal está ao vivo agora. Público, como o resto do perfil
  app.get<{ Params: { username: string } }>('/profiles/:username/twitch', limit(60), async (req, reply) => {
    const creds = twitchCredentials();
    const user = await findByUsername(req.params.username);
    if (!creds || !user || !isWhitelisted(user) || !user.twitch_id) return reply.code(404).send({ error: 'Sem Twitch' });
    return fetchLive(user.twitch_id, creds);
  });

  // Passo 1: a pessoa diz qual canal é o dela e recebe um código para colar na bio do canal
  app.post('/me/twitch/start', { preHandler: requireWhitelisted, ...limit(10) }, async (req, reply) => {
    const creds = twitchCredentials();
    if (!creds) return notConfigured(reply);
    const parsed = startSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]!.message });

    const found = await findByLogin(parsed.data.login, creds);
    if (!found) return reply.code(404).send({ error: 'Não achei esse canal na Twitch' });

    const taken = await queryOne('SELECT 1 FROM user_twitch WHERE twitch_id = ? AND user_id != ?', [found.id, req.currentUser!.id]);
    if (taken) return reply.code(409).send({ error: 'Esse canal da Twitch já está vinculado a outro perfil' });

    await run(
      `INSERT INTO user_twitch (user_id, pending_id, pending_login, pending_code, pending_at)
       VALUES (?, ?, ?, ?, UTC_TIMESTAMP())
       ON DUPLICATE KEY UPDATE pending_id = VALUES(pending_id), pending_login = VALUES(pending_login),
         pending_code = VALUES(pending_code), pending_at = VALUES(pending_at)`,
      [req.currentUser!.id, found.id, found.login, newCode()],
    );
    return me(req.currentUser!.id);
  });

  // Passo 2: lê a bio do canal e confere se o código está lá
  app.post('/me/twitch/verify', { preHandler: requireWhitelisted, ...limit(10) }, async (req, reply) => {
    const creds = twitchCredentials();
    if (!creds) return notConfigured(reply);
    const user = req.currentUser!;
    const pending = (await me(user.id)).twitchPending;
    const row = await queryOne<{ pending_id: string | null }>('SELECT pending_id FROM user_twitch WHERE user_id = ?', [user.id]);
    if (!pending || !row?.pending_id) return reply.code(409).send({ error: 'Nenhum vínculo em andamento (o código vale 30 minutos). Comece de novo.' });

    const snap = await fetchSnapshot(row.pending_id, creds);
    if (!snap.description.includes(pending.code)) {
      return reply.code(422).send({ error: 'Não encontrei o código na bio do canal. Salve a bio na Twitch e tente de novo.' });
    }

    try {
      await run(
        `UPDATE user_twitch SET twitch_id = pending_id, pending_id = NULL, pending_login = '', pending_code = '', pending_at = NULL
         WHERE user_id = ?`,
        [user.id],
      );
    } catch (err) {
      // 1062 = outro perfil verificou esse mesmo canal no meio tempo
      if ((err as { errno?: number }).errno === 1062) return reply.code(409).send({ error: 'Esse canal da Twitch já está vinculado a outro perfil' });
      throw err;
    }
    await saveSnapshot(user.id, snap);
    return me(user.id);
  });

  app.post('/me/twitch/refresh', { preHandler: requireWhitelisted, ...limit(6) }, async (req, reply) => {
    const creds = twitchCredentials();
    if (!creds) return notConfigured(reply);
    const user = req.currentUser!;
    if (!user.twitch_id) return reply.code(409).send({ error: 'Nenhum canal da Twitch vinculado' });
    await saveSnapshot(user.id, await fetchSnapshot(user.twitch_id, creds));
    return me(user.id);
  });

  app.delete('/me/twitch', { preHandler: requireWhitelisted, ...limit(10) }, async (req) => {
    await run('DELETE FROM user_twitch WHERE user_id = ?', [req.currentUser!.id]);
    return me(req.currentUser!.id);
  });
}
