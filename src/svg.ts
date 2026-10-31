import type { IconSvg } from './badges.js';

// Nada que execute ou carregue algo de fora: só formas
const UNSAFE = /<(script|foreignObject|iframe|image|use|style|a|animate|set|link|object|embed)\b|\son\w+\s*=|javascript:|href\s*=|@import|url\(\s*['"]?(?!#)/i;

const MAX_BODY = 12_000;

/**
 * Transforma o texto de um .svg em { viewBox, body } pronto para o perfil, ou undefined se não servir.
 * Cores fixas viram currentColor, para a badge usar a cor escolhida na gestão.
 */
export function parseSvg(text: string): IconSvg | undefined {
  const t = text
    .replace(/<\?xml[\s\S]*?\?>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!DOCTYPE[^>]*>/gi, '')
    .replace(/<(title|desc|metadata)\b[\s\S]*?<\/\1>/gi, '')
    .trim();

  const m = /^<svg\b([^>]*)>([\s\S]*)<\/svg>$/i.exec(t);
  if (!m) return undefined;
  const attrs = m[1]!;

  let viewBox = /\bviewBox\s*=\s*["']([\d.\s,-]+)["']/i.exec(attrs)?.[1]?.trim().replace(/,/g, ' ');
  if (!viewBox) {
    const w = /\bwidth\s*=\s*["']?([\d.]+)/i.exec(attrs)?.[1];
    const h = /\bheight\s*=\s*["']?([\d.]+)/i.exec(attrs)?.[1];
    if (!w || !h) return undefined;
    viewBox = `0 0 ${w} ${h}`;
  }
  if (viewBox.split(/\s+/).length !== 4 || viewBox.split(/\s+/).some((n) => Number.isNaN(Number(n)))) return undefined;

  const body = m[2]!
    .replace(/\b(fill|stroke)\s*=\s*["'](?!none["']|currentColor["'])[^"']*["']/gi, '$1="currentColor"')
    .replace(/\b(fill|stroke)\s*:\s*(?!none\b|currentColor\b)[^;"']+/gi, '$1:currentColor')
    .trim();

  if (!body || body.length > MAX_BODY || UNSAFE.test(body)) return undefined;
  return { viewBox, body };
}
