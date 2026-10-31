import { randomBytes } from 'node:crypto';

// Só as APIs públicas do Roblox, sem chave. Os hosts são fixos: nada vindo do usuário monta a URL
// além do ID numérico e do nome (que passa por ROBLOX_NAME antes).
const TIMEOUT_MS = 6000;
export const ROBLOX_NAME = /^[A-Za-z0-9_]{3,20}$/;
export const CODE_TTL_MIN = 30;

export class RobloxError extends Error {}

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), headers: { Accept: 'application/json', ...init?.headers } });
  } catch {
    throw new RobloxError('O Roblox não respondeu. Tente de novo em instantes.');
  }
  if (res.status === 429) throw new RobloxError('O Roblox pediu para esperar um pouco. Tente de novo em instantes.');
  if (!res.ok) throw new RobloxError('Não foi possível falar com o Roblox agora.');
  return (await res.json()) as T;
}

export interface RobloxFound { id: string; name: string; displayName: string }

/** Procura uma conta pelo @ do Roblox. */
export async function findByName(name: string): Promise<RobloxFound | null> {
  const res = await getJson<{ data: { id: number; name: string; displayName: string }[] }>(
    'https://users.roblox.com/v1/usernames/users',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usernames: [name], excludeBannedUsers: true }),
    },
  );
  const hit = res.data[0];
  return hit ? { id: String(hit.id), name: hit.name, displayName: hit.displayName } : null;
}

export interface RobloxSnapshot {
  id: string;
  name: string;
  displayName: string;
  description: string;
  created: string;
  avatarUrl: string;
  friends: number;
  followers: number;
}

/** Dados públicos da conta. Avatar e contagens são enfeite: se falharem, o resto vale. */
export async function fetchSnapshot(id: string): Promise<RobloxSnapshot> {
  const [user, avatar, friends, followers] = await Promise.all([
    getJson<{ name: string; displayName: string; description: string | null; created: string; isBanned: boolean }>(
      `https://users.roblox.com/v1/users/${id}`,
    ),
    getJson<{ data: { imageUrl?: string; state: string }[] }>(
      `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${id}&size=150x150&format=Png`,
    ).catch(() => null),
    getJson<{ count: number }>(`https://friends.roblox.com/v1/users/${id}/friends/count`).catch(() => null),
    getJson<{ count: number }>(`https://friends.roblox.com/v1/users/${id}/followers/count`).catch(() => null),
  ]);
  if (user.isBanned) throw new RobloxError('Essa conta do Roblox está banida.');

  const thumb = avatar?.data[0];
  return {
    id,
    name: user.name,
    displayName: user.displayName,
    description: user.description ?? '',
    created: user.created,
    avatarUrl: thumb?.state === 'Completed' && thumb.imageUrl ? thumb.imageUrl : '',
    friends: friends?.count ?? 0,
    followers: followers?.count ?? 0,
  };
}

/** Código que a pessoa cola na bio do Roblox para provar que a conta é dela. */
export const newCode = () => `avenue-${randomBytes(4).toString('hex')}`;
