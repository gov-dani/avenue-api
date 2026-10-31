import type { z } from 'zod';
import { computeBadges, grantEventBadge, grantedKeys, publicRole } from './badges.js';
import { query, queryOne, run, transaction } from './db.js';
import { CODE_TTL_MIN } from './roblox.js';
import { RESERVED_USERNAMES, type profileSchema } from './schemas.js';

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

/** O usuário inteiro, montado a partir de users + user_profiles + user_discord + listas. */
export interface UserRow {
  id: number;
  discord_id: string;
  username: string;
  role: Role;
  views: number;
  created_at: string;
  whitelisted: number;
  // user_profiles
  display_name: string;
  bio: string;
  location: string;
  avatar_url: string;
  banner_url: string;
  discord: string;
  music_url: string;
  music_title: string;
  avatar_decoration: string;
  name_style: string;
  name_font: string;
  show_activity: number;
  show_views: number;
  link_layout: 'list' | 'grid' | 'icons';
  // user_discord
  discord_handle: string;
  discord_name: string;
  discord_avatar: string;
  discord_banner: string;
  discord_accent: string;
  discord_synced_at: string;
  sync_avatar: number;
  sync_banner: number;
  sync_name: number;
  // user_roblox (roblox_id é null até a conta ser verificada)
  roblox_id: string | null;
  roblox_username: string;
  roblox_display_name: string;
  roblox_avatar: string;
  roblox_friends: number;
  roblox_followers: number;
  roblox_created: string;
  roblox_pending_username: string;
  roblox_pending_code: string;
  roblox_pending_at: string | null;
  // user_links, user_games, user_gear, user_badges
  links: Link[];
  games: Game[];
  gear: Gear[];
  badges: string[];
}

type BaseRow = Omit<UserRow, 'links' | 'games' | 'gear' | 'badges' | 'discord_synced_at'> & {
  discord_synced_at: string | null;
};

const SELECT_USER = `
  SELECT u.id, u.discord_id, u.username, u.role, u.views, u.created_at, u.whitelisted,
         p.display_name, p.bio, p.location, p.avatar_url, p.banner_url, p.discord, p.music_url, p.music_title,
         p.avatar_decoration, p.name_style, p.name_font, p.show_activity, p.show_views, p.link_layout,
         d.handle AS discord_handle, d.name AS discord_name, d.avatar_url AS discord_avatar,
         d.banner_url AS discord_banner, d.accent AS discord_accent, d.synced_at AS discord_synced_at,
         d.sync_avatar, d.sync_banner, d.sync_name,
         r.roblox_id, COALESCE(r.username, '') AS roblox_username, COALESCE(r.display_name, '') AS roblox_display_name,
         COALESCE(r.avatar_url, '') AS roblox_avatar, COALESCE(r.friends, 0) AS roblox_friends,
         COALESCE(r.followers, 0) AS roblox_followers, COALESCE(r.account_created, '') AS roblox_created,
         COALESCE(r.pending_username, '') AS roblox_pending_username, COALESCE(r.pending_code, '') AS roblox_pending_code,
         r.pending_at AS roblox_pending_at
  FROM users u
  JOIN user_profiles p ON p.user_id = u.id
  JOIN user_discord d ON d.user_id = u.id
  LEFT JOIN user_roblox r ON r.user_id = u.id`;

/** Anexa as listas (links, jogos, equipamentos, badges) de vários usuários de uma vez. */
async function hydrate(rows: BaseRow[]): Promise<UserRow[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);

  const [links, games, gear, badges] = await Promise.all([
    query<Link & { user_id: number }>('SELECT user_id, label, url FROM user_links WHERE user_id IN (?) ORDER BY sort_order', [ids]),
    query<Game & { user_id: number }>('SELECT user_id, name, detail FROM user_games WHERE user_id IN (?) ORDER BY sort_order', [ids]),
    query<Gear & { user_id: number }>('SELECT user_id, category, name FROM user_gear WHERE user_id IN (?) ORDER BY sort_order', [ids]),
    query<{ user_id: number; badge: string }>('SELECT user_id, badge FROM user_badges WHERE user_id IN (?)', [ids]),
  ]);

  const by = <T extends { user_id: number }>(list: T[], id: number) => list.filter((x) => x.user_id === id);
  return rows.map((r) => ({
    ...r,
    discord_synced_at: r.discord_synced_at ?? '',
    links: by(links, r.id).map(({ label, url }) => ({ label, url })),
    games: by(games, r.id).map(({ name, detail }) => ({ name, detail })),
    gear: by(gear, r.id).map(({ category, name }) => ({ category, name })),
    badges: by(badges, r.id).map((b) => b.badge),
  }));
}

async function loadUsers(where = '1=1', params: unknown[] = [], order = 'u.id'): Promise<UserRow[]> {
  return hydrate(await query<BaseRow>(`${SELECT_USER} WHERE ${where} ORDER BY ${order}`, params));
}

const loadOne = async (where: string, param: unknown) => (await loadUsers(where, [param]))[0];

export const findByUsername = (username: string) => loadOne('u.username = ?', username);
export const findById = (id: number) => loadOne('u.id = ?', id);
const findByDiscordId = (discordId: string) => loadOne('u.discord_id = ?', discordId);

/** Todos os cadastros, com filtro e ordem opcionais (SQL fixo do código, nunca texto do usuário). */
export const listUsers = (where?: string, order?: string) => loadUsers(where, [], order);

export const countUsers = async () =>
  Number((await queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM users'))!.n);

/** Transforma o nome do Discord em um @usuario válido e livre. */
async function freeUsername(raw: string): Promise<string> {
  let base = raw.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^_+|_+$/g, '').slice(0, 16);
  if (base.length < 3) base = `${base}av9`.slice(0, 16);
  if (RESERVED_USERNAMES.has(base.toLowerCase())) base = `${base}_av9`;

  let candidate = base;
  for (let n = 2; await queryOne('SELECT 1 FROM users WHERE username = ?', [candidate]); n++) candidate = `${base}${n}`;
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
    `UPDATE user_profiles p JOIN user_discord d ON d.user_id = p.user_id SET
       p.avatar_url   = CASE WHEN d.sync_avatar = 1 AND d.avatar_url != '' THEN d.avatar_url ELSE p.avatar_url END,
       p.banner_url   = CASE WHEN d.sync_banner = 1 THEN d.banner_url ELSE p.banner_url END,
       p.display_name = CASE WHEN d.sync_name = 1 AND d.name != '' THEN SUBSTRING(d.name, 1, 40) ELSE p.display_name END
     WHERE p.user_id = ?`,
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

  if (existing) {
    await run(
      `UPDATE user_discord SET handle = ?, name = ?, avatar_url = ?, banner_url = ?, accent = ?,
         synced_at = UTC_TIMESTAMP() WHERE user_id = ?`,
      [d.handle, d.displayName, d.avatarUrl, d.bannerUrl, d.accent, existing.id],
    );
    await applySync(existing.id);
    return { user: (await findById(existing.id))!, created: false };
  }

  const role: Role = (await countUsers()) === 0 ? 'fundador' : 'visitante';
  const username = await freeUsername(d.handle);

  const id = await transaction(async (tx) => {
    // Todos nascem sem whitelist, sem exceção; só a gestão aprova
    const { insertId } = await tx('INSERT INTO users (discord_id, username, role, whitelisted) VALUES (?, ?, ?, 0)', [
      d.id,
      username,
      role,
    ]);
    await tx('INSERT INTO user_profiles (user_id, display_name, avatar_url, banner_url, discord) VALUES (?, ?, ?, ?, ?)', [
      insertId,
      d.displayName.slice(0, 40),
      d.avatarUrl,
      d.bannerUrl,
      d.handle,
    ]);
    await tx(
      `INSERT INTO user_discord (user_id, handle, name, avatar_url, banner_url, accent, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())`,
      [insertId, d.handle, d.displayName, d.avatarUrl, d.bannerUrl, d.accent],
    );
    return insertId;
  });

  await grantEventBadge();
  return { user: (await findById(id))!, created: true };
}

type ProfileInput = z.infer<typeof profileSchema>;

/** Salva o que a pessoa editou no painel: perfil, sincronização e as listas. */
export async function saveProfile(id: number, p: ProfileInput, linked: boolean) {
  await transaction(async (tx) => {
    await tx(
      `UPDATE user_profiles SET display_name = ?, bio = ?, location = ?, avatar_url = ?, banner_url = ?, music_url = ?,
         music_title = ?, avatar_decoration = ?, name_style = ?, name_font = ?, discord = ?, show_activity = ?, show_views = ?, link_layout = ? WHERE user_id = ?`,
      [p.displayName, p.bio, p.location, p.avatarUrl, p.bannerUrl, p.musicUrl, p.musicTitle, p.avatarDecoration, p.nameStyle, p.nameFont, p.discord, Number(p.showActivity), Number(p.showViews), p.linkLayout, id],
    );
    // Conta sem Discord de verdade (atalho de dev) não tem o que sincronizar
    await tx('UPDATE user_discord SET sync_avatar = ?, sync_banner = ?, sync_name = ? WHERE user_id = ?', [
      Number(linked && p.syncAvatar),
      Number(linked && p.syncBanner),
      Number(linked && p.syncName),
      id,
    ]);

    await replaceList(tx, 'user_links', ['label', 'url'], id, p.links.map((l) => [l.label, l.url]));
    await replaceList(tx, 'user_games', ['name', 'detail'], id, p.games.map((g) => [g.name, g.detail]));
    await replaceList(tx, 'user_gear', ['category', 'name'], id, p.gear.map((g) => [g.category, g.name]));
  });
}

/** Troca a lista inteira do usuário, guardando a ordem em sort_order. */
async function replaceList(
  tx: typeof run,
  table: 'user_links' | 'user_games' | 'user_gear',
  columns: [string, string],
  userId: number,
  items: string[][],
) {
  await tx(`DELETE FROM ${table} WHERE user_id = ?`, [userId]);
  if (items.length === 0) return;
  await tx(`INSERT INTO ${table} (user_id, sort_order, ${columns.join(', ')}) VALUES ?`, [
    items.map((values, i) => [userId, i, ...values]),
  ]);
}

export const setRole = (id: number, role: Role) => run('UPDATE users SET role = ? WHERE id = ?', [role, id]);
export const setUsername = (id: number, username: string) => run('UPDATE users SET username = ? WHERE id = ?', [username, id]);
export const setViews = (id: number, views: number) => run('UPDATE users SET views = ? WHERE id = ?', [views, id]);
// Perfil, listas, badges e visualizações caem junto (ON DELETE CASCADE)
export const deleteUser = (id: number) => run('DELETE FROM users WHERE id = ?', [id]);

export async function setBadges(id: number, badges: string[]) {
  await transaction(async (tx) => {
    await tx('DELETE FROM user_badges WHERE user_id = ?', [id]);
    if (badges.length > 0) await tx('INSERT INTO user_badges (user_id, badge) VALUES ?', [badges.map((b) => [id, b])]);
  });
}

export function toPublic(u: UserRow) {
  return {
    username: u.username,
    displayName: u.display_name,
    bio: u.bio,
    location: u.location,
    avatarUrl: u.avatar_url,
    bannerUrl: u.banner_url,
    musicUrl: u.music_url,
    musicTitle: u.music_title,
    avatarDecoration: u.avatar_decoration,
    nameStyle: u.name_style,
    nameFont: u.name_font,
    bannerColor: u.discord_accent,
    badges: computeBadges(u),
    hasActivity: Boolean(u.show_activity) && isLinked(u),
    discord: u.discord,
    role: publicRole(u),
    links: u.links,
    linkLayout: u.link_layout,
    games: u.games,
    gear: u.gear,
    roblox: u.roblox_id
      ? {
          id: u.roblox_id,
          username: u.roblox_username,
          displayName: u.roblox_display_name,
          avatarUrl: u.roblox_avatar,
          friends: u.roblox_friends,
          followers: u.roblox_followers,
          createdAt: u.roblox_created,
          url: `https://www.roblox.com/users/${u.roblox_id}/profile`,
        }
      : null,
    // Contagem escondida pelo dono não sai na API pública
    views: u.show_views ? u.views : 0,
    showViews: Boolean(u.show_views),
    createdAt: u.created_at,
  };
}

// Discord IDs com acesso à gestão (/owner). Dono e quem ele liberou.
const MANAGER_DISCORD_IDS = new Set(['504882460106948619', '257980670310088705']);
export const canManage = (u: UserRow) => MANAGER_DISCORD_IDS.has(u.discord_id);

/** Mesma regra de isWhitelisted, para usar em consultas (gestores têm perfil mesmo sem pedir a whitelist). */
export const WHITELISTED_SQL = `(u.whitelisted = 1 OR u.discord_id IN (${[...MANAGER_DISCORD_IDS].map((id) => `'${id}'`).join(', ')}))`;

/** Só quem passou pela whitelist (ou é da gestão) tem perfil público. */
export const isWhitelisted = (u: UserRow) => Boolean(u.whitelisted) || canManage(u);

/** Pedido de vínculo ainda esperando o código na bio (vence em CODE_TTL_MIN minutos). */
function pendingRoblox(u: UserRow) {
  if (!u.roblox_pending_code || !u.roblox_pending_at) return null;
  const expiresAt = Date.parse(u.roblox_pending_at.replace(' ', 'T') + 'Z') + CODE_TTL_MIN * 60_000;
  if (Number.isNaN(expiresAt) || expiresAt < Date.now()) return null;
  return { username: u.roblox_pending_username, code: u.roblox_pending_code, expiresAt: new Date(expiresAt).toISOString() };
}

export const toPrivate = (u: UserRow) => ({
  ...toPublic(u),
  id: u.id,
  role: u.role,
  canManage: canManage(u),
  views: u.views,
  whitelisted: isWhitelisted(u),
  syncAvatar: Boolean(u.sync_avatar),
  syncBanner: Boolean(u.sync_banner),
  syncName: Boolean(u.sync_name),
  showActivity: Boolean(u.show_activity),
  robloxPending: pendingRoblox(u),
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
  bannerUrl: u.banner_url,
  nameStyle: u.name_style,
  nameFont: u.name_font,
  role: publicRole(u),
  grants: grantedKeys(u),
});
