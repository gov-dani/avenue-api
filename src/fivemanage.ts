import { env } from './env.js';

const ENDPOINT = 'https://api.fivemanage.com/api/image';

export const fivemanageEnabled = Boolean(env.FIVEMANAGE_API_KEY);

/** Sobe a imagem para o Fivemanage e devolve o endereço público dela. */
export async function uploadImage(
  data: Buffer,
  ext: string,
  mime: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(data)], { type: mime }), `upload.${ext}`);

  const res = await fetchImpl(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: env.FIVEMANAGE_API_KEY ?? '' },
    body: form,
    signal: AbortSignal.timeout(20_000),
  });
  const body = (await res.json().catch(() => null)) as { url?: string; data?: { url?: string } } | null;
  const url = body?.url ?? body?.data?.url;
  if (!res.ok || typeof url !== 'string' || !url.startsWith('https://')) {
    throw new Error(`Fivemanage respondeu ${res.status}`);
  }
  return url;
}
