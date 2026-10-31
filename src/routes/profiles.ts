import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { env } from '../env.js';
import { queryOne, run } from '../db.js';
import { requireUser } from '../auth.js';
import { profileSchema } from '../schemas.js';
import { fetchActivity } from '../presence.js';
import { applySync, findById, findByUsername, isLinked, toPrivate, toPublic } from '../users.js';

const VIEW_WINDOW_MS = 24 * 60 * 60 * 1000;

export default async function profileRoutes(app: FastifyInstance) {
  app.get<{ Params: { username: string } }>('/profiles/:username', async (req, reply) => {
    const user = await findByUsername(req.params.username);
    if (!user) return reply.code(404).send({ error: 'Perfil não encontrado' });
    return toPublic(user);
  });

  // Chamado pelo navegador, para não contar prefetch/bots do SSR.
  // Cada visitante conta uma vez a cada 24h; o dono do perfil nunca conta.
  app.post<{ Params: { username: string } }>(
    '/profiles/:username/view',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const user = await findByUsername(req.params.username);
      if (!user) return reply.code(204).send();

      const viewer = await req.jwtVerify<{ id: number }>().catch(() => null);
      if (viewer?.id === user.id) return reply.code(204).send();

      const visitor = createHash('sha256')
        .update(`${env.JWT_SECRET}|${req.ip}|${req.headers['user-agent'] ?? ''}`)
        .digest('hex')
        .slice(0, 32);
      const now = Date.now();

      // Insere ou renova o registro só se o último for de mais de 24h; mudou alguma linha = visita nova
      const res = await run(
        `INSERT INTO profile_views (user_id, visitor, viewed_at) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE viewed_at = IF(viewed_at < ?, VALUES(viewed_at), viewed_at)`,
        [user.id, visitor, now, now - VIEW_WINDOW_MS],
      );

      if (res.affectedRows > 0) await run('UPDATE users SET views = views + 1 WHERE id = ?', [user.id]);
      return reply.code(204).send();
    },
  );

  app.put('/me/profile', { preHandler: requireUser }, async (req, reply) => {
    const parsed = profileSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]!.message });
    const p = parsed.data;

    // Conta sem Discord de verdade (atalho de dev) não tem o que sincronizar
    const linked = isLinked(req.currentUser!);
    await run(
      `UPDATE users SET display_name = ?, bio = ?, avatar_url = ?, banner_url = ?, music_url = ?, music_title = ?, avatar_decoration = ?, discord = ?,
         links = ?, games = ?, gear = ?,
         sync_avatar = ?, sync_banner = ?, sync_name = ?, show_activity = ? WHERE id = ?`,
      [
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
      ],
    );
    // O que está marcado para acompanhar o Discord vale mais que o texto enviado
    await applySync(req.currentUser!.id);
    return toPrivate((await findById(req.currentUser!.id))!);
  });

  // O que a pessoa está jogando/ouvindo agora. Fica separado do perfil para a página
  // carregar rápido e a presença atualizar sozinha.
  app.get<{ Params: { username: string } }>(
    '/profiles/:username/activity',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const user = await findByUsername(req.params.username);
      if (!user || !user.show_activity || !isLinked(user)) return reply.code(404).send({ error: 'Sem atividade' });
      return fetchActivity(user.discord_id);
    },
  );

  app.get('/stats', async () => {
    // SUM volta como texto (DECIMAL) no MySQL
    const row = (await queryOne<{ profiles: number; members: string | null }>(
      `SELECT COUNT(*) AS profiles,
              SUM(CASE WHEN role != 'visitante' THEN 1 ELSE 0 END) AS members
       FROM users`,
    ))!;
    return { profiles: Number(row.profiles), members: Number(row.members ?? 0) };
  });
}
