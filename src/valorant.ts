// HenrikDev: API não oficial do Valorant. O que vem dela é enfeite do perfil, então toda falha
// de rank vira "sem rank" e o Riot ID continua valendo.
const TIMEOUT_MS = 6000;
const BASE = 'https://api.henrikdev.xyz/valorant';
const REGIONS = new Set(['na', 'eu', 'ap', 'kr', 'latam', 'br']);

export const RIOT_TAG = /^[A-Za-z0-9]{3,5}$/;

export class ValorantError extends Error {
  constructor(
    message: string,
    public notFound = false,
  ) {
    super(message);
  }
}

/** "Nome#TAG" -> { name, tag }, ou uma mensagem do que está errado. */
export function parseRiotId(raw: string): { name: string; tag: string } | { error: string } {
  const i = raw.lastIndexOf('#');
  const name = raw.slice(0, i).trim();
  const tag = raw.slice(i + 1).trim();
  if (i < 1) return { error: 'Use o formato Nome#TAG, como aparece no jogo' };
  if (name.length < 3 || name.length > 16 || /[#/\\?%\u0000-\u001f]/.test(name)) return { error: 'O nome do Riot ID tem de 3 a 16 caracteres' };
  if (!RIOT_TAG.test(tag)) return { error: 'A TAG tem de 3 a 5 letras ou números (o que vem depois do #)' };
  return { name, tag };
}

export const trackerUrl = (name: string, tag: string) =>
  `https://tracker.gg/valorant/profile/riot/${encodeURIComponent(`${name}#${tag}`)}/overview`;

async function get<T>(path: string, key: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { Accept: 'application/json', Authorization: key } });
  } catch {
    throw new ValorantError('O serviço de rank do Valorant não respondeu. Tente de novo em instantes.');
  }
  if (res.status === 404) throw new ValorantError('Não achei esse Riot ID no Valorant', true);
  if (res.status === 429) throw new ValorantError('O serviço de rank pediu para esperar um pouco. Tente de novo em instantes.');
  if (!res.ok) throw new ValorantError('Não foi possível consultar o Valorant agora.');
  return ((await res.json()) as { data: T }).data;
}

export interface ValorantSnapshot {
  name: string;
  tag: string;
  region: string;
  level: number;
  cardUrl: string;
  tier: string;
  tierId: number;
  rr: number;
  peakTier: string;
  peakTierId: number;
}

/** Conta + rank atual e pico. Sem partidas competitivas, o rank vem vazio. */
export async function fetchSnapshot(name: string, tag: string, key: string): Promise<ValorantSnapshot> {
  const account = await get<{ region: string; account_level: number; name: string; tag: string; card: string }>(
    `/v2/account/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`,
    key,
  );

  const snap: ValorantSnapshot = {
    name: account.name,
    tag: account.tag,
    region: REGIONS.has(account.region) ? account.region : '',
    level: account.account_level,
    // A arte do card vem como texto solto da API: só aceitamos HTTPS
    cardUrl: typeof account.card === 'string' && account.card.startsWith('https://') ? account.card : '',
    tier: '',
    tierId: 0,
    rr: 0,
    peakTier: '',
    peakTierId: 0,
  };
  if (!snap.region) return snap;

  const mmr = await get<{
    current?: { tier?: { id: number; name: string }; rr?: number };
    peak?: { tier?: { id: number; name: string } };
  }>(`/v3/mmr/${snap.region}/pc/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`, key).catch(() => null);

  const cur = mmr?.current?.tier;
  // id 0 = sem rank (unranked)
  if (cur?.id) {
    snap.tier = cur.name;
    snap.tierId = cur.id;
    snap.rr = mmr?.current?.rr ?? 0;
  }
  const peak = mmr?.peak?.tier;
  if (peak?.id) {
    snap.peakTier = peak.name;
    snap.peakTierId = peak.id;
  }
  return snap;
}
