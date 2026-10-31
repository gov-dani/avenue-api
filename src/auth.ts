import type { FastifyReply, FastifyRequest } from 'fastify';
import { canManage, findById, isWhitelisted, type UserRow } from './users.js';

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
  const user = await findById(req.user.id);
  if (!user) return reply.code(401).send({ error: 'Sessão inválida' });
  req.currentUser = user;
}

/** Logado e já aprovado na whitelist: só quem passou por ela edita perfil ou envia arquivos. */
export async function requireWhitelisted(req: FastifyRequest, reply: FastifyReply) {
  const denied = await requireUser(req, reply);
  if (denied) return denied;
  if (!isWhitelisted(req.currentUser!)) return reply.code(403).send({ error: 'Peça a whitelist para liberar seu perfil' });
}

export async function requireManager(req: FastifyRequest, reply: FastifyReply) {
  const denied = await requireUser(req, reply);
  if (denied) return denied;
  if (!canManage(req.currentUser!)) return reply.code(403).send({ error: 'Sem permissão' });
}
