import { query, queryOne, run } from './db.js';
import { RESERVED_USERNAMES } from './schemas.js';

export type WhitelistStatus = 'pending' | 'approved' | 'rejected';

export interface WhitelistRow {
  id: number;
  user_id: number;
  username: string;
  message: string;
  status: WhitelistStatus;
  reason: string;
  reviewed_by: string;
  created_at: string;
  reviewed_at: string | null;
}

export const asRequest = (r: WhitelistRow) => ({
  id: r.id,
  username: r.username,
  message: r.message,
  status: r.status,
  reason: r.reason,
  reviewedBy: r.reviewed_by,
  createdAt: r.created_at,
  reviewedAt: r.reviewed_at ?? '',
});

export const latestRequest = (userId: number) =>
  queryOne<WhitelistRow>('SELECT * FROM whitelist_requests WHERE user_id = ? ORDER BY id DESC LIMIT 1', [userId]);

export const findRequest = (id: number) =>
  queryOne<WhitelistRow>('SELECT * FROM whitelist_requests WHERE id = ?', [id]);

/** Motivo pelo qual o @ não pode ser usado por esta pessoa, ou null se estiver livre. */
export async function usernameProblem(username: string, userId: number, ignoreRequestId = 0): Promise<string | null> {
  if (RESERVED_USERNAMES.has(username.toLowerCase())) return 'Esse @usuário é reservado';
  const taken = await queryOne('SELECT 1 FROM users WHERE username = ? AND id != ?', [username, userId]);
  if (taken) return 'Esse @usuário já está em uso';
  const claimed = await queryOne(
    "SELECT 1 FROM whitelist_requests WHERE status = 'pending' AND username = ? AND user_id != ? AND id != ?",
    [username, userId, ignoreRequestId],
  );
  if (claimed) return 'Esse @usuário já foi pedido por outra pessoa';
  return null;
}

export const createRequest = (userId: number, username: string, message: string) =>
  run('INSERT INTO whitelist_requests (user_id, username, message) VALUES (?, ?, ?)', [userId, username, message]);

export const pendingCount = async () =>
  Number((await queryOne<{ n: number }>("SELECT COUNT(*) AS n FROM whitelist_requests WHERE status = 'pending'"))!.n);

/** Pedidos com quem pediu: pendentes primeiro (os mais antigos na frente), depois os já decididos. */
export const listRequests = () =>
  query<WhitelistRow & { discord_id: string; display_name: string; avatar_url: string; current_username: string }>(
    `SELECT w.*, u.discord_id, u.username AS current_username, p.display_name, p.avatar_url
     FROM whitelist_requests w
     JOIN users u ON u.id = w.user_id
     JOIN user_profiles p ON p.user_id = u.id
     ORDER BY w.status = 'pending' DESC,
              CASE WHEN w.status = 'pending' THEN w.id END ASC,
              w.id DESC
     LIMIT 200`,
  );
