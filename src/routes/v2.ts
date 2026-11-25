import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireWhitelisted } from '../auth.js';
import { query, queryOne, run, transaction } from '../db.js';
import { env } from '../env.js';
import { firstIssue, mediaImageUrl } from '../schemas.js';
import { canManage, findByUsername, isWhitelisted, type UserRow } from '../users.js';
import { MAX_NOTES_SHOWN, MAX_PHOTOS, V2_LAYOUTS, geocode, isV2, normalizeLayout, profileLevel } from '../v2.js';
import { ipKey } from './profiles.js';

const saveSchema = z.object({
  photos: z
    .array(z.object({ url: mediaImageUrl.refine((u) => u !== '', 'Foto sem endereço'), hidden: z.boolean() }))
    .max(MAX_PHOTOS, `No máximo ${MAX_PHOTOS} fotos`),
  location: z.string().trim().max(80),
  settings: z.object({
    showPhotos: z.boolean(),
    showMap: z.boolean(),
    showNotes: z.boolean(),
    showLevel: z.boolean(),
    layout: z.enum(V2_LAYOUTS),
  }),
});

const noteSchema = z.object({ body: z.string().trim().min(1, 'Escreva o bilhete').max(280, 'Máximo de 280 caracteres') });

const visitorHash = (identity: string) =>
  createHash('sha256').update(`${env.JWT_SECRET}|${identity}`).digest('hex').slice(0, 32);

/** Quem está vendo: conta (cookie) ou, se anônimo, o IP. */
async function viewerOf(req: FastifyRequest) {
  const viewer = await req.jwtVerify<{ id: number }>().catch(() => null);
  return { id: viewer?.id ?? null, hash: visitorHash(viewer?.id ? `u:${viewer.id}` : `ip:${ipKey(req.ip)}`) };
}

/** Perfil existente, público e com a v2 liberada; senão null. */
async function v2User(username: string): Promise<UserRow | null> {
  const user = await findByUsername(username);
  return user && isWhitelisted(user) && isV2(user) ? user : null;
}

interface SettingsRow {
  lat: string | null;
  lng: string | null;
  v2_show_photos: number;
  v2_show_map: number;
  v2_show_notes: number;
  v2_show_level: number;
  v2_layout: string;
}

const loadSettings = (userId: number) =>
  queryOne<SettingsRow>(
    'SELECT lat, lng, v2_show_photos, v2_show_map, v2_show_notes, v2_show_level, v2_layout FROM user_profiles WHERE user_id = ?',
    [userId],
  );

/**
 * Dados da v2. Para o público, o que o dono desligou ou escondeu não sai daqui.
 * Com `all` (o próprio dono no editor) vem tudo, inclusive as fotos escondidas.
 */
async function loadV2(user: UserRow, viewerHash: string, all = false) {
  const s = (await loadSettings(user.id))!;
  const settings = {
    showPhotos: Boolean(s.v2_show_photos),
    showMap: Boolean(s.v2_show_map),
    showNotes: Boolean(s.v2_show_notes),
    showLevel: Boolean(s.v2_show_level),
    layout: normalizeLayout(s.v2_layout),
  };

  const [photos, notes] = await Promise.all([
    all || settings.showPhotos
      ? query<{ id: number; url: string; hidden: number; likes: number; liked: number }>(
          `SELECT p.id, p.url, p.hidden, COUNT(l.visitor) AS likes, COALESCE(MAX(l.visitor = ?), 0) AS liked
           FROM user_photos p LEFT JOIN photo_likes l ON l.photo_id = p.id
           WHERE p.user_id = ? ${all ? '' : 'AND p.hidden = 0'}
           GROUP BY p.id, p.url, p.hidden, p.sort_order ORDER BY p.sort_order, p.id`,
          [viewerHash, user.id],
        )
      : [],
    all || settings.showNotes
      ? query<{ id: number; body: string; created_at: string; author_id: number; username: string; display_name: string; avatar_url: string }>(
          `SELECT n.id, n.body, n.created_at, n.author_id, a.username, p.display_name, p.avatar_url
           FROM profile_notes n JOIN users a ON a.id = n.author_id JOIN user_profiles p ON p.user_id = n.author_id
           WHERE n.profile_id = ? ORDER BY n.id DESC LIMIT ?`,
          [user.id, MAX_NOTES_SHOWN],
        )
      : [],
  ]);

  const hasCoords = s.lat != null && s.lng != null;
  return {
    ownerId: user.id,
    settings,
    level: all || settings.showLevel ? profileLevel(user.created_at) : null,
    map: hasCoords && (all || settings.showMap) ? { lat: Number(s.lat), lng: Number(s.lng), label: user.location } : null,
    photos: photos.map((p) => ({ id: p.id, url: p.url, hidden: Boolean(p.hidden), likes: Number(p.likes), liked: Boolean(Number(p.liked)) })),
    notes: notes.map((n) => ({
      id: n.id,
      body: n.body,
      createdAt: n.created_at,
      authorId: n.author_id,
      author: { username: n.username, displayName: n.display_name, avatarUrl: n.avatar_url },
    })),
  };
}

export default async function v2Routes(app: FastifyInstance) {
  app.get<{ Params: { username: string } }>(
    '/profiles/:username/v2',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const user = await v2User(req.params.username);
      if (!user) return reply.code(404).send({ error: 'Perfil não encontrado' });
      const viewer = await viewerOf(req);
      return { ...(await loadV2(user, viewer.hash)), viewerId: viewer.id };
    },
  );

  // Curtir / descurtir uma foto (uma curtida por visitante). Foto escondida ou seção desligada não recebe.
  app.post<{ Params: { username: string; photoId: string } }>(
    '/profiles/:username/photos/:photoId/like',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const user = await v2User(req.params.username);
      const photoId = Number(req.params.photoId);
      if (!user || !Number.isInteger(photoId)) return reply.code(404).send({ error: 'Foto não encontrada' });
      const photo = await queryOne(
        `SELECT 1 FROM user_photos p JOIN user_profiles pr ON pr.user_id = p.user_id
         WHERE p.id = ? AND p.user_id = ? AND p.hidden = 0 AND pr.v2_show_photos = 1`,
        [photoId, user.id],
      );
      if (!photo) return reply.code(404).send({ error: 'Foto não encontrada' });

      const { hash } = await viewerOf(req);
      const del = await run('DELETE FROM photo_likes WHERE photo_id = ? AND visitor = ?', [photoId, hash]);
      const liked = del.affectedRows === 0;
      if (liked) await run('INSERT IGNORE INTO photo_likes (photo_id, visitor) VALUES (?, ?)', [photoId, hash]);

      const row = await queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM photo_likes WHERE photo_id = ?', [photoId]);
      return { liked, likes: Number(row?.n ?? 0) };
    },
  );

  // Deixar um bilhete: precisa estar logado e na whitelist, e o dono precisa ter deixado a seção ligada
  app.post<{ Params: { username: string } }>(
    '/profiles/:username/notes',
    { preHandler: requireWhitelisted, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const user = await v2User(req.params.username);
      if (!user) return reply.code(404).send({ error: 'Perfil não encontrado' });
      if (!(await loadSettings(user.id))?.v2_show_notes) return reply.code(403).send({ error: 'Esta pessoa desligou os bilhetes' });
      const parsed = noteSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: firstIssue(parsed.error) });

      const me = req.currentUser!;
      const recent = await queryOne<{ n: number }>(
        'SELECT COUNT(*) AS n FROM profile_notes WHERE profile_id = ? AND author_id = ? AND created_at > UTC_TIMESTAMP() - INTERVAL 1 HOUR',
        [user.id, me.id],
      );
      if (Number(recent?.n ?? 0) >= 3) return reply.code(429).send({ error: 'Você já deixou bilhetes demais aqui. Tente mais tarde.' });

      await run('INSERT INTO profile_notes (profile_id, author_id, body) VALUES (?, ?, ?)', [user.id, me.id, parsed.data.body]);
      return reply.code(201).send(await loadV2(user, (await viewerOf(req)).hash));
    },
  );

  // Apagar um bilhete: quem escreveu, o dono do perfil ou a gestão
  app.delete<{ Params: { username: string; noteId: string } }>(
    '/profiles/:username/notes/:noteId',
    { preHandler: requireWhitelisted },
    async (req, reply) => {
      const user = await v2User(req.params.username);
      const noteId = Number(req.params.noteId);
      if (!user || !Number.isInteger(noteId)) return reply.code(404).send({ error: 'Bilhete não encontrado' });
      const note = await queryOne<{ author_id: number }>('SELECT author_id FROM profile_notes WHERE id = ? AND profile_id = ?', [noteId, user.id]);
      if (!note) return reply.code(404).send({ error: 'Bilhete não encontrado' });

      const me = req.currentUser!;
      if (note.author_id !== me.id && user.id !== me.id && !canManage(me)) return reply.code(403).send({ error: 'Sem permissão' });
      await run('DELETE FROM profile_notes WHERE id = ?', [noteId]);
      return reply.code(204).send();
    },
  );

  // Tudo do próprio perfil, inclusive o que está escondido: é o que o editor carrega
  app.get('/me/v2', { preHandler: requireWhitelisted }, async (req, reply) => {
    const me = req.currentUser!;
    if (!isV2(me)) return reply.code(403).send({ error: 'O perfil v2 ainda não está liberado para você' });
    return { ...(await loadV2(me, (await viewerOf(req)).hash, true)), viewerId: me.id };
  });

  // Dono edita fotos, localização do mapa e quais seções aparecem
  app.put('/me/v2', { preHandler: requireWhitelisted }, async (req, reply) => {
    const me = req.currentUser!;
    if (!isV2(me)) return reply.code(403).send({ error: 'O perfil v2 ainda não está liberado para você' });
    const parsed = saveSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: firstIssue(parsed.error) });
    const { photos, location, settings } = parsed.data;

    // Mesma foto duas vezes vale uma só
    const unique = [...new Map(photos.map((p) => [p.url, p])).values()];

    const before = await queryOne<{ lat: string | null; location: string }>('SELECT lat, location FROM user_profiles WHERE user_id = ?', [me.id]);
    const sameSpot = location === (before?.location ?? '') && before?.lat != null;
    const coords = sameSpot ? undefined : await geocode(location);

    await transaction(async (tx) => {
      await tx(
        `UPDATE user_profiles SET v2_show_photos = ?, v2_show_map = ?, v2_show_notes = ?, v2_show_level = ?, v2_layout = ? WHERE user_id = ?`,
        [Number(settings.showPhotos), Number(settings.showMap), Number(settings.showNotes), Number(settings.showLevel), settings.layout, me.id],
      );
      if (!sameSpot) {
        await tx('UPDATE user_profiles SET location = ?, lat = ?, lng = ? WHERE user_id = ?', [location, coords?.lat ?? null, coords?.lng ?? null, me.id]);
      }

      // Fotos que continuam mantêm id (e as curtidas); as que saíram caem, as novas entram
      const current = await query<{ id: number; url: string }>('SELECT id, url FROM user_photos WHERE user_id = ?', [me.id]);
      const keep = new Set(unique.map((p) => p.url));
      const kept = new Map<string, number>();
      for (const p of current) if (keep.has(p.url) && !kept.has(p.url)) kept.set(p.url, p.id);
      const drop = current.filter((p) => kept.get(p.url) !== p.id).map((p) => p.id);
      if (drop.length) await tx('DELETE FROM user_photos WHERE id IN (?)', [drop]);

      for (const [i, p] of unique.entries()) {
        const id = kept.get(p.url);
        if (id) await tx('UPDATE user_photos SET sort_order = ?, hidden = ? WHERE id = ?', [i, Number(p.hidden), id]);
        else await tx('INSERT INTO user_photos (user_id, sort_order, url, hidden) VALUES (?, ?, ?, ?)', [me.id, i, p.url, Number(p.hidden)]);
      }
    });

    const fresh = (await findByUsername(me.username))!;
    return { ...(await loadV2(fresh, (await viewerOf(req)).hash, true)), viewerId: me.id };
  });
}
