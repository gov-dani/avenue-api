/** Perfil v2: liberado por Discord ID, enquanto está em teste. */
export const V2_DISCORD_IDS = new Set(['504882460106948619', '1105505473563734106']);
export const isV2 = (u: { discord_id: string }) => V2_DISCORD_IDS.has(u.discord_id);

export const MAX_PHOTOS = 24;
/** Formato das fotos: proporção original (como no Instagram), retrato 4:5 ou quadrada. Valor antigo 'tall' vale como natural. */
export const V2_LAYOUTS = ['natural', 'portrait', 'square'] as const;
export type V2Layout = (typeof V2_LAYOUTS)[number];

/** O que está no banco pode ser o valor antigo ('tall') ou desconhecido: cai no natural */
export const normalizeLayout = (v: string): V2Layout => ((V2_LAYOUTS as readonly string[]).includes(v) ? (v as V2Layout) : 'natural');
export const MAX_NOTES_SHOWN = 50;

/** Níveis da insígnia, que sobem com o tempo de perfil. `days` é a idade mínima da conta. */
export const TIERS = [
  { key: 'novato', label: 'Novato', days: 0, color: '#34d382' },
  { key: 'frequente', label: 'Frequente', days: 7, color: '#3d9bff' },
  { key: 'veterano', label: 'Veterano', days: 30, color: '#a770ff' },
  { key: 'lenda', label: 'Lenda', days: 90, color: '#ff9632' },
  { key: 'imortal', label: 'Imortal', days: 180, color: '#ff5fb0' },
  { key: 'eterno', label: 'Eterno', days: 365, color: '#f4cd5c' },
] as const;

export interface ProfileLevel {
  key: string;
  label: string;
  color: string;
  /** 1 a 6 */
  tier: number;
  /** Dias de perfil */
  days: number;
  /** Próximo nível e quantos dias faltam; null no último */
  next: { label: string; inDays: number } | null;
  /** 0 a 1, do nível atual até o próximo */
  progress: number;
}

/** createdAt vem do banco como "YYYY-MM-DD HH:MM:SS" em UTC. */
export function profileLevel(createdAt: string, now = Date.now()): ProfileLevel {
  const born = Date.parse(createdAt.replace(' ', 'T') + 'Z');
  const days = Number.isNaN(born) ? 0 : Math.max(0, Math.floor((now - born) / 86_400_000));

  let i = 0;
  while (i + 1 < TIERS.length && days >= TIERS[i + 1]!.days) i++;
  const cur = TIERS[i]!;
  const nxt = TIERS[i + 1];

  return {
    key: cur.key,
    label: cur.label,
    color: cur.color,
    tier: i + 1,
    days,
    next: nxt ? { label: nxt.label, inDays: nxt.days - days } : null,
    progress: nxt ? (days - cur.days) / (nxt.days - cur.days) : 1,
  };
}

/** Acha latitude/longitude de um lugar (OpenStreetMap/Nominatim). Null se não achar ou o serviço falhar. */
export async function geocode(place: string): Promise<{ lat: number; lng: number } | null> {
  const q = place.trim();
  if (!q) return null;
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`, {
      headers: { 'User-Agent': 'avenue-profile/1.0', 'Accept-Language': 'pt-BR' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const [hit] = (await res.json()) as { lat: string; lon: string }[];
    const lat = Number(hit?.lat);
    const lng = Number(hit?.lon);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  } catch {
    return null;
  }
}
