import type { FastifyInstance } from 'fastify';
import { requireUser } from '../auth.js';
import { isProd } from '../env.js';
import { whitelistRequestSchema } from '../schemas.js';
import { isLinked, isWhitelisted } from '../users.js';
import { asRequest, createRequest, latestRequest, usernameProblem } from '../whitelist.js';

export default async function whitelistRoutes(app: FastifyInstance) {
  const status = async (userId: number, approved: boolean) => {
    const last = await latestRequest(userId);
    return { approved, request: last ? asRequest(last) : null };
  };

  app.get('/me/whitelist', { preHandler: requireUser }, async (req) => {
    const me = req.currentUser!;
    return status(me.id, isWhitelisted(me));
  });

  app.post(
    '/me/whitelist',
    { preHandler: requireUser, config: { rateLimit: { max: 6, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const me = req.currentUser!;
      if (isWhitelisted(me)) return reply.code(409).send({ error: 'Você já está na whitelist' });
      // A decisão volta por DM do Discord, então o pedido exige a conta vinculada
      if (!isLinked(me) && isProd) {
        return reply.code(400).send({ error: 'Vincule sua conta do Discord para pedir a whitelist' });
      }

      const parsed = whitelistRequestSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]!.message });

      const last = await latestRequest(me.id);
      if (last?.status === 'pending') return reply.code(409).send({ error: 'Você já tem um pedido em análise' });

      const { username, message } = parsed.data;
      const problem = await usernameProblem(username, me.id);
      if (problem) return reply.code(409).send({ error: problem });

      await createRequest(me.id, username, message);
      return reply.code(201).send(await status(me.id, false));
    },
  );
}
