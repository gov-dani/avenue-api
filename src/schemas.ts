import { z } from 'zod';

export const RESERVED_USERNAMES = new Set([
  'api', 'admin', 'login', 'registro', 'painel', 'membros', 'entrar', 'sair',
  'management', 'owner', 'sobre', 'termos', 'privacidade', 'cookies', 'lgpd', 'contato', 'ajuda', 'static', 'assets', '_next', 'favicon',
]);

const httpUrl = z
  .string()
  .trim()
  .max(500)
  .regex(/^https?:\/\//i, 'A URL precisa começar com http:// ou https://');

// Link externo ou arquivo enviado para o nosso próprio /media
const mediaUrl = z.union([
  httpUrl,
  z.string().regex(/^\/api\/media\/[a-f0-9]{32}\.(png|jpg|gif|webp|mp3|ogg|wav|m4a)$/),
  z.literal(''),
]);

// Foto do periférico: link externo (Imgur, Discord...) ou imagem enviada para o /media
const mediaImageUrl = z.union([
  httpUrl,
  z.string().regex(/^\/api\/media\/[a-f0-9]{32}\.(png|jpg|gif|webp)$/),
  z.literal(''),
]);

// Decoração do avatar: uma das prontas (/decorations no site) ou um arquivo enviado
const decorationUrl = z.union([
  z.string().regex(/^\/decorations\/[a-z0-9-]+\.(gif|png|webp)$/),
  z.string().regex(/^\/api\/media\/[a-f0-9]{32}\.(png|gif|webp)$/),
  z.literal(''),
]);

// Estilos do nome (efeitos em CSS no site). A lista com os rótulos fica em web/lib/namestyles.ts
export const NAME_STYLES = ['', 'ouro', 'fogo', 'oceano', 'aurora', 'neon', 'gelo', 'toxico', 'galaxia', 'glitch', 'cromo'] as const;

// Fontes do nome. Os rótulos e o CSS de cada uma ficam em web/lib/namestyles.ts
export const NAME_FONTS = ['', 'poppins', 'fantasia', 'classica', 'elegante', 'cursiva', 'manuscrita', 'grafite', 'tech', 'retro', 'terror', 'pixel', 'redonda'] as const;

// Efeitos da tela de entrada. Os rótulos ficam em web/lib/gate.ts
export const GATE_EFFECTS = ['stars', 'shooting', 'glow', 'sparkles', 'fireflies', 'snow'] as const;

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Cor inválida');

export const gateSchema = z.object({
  enabled: z.boolean(),
  text: z.string().trim().max(60),
  effects: z.array(z.enum(GATE_EFFECTS)).max(GATE_EFFECTS.length),
  color: hexColor,
  bg: hexColor,
});

export const profileSchema = z.object({
  displayName: z.string().trim().min(1, 'Informe um nome').max(40),
  nameStyle: z.enum(NAME_STYLES),
  nameFont: z.enum(NAME_FONTS),
  bio: z.string().trim().max(280),
  location: z.string().trim().max(60),
  avatarUrl: mediaUrl,
  bannerUrl: mediaUrl,
  musicUrl: mediaUrl,
  musicTitle: z.string().trim().max(60),
  avatarDecoration: decorationUrl,
  syncAvatar: z.boolean(),
  syncBanner: z.boolean(),
  syncName: z.boolean(),
  showActivity: z.boolean(),
  showViews: z.boolean(),
  linkLayout: z.enum(['list', 'grid', 'icons']),
  gate: gateSchema,
  discord: z.string().trim().max(120),
  links: z
    .array(z.object({ label: z.string().trim().min(1).max(40), url: httpUrl }))
    .max(12),
  games: z
    .array(z.object({ name: z.string().trim().min(1).max(60), detail: z.string().trim().max(60) }))
    .max(12),
  gear: z
    .array(z.object({ category: z.string().trim().min(1).max(30), name: z.string().trim().min(1).max(80), image: mediaImageUrl }))
    .max(16),
});

/** Primeira mensagem de erro; as genéricas ("Invalid input") ganham o nome do campo que falhou. */
export function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0]!;
  if (issue.message !== 'Invalid input' && !issue.message.startsWith('Invalid input:')) return issue.message;
  const field = issue.path.join('.');
  return field ? `Valor inválido em "${field}"` : issue.message;
}

export const membersQuerySchema = z.object({
  q: z.string().trim().max(40).optional(),
  role: z.enum(['membro', 'equipe', 'lider', 'fundador']).optional(),
});

// Quais badges existem é decidido na rota (as de fábrica + as criadas em /owner)
export const grantsSchema = z.object({
  badges: z.array(z.string().max(20)).max(60),
});

export const BADGE_ICONS = [
  'star', 'heart', 'crown', 'bolt', 'shield', 'flame', 'gem', 'trophy', 'code',
  'music', 'gamepad', 'rocket', 'skull', 'moon', 'sun', 'check', 'camera', 'mic',
] as const;

export const badgeDefSchema = z.object({
  label: z.string().trim().min(1, 'Informe o nome da badge').max(40),
  desc: z.string().trim().max(120),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Cor inválida'),
  // Um dos ícones prontos ou "pacote:nome" de um ícone do allsvgicons.com
  icon: z.union([z.enum(BADGE_ICONS), z.literal('upload'), z.string().regex(/^[a-z0-9-]{1,40}:[a-z0-9_.-]{1,80}$/, 'Ícone inválido')]),
  // Texto de um .svg enviado pelo dono (vira icon = 'upload')
  svgFile: z.string().max(40_000).optional(),
  // Badge temporária: manual (sem prazo) · signup (quem criar conta até `until`) · everyone (todos até `until`) · people (`days` dias a quem receber)
  mode: z.enum(['manual', 'signup', 'everyone', 'people']).default('manual'),
  until: z.string().datetime({ offset: true }).optional(),
  days: z.number().int().min(1).max(3650).optional(),
}).superRefine((b, ctx) => {
  if ((b.mode === 'signup' || b.mode === 'everyone') && !b.until) ctx.addIssue({ code: 'custom', message: 'Informe até quando', path: ['until'] });
  if (b.mode === 'people' && !b.days) ctx.addIssue({ code: 'custom', message: 'Informe quantos dias a badge dura', path: ['days'] });
});

export const adminUserSchema = z.object({
  role: z.enum(['visitante', 'membro', 'equipe', 'lider', 'fundador']).optional(),
  username: z.string().regex(/^[a-zA-Z0-9_]{3,32}$/, 'Use de 3 a 32 letras, números ou _').optional(),
  views: z.number().int().min(0).max(1_000_000_000).optional(),
});

const usernameField = z.string().regex(/^[a-zA-Z0-9_]{3,32}$/, 'Use de 3 a 32 letras, números ou _');

export const whitelistRequestSchema = z.object({
  username: usernameField,
  message: z.string().trim().max(300),
});

export const whitelistReviewSchema = z.object({
  // Na aprovação a gestão pode ajustar o @ pedido; na recusa, explicar o motivo
  username: usernameField.optional(),
  reason: z.string().trim().max(300).optional(),
});

export const themeSchema = z.object({
  // '' volta para a cor automática (a surpresa fixa, se houver, ou o dourado)
  theme: z.union([z.literal(''), z.enum(['gold', 'pink', 'blue', 'purple', 'green', 'red', 'orange', 'cyan']), z.string().regex(/^#[0-9a-fA-F]{6}$/).transform((h) => h.toLowerCase())]),
});

export const themeAccessSchema = z.object({ allowed: z.boolean() });
