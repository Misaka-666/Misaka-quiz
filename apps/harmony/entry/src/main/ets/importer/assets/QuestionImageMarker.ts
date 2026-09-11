/**
 * DOCX 图片占位标记 — 1:1 移植自 Android QuestionImageMarker.kt。
 * 正则从 Kotlin 原始字符串逐字拷贝；'g' 副本仅用于 replace/findAll。
 */

const MARKER_REGEX_SOURCE =
  '(?:\\[\\s*){0,2}MISAKA_IMAGE\\s*:\\s*(img_\\d{4})(?:\\s*]){0,2}|(?:[【\\[]\\s*){1,2}MISAKA_IMAGE\\s*:\\s*(img_\\d{4})(?:\\s*[】\\]]){1,2}';
const MARKER_REGEX = new RegExp(MARKER_REGEX_SOURCE, 'i');
const MARKER_REGEX_GLOBAL = new RegExp(MARKER_REGEX_SOURCE, 'gi');

export function canonicalMarker(id: string): string {
  return `[[MISAKA_IMAGE:${id.trim()}]]`;
}

export function markerId(raw: string): string | null {
  const match = MARKER_REGEX.exec(raw);
  if (match === null) return null;
  const groups = [match[1], match[2]];
  for (const group of groups) {
    if (group !== undefined && group.trim().length > 0) {
      return group.trim();
    }
  }
  return null;
}

export function canonicalizeMarkers(text: string): string {
  if (!containsMarker(text)) return text;
  return text.replace(MARKER_REGEX_GLOBAL, (matched: string): string => {
    const id = markerId(matched);
    return id === null ? '' : canonicalMarker(id);
  });
}

export function containsMarker(text: string): boolean {
  return MARKER_REGEX.test(text);
}

// 返回标记的 [start, end] 闭区间列表（对应 Kotlin IntRange）
export function markerRangesIn(text: string): number[][] {
  if (text.trim().length === 0) return [];
  const ranges: number[][] = [];
  MARKER_REGEX_GLOBAL.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MARKER_REGEX_GLOBAL.exec(text)) !== null) {
    ranges.push([m.index, m.index + m[0].length - 1]);
  }
  return ranges;
}

export function markerIdsIn(text: string): string[] {
  if (text.trim().length === 0) return [];
  const ids: string[] = [];
  MARKER_REGEX_GLOBAL.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MARKER_REGEX_GLOBAL.exec(text)) !== null) {
    const id = markerId(m[0]);
    if (id !== null && !ids.includes(id)) {
      ids.push(id);
    }
  }
  return ids;
}

export function removeAllMarkers(text: string): string {
  if (!containsMarker(text)) return text.trim();
  return text.replace(MARKER_REGEX_GLOBAL, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
