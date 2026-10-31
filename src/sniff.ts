export type Kind = 'image' | 'audio';

export const LIMIT: Record<Kind, number> = { image: 5 * 1024 * 1024, audio: 10 * 1024 * 1024 };

export const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
};

/** Descobre o tipo real pelo conteúdo; o que o cliente declara não é confiável. */
export function sniff(b: Buffer): { ext: string; kind: Kind } | null {
  const at = (s: string, o = 0) => b.subarray(o, o + s.length).toString('latin1') === s;
  if (b.length < 12) return null;
  if (b[0] === 0x89 && at('PNG', 1)) return { ext: 'png', kind: 'image' };
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: 'jpg', kind: 'image' };
  if (at('GIF8')) return { ext: 'gif', kind: 'image' };
  if (at('RIFF') && at('WEBP', 8)) return { ext: 'webp', kind: 'image' };
  if (at('RIFF') && at('WAVE', 8)) return { ext: 'wav', kind: 'audio' };
  if (at('OggS')) return { ext: 'ogg', kind: 'audio' };
  if (at('ID3') || (b[0] === 0xff && (b[1]! & 0xe0) === 0xe0)) return { ext: 'mp3', kind: 'audio' };
  if (at('ftyp', 4)) return { ext: 'm4a', kind: 'audio' };
  return null;
}
