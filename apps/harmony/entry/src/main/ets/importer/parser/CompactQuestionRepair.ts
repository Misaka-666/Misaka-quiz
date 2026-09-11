/**
 * 紧凑排版修复 — 1:1 移植自 Android CompactQuestionRepair.kt。
 * 紧凑排版只作为兜底候选：必须存在至少两个连续、可解释的选项标记。
 */
import { markerRangesIn } from '../assets/QuestionImageMarker';
import {
  isIndexInStringOrComment,
  looksLikeLeadingCodeOption,
  looksLikeCodeOptionChunk
} from './CodeLikeTextGuard';

class OptionMarker {
  key: string;
  markerStart: number;
  contentStart: number;
  joinedInsideAsciiWord: boolean;
  constructor(key: string, markerStart: number, contentStart: number, joinedInsideAsciiWord: boolean = false) {
    this.key = key;
    this.markerStart = markerStart;
    this.contentStart = contentStart;
    this.joinedInsideAsciiWord = joinedInsideAsciiWord;
  }
}

class ProtectedText {
  text: string;
  replacements: Map<string, string>;
  constructor(text: string, replacements: Map<string, string>) {
    this.text = text;
    this.replacements = replacements;
  }
}

const INLINE_ANSWER_REGEX = /\S\s+(?:[【\[]?\s*(?:答案|正确答案|参考答案|标准答案)\s*[:：])/;
const INLINE_ANALYSIS_REGEX = /\S\s+(?:[【\[]?\s*(?:解析|答案解析|说明)\s*[:：])/;
const PUNCTUATED_MARKER_REGEX = /([A-Ga-g])\s*[.、．:：)）]/g;
const BRACKET_MARKER_REGEX = /[\(（\[【〔〖《]\s*([A-Ga-g])\s*[\)）\]】〕〗》]/g;
const PUNCTUATED_MARKER_FIRST = /([A-Ga-g])\s*[.、．:：)）]/;
const BRACKET_MARKER_FIRST = /[\(（\[【〔〖《]\s*([A-Ga-g])\s*[\)）\]】〕〗》]/;
const ABBREVIATION_TAIL_PUNCTUATION: string[] = [
  ',', '，', ';', '；', ':', '：', ')', '）', ']', '】', '}', '》', '/', '\\'
];

function isAsciiLetter(ch: string): boolean {
  return (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z');
}

function isUpperCaseLetter(ch: string): boolean {
  return ch >= 'A' && ch <= 'Z';
}

function isLowerCaseLetter(ch: string): boolean {
  return ch >= 'a' && ch <= 'z';
}

export function hasCompactPattern(raw: string): boolean {
  if (raw.trim().length === 0) return false;
  return raw.split('\n').some((rawLine: string): boolean => {
    const line = rawLine.trim();
    return line.length >= 4 && (
      findBestCompactOptionRun(protectImageMarkers(line).text) !== null ||
      INLINE_ANSWER_REGEX.test(line) ||
      INLINE_ANALYSIS_REGEX.test(line)
    );
  });
}

export function hasCompactOptionSequence(line: string): boolean {
  if (line.trim().length === 0) return false;
  return findBestCompactOptionRun(protectImageMarkers(line.trim()).text) !== null;
}

// 返回紧凑选项组中实际识别到的字母（去重保序，对应 Kotlin LinkedHashSet）
export function compactOptionKeys(raw: string): string[] {
  if (raw.trim().length === 0) return [];
  const keys: string[] = [];
  for (const rawLine of raw.split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    const run = findBestCompactOptionRun(protectImageMarkers(line).text);
    if (run === null) continue;
    for (const marker of run) {
      const upper = marker.key.toUpperCase();
      if (!keys.includes(upper)) keys.push(upper);
    }
  }
  return keys;
}

// 标准格式只认行首独立选项；英文缩写如 E.U / D.H. 不算。
export function isStandardOptionLine(line: string): boolean {
  const normalized = line.replace(/^\s+/, '');
  const marker = findLeadingMarker(normalized);
  if (marker === null) return false;
  return !looksLikeDottedAbbreviation(normalized, marker) &&
    !looksLikeLeadingCodeOption(normalized, marker.markerStart, marker.contentStart);
}

export function repair(raw: string): string {
  if (raw.trim().length === 0) return raw;
  if (!hasCompactPattern(raw)) return raw;
  const out: string[] = [];
  for (const line of raw.split('\n')) {
    for (const repairedLine of repairLine(line).split('\n')) {
      out.push(repairedLine);
    }
  }
  return out.join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function repairLine(rawLine: string): string {
  const original = rawLine.replace(/\s+$/, '');
  if (original.trim().length === 0) return original;

  const protectedText = protectImageMarkers(original);
  const optionRun = findBestCompactOptionRun(protectedText.text);
  let repaired = optionRun === null ? protectedText.text : splitByOptionRun(protectedText.text, optionRun);

  // 答案、解析粘在题干或最后一个选项后时再做轻量换行。
  repaired = repaired
    .replace(/[ \t]+([【\[]?\s*(?:答案|正确答案|参考答案|标准答案)\s*[:：])/g, '\n$1')
    .replace(/[ \t]+([【\[]?\s*(?:解析|答案解析|说明)\s*[:：])/g, '\n$1');

  return restoreImageMarkers(repaired, protectedText);
}

function splitByOptionRun(line: string, markers: OptionMarker[]): string {
  const pieces: string[] = [];
  const prefix = line.substring(0, markers[0].markerStart).trim();
  if (prefix.length > 0) pieces.push(prefix);

  for (let index = 0; index < markers.length; index++) {
    const marker = markers[index];
    const next = markers[index + 1];
    const end = next !== undefined ? next.markerStart : line.length;
    const optionChunk = line.substring(marker.markerStart, end).trim();
    if (optionChunk.length > 0) pieces.push(optionChunk);
  }
  return pieces.join('\n');
}

function compareRuns(a: OptionMarker[], b: OptionMarker[]): number {
  if (a.length !== b.length) return a.length - b.length;
  const aStartsA = a[0].key.toUpperCase() === 'A' ? 1 : 0;
  const bStartsB = b[0].key.toUpperCase() === 'A' ? 1 : 0;
  if (aStartsA !== bStartsB) return aStartsA - bStartsB;
  return (-a[0].markerStart) - (-b[0].markerStart);
}

function findBestCompactOptionRun(line: string): OptionMarker[] | null {
  const candidates = findCandidateMarkers(line);
  if (candidates.length < 2) return null;

  const runs: OptionMarker[][] = [];
  for (let startIndex = 0; startIndex < candidates.length; startIndex++) {
    const run: OptionMarker[] = [candidates[startIndex]];
    let expected = keyIndex(candidates[startIndex].key) + 1;
    let cursor = startIndex + 1;
    while (cursor < candidates.length && expected >= 1 && expected <= 6) {
      const candidate = candidates[cursor];
      const index = keyIndex(candidate.key);
      if (index === expected) {
        run.push(candidate);
        expected += 1;
        cursor += 1;
      } else {
        break;
      }
    }
    if (isValidCompactRun(line, run)) runs.push(run);
  }

  if (runs.length === 0) return null;
  let best = runs[0];
  for (const run of runs) {
    if (compareRuns(run, best) > 0) best = run;
  }
  return best;
}

function isValidCompactRun(line: string, run: OptionMarker[]): boolean {
  if (run.length < 2) return false;
  const first = run[0];
  const prefix = line.substring(0, first.markerStart).trim();

  // 题干后同行选项必须从 A 开始；从 B/C 开始只允许该行本身就是选项续行。
  if (prefix.length > 0 && first.key.toUpperCase() !== 'A') return false;
  if (first.joinedInsideAsciiWord) return false;

  let codeLikeChunks = 0;
  for (const marker of run) {
    let end = line.length;
    for (const other of run) {
      if (other.markerStart > marker.markerStart) {
        end = other.markerStart;
        break;
      }
    }
    if (looksLikeCodeOptionChunk(line, marker.markerStart, marker.contentStart, end)) {
      codeLikeChunks += 1;
    }
  }
  if (codeLikeChunks >= 2) return false;

  for (let index = 0; index < run.length; index++) {
    const marker = run[index];
    if (marker.joinedInsideAsciiWord && index === 0) return false;
    const next = run[index + 1];
    const end = next !== undefined ? next.markerStart : line.length;
    const content = line.substring(marker.contentStart, end)
      .trim()
      .replace(/^[;；]+/, '')
      .replace(/[;；]+$/, '')
      .trim();
    if (content.length === 0) return false;
  }
  return true;
}

function findCandidateMarkers(line: string): OptionMarker[] {
  const markers: OptionMarker[] = [];

  PUNCTUATED_MARKER_REGEX.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PUNCTUATED_MARKER_REGEX.exec(line)) !== null) {
    const key = m[1];
    if (key === undefined) continue;
    // 捕获组为匹配的第一个字符，组起点即 m.index
    const start = m.index;
    const marker = new OptionMarker(key, start, m.index + m[0].length, isJoinedInsideAsciiWord(line, start));
    if (
      !isIndexInStringOrComment(line, marker.markerStart) &&
      isCandidateBoundaryAllowed(line, marker) &&
      !looksLikeDottedAbbreviation(line, marker) &&
      !looksLikeLeadingCodeOption(line, marker.markerStart, marker.contentStart)
    ) {
      markers.push(marker);
    }
  }

  BRACKET_MARKER_REGEX.lastIndex = 0;
  while ((m = BRACKET_MARKER_REGEX.exec(line)) !== null) {
    const key = m[1];
    if (key === undefined) continue;
    // 组起点 = 匹配起点 + 组前缀（开括号 + \s*）长度；m[0] 中仅出现一次组字符
    const start = m.index;
    const marker = new OptionMarker(key, start, m.index + m[0].length, false);
    if (
      !isIndexInStringOrComment(line, marker.markerStart) &&
      isCandidateBoundaryAllowed(line, marker) &&
      !looksLikeLeadingCodeOption(line, marker.markerStart, marker.contentStart)
    ) {
      markers.push(marker);
    }
  }

  const seen = new Set<string>();
  const distinct: OptionMarker[] = [];
  for (const marker of markers) {
    const dedupeKey = `${marker.markerStart}:${marker.key.toUpperCase()}`;
    if (!seen.has(dedupeKey)) {
      seen.add(dedupeKey);
      distinct.push(marker);
    }
  }
  distinct.sort((a: OptionMarker, b: OptionMarker): number => a.markerStart - b.markerStart);
  return distinct;
}

function findLeadingMarker(line: string): OptionMarker | null {
  const punctMatch = PUNCTUATED_MARKER_FIRST.exec(line);
  if (punctMatch !== null && punctMatch.index === 0 && punctMatch[1] !== undefined) {
    return new OptionMarker(punctMatch[1], 0, punctMatch[0].length);
  }
  const bracketMatch = BRACKET_MARKER_FIRST.exec(line);
  if (bracketMatch !== null && bracketMatch.index === 0 && bracketMatch[1] !== undefined) {
    return new OptionMarker(bracketMatch[1], 0, bracketMatch[0].length);
  }
  return null;
}

function isCandidateBoundaryAllowed(line: string, marker: OptionMarker): boolean {
  if (marker.markerStart === 0) return true;
  const previous = marker.markerStart - 1 < line.length ? line.charAt(marker.markerStart - 1) : null;
  if (previous === null) return true;
  if (previous === '_') return false;
  // DOCX/OCR 常见为 “A.182B.242C.36 D.72”。数字后的大写 B/C/D
  // 只能作为从 A 开始的连续选项组后续标记参与校验，不能单独触发修复。
  if (/[0-9]/.test(previous)) return isUpperCaseLetter(marker.key);

  const keyIsLowercase = isLowerCaseLetter(marker.key);
  if (keyIsLowercase && isAsciiLetter(previous)) return false;

  // 大写粘连标记（A.oneB.two）只作为连续选项组中的后续项保留。
  if (isAsciiLetter(previous) && isUpperCaseLetter(marker.key)) return true;

  return true;
}

function isJoinedInsideAsciiWord(line: string, markerStart: number): boolean {
  if (markerStart <= 0) return false;
  return isAsciiLetter(line.charAt(markerStart - 1));
}

function looksLikeDottedAbbreviation(line: string, marker: OptionMarker): boolean {
  const markerText = line.substring(marker.markerStart, marker.contentStart);
  if (!markerText.includes('.') && !markerText.includes('．')) return false;

  const next = marker.contentStart < line.length ? line.charAt(marker.contentStart) : null;
  if (next === null || !isAsciiLetter(next)) return false;
  const nextNext = marker.contentStart + 1 < line.length ? line.charAt(marker.contentStart + 1) : null;

  // e.g. / D.H. / U.S. 这类连续字母点号。
  if (nextNext === '.' || nextNext === '．') return true;

  // E.U / U.S 这类大写缩写，第二个字母后直接结束、空格或标点。
  if (isUpperCaseLetter(next) &&
    (nextNext === null || /\s/.test(nextNext) || ABBREVIATION_TAIL_PUNCTUATION.includes(nextNext))) {
    return true;
  }
  return false;
}

function protectImageMarkers(line: string): ProtectedText {
  const ranges = markerRangesIn(line);
  if (ranges.length === 0) return new ProtectedText(line, new Map<string, string>());
  const replacements = new Map<string, string>();
  let builder = '';
  let cursor = 0;
  for (let index = 0; index < ranges.length; index++) {
    const range = ranges[index];
    if (range[0] < cursor) continue;
    builder += line.substring(cursor, range[0]);
    const token = `@@MISAKA_IMG_MARKER_${index}@@`;
    replacements.set(token, line.substring(range[0], range[1] + 1));
    builder += token;
    cursor = range[1] + 1;
  }
  if (cursor < line.length) builder += line.substring(cursor);
  return new ProtectedText(builder, replacements);
}

function restoreImageMarkers(text: string, protectedText: ProtectedText): string {
  let restored = text;
  protectedText.replacements.forEach((marker: string, token: string): void => {
    restored = restored.split(token).join(marker);
  });
  return restored;
}

function keyIndex(key: string): number {
  return key.toUpperCase().charCodeAt(0) - 'A'.charCodeAt(0);
}
