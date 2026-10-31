const HOUR = 60 * 60 * 1000;

/** Teto de envios por usuário. Fica em memória: reiniciar a API zera, o que é aceitável. */
export function createQuota(maxUploads: number, maxBytes: number, windowMs = HOUR, now: () => number = Date.now) {
  const used = new Map<number, { start: number; count: number; bytes: number }>();

  return {
    /** Reserva o envio; false se o usuário já passou do teto na janela atual. */
    take(userId: number, size: number): boolean {
      const t = now();
      let u = used.get(userId);
      if (!u || t - u.start >= windowMs) {
        u = { start: t, count: 0, bytes: 0 };
        used.set(userId, u);
      }
      if (u.count + 1 > maxUploads || u.bytes + size > maxBytes) return false;
      u.count += 1;
      u.bytes += size;
      return true;
    },
    /** Devolve a reserva quando o envio falhou depois. */
    refund(userId: number, size: number) {
      const u = used.get(userId);
      if (u) {
        u.count = Math.max(0, u.count - 1);
        u.bytes = Math.max(0, u.bytes - size);
      }
    },
  };
}

export const uploadQuota = createQuota(30, 60 * 1024 * 1024);
