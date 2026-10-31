import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import { env } from './env.js';
import { COOKIE_NAME } from './auth.js';
import './db.js';
import { loadCustomBadges } from './badges.js';
import { startPresenceBot } from './presence.js';
import authRoutes from './routes/auth.js';
import factionRoutes from './routes/faction.js';
import managementRoutes from './routes/management.js';
import mediaRoutes from './routes/media.js';
import profileRoutes from './routes/profiles.js';

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

app.get('/health', async () => ({ ok: true }));

await app.register(authRoutes);
await app.register(profileRoutes);
await app.register(mediaRoutes);
await app.register(factionRoutes);
await app.register(managementRoutes);

await loadCustomBadges();

startPresenceBot(app.log);

try {
  await app.listen({ port: env.PORT, host: env.HOST });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
