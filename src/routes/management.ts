import { randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { requireManager } from '../auth.js';
import { backupPath, listBackups, runBackup } from '../backup.js';
import {
  GRANTABLE,
  customBadges,
  grantedKeys,
  isBuiltinGrant,
  isGrantable,
  grantEventBadge,
  loadCustomBadges,
} from '../badges.js';
import { query, queryOne, run, transaction } from '../db.js';
import { parseSvg } from '../svg.js';
import { dmWhitelistApproved, dmWhitelistRejected } from '../notify.js';
import {
  adminUserSchema,
  badgeDefSchema,
  grantsSchema,
  profileSchema,
  whitelistReviewSchema,
  RESERVED_USERNAMES,
} from '../schemas.js';
import {
  ROLES,
  applySync,
  canManage,
  deleteUser,
  findById,
  findByUsername,
  isLinked,
  isWhitelisted,
  listUsers,
  saveProfile,
  setBadges,
  setRole,
  setUsername,
  setViews,
  toPrivate,
  type UserRow,
} from '../users.js';
import { asRequest, findRequest, listRequests, pendingCount, usernameProblem } from '../whitelist.js';

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
  whitelisted: isWhitelisted(u),
  views: u.views,
  createdAt: u.created_at,
});

const asDetail = (u: UserRow) => ({ ...toPrivate(u), ...asCard(u) });

// Ícones do allsvgicons.com: o SVG é baixado uma vez e guardado, só com formas (nada de script ou link)
const ICON_HOST = 'https://i.allsvgicons.com';

/**
 * Decide o SVG guardado da badge: o .svg enviado, o do allsvgicons ("pacote:nome"),
 * ou o que já estava salvo quando só o texto mudou. null = ícone pronto do site; undefined = falhou.
 */
async function resolveIcon(icon: string, upload?: string, saved?: string): Promise<string | null | undefined> {
  if (upload !== undefined) {
    const svg = parseSvg(upload);
    return svg ? JSON.stringify(svg) : undefined;
  }
  if (icon === 'upload') return saved ?? undefined;

  const [pack, name] = icon.split(':');
  if (!pack || !name) return null;
  try {
    const res = await fetch(`${ICON_HOST}/${pack}/${name}.svg`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return undefined;
    const svg = parseSvg(await res.text());
    return svg ? JSON.stringify(svg) : undefined;
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

  // ---------- Whitelist ----------
  app.get('/management/whitelist', async () => {
    const rows = await listRequests();
    return {
      pending: await pendingCount(),
      items: rows.map((r) => ({
        ...asRequest(r),
        userId: r.user_id,
        discordId: r.discord_id,
        currentUsername: r.current_username,
        displayName: r.display_name,
        avatarUrl: r.avatar_url,
      })),
    };
  });

  // Aprova: o @ pedido vira o link da pessoa, o perfil fica público e o resultado vai por DM
  app.post<{ Params: { id: string } }>('/management/whitelist/:id/approve', async (req, reply) => {
    const parsed = whitelistReviewSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]!.message });

    const request = await findRequest(Number(req.params.id));
    if (!request) return reply.code(404).send({ error: 'Pedido não encontrado' });
    if (request.status !== 'pending') return reply.code(409).send({ error: 'Este pedido já foi decidido' });

    const target = await findById(request.user_id);
    if (!target) return reply.code(404).send({ error: 'Usuário não encontrado' });

    const username = parsed.data.username ?? request.username;
    const problem = await usernameProblem(username, target.id, request.id);
    if (problem) return reply.code(409).send({ error: problem });

    const actor = req.currentUser!;
    try {
      await transaction(async (tx) => {
        // O WHERE garante que dois cliques seguidos não aprovem (e avisem) duas vezes
        const res = await tx(
          "UPDATE whitelist_requests SET status = 'approved', username = ?, reviewed_by = ?, reviewed_at = UTC_TIMESTAMP() WHERE id = ? AND status = 'pending'",
          [username, actor.username, request.id],
        );
        if (res.affectedRows === 0) throw new Error('decidido');
        await tx('UPDATE users SET username = ?, whitelisted = 1 WHERE id = ?', [username, target.id]);
      });
    } catch (err) {
      const code = (err as { errno?: number }).errno;
      if (code === 1062) return reply.code(409).send({ error: 'Esse @usuário já está em uso' });
      if ((err as Error).message === 'decidido') return reply.code(409).send({ error: 'Este pedido já foi decidido' });
      throw err;
    }

    await audit(actor, 'whitelist aprovada', target.username === username ? username : `${target.username} → ${username}`, request.message);
    const dm = await dmWhitelistApproved(target.discord_id, username, req.log);
    return { ok: true, dm, username };
  });

  app.post<{ Params: { id: string } }>('/management/whitelist/:id/reject', async (req, reply) => {
    const parsed = whitelistReviewSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]!.message });
    const reason = parsed.data.reason ?? '';

    const request = await findRequest(Number(req.params.id));
    if (!request) return reply.code(404).send({ error: 'Pedido não encontrado' });
    const target = await findById(request.user_id);
    if (!target) return reply.code(404).send({ error: 'Usuário não encontrado' });

    const actor = req.currentUser!;
    const res = await run(
      "UPDATE whitelist_requests SET status = 'rejected', reason = ?, reviewed_by = ?, reviewed_at = UTC_TIMESTAMP() WHERE id = ? AND status = 'pending'",
      [reason, actor.username, request.id],
    );
    if (res.affectedRows === 0) return reply.code(409).send({ error: 'Este pedido já foi decidido' });

    await audit(actor, 'whitelist recusada', request.username, reason);
    const dm = await dmWhitelistRejected(target.discord_id, reason, req.log);
    return { ok: true, dm };
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

    const { label, desc, color, icon, svgFile } = parsed.data;
    const svg = await resolveIcon(icon, svgFile);
    if (svg === undefined) return reply.code(400).send({ error: 'Ícone inválido. Use um .svg simples, sem scripts nem imagens.' });

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
    await grantEventBadge();
    await audit(req.currentUser!, 'badge criada', label);
    return reply.code(201).send(await withHolders());
  });

  app.put<{ Params: { key: string } }>('/management/badges/:key', async (req, reply) => {
    const parsed = badgeDefSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]!.message });
    if (isBuiltinGrant(req.params.key) || !customBadges().some((b) => b.key === req.params.key)) {
      return reply.code(404).send({ error: 'Badge não encontrada' });
    }

    const { label, desc, color, icon, svgFile } = parsed.data;
    const saved = customBadges().find((b) => b.key === req.params.key)?.svg;
    const svg = await resolveIcon(icon, svgFile, saved && JSON.stringify(saved));
    if (svg === undefined) return reply.code(400).send({ error: 'Ícone inválido. Use um .svg simples, sem scripts nem imagens.' });

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
  // ---------- Backups do banco ----------
  app.get('/management/backups', async () => listBackups());

  app.post('/management/backups', { config: { rateLimit: { max: 3, timeWindow: '1 minute' } } }, async (req, reply) => {
    try {
      const made = await runBackup();
      await audit(req.currentUser!, 'backup criado', made.name);
      return made;
    } catch (err) {
      req.log.error(err, 'falha ao criar o backup');
      return reply.code(500).send({ error: 'Não foi possível criar o backup. O mysqldump está instalado na VPS?' });
    }
  });

  app.get<{ Params: { name: string } }>(
    '/management/backups/:name',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const path = backupPath(req.params.name);
      if (!path || !(await listBackups()).some((b) => b.name === req.params.name)) {
        return reply.code(404).send({ error: 'Backup não encontrado' });
      }
      await audit(req.currentUser!, 'backup baixado', req.params.name);
      return reply
        .header('Content-Type', 'application/sql')
        .header('Content-Disposition', `attachment; filename="${req.params.name}"`)
        .header('Cache-Control', 'no-store')
        .send(createReadStream(path));
    },
  );

  app.get('/management/audit', async () =>
    query<{ id: number; actor: string; action: string; target: string; detail: string; created_at: string }>(
      'SELECT id, actor, action, target, detail, created_at FROM audit_log ORDER BY id DESC LIMIT 200',
    ),
  );
}
