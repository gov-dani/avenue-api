import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import { env, isProd } from './env.js';
import { COOKIE_NAME } from './auth.js';
import './db.js';
import { grantEventBadge, loadCustomBadges } from './badges.js';
import { startBackupSchedule } from './backup.js';
import { startPresenceBot } from './presence.js';
import authRoutes from './routes/auth.js';
import factionRoutes from './routes/faction.js';
import managementRoutes from './routes/management.js';
import mediaRoutes from './routes/media.js';
import profileRoutes from './routes/profiles.js';
import whitelistRoutes from './routes/whitelist.js';

const app = Fastify({ logger: true, trustProxy: true, bodyLimit: 100_000 });

await app.register(cors, {
  origin: env.WEB_ORIGIN.split(',').map((o) => o.trim()),
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
});
await app.register(cookie);
await app.register(jwt, {
  secret: env.JWT_SECRET,
  cookie: { cookieName: COOKIE_NAME, signed: false },
});
await app.register(rateLimit, { global: true, max: 120, timeWindow: '1 minute' });

// A API só devolve JSON/mídia: cabeçalhos que travam o que o navegador poderia fazer com ela
app.addHook('onSend', async (_req, reply) => {
  reply
    .header('X-Content-Type-Options', 'nosniff')
    .header('X-Frame-Options', 'DENY')
    .header('Referrer-Policy', 'no-referrer')
    .header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  if (isProd) reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
});

app.get('/health', async () => ({ ok: true }));

await app.register(authRoutes);
await app.register(profileRoutes);
await app.register(whitelistRoutes);
await app.register(mediaRoutes);
await app.register(factionRoutes);
await app.register(managementRoutes);

await loadCustomBadges();
await grantEventBadge();

startPresenceBot(app.log);
startBackupSchedule(app.log);

try {
  await app.listen({ port: env.PORT, host: env.HOST });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
