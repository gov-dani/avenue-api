import type { FastifyReply, FastifyRequest } from 'fastify';
import { findById, isAdmin, type UserRow } from './users.js';

export const COOKIE_NAME = 'ag_session';
const THIRTY_DAYS = 60 * 60 * 24 * 30;

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { id: number };
    user: { id: number };
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    currentUser?: UserRow;
  }
}

export function sessionCookieOptions(secure: boolean) {
  return { path: '/', httpOnly: true, sameSite: 'lax' as const, secure, maxAge: THIRTY_DAYS };
}

export async function requireUser(req: FastifyRequest, reply: FastifyReply) {
  try {
    await req.jwtVerify({ onlyCookie: true });
  } catch {
    return reply.code(401).send({ error: 'Não autenticado' });
  }
  const user = findById(req.user.id);
  if (!user) return reply.code(401).send({ error: 'Sessão inválida' });
  req.currentUser = user;
}

export async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
  const denied = await requireUser(req, reply);
  if (denied) return denied;
  if (!isAdmin(req.currentUser!.role)) return reply.code(403).send({ error: 'Sem permissão' });
}
