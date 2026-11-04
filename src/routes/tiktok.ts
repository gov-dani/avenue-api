import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { requireWhitelisted } from '../auth.js';
import { env, isProd } from '../env.js';
import { queryOne, run } from '../db.js';
import { authorizeUrl, exchangeCode, fetchProfile, revoke, tiktokEnabled, TikTokError } from '../tiktok.js';
import { forgetVideo, latestVideo, saveTokens } from '../tiktok-store.js';
import { findById, findByUsername, isWhitelisted, toPrivate } from '../users.js';

const STATE_COOKIE = 'ag_tiktok_state';
const stateCookie = { path: '/', httpOnly: true, sameSite: 'lax', secure: isProd, maxAge: 600 } as const;
const limit = (max: number) => ({ config: { rateLimit: { max, timeWindow: '1 minute' } } });
const sameState = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export default async function tiktokRoutes(app: FastifyInstance) {
  // Volta para a aba do TikTok no painel; o parâmetro `tiktok` diz o resultado
  const back = (reply: FastifyReply, result: string) => reply.redirect(`${env.WEB_URL}/painel?tiktok=${result}#tiktok`);

  // Último vídeo da conta. Público, como o resto do perfil
  app.get<{ Params: { username: string } }>('/profiles/:username/tiktok', limit(60), async (req, reply) => {
    const user = await findByUsername(req.params.username);
    if (!tiktokEnabled || !user || !isWhitelisted(user) || !user.tiktok_open_id) return reply.code(404).send({ error: 'Sem TikTok' });
    try {
      return { video: await latestVideo(user.id) };
    } catch (err) {
      if (err instanceof TikTokError) return { video: null };
      throw err;
    }
  });

  // Passo 1: manda a pessoa para o login do TikTok (navegação normal, não fetch)
  app.get('/me/tiktok/connect', { preHandler: requireWhitelisted, ...limit(10) }, async (_req, reply) => {
    if (!tiktokEnabled) return back(reply, 'indisponivel');
    const state = randomBytes(16).toString('hex');
    reply.setCookie(STATE_COOKIE, state, stateCookie);
    return reply.redirect(authorizeUrl(state));
  });

  // Passo 2: o TikTok devolve a pessoa aqui com um code; troca por tokens e guarda a conta
  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    '/me/tiktok/callback',
    { preHandler: requireWhitelisted, ...limit(20) },
    async (req, reply) => {
      const expected = req.cookies[STATE_COOKIE];
      reply.clearCookie(STATE_COOKIE, { path: '/' });

      if (req.query.error) return back(reply, 'cancelado');
      const { code, state } = req.query;
      if (!tiktokEnabled || !code || !state || !expected || !sameState(state, expected)) return back(reply, 'invalido');

      const userId = req.currentUser!.id;
      try {
        const tokens = await exchangeCode(code);
        const taken = await queryOne('SELECT 1 FROM user_tiktok WHERE open_id = ? AND user_id != ?', [tokens.openId, userId]);
        if (taken) {
          await revoke(tokens.accessToken);
          return back(reply, 'em-uso');
        }
        const profile = await fetchProfile(tokens.accessToken);

        await run(
          `INSERT INTO user_tiktok (user_id, open_id, username, display_name, access_token, refresh_token, access_expires_at, refresh_expires_at)
           VALUES (?, ?, ?, ?, '', '', UTC_TIMESTAMP(), UTC_TIMESTAMP())
           ON DUPLICATE KEY UPDATE open_id = VALUES(open_id), username = VALUES(username), display_name = VALUES(display_name)`,
          [userId, tokens.openId, profile.username, profile.displayName],
        );
        await saveTokens(userId, tokens);
        forgetVideo(userId);
        return back(reply, 'ok');
      } catch (err) {
        // 1062 = outro perfil vinculou essa mesma conta no meio tempo
        if ((err as { errno?: number }).errno === 1062) return back(reply, 'em-uso');
        req.log.error(err, 'falha ao vincular o TikTok');
        return back(reply, 'falha');
      }
    },
  );

  app.delete('/me/tiktok', { preHandler: requireWhitelisted, ...limit(10) }, async (req) => {
    const userId = req.currentUser!.id;
    const row = await queryOne<{ access_token: string }>('SELECT access_token FROM user_tiktok WHERE user_id = ?', [userId]);
    await run('DELETE FROM user_tiktok WHERE user_id = ?', [userId]);
    forgetVideo(userId);
    if (row?.access_token) await revoke(row.access_token);
    return toPrivate((await findById(userId))!);
  });
}
