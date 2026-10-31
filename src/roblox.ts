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

export interface RobloxPresence {
  status: 'offline' | 'online' | 'playing' | 'studio';
  game?: { name: string; placeId: string; iconUrl: string };
}

// A página consulta a cada 30s: guardar a resposta por um tempo poupa o Roblox
const PRESENCE_MS = 25_000;
const presenceCache = new Map<string, { at: number; value: RobloxPresence }>();

/** Se a pessoa está online ou jogando agora. Quem escondeu o status no Roblox aparece como offline. */
export async function fetchPresence(id: string): Promise<RobloxPresence> {
  const hit = presenceCache.get(id);
  if (hit && Date.now() - hit.at < PRESENCE_MS) return hit.value;

  const res = await getJson<{
    userPresences: { userPresenceType: number; lastLocation: string; rootPlaceId: number | null; universeId: number | null }[];
  }>('https://presence.roblox.com/v1/presence/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userIds: [Number(id)] }),
  });

  const p = res.userPresences[0];
  let value: RobloxPresence = { status: 'offline' };
  if (p?.userPresenceType === 1) value = { status: 'online' };
  else if (p?.userPresenceType === 3) value = { status: 'studio' };
  else if (p?.userPresenceType === 2) {
    // Jogo escondido (o dono bloqueou o "entrar") vem sem lugar: mostramos só que está jogando
    value = { status: 'playing' };
    if (p.rootPlaceId && p.lastLocation) {
      const icon = p.universeId
        ? await getJson<{ data: { imageUrl?: string; state: string }[] }>(
            `https://thumbnails.roblox.com/v1/games/icons?universeIds=${p.universeId}&size=128x128&format=Png`,
          ).catch(() => null)
        : null;
      const thumb = icon?.data[0];
      value.game = {
        name: p.lastLocation,
        placeId: String(p.rootPlaceId),
        iconUrl: thumb?.state === 'Completed' && thumb.imageUrl ? thumb.imageUrl : '',
      };
    }
  }

  presenceCache.set(id, { at: Date.now(), value });
  return value;
}
