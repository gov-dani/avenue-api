import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { env } from '../env.js';
import { queryOne, run } from '../db.js';
import { requireWhitelisted } from '../auth.js';
import { profileSchema } from '../schemas.js';
import { fetchActivity } from '../presence.js';
import { refreshIfStale } from '../roblox-store.js';
import { refreshIfStale as refreshValorant } from '../valorant-store.js';
import { WHITELISTED_SQL, applySync, findById, findByUsername, isLinked, isWhitelisted, saveProfile, toPrivate, toPublic } from '../users.js';

const VIEW_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_NEW_VIEWS_PER_HOUR = 300;

/** IPv4 inteiro; IPv6 só pelo /64, já que uma pessoa controla o bloco todo e giraria o final à vontade. */
function ipKey(ip: string): string {
  const v4 = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (v4) return v4[1]!;
  if (!ip.includes(':')) return ip;
  const [head = '', tail = ''] = ip.split('::');
  const groups = head ? head.split(':') : [];
  if (ip.includes('::')) {
    const rest = tail ? tail.split(':') : [];
    while (groups.length + rest.length < 8) groups.push('0');
    groups.push(...rest);
  }
  return groups.slice(0, 4).map((g) => g.toLowerCase().replace(/^0+(?=.)/, '')).join(':');
}

export default async function profileRoutes(app: FastifyInstance) {
  app.get<{ Params: { username: string } }>('/profiles/:username', async (req, reply) => {
    const user = await findByUsername(req.params.username);
    if (!user || !isWhitelisted(user)) return reply.code(404).send({ error: 'Perfil não encontrado' });
    // Dados do Roblox se atualizam sozinhos de tempos em tempos, sem fazer a visita esperar
    if (user.roblox_id) refreshIfStale(user.id, user.roblox_id).catch((err) => req.log.warn({ err }, 'roblox refresh'));
    if (user.valorant_name) refreshValorant(user.id, user.valorant_name, user.valorant_tag).catch((err) => req.log.warn({ err }, 'valorant refresh'));
    return toPublic(user);
  });

  // Chamado pelo navegador, para não contar prefetch/bots do SSR.
  // Cada visitante conta uma vez a cada 24h; o dono do perfil nunca conta.
  // Quem está logado conta pela conta (trocar de IP/navegador não rende outra view);
  // anônimo conta pelo IP (sem User-Agent, que é trivial de variar).
  app.post<{ Params: { username: string } }>(
    '/profiles/:username/view',
    { config: { rateLimit: { max: 40, timeWindow: '1 hour' } } },
    async (req, reply) => {
      const user = await findByUsername(req.params.username);
      if (!user || !isWhitelisted(user)) return reply.code(204).send();

      const viewer = await req.jwtVerify<{ id: number }>().catch(() => null);
      if (viewer?.id === user.id) return reply.code(204).send();

      const identity = viewer?.id ? `u:${viewer.id}` : `ip:${ipKey(req.ip)}`;
      const visitor = createHash('sha256').update(`${env.JWT_SECRET}|${identity}`).digest('hex').slice(0, 32);
      const now = Date.now();

      // Mesmo que alguém consiga muitos IPs, o perfil não ganha mais que isso por hora
      const recent = await queryOne<{ n: number }>(
        'SELECT COUNT(*) AS n FROM profile_views WHERE user_id = ? AND viewed_at > ?',
        [user.id, now - 60 * 60 * 1000],
      );
      if (Number(recent?.n ?? 0) >= MAX_NEW_VIEWS_PER_HOUR) return reply.code(204).send();

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
       FROM users u WHERE ${WHITELISTED_SQL}`,
    ))!;
    return { profiles: Number(row.profiles), members: Number(row.members ?? 0) };
  });
}
