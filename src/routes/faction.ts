import type { FastifyInstance } from 'fastify';
import { membersQuerySchema } from '../schemas.js';
import { ROLE_RANK, listUsers, toCard } from '../users.js';

export default async function factionRoutes(app: FastifyInstance) {
  app.get('/faction/members', async (req, reply) => {
    const parsed = membersQuerySchema.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: 'Filtro inválido' });
    const { q, role } = parsed.data;

    const rows = await listUsers("u.role != 'visitante'");

    const needle = q?.toLowerCase();
    return rows
      .filter((u) => !role || u.role === role)
      .filter(
        (u) =>
          !needle ||
          u.username.toLowerCase().includes(needle) ||
          u.display_name.toLowerCase().includes(needle),
      )
      .sort(
        (a, b) =>
          ROLE_RANK[b.role] - ROLE_RANK[a.role] || a.display_name.localeCompare(b.display_name),
      )
      .map(toCard);
  });
}
