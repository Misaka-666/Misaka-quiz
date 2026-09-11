/**
 * 章节范围解析 — 1:1 移植自 Android ChapterScopeParser.kt。
 */
import { normalizeQuestionIndex } from './ParserUtils';

const CHAPTER_REGEX = /第\s*([一二三四五六七八九十百0-9]+)\s*章/;

export function normalizeChapter(raw: string): string {
  const match = CHAPTER_REGEX.exec(raw);
  const token = match !== null && match[1] !== undefined ? match[1] : '';
  if (token.trim().length === 0) {
    return '';
  }
  const number = normalizeQuestionIndex(token);
  return number.length > 0 ? `第${number}章` : `第${token}章`;
}

export function hasChapter(raw: string): boolean {
  return normalizeChapter(raw).length > 0;
}
