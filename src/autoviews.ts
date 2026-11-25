import { createHash } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import { run } from './db.js';

/** Discord IDs que recebem visualizações automáticas, de MIN a MAX por dia. */
const AUTO_VIEWS_DISCORD_IDS = ['504882460106948619'];
const MIN = 5;
const MAX = 10;

/** Número pseudoaleatório determinístico (0 a 2^32-1) a partir de um texto */
const seeded = (seed: string) => createHash('sha256').update(seed).digest().readUInt32BE(0);

/**
 * Quantas visualizações o dia tem (5 a 10) e em quais minutos do dia (0 a 1439, UTC) cada uma cai.
 * Só depende da data e do ID, então reiniciar a API não muda o plano do dia.
 */
export function viewPlan(discordId: string, day: string): number[] {
  const total = MIN + (seeded(`${discordId}|${day}|total`) % (MAX - MIN + 1));
  const minutes = new Set<number>();
  for (let i = 0; minutes.size < total; i++) minutes.add(seeded(`${discordId}|${day}|${i}`) % 1440);
  return [...minutes];
}

/** A cada minuto, adiciona 1 visualização se aquele minuto foi sorteado: elas caem ao longo do dia, uma a uma. */
export function startAutoViews(log: FastifyBaseLogger) {
  let lastSlot = -1;
  const tick = async () => {
    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    const minute = now.getUTCHours() * 60 + now.getUTCMinutes();
    const slot = Date.parse(day) / 60000 + minute;
    if (slot === lastSlot) return;
    lastSlot = slot;
    for (const id of AUTO_VIEWS_DISCORD_IDS) {
      if (!viewPlan(id, day).includes(minute)) continue;
      try {
        await run('UPDATE users SET views = views + 1 WHERE discord_id = ?', [id]);
      } catch (err) {
        log.warn({ err }, 'visualizações automáticas falharam');
      }
    }
  };
  setInterval(() => void tick(), 20 * 1000).unref();
}
