/**
 * 代码外形守卫 — 1:1 移植自 Android CodeLikeTextGuard.kt。
 * 仅拦截高置信度的代码语法外形；不是编程语言解析器。
 */

const EMPTY_PARENTHESES_REGEX = /[\(（]\s*[\)）]/g;
const DECIMAL_EXPRESSION_REGEX = /^\s*\d+\.\d+(?:[fFdDlL])?(?=\s*(?:[+\-*/%<>=]|\.\d|$))/;
const DOTTED_NUMERIC_REGEX = /^\s*(?:\d{1,3}\.){2,}\d{1,4}(?=\s|$|[/:+\-*])/;
const DIRECT_CALL_REGEX = /^\s*(?:[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*|[A-Za-z_]\w*\s*\[[^\]]+])\s*\([^\r\n]*\)\s*(?:[;{]\s*)?$/;
const CONTROL_CALL_REGEX = /^\s*(?:if|while|for|switch|catch|assert|when)\s*\([^\r\n]*\)\s*(?:[;{]\s*)?$/i;
const ASSIGNMENT_REGEX = /^\s*(?:[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*|[A-Za-z_]\w*\s*\[[^\]]+])\s*(?:=|\+=|-=|\*=|\/=|%=|:=)\s*.+;?\s*$/;
const MEMBER_ACCESS_SEQUENCE_REGEX = /^\s*[A-Ga-g]\.[A-Za-z_]\w*(?:\([^\r\n]*?\))?(?:\s*[,;]\s*[A-Ga-g]\.[A-Za-z_]\w*(?:\([^\r\n]*?\))?){1,}\s*$/;
const IDENTIFIER_LEAD_REGEX = /^[A-Za-z_]\w*/;

function isAsciiIdentifierPart(ch: string): boolean {
  return /[A-Za-z0-9_]/.test(ch);
}

function containsCjk(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0x3400 && code <= 0x9FFF) {
      return true;
    }
  }
  return false;
}

function startsWithComment(text: string): boolean {
  return text.startsWith('//') || text.startsWith('#') || text.startsWith('/*') || text.startsWith('*/');
}

function isCommentBoundary(text: string, index: number): boolean {
  if (index === 0) {
    return true;
  }
  const previous = text.charAt(index - 1);
  return /\s/.test(previous) || [';', '{', '}', '(', ')', '[', ']'].includes(previous);
}

function isApostropheInsideWord(text: string, index: number): boolean {
  const before = index > 0 ? text.charAt(index - 1) : null;
  const after = index + 1 < text.length ? text.charAt(index + 1) : null;
  return before !== null && isAsciiIdentifierPart(before) && after !== null && isAsciiIdentifierPart(after);
}

// 返回字符串/注释的保护区间 [start, end]（含端点）
function protectedRanges(text: string): number[][] {
  const ranges: number[][] = [];
  let index = 0;
  while (index < text.length) {
    const ch = text.charAt(index);
    if (ch === '/' && text.charAt(index + 1) === '/' && isCommentBoundary(text, index)) {
      ranges.push([index, text.length - 1]);
      break;
    }
    if (ch === '#' && isCommentBoundary(text, index)) {
      ranges.push([index, text.length - 1]);
      break;
    }
    if (ch === '/' && text.charAt(index + 1) === '*') {
      const end = text.indexOf('*/', index + 2);
      const close = end >= 0 ? end + 1 : text.length - 1;
      ranges.push([index, close]);
      index = close + 1;
      continue;
    }
    if (ch === '"' || ch === '\'' || ch === '`') {
      if (ch === '\'' && isApostropheInsideWord(text, index)) {
        index += 1;
        continue;
      }
      const start = index;
      index += 1;
      let escaping = false;
      while (index < text.length) {
        const current = text.charAt(index);
        if (escaping) {
          escaping = false;
        } else if (current === '\\') {
          escaping = true;
        } else if (current === ch) {
          ranges.push([start, index]);
          index += 1;
          break;
        }
        index += 1;
      }
      let covered = false;
      for (const range of ranges) {
        if (range[0] <= start && start <= range[1]) {
          covered = true;
          break;
        }
      }
      if (!covered) {
        ranges.push([start, text.length - 1]);
      }
      continue;
    }
    index += 1;
  }
  return ranges;
}

export function isIndexInStringOrComment(text: string, index: number): boolean {
  if (index < 0 || index >= text.length) {
    return false;
  }
  for (const range of protectedRanges(text)) {
    if (range[0] <= index && index <= range[1]) {
      return true;
    }
  }
  return false;
}

function isMixedCaseChoiceToken(token: string): boolean {
  const compact = token.replace(/[\s,，、;；/\\]+/g, '');
  if (compact.length === 0 || !/^[A-Ga-g]+$/.test(compact)) {
    return false;
  }
  let hasUpper = false;
  let hasLower = false;
  for (const ch of compact) {
    if (ch >= 'A' && ch <= 'G') {
      hasUpper = true;
    }
    if (ch >= 'a' && ch <= 'g') {
      hasLower = true;
    }
  }
  return hasUpper && hasLower;
}

function isCallLikeOpenParenthesis(text: string, openIndex: number): boolean {
  if (openIndex <= 0) {
    return false;
  }
  const immediate = text.charAt(openIndex - 1);
  if (isAsciiIdentifierPart(immediate) || immediate === ']' || immediate === ')') {
    return true;
  }
  if (!/\s/.test(immediate)) {
    return false;
  }

  let tokenEnd = openIndex - 2;
  while (tokenEnd >= 0 && /\s/.test(text.charAt(tokenEnd))) {
    tokenEnd -= 1;
  }
  if (tokenEnd < 0 || !isAsciiIdentifierPart(text.charAt(tokenEnd))) {
    return false;
  }

  let tokenStart = tokenEnd;
  while (tokenStart > 0 && isAsciiIdentifierPart(text.charAt(tokenStart - 1))) {
    tokenStart -= 1;
  }
  const token = text.substring(tokenStart, tokenEnd + 1);
  const prefix = text.substring(0, tokenStart).replace(/\s+$/, '');
  if (['if', 'while', 'for', 'switch', 'catch', 'assert', 'when'].includes(token.toLowerCase())) {
    return true;
  }
  const prefixTail = prefix.length > 0 ? prefix.charAt(prefix.length - 1) : null;
  if (prefix.length === 0) {
    return true;
  }
  return prefixTail !== null && ['=', '.', '(', '[', '{', ',', ';', ':', '+', '-', '*', '/', '%', '!', '&', '|', '<', '>'].includes(prefixTail);
}

// range 为 [start, end] 闭区间（对应 Kotlin IntRange）
export function isProtectedParenthesizedToken(text: string, rangeStart: number, rangeEnd: number, token: string): boolean {
  if (rangeStart > rangeEnd) {
    return false;
  }
  if (isIndexInStringOrComment(text, rangeStart)) {
    return true;
  }
  if (isCallLikeOpenParenthesis(text, rangeStart)) {
    return true;
  }
  return isMixedCaseChoiceToken(token);
}

export function hasUnprotectedEmptyParentheses(text: string): boolean {
  EMPTY_PARENTHESES_REGEX.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = EMPTY_PARENTHESES_REGEX.exec(text)) !== null) {
    if (!isProtectedParenthesizedToken(text, m.index, m.index + m[0].length - 1, '')) {
      return true;
    }
  }
  return false;
}

export function looksLikeStandaloneCodeExpression(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return false;
  }
  if (startsWithComment(trimmed)) {
    return true;
  }
  if (hasUnprotectedEmptyParentheses(trimmed)) {
    return false;
  }
  if (containsCjk(trimmed)) {
    return false;
  }
  return DIRECT_CALL_REGEX.test(trimmed) || CONTROL_CALL_REGEX.test(trimmed) ||
    ASSIGNMENT_REGEX.test(trimmed) || MEMBER_ACCESS_SEQUENCE_REGEX.test(trimmed);
}

export function looksLikeNumericCodeOrDataLine(line: string): boolean {
  const trimmed = line.trim();
  if (containsCjk(trimmed)) {
    return false;
  }
  return DECIMAL_EXPRESSION_REGEX.test(trimmed) || DOTTED_NUMERIC_REGEX.test(trimmed);
}

export function looksLikeLeadingCodeOption(line: string, markerStart: number, contentStart: number): boolean {
  if (markerStart < 0 || markerStart >= line.length || contentStart < 0 || contentStart > line.length) {
    return false;
  }
  if (isIndexInStringOrComment(line, markerStart)) {
    return true;
  }

  const markerText = line.substring(markerStart, contentStart);
  const markerTrimmed = markerText.replace(/^\s+/, '');
  const markerLead = markerTrimmed.length > 0 ? markerTrimmed.charAt(0) : null;
  if (markerLead !== null && ['(', '（', '[', '【', '〔', '〖', '《'].includes(markerLead) &&
    markerStart > 0) {
    const prev = line.charAt(markerStart - 1);
    if (isAsciiIdentifierPart(prev) || prev === ']' || prev === ')') {
      return true;
    }
  }

  const tail = line.substring(contentStart);
  const trimmedTail = tail.replace(/^\s+/, '');
  if (trimmedTail.startsWith('->') || trimmedTail.startsWith('=>') ||
    trimmedTail.startsWith('::') || trimmedTail.startsWith('=')) {
    return true;
  }

  const usesDotMarker = markerText.includes('.') || markerText.includes('．');
  if (!usesDotMarker || (tail.length > 0 && /\s/.test(tail.charAt(0)))) {
    return false;
  }

  const identifier = IDENTIFIER_LEAD_REGEX.exec(tail);
  if (identifier === null) {
    return false;
  }
  const afterIndex = identifier.index + identifier[0].length;
  const after = afterIndex < tail.length ? tail.charAt(afterIndex) : null;
  if (after !== null && ['(', '[', '.', '=', ':'].includes(after)) {
    return true;
  }
  if (tail.includes('::') || tail.includes('->') || tail.includes('=>')) {
    return true;
  }

  if (after === ',' || after === ';') {
    const rest = tail.substring(afterIndex + 1);
    if (/\s*[A-Ga-g]\.[A-Za-z_]\w*/.test(rest)) {
      return true;
    }
  }
  return false;
}

export function looksLikeCodeOptionChunk(line: string, markerStart: number, contentStart: number, endExclusive: number): boolean {
  if (markerStart < 0 || markerStart >= line.length || contentStart < 0 || contentStart > line.length) {
    return false;
  }
  const safeEnd = Math.min(Math.max(endExclusive, contentStart), line.length);
  const markerText = line.substring(markerStart, contentStart);
  const rawChunk = line.substring(contentStart, safeEnd);
  if (rawChunk.length > 0 && /\s/.test(rawChunk.charAt(0))) {
    return false;
  }
  if (!markerText.includes('.') && !markerText.includes('．')) {
    return false;
  }

  const chunk = rawChunk.trim();
  const identifier = IDENTIFIER_LEAD_REGEX.exec(chunk);
  if (identifier === null) {
    return false;
  }
  const afterIndex = identifier.index + identifier[0].length;
  const after = afterIndex < chunk.length ? chunk.charAt(afterIndex) : null;
  if (after !== null && ['(', '[', '.', '=', ':'].includes(after)) {
    return true;
  }
  if (chunk.includes('::') || chunk.includes('->') || chunk.includes('=>')) {
    return true;
  }
  if ((chunk.endsWith(',') || chunk.endsWith(';')) && identifier[0].length + 1 === chunk.length) {
    return true;
  }
  return false;
}
