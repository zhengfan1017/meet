import { EMO_LABELS } from '../mood.js';

const MARKER_RE = /\[\[(emo|mem):([^\]\n]*)\]\]/g;
const MEM_MAX_LEN = 30;

export function extractTags(raw) {
  const text = typeof raw === 'string' ? raw : '';
  const matches = [...text.matchAll(MARKER_RE)];
  if (matches.length === 0) {
    return { content: text.trim(), emo: null, memories: [] };
  }

  // 定位结尾处连续的标记块起点：相邻标记之间只允许空白
  let blockStart = matches[matches.length - 1].index;
  for (let i = matches.length - 1; i > 0; i -= 1) {
    const gap = text.slice(matches[i - 1].index + matches[i - 1][0].length, matches[i].index);
    if (gap.trim() === '') blockStart = matches[i - 1].index;
    else break;
  }

  const tail = text.slice(blockStart).replace(MARKER_RE, '').trim();
  if (tail !== '') {
    // 标记块后面还有正文 → 整体视为普通文本，不做任何解析
    return { content: text.trim(), emo: null, memories: [] };
  }

  const block = matches.filter((m) => m.index >= blockStart);
  const emoRaw = (block.find((m) => m[1] === 'emo') || [])[2];
  const emo = EMO_LABELS.includes(String(emoRaw || '').trim().toLowerCase())
    ? String(emoRaw).trim().toLowerCase()
    : null;

  const memories = block
    .filter((m) => m[1] === 'mem')
    .map((m) => m[2].trim())
    .filter((s) => s.length > 0)
    .map((s) => s.slice(0, MEM_MAX_LEN));

  const content = text.slice(0, blockStart).trim();
  return { content, emo, memories };
}

export function stripMarkers(text) {
  return String(text || '')
    .replace(/\[\[(emo|mem):[^\]\n]*\]\]/g, '')
    .replace(/\[\[[^\n]*$/, '')
    .trim();
}
