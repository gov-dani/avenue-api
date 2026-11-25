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
 * Quantas visualizações o dia tem (5 a 10) e em quais horas (UTC) cada uma cai.
 * Só depende da data e do ID, então reiniciar a API não muda o plano do dia.
 */
export function viewPlan(discordId: string, day: string): number[] {
  const total = MIN + (seeded(`${discordId}|${day}|total`) % (MAX - MIN + 1));
  const hours = Array.from({ length: 24 }, (_, h) => h).sort((a, b) => seeded(`${discordId}|${day}|${a}`) - seeded(`${discordId}|${day}|${b}`));
  return hours.slice(0, total);
}

/** A cada hora, adiciona 1 visualização se aquela hora foi sorteada para o dia. */
export function startAutoViews(log: FastifyBaseLogger) {
  let lastSlot = '';
  const tick = async () => {
    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    const slot = `${day}T${now.getUTCHours()}`;
    if (slot === lastSlot) return;
    lastSlot = slot;
    for (const id of AUTO_VIEWS_DISCORD_IDS) {
      if (!viewPlan(id, day).includes(now.getUTCHours())) continue;
      try {
        await run('UPDATE users SET views = views + 1 WHERE discord_id = ?', [id]);
      } catch (err) {
        log.warn({ err }, 'visualizações automáticas falharam');
      }
    }
  };
  void tick();
  setInterval(() => void tick(), 5 * 60 * 1000).unref();
}
