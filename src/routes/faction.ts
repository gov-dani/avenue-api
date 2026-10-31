import type { FastifyInstance } from 'fastify';
import { query, run } from '../db.js';
import { requireAdmin } from '../auth.js';
import { grantsSchema, memberRoleSchema, membersQuerySchema } from '../schemas.js';
import { ROLE_RANK, findByUsername, toCard, type UserRow } from '../users.js';

export default async function factionRoutes(app: FastifyInstance) {
  app.get('/faction/members', async (req, reply) => {
    const parsed = membersQuerySchema.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: 'Filtro inválido' });
    const { q, role } = parsed.data;

    const rows = await query<UserRow>("SELECT * FROM users WHERE role != 'visitante'");

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
  app.get('/faction/users', { preHandler: requireAdmin }, async () => {
    const rows = await query<UserRow>('SELECT * FROM users ORDER BY created_at DESC');
    return rows.map(toCard);
  });

  app.patch<{ Params: { username: string } }>(
    '/faction/members/:username',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const parsed = memberRoleSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'Cargo inválido' });

      const actor = req.currentUser!;
      const target = await findByUsername(req.params.username);
      if (!target) return reply.code(404).send({ error: 'Usuário não encontrado' });

      // Só o fundador mexe em cargos de liderança
      const newRank = ROLE_RANK[parsed.data.role];
      const touchesLeadership = newRank >= ROLE_RANK.lider || ROLE_RANK[target.role] >= ROLE_RANK.lider;
      if (touchesLeadership && actor.role !== 'fundador') {
        return reply.code(403).send({ error: 'Apenas o fundador altera cargos de liderança' });
      }

      await run('UPDATE users SET role = ? WHERE id = ?', [parsed.data.role, target.id]);
      return toCard({ ...target, role: parsed.data.role });
    },
  );

  // Badges especiais concedidas pela liderança (Avenue Girls, Parceiro, VIP, Campeão)
  app.put<{ Params: { username: string } }>(
    '/faction/members/:username/badges',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const parsed = grantsSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'Badge inválida' });

      const target = await findByUsername(req.params.username);
      if (!target) return reply.code(404).send({ error: 'Usuário não encontrado' });

      const badges = JSON.stringify([...new Set(parsed.data.badges)]);
      await run('UPDATE users SET badges = ? WHERE id = ?', [badges, target.id]);
      return toCard({ ...target, badges });
    },
  );
}
