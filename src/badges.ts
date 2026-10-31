import { query, run } from './db.js';
import type { UserRow } from './users.js';

export interface Badge {
  key: string;
  label: string;
  desc: string;
  /** Só nas badges criadas em /owner */
  color?: string;
  icon?: string;
  /** Ícone do allsvgicons.com, guardado no banco para o perfil não depender de site externo */
  svg?: IconSvg;
  /** Imagem em /public do site, para insígnias que não são ícones de uma cor só */
  image?: string;
}

export interface IconSvg {
  viewBox: string;
  body: string;
}

export interface CustomBadge {
  key: string;
  label: string;
  desc: string;
  color: string;
  icon: string;
  svg?: IconSvg;
}

// Badges criadas em /owner ficam na memória para o computeBadges (síncrono) enxergar.
let custom = new Map<string, CustomBadge>();

export async function loadCustomBadges() {
  const rows = await query<CustomBadge & { icon_svg: string | null }>(
    'SELECT badge_key AS `key`, label, description AS `desc`, color, icon, icon_svg FROM badge_defs ORDER BY created_at',
  );
  custom = new Map(
    rows.map(({ icon_svg, ...r }) => {
      const svg = icon_svg ? (JSON.parse(icon_svg) as IconSvg) : undefined;
      return [r.key, svg ? { ...r, svg } : r];
    }),
  );
}

/**
 * Badge de evento: quem entrou até o prazo recebe sozinho. A badge é criada em /owner
 * (é achada pelo nome) e o prazo é 31/10/2026 23:59 em Brasília (UTC-3), já que created_at é UTC.
 */
const EVENT_BADGE = { label: 'Halloween 2026', until: '2026-11-01 02:59:59' };

export async function grantEventBadge() {
  const badge = [...custom.values()].find((b) => b.label.trim().toLowerCase() === EVENT_BADGE.label.toLowerCase());
  if (!badge) return;
  await run(
    'INSERT IGNORE INTO user_badges (user_id, badge) SELECT id, ? FROM users WHERE created_at <= ?',
    [badge.key, EVENT_BADGE.until],
  );
}

export const customBadges = () => [...custom.values()];
export const isBuiltinGrant = (key: string) => Object.hasOwn(GRANTABLE, key);
export const isGrantable = (key: string) => isBuiltinGrant(key) || custom.has(key);

/** Badges que a liderança concede à mão. As demais são calculadas do perfil. */
export const GRANTABLE: Record<string, Omit<Badge, 'key'>> = {
  girls: { label: 'Avenue Girls', desc: 'Faz parte das Avenue Girls' },
  parceiro: { label: 'Parceiro', desc: 'Parceiro oficial da Avenue' },
  vip: { label: 'VIP', desc: 'Destaque da comunidade' },
  campeao: { label: 'Campeão', desc: 'Venceu um campeonato pela Avenue' },
};

/** Badge exclusiva, atribuída pelo Discord ID e não pela liderança. */
const DEVELOPER_DISCORD_IDS = new Set(['504882460106948619']);

/** Cargo exibido ao público: o desenvolvedor não é o fundador, então aparece como liderança. */
export const publicRole = (u: UserRow): UserRow['role'] =>
  DEVELOPER_DISCORD_IDS.has(u.discord_id) && u.role === 'fundador' ? 'lider' : u.role;

/** Surpresa: este Discord ID ganha o perfil rosa e a insígnia da Hello Kitty. */
const KITTY_DISCORD_IDS = new Set(['1105505473563734106']);
export const profileTheme = (u: UserRow): 'pink' | '' => (KITTY_DISCORD_IDS.has(u.discord_id) ? 'pink' : '');

const ROLE_BADGE: Partial<Record<UserRow['role'], Badge>> = {
  fundador: { key: 'fundador', label: 'Fundador', desc: 'Criou a Avenue' },
  lider: { key: 'lider', label: 'Liderança', desc: 'Lidera a Avenue' },
  equipe: { key: 'equipe', label: 'Equipe', desc: 'Faz parte da equipe da Avenue' },
  membro: { key: 'membro', label: 'Membro', desc: 'Da família Avenue' },
};

const STREAM_HOSTS = /(^|\.)(twitch\.tv|kick\.com|youtube\.com|youtu\.be)$/i;

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
};

const fmtDate = (sqlDate: string) => {
  const [y, m, d] = sqlDate.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
};

export const grantedKeys = (u: UserRow): string[] => u.badges.filter(isGrantable);

/** Badges exibidas no perfil, na ordem em que aparecem. */
export function computeBadges(u: UserRow): Badge[] {
  const out: Badge[] = [];

  const isDev = DEVELOPER_DISCORD_IDS.has(u.discord_id);
  const role = ROLE_BADGE[publicRole(u)];
  if (role) out.push(role);

  if (isDev) {
    out.push({ key: 'dev', label: 'Desenvolvedor', desc: 'Desenvolveu e mantém o site da Avenue' });
  }

  if (profileTheme(u)) {
    out.push({ key: 'kitty', label: '?????', desc: '?????', color: '#e6007e', image: '/hello-kitty.png' });
  }

  for (const key of grantedKeys(u)) out.push(custom.get(key) ?? { key, ...GRANTABLE[key]! });

  // O desenvolvedor tem as mesmas tags dos membros, qualquer que seja o cargo
  if (isDev || u.role !== 'visitante') {
    out.push({ key: 'desde', label: 'Na Avenue', desc: `Membro desde ${fmtDate(u.created_at)}` });
  }
  if (!u.discord_id.startsWith('dev:')) {
    out.push({ key: 'discord', label: 'Discord vinculado', desc: 'Conta conectada ao Discord' });
  }
  if (u.links.some((l) => STREAM_HOSTS.test(hostOf(l.url)))) {
    out.push({ key: 'streamer', label: 'Criador de conteúdo', desc: 'Faz live ou vídeos' });
  }
  if (u.games.length >= 3) {
    out.push({ key: 'gamer', label: 'Gamer', desc: 'Joga em vários jogos' });
  }
  if (u.gear.length >= 4) {
    out.push({ key: 'setup', label: 'Setup montado', desc: 'Mostra o setup completo' });
  }
  if (u.views >= 100) {
    out.push({ key: 'popular', label: 'Popular', desc: u.show_views ? `${u.views.toLocaleString('pt-BR')} visualizações no perfil` : 'Perfil muito visitado' });
  }
  return out;
}
