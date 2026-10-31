import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { env, isProd } from '../env.js';
import { COOKIE_NAME, requireUser, sessionCookieOptions } from '../auth.js';
import {
  authorizeUrl,
  devLoginEnabled,
  discordAccent,
  discordAvatarUrl,
  discordBannerUrl,
  discordEnabled,
  fetchDiscordUser,
} from '../discord.js';
import { isWhitelisted, loginWithDiscord, toPrivate, type UserRow } from '../users.js';

const STATE_COOKIE = 'ag_oauth_state';
// Guarda para onde voltar depois do Discord (ex.: "Sincronizar" no painel)
const NEXT_COOKIE = 'ag_oauth_next';
const oauthCookie = { path: '/', httpOnly: true, sameSite: 'lax', secure: isProd, maxAge: 600 } as const;
const limit = (max: number) => ({ config: { rateLimit: { max, timeWindow: '1 minute' } } });

const sameState = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export default async function authRoutes(app: FastifyInstance) {
  const fail = (reply: FastifyReply, code: string) =>
    reply.redirect(`${env.WEB_URL}/login?erro=${code}`);

  // Depois do login: perfil novo (ou ainda sem whitelist) vai para o painel, quem já tem link vai para o próprio perfil
  const startSession = (reply: FastifyReply, user: UserRow, created: boolean, back = false) => {
    const token = app.jwt.sign({ id: user.id }, { expiresIn: '30d' });
    reply.setCookie(COOKIE_NAME, token, sessionCookieOptions(isProd));
    const to = back ? '/painel#discord' : created || !isWhitelisted(user) ? '/painel' : `/${user.username}`;
    return reply.redirect(`${env.WEB_URL}${to}`);
  };

  app.get('/auth/config', async () => ({ discord: discordEnabled, dev: devLoginEnabled }));

  app.get<{ Querystring: { next?: string } }>('/auth/discord', limit(20), async (req, reply) => {
    if (!discordEnabled) return fail(reply, 'indisponivel');

    const state = randomBytes(16).toString('hex');
    reply.setCookie(STATE_COOKIE, state, oauthCookie);
    // Só aceita o destino conhecido, nunca uma URL vinda da query
    if (req.query.next === 'painel') reply.setCookie(NEXT_COOKIE, 'painel', oauthCookie);
    return reply.redirect(authorizeUrl(state));
  });

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    '/auth/discord/callback',
    limit(20),
    async (req, reply) => {
      const expected = req.cookies[STATE_COOKIE];
      const back = req.cookies[NEXT_COOKIE] === 'painel';
      reply.clearCookie(STATE_COOKIE, { path: '/' });
      reply.clearCookie(NEXT_COOKIE, { path: '/' });

      if (req.query.error) return fail(reply, 'cancelado');
      const { code, state } = req.query;
      if (!discordEnabled || !code || !state || !expected || !sameState(state, expected)) {
        return fail(reply, 'invalido');
      }

      try {
        const d = await fetchDiscordUser(code);
        const { user, created } = await loginWithDiscord({
          id: d.id,
          handle: d.username,
          displayName: d.global_name || d.username,
          avatarUrl: discordAvatarUrl(d),
          bannerUrl: discordBannerUrl(d),
          accent: discordAccent(d),
        });
        return startSession(reply, user, created, back && !created);
      } catch (err) {
        req.log.error(err, 'falha no login com Discord');
        return fail(reply, 'falha');
      }
    },
  );

  // Só em desenvolvimento e sem app Discord configurado: simula um login para testar o site
  app.get<{ Querystring: { name?: string } }>('/auth/dev-login', limit(20), async (req, reply) => {
    if (!devLoginEnabled) return reply.code(404).send({ error: 'Não encontrado' });

    const name = (req.query.name ?? '').trim().slice(0, 20) || 'dev';
    const { user, created } = await loginWithDiscord({
      id: `dev:${name.toLowerCase()}`,
      handle: name,
      displayName: name,
      avatarUrl: '',
      bannerUrl: '',
      accent: '',
    });
    return startSession(reply, user, created);
  });

  app.post('/auth/logout', async (_req, reply) => {
    reply.clearCookie(COOKIE_NAME, { path: '/' });
    return reply.code(204).send();
  });

  app.get('/auth/me', { preHandler: requireUser }, async (req) => toPrivate(req.currentUser!));
}
