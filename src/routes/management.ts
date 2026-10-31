import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { requireManager } from '../auth.js';
import {
  GRANTABLE,
  customBadges,
  grantedKeys,
  isBuiltinGrant,
  isGrantable,
  loadCustomBadges,
} from '../badges.js';
import { query, queryOne, run } from '../db.js';
import { adminUserSchema, badgeDefSchema, grantsSchema, profileSchema, RESERVED_USERNAMES } from '../schemas.js';
import {
  ROLES,
  applySync,
  canManage,
  deleteUser,
  findByUsername,
  isLinked,
  listUsers,
  saveProfile,
  setBadges,
  setRole,
  setUsername,
  setViews,
  toPrivate,
  type UserRow,
} from '../users.js';

// Badges que não se concedem à mão: vêm do cargo ou do perfil
const AUTOMATIC = [
  { key: 'fundador', label: 'Fundador', rule: 'Cargo Fundador' },
  { key: 'lider', label: 'Liderança', rule: 'Cargo Líder' },
  { key: 'equipe', label: 'Equipe', rule: 'Cargo Equipe' },
  { key: 'membro', label: 'Membro', rule: 'Cargo Membro' },
  { key: 'dev', label: 'Desenvolvedor', rule: 'Exclusiva do dono (por Discord ID)' },
  { key: 'desde', label: 'Na Avenue', rule: 'Qualquer cargo acima de visitante' },
  { key: 'discord', label: 'Discord vinculado', rule: 'Conta ligada ao Discord' },
  { key: 'streamer', label: 'Criador de conteúdo', rule: 'Tem link de Twitch, Kick ou YouTube' },
  { key: 'gamer', label: 'Gamer', rule: '3 ou mais jogos no perfil' },
  { key: 'setup', label: 'Setup montado', rule: '4 ou mais periféricos' },
  { key: 'popular', label: 'Popular', rule: '100 ou mais visualizações' },
];

const asCard = (u: UserRow) => ({
  id: u.id,
  username: u.username,
  displayName: u.display_name,
  avatarUrl: u.avatar_url,
  role: u.role,
  grants: grantedKeys(u),
  discordId: u.discord_id,
  linked: isLinked(u),
  views: u.views,
  createdAt: u.created_at,
});

const asDetail = (u: UserRow) => ({ ...toPrivate(u), ...asCard(u) });

// Ícones do allsvgicons.com: o SVG é baixado uma vez e guardado, só com formas (nada de script ou link)
const ICON_HOST = 'https://i.allsvgicons.com';
const UNSAFE_SVG = /<(script|foreignObject|iframe|image|use|style|a|animate|set)\b|\son\w+\s*=|javascript:|href\s*=/i;

async function fetchIcon(icon: string): Promise<string | null | undefined> {
  const [pack, name] = icon.split(':');
  if (!pack || !name) return null; // ícone pronto do site, sem SVG guardado
  try {
    const res = await fetch(`${ICON_HOST}/${pack}/${name}.svg`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return undefined;
    const m = /^<svg[^>]*\sviewBox="([\d.\s-]+)"[^>]*>([\s\S]*)<\/svg>\s*$/.exec((await res.text()).trim());
    if (!m || m[2]!.length > 8000 || UNSAFE_SVG.test(m[2]!)) return undefined;
    return JSON.stringify({ viewBox: m[1], body: m[2] });
  } catch {
    return undefined;
  }
}

const ts = (sql: string) => Date.parse(`${sql.replace(' ', 'T')}Z`);

export default async function managementRoutes(app: FastifyInstance) {
  app.addHook('preHandler', async (req, reply) => {
    if (req.url.startsWith('/management')) return requireManager(req, reply);
  });

  const audit = (actor: UserRow, action: string, target = '', detail = '') =>
    run('INSERT INTO audit_log (actor, action, target, detail) VALUES (?, ?, ?, ?)', [
      actor.username,
      action,
      target.slice(0, 64),
      detail.slice(0, 300),
    ]);

  // ---------- Visão geral ----------
  app.get('/management/overview', async () => {
    const users = await listUsers();
    const week = Date.now() - 7 * 24 * 60 * 60 * 1000;

    const byRole = Object.fromEntries(ROLES.map((r) => [r, users.filter((u) => u.role === r).length]));
    const mini = (u: UserRow) => ({
      username: u.username,
      displayName: u.display_name,
      avatarUrl: u.avatar_url,
      role: u.role,
      views: u.views,
      createdAt: u.created_at,
    });

    return {
      total: users.length,
      linked: users.filter(isLinked).length,
      newThisWeek: users.filter((u) => ts(u.created_at) >= week).length,
      views: users.reduce((n, u) => n + u.views, 0),
      grants: users.reduce((n, u) => n + grantedKeys(u).length, 0),
      customBadges: customBadges().length,
      byRole,
      topViewed: [...users].sort((a, b) => b.views - a.views).slice(0, 5).map(mini),
      recent: [...users].sort((a, b) => ts(b.created_at) - ts(a.created_at)).slice(0, 6).map(mini),
    };
  });

  // ---------- Usuários ----------
  app.get('/management/users', async () => {
    const rows = await listUsers(undefined, 'u.created_at DESC');
    return rows.map(asCard);
  });

  app.get<{ Params: { username: string } }>('/management/users/:username', async (req, reply) => {
    const target = await findByUsername(req.params.username);
    if (!target) return reply.code(404).send({ error: 'Usuário não encontrado' });
    return asDetail(target);
  });

  // Edita o perfil inteiro de qualquer pessoa (mesmos campos e regras do painel)
  app.put<{ Params: { username: string } }>('/management/users/:username/profile', async (req, reply) => {
    const parsed = profileSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]!.message });

    const target = await findByUsername(req.params.username);
    if (!target) return reply.code(404).send({ error: 'Usuário não encontrado' });

    await saveProfile(target.id, parsed.data, isLinked(target));
    await applySync(target.id);
    await audit(req.currentUser!, 'perfil editado', target.username);
    return asDetail((await findByUsername(target.username))!);
  });

  // Cargo, @usuário (a URL do perfil) e visualizações
  app.patch<{ Params: { username: string } }>('/management/users/:username', async (req, reply) => {
    const parsed = adminUserSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]!.message });
    const { role, username, views } = parsed.data;

    const target = await findByUsername(req.params.username);
    if (!target) return reply.code(404).send({ error: 'Usuário não encontrado' });
    const actor = req.currentUser!;

    if (username && username !== target.username) {
      if (RESERVED_USERNAMES.has(username.toLowerCase())) {
        return reply.code(400).send({ error: 'Esse @usuário é reservado' });
      }
      const taken = await queryOne<{ id: number }>('SELECT id FROM users WHERE username = ? AND id != ?', [
        username,
        target.id,
      ]);
      if (taken) return reply.code(409).send({ error: 'Esse @usuário já está em uso' });
      await setUsername(target.id, username);
      await audit(actor, 'url alterada', target.username, `@${target.username} → @${username}`);
    }
    if (role && role !== target.role) {
      await setRole(target.id, role);
      await audit(actor, 'cargo alterado', target.username, `${target.role} → ${role}`);
    }
    if (views !== undefined && views !== target.views) {
      await setViews(target.id, views);
      await audit(actor, 'visualizações alteradas', target.username, `${target.views} → ${views}`);
    }

    return asDetail((await findByUsername(username ?? target.username))!);
  });

  app.put<{ Params: { username: string } }>('/management/users/:username/badges', async (req, reply) => {
    const parsed = grantsSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Badge inválida' });
    if (!parsed.data.badges.every(isGrantable)) return reply.code(400).send({ error: 'Badge inexistente' });

    const target = await findByUsername(req.params.username);
    if (!target) return reply.code(404).send({ error: 'Usuário não encontrado' });

    const badges = [...new Set(parsed.data.badges)];
    await setBadges(target.id, badges);
    await audit(req.currentUser!, 'badges alteradas', target.username, badges.join(', ') || 'nenhuma');
    return asDetail((await findByUsername(target.username))!);
  });

  app.delete<{ Params: { username: string } }>('/management/users/:username', async (req, reply) => {
    const target = await findByUsername(req.params.username);
    if (!target) return reply.code(404).send({ error: 'Usuário não encontrado' });
    if (canManage(target)) return reply.code(403).send({ error: 'Esta conta não pode ser apagada' });

    await deleteUser(target.id);
    await audit(req.currentUser!, 'conta apagada', target.username, target.display_name);
    return reply.code(204).send();
  });

  // ---------- Badges ----------
  async function withHolders() {
    const rows = await query<{ badge: string; n: number }>('SELECT badge, COUNT(*) AS n FROM user_badges GROUP BY badge');
    const count = new Map(rows.map((r) => [r.badge, Number(r.n)]));
    return {
      granted: Object.entries(GRANTABLE).map(([key, b]) => ({ key, ...b, holders: count.get(key) ?? 0 })),
      custom: customBadges().map((b) => ({ ...b, holders: count.get(b.key) ?? 0 })),
      automatic: AUTOMATIC,
    };
  }

  app.get('/management/badges', withHolders);

  app.post('/management/badges', async (req, reply) => {
    const parsed = badgeDefSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]!.message });
    if (customBadges().length >= 40) return reply.code(400).send({ error: 'Limite de 40 badges criadas' });

    const { label, desc, color, icon } = parsed.data;
    const svg = await fetchIcon(icon);
    if (svg === undefined) return reply.code(400).send({ error: 'Não foi possível carregar esse ícone' });

    const key = `c_${randomBytes(5).toString('hex')}`;
    await run('INSERT INTO badge_defs (badge_key, label, description, color, icon, icon_svg) VALUES (?, ?, ?, ?, ?, ?)', [
      key,
      label,
      desc,
      color.toLowerCase(),
      icon,
      svg,
    ]);
    await loadCustomBadges();
    await audit(req.currentUser!, 'badge criada', label);
    return reply.code(201).send(await withHolders());
  });

  app.put<{ Params: { key: string } }>('/management/badges/:key', async (req, reply) => {
    const parsed = badgeDefSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]!.message });
    if (isBuiltinGrant(req.params.key) || !customBadges().some((b) => b.key === req.params.key)) {
      return reply.code(404).send({ error: 'Badge não encontrada' });
    }

    const { label, desc, color, icon } = parsed.data;
    const svg = await fetchIcon(icon);
    if (svg === undefined) return reply.code(400).send({ error: 'Não foi possível carregar esse ícone' });

    await run('UPDATE badge_defs SET label = ?, description = ?, color = ?, icon = ?, icon_svg = ? WHERE badge_key = ?', [
      label,
      desc,
      color.toLowerCase(),
      icon,
      svg,
      req.params.key,
    ]);
    await loadCustomBadges();
    await audit(req.currentUser!, 'badge editada', label);
    return withHolders();
  });

  app.delete<{ Params: { key: string } }>('/management/badges/:key', async (req, reply) => {
    const badge = customBadges().find((b) => b.key === req.params.key);
    if (!badge) return reply.code(404).send({ error: 'Badge não encontrada' });

    await run('DELETE FROM user_badges WHERE badge = ?', [badge.key]);
    await run('DELETE FROM badge_defs WHERE badge_key = ?', [badge.key]);
    await loadCustomBadges();
    await audit(req.currentUser!, 'badge apagada', badge.label);
    return withHolders();
  });

  // ---------- Histórico ----------
  app.get('/management/audit', async () =>
    query<{ id: number; actor: string; action: string; target: string; detail: string; created_at: string }>(
      'SELECT id, actor, action, target, detail, created_at FROM audit_log ORDER BY id DESC LIMIT 200',
    ),
  );
}
