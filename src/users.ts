import { computeBadges, grantedKeys } from './badges.js';
import { queryOne, run } from './db.js';
import { RESERVED_USERNAMES } from './schemas.js';

export const ROLES = ['visitante', 'membro', 'equipe', 'lider', 'fundador'] as const;
export type Role = (typeof ROLES)[number];

// Quanto maior, mais alto na hierarquia
export const ROLE_RANK: Record<Role, number> = {
  visitante: 0,
  membro: 1,
  equipe: 2,
  lider: 3,
  fundador: 4,
};

export const isAdmin = (role: Role) => ROLE_RANK[role] >= ROLE_RANK.lider;

export interface Link { label: string; url: string }
export interface Game { name: string; detail: string }
export interface Gear { category: string; name: string }

export interface UserRow {
  id: number;
  discord_id: string;
  username: string;
  display_name: string;
  bio: string;
  avatar_url: string;
  banner_url: string;
  discord: string;
  discord_handle: string;
  discord_name: string;
  discord_avatar: string;
  discord_banner: string;
  discord_accent: string;
  discord_synced_at: string;
  sync_avatar: number;
  sync_banner: number;
  sync_name: number;
  show_activity: number;
  badges: string;
  music_url: string;
  music_title: string;
  avatar_decoration: string;
  links: string;
  games: string;
  gear: string;
  role: Role;
  views: number;
  created_at: string;
}

export const findByUsername = (username: string) =>
  queryOne<UserRow>('SELECT * FROM users WHERE username = ?', [username]);

export const findById = (id: number) => queryOne<UserRow>('SELECT * FROM users WHERE id = ?', [id]);

const findByDiscordId = (discordId: string) =>
  queryOne<UserRow>('SELECT * FROM users WHERE discord_id = ?', [discordId]);

export const countUsers = async () =>
  Number((await queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM users'))!.n);

/** Transforma o nome do Discord em um @usuario válido e livre. */
async function freeUsername(raw: string): Promise<string> {
  let base = raw.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^_+|_+$/g, '').slice(0, 16);
  if (base.length < 3) base = `${base}av9`.slice(0, 16);
  if (RESERVED_USERNAMES.has(base.toLowerCase())) base = `${base}_av9`;

  let candidate = base;
  for (let n = 2; await findByUsername(candidate); n++) candidate = `${base}${n}`;
  return candidate;
}

interface DiscordProfile {
  id: string;
  handle: string;
  displayName: string;
  avatarUrl: string;
  bannerUrl: string;
  accent: string;
}

// Contas `dev:` vêm do atalho de desenvolvimento e não existem no Discord
export const isLinked = (u: UserRow) => !u.discord_id.startsWith('dev:');

/** Copia para o perfil o que o usuário pediu para acompanhar a conta do Discord. */
export async function applySync(id: number) {
  const u = await findById(id);
  if (!u || !isLinked(u)) return;
  await run(
    `UPDATE users SET
       avatar_url   = CASE WHEN sync_avatar = 1 AND discord_avatar != '' THEN discord_avatar ELSE avatar_url END,
       banner_url   = CASE WHEN sync_banner = 1 THEN discord_banner ELSE banner_url END,
       display_name = CASE WHEN sync_name = 1 AND discord_name != '' THEN SUBSTRING(discord_name, 1, 40) ELSE display_name END
     WHERE id = ?`,
    [id],
  );
}

/**
 * Entra com a conta do Discord, criando o perfil no primeiro acesso.
 * A cada entrada os dados da conta são atualizados e o que está marcado para
 * sincronizar é copiado para o perfil; o resto do que o usuário editou fica.
 * O primeiro usuário vira fundador.
 */
export async function loginWithDiscord(d: DiscordProfile): Promise<{ user: UserRow; created: boolean }> {
  const existing = await findByDiscordId(d.id);
  const synced = [d.handle, d.displayName, d.avatarUrl, d.bannerUrl, d.accent];

  if (existing) {
    await run(
      `UPDATE users SET discord_handle = ?, discord_name = ?, discord_avatar = ?,
         discord_banner = ?, discord_accent = ?, discord_synced_at = UTC_TIMESTAMP() WHERE id = ?`,
      [...synced, existing.id],
    );
    await applySync(existing.id);
    return { user: (await findById(existing.id))!, created: false };
  }

  const role: Role = (await countUsers()) === 0 ? 'fundador' : 'visitante';
  const result = await run(
    `INSERT INTO users (discord_id, username, display_name, bio, avatar_url, banner_url, discord, role,
       badges, music_url, links, games, gear,
       discord_handle, discord_name, discord_avatar, discord_banner, discord_accent, discord_synced_at)
     VALUES (?, ?, ?, '', ?, ?, ?, ?, '[]', '', '[]', '[]', '[]', ?, ?, ?, ?, ?, UTC_TIMESTAMP())`,
    [
      d.id,
      await freeUsername(d.handle),
      d.displayName.slice(0, 40),
      d.avatarUrl,
      d.bannerUrl,
      d.handle,
      role,
      ...synced,
    ],
  );

  return { user: (await findById(result.insertId))!, created: true };
}

const parse = <T>(json: string): T[] => {
  try {
    return JSON.parse(json) as T[];
  } catch {
    return [];
  }
};

export function toPublic(u: UserRow) {
  return {
    username: u.username,
    displayName: u.display_name,
    bio: u.bio,
    avatarUrl: u.avatar_url,
    bannerUrl: u.banner_url,
    musicUrl: u.music_url,
    musicTitle: u.music_title,
    avatarDecoration: u.avatar_decoration,
    bannerColor: u.discord_accent,
    badges: computeBadges(u),
    hasActivity: Boolean(u.show_activity) && isLinked(u),
    discord: u.discord,
    role: u.role,
    links: parse<Link>(u.links),
    games: parse<Game>(u.games),
    gear: parse<Gear>(u.gear),
    views: u.views,
    createdAt: u.created_at,
  };
}

export const toPrivate = (u: UserRow) => ({
  ...toPublic(u),
  id: u.id,
  syncAvatar: Boolean(u.sync_avatar),
  syncBanner: Boolean(u.sync_banner),
  syncName: Boolean(u.sync_name),
  showActivity: Boolean(u.show_activity),
  discordAccount: {
    linked: isLinked(u),
    handle: u.discord_handle,
    name: u.discord_name,
    avatarUrl: u.discord_avatar,
    bannerUrl: u.discord_banner,
    accent: u.discord_accent,
    syncedAt: u.discord_synced_at,
  },
});

export const toCard = (u: UserRow) => ({
  username: u.username,
  displayName: u.display_name,
  avatarUrl: u.avatar_url,
  role: u.role,
  grants: grantedKeys(u),
});
