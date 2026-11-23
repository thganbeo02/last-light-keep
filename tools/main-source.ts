// Reads top-level `const NAME = <literal>` values out of the 3.x game source (src/main.js), so the rebuild's
// content files are copied from the game by code, never retyped. Used by tools/extract-content.ts and by the
// parity test that keeps src/content in step with main.js until main.js is retired.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const MAIN_JS = fileURLToPath(new URL('../src/main.js', import.meta.url));
export const mainSource = () => readFileSync(MAIN_JS, 'utf8');

const OPEN = '([{', CLOSE = ')]}';

/** The initializer text of `const NAME = …` up to its terminating `;` at depth 0. */
export function constText(src: string, name: string): string {
  const head = new RegExp(`^const ${name} = `, 'm').exec(src);
  if (!head) throw new Error(`const ${name} not found in main.js`);
  let i = head.index + head[0].length, depth = 0;
  const start = i;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); continue; }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i) + 1; continue; }
    if (c === "'" || c === '"' || c === '`') { // skip a string; template ${} holes hold no top-level ; we care about
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === '\\') i++;
      continue;
    }
    if (OPEN.includes(c)) depth++;
    else if (CLOSE.includes(c)) depth--;
    else if ((c === ';' || c === '\n') && depth === 0) break;
  }
  return src.slice(start, i).trim();
}

/** Evaluates a const that is plain data (it may hold functions, but must not reference other identifiers). */
export function readConst<T = unknown>(src: string, name: string, scope: Record<string, unknown> = {}): T {
  const text = constText(src, name);
  return new Function(...Object.keys(scope), `return (${text});`)(...Object.values(scope)) as T;
}
