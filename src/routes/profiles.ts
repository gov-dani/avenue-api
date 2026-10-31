import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { env } from '../env.js';
import { db } from '../db.js';
import { requireUser } from '../auth.js';
import { profileSchema } from '../schemas.js';
import { fetchActivity } from '../presence.js';
import { applySync, findById, findByUsername, isLinked, toPrivate, toPublic } from '../users.js';

const VIEW_WINDOW_MS = 24 * 60 * 60 * 1000;

export default async function profileRoutes(app: FastifyInstance) {
  app.get<{ Params: { username: string } }>('/profiles/:username', async (req, reply) => {
    const user = findByUsername(req.params.username);
    if (!user) return reply.code(404).send({ error: 'Perfil não encontrado' });
    return toPublic(user);
  });

  // Chamado pelo navegador, para não contar prefetch/bots do SSR.
  // Cada visitante conta uma vez a cada 24h; o dono do perfil nunca conta.
  app.post<{ Params: { username: string } }>(
    '/profiles/:username/view',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const user = findByUsername(req.params.username);
      if (!user) return reply.code(204).send();

      const viewer = await req.jwtVerify<{ id: number }>().catch(() => null);
      if (viewer?.id === user.id) return reply.code(204).send();

      const visitor = createHash('sha256')
        .update(`${env.JWT_SECRET}|${req.ip}|${req.headers['user-agent'] ?? ''}`)
        .digest('hex')
        .slice(0, 32);
      const now = Date.now();

      // Insere ou renova o registro só se o último for de mais de 24h; mudou alguma linha = visita nova
      const res = db
        .prepare(
          `INSERT INTO profile_views (user_id, visitor, viewed_at) VALUES (?, ?, ?)
           ON CONFLICT(user_id, visitor) DO UPDATE SET viewed_at = excluded.viewed_at
           WHERE profile_views.viewed_at < ?`,
        )
        .run(user.id, visitor, now, now - VIEW_WINDOW_MS);

      if (res.changes > 0) db.prepare('UPDATE users SET views = views + 1 WHERE id = ?').run(user.id);
      return reply.code(204).send();
    },
  );

  app.put('/me/profile', { preHandler: requireUser }, async (req, reply) => {
    const parsed = profileSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]!.message });
    const p = parsed.data;

    // Conta sem Discord de verdade (atalho de dev) não tem o que sincronizar
    const linked = isLinked(req.currentUser!);
    db.prepare(
      `UPDATE users SET display_name = ?, bio = ?, avatar_url = ?, banner_url = ?, music_url = ?, music_title = ?, avatar_decoration = ?, discord = ?,
         links = ?, games = ?, gear = ?,
         sync_avatar = ?, sync_banner = ?, sync_name = ?, show_activity = ? WHERE id = ?`,
    ).run(
      p.displayName,
      p.bio,
      p.avatarUrl,
      p.bannerUrl,
      p.musicUrl,
      p.musicTitle,
      p.avatarDecoration,
      p.discord,
      JSON.stringify(p.links),
      JSON.stringify(p.games),
      JSON.stringify(p.gear),
      Number(linked && p.syncAvatar),
      Number(linked && p.syncBanner),
      Number(linked && p.syncName),
      Number(p.showActivity),
      req.currentUser!.id,
    );
    // O que está marcado para acompanhar o Discord vale mais que o texto enviado
    applySync(req.currentUser!.id);
    return toPrivate(findById(req.currentUser!.id)!);
  });

  // O que a pessoa está jogando/ouvindo agora. Fica separado do perfil para a página
  // carregar rápido e a presença atualizar sozinha.
  app.get<{ Params: { username: string } }>(
    '/profiles/:username/activity',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const user = findByUsername(req.params.username);
      if (!user || !user.show_activity || !isLinked(user)) return reply.code(404).send({ error: 'Sem atividade' });
      return fetchActivity(user.discord_id);
    },
  );

  app.get('/stats', async () => {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS profiles,
                SUM(CASE WHEN role != 'visitante' THEN 1 ELSE 0 END) AS members
         FROM users`,
      )
      .get() as unknown as { profiles: number; members: number | null };
    return { profiles: row.profiles, members: row.members ?? 0 };
  });
}
