import type { FastifyInstance } from 'fastify';
import { requireManager } from '../auth.js';
import { grantsSchema, memberRoleSchema, membersQuerySchema } from '../schemas.js';
import { ROLE_RANK, findByUsername, listUsers, setBadges, setRole, toCard } from '../users.js';

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

  // Lista todos os cadastros (inclusive visitantes) para o painel de administração
  app.get('/faction/users', { preHandler: requireManager }, async () => {
    const rows = await listUsers(undefined, 'u.created_at DESC');
    return rows.map(toCard);
  });

  app.patch<{ Params: { username: string } }>(
    '/faction/members/:username',
    { preHandler: requireManager },
    async (req, reply) => {
      const parsed = memberRoleSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'Cargo inválido' });

      const target = await findByUsername(req.params.username);
      if (!target) return reply.code(404).send({ error: 'Usuário não encontrado' });

      await setRole(target.id, parsed.data.role);
      return toCard({ ...target, role: parsed.data.role });
    },
  );

  // Badges especiais concedidas pela liderança (Avenue Girls, Parceiro, VIP, Campeão)
  app.put<{ Params: { username: string } }>(
    '/faction/members/:username/badges',
    { preHandler: requireManager },
    async (req, reply) => {
      const parsed = grantsSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'Badge inválida' });

      const target = await findByUsername(req.params.username);
      if (!target) return reply.code(404).send({ error: 'Usuário não encontrado' });

      const badges = [...new Set(parsed.data.badges)];
      await setBadges(target.id, badges);
      return toCard({ ...target, badges });
    },
  );
}
