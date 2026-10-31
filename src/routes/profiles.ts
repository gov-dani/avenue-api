import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { env } from '../env.js';
import { queryOne, run } from '../db.js';
import { requireWhitelisted } from '../auth.js';
import { profileSchema } from '../schemas.js';
import { fetchActivity } from '../presence.js';
import { applySync, findById, findByUsername, isLinked, isWhitelisted, saveProfile, toPrivate, toPublic } from '../users.js';

const VIEW_WINDOW_MS = 24 * 60 * 60 * 1000;

export default async function profileRoutes(app: FastifyInstance) {
  app.get<{ Params: { username: string } }>('/profiles/:username', async (req, reply) => {
    const user = await findByUsername(req.params.username);
    if (!user || !isWhitelisted(user)) return reply.code(404).send({ error: 'Perfil não encontrado' });
    return toPublic(user);
  });

  // Chamado pelo navegador, para não contar prefetch/bots do SSR.
  // Cada visitante conta uma vez a cada 24h; o dono do perfil nunca conta.
  app.post<{ Params: { username: string } }>(
    '/profiles/:username/view',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const user = await findByUsername(req.params.username);
      if (!user || !isWhitelisted(user)) return reply.code(204).send();

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

  app.put('/me/profile', { preHandler: requireWhitelisted }, async (req, reply) => {
    const parsed = profileSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]!.message });
    const p = parsed.data;

    const linked = isLinked(req.currentUser!);
    await saveProfile(req.currentUser!.id, p, linked);
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
      if (!user || !isWhitelisted(user) || !user.show_activity || !isLinked(user)) return reply.code(404).send({ error: 'Sem atividade' });
      return fetchActivity(user.discord_id);
    },
  );

  app.get('/stats', async () => {
    // SUM volta como texto (DECIMAL) no MySQL
    const row = (await queryOne<{ profiles: number; members: string | null }>(
      `SELECT COUNT(*) AS profiles,
              SUM(CASE WHEN role != 'visitante' THEN 1 ELSE 0 END) AS members
       FROM users WHERE whitelisted = 1`,
    ))!;
    return { profiles: Number(row.profiles), members: Number(row.members ?? 0) };
  });
}
