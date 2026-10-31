import type { FastifyInstance } from 'fastify';
import { publicRole } from '../badges.js';
import { membersQuerySchema } from '../schemas.js';
import { ROLE_RANK, WHITELISTED_SQL, listUsers, toCard } from '../users.js';

export default async function factionRoutes(app: FastifyInstance) {
  app.get('/faction/members', async (req, reply) => {
    const parsed = membersQuerySchema.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: 'Filtro inválido' });
    const { q, role } = parsed.data;

    const rows = await listUsers(`u.role != 'visitante' AND ${WHITELISTED_SQL}`);

    const needle = q?.toLowerCase();
    return rows
      .filter((u) => !role || publicRole(u) === role)
      .filter(
        (u) =>
          !needle ||
          u.username.toLowerCase().includes(needle) ||
          u.display_name.toLowerCase().includes(needle),
      )
      .sort(
        (a, b) =>
          ROLE_RANK[publicRole(b)] - ROLE_RANK[publicRole(a)] || a.display_name.localeCompare(b.display_name),
      )
      .map(toCard);
  });

  // Perfis mais visitados. Quem escondeu a contagem não entra no ranking.
  app.get('/ranking', async () => {
    const rows = await listUsers(
      `${WHITELISTED_SQL} AND p.show_views = 1 AND u.views > 0`,
      'u.views DESC, u.id',
    );
    return rows.slice(0, 10).map((u) => ({ ...toCard(u), views: u.views }));
  });
}
