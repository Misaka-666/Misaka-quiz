/**
 * 题库文本规范化 — 1:1 移植自 Android QuestionTextNormalizer.kt。
 */

const PROFILE_HEADER_MARKER = /^.*?(?:姓名|单位|岗位|班级|部门)\s*[:：]\s*(?=(?:第\s*)?\d{1,4}\s*(?:题)?\s*[.、．:：)）])/;

function normalizeFullWidthAscii(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 0x3000) {
      out += ' ';
    } else if (code >= 0xFF01 && code <= 0xFF5E) {
      out += String.fromCharCode(code - 0xFEE0);
    } else {
      out += text.charAt(i);
    }
  }
  return out;
}

function stripProfileHeaderBeforeQuestion(line: string): string {
  return line.replace(PROFILE_HEADER_MARKER, '').replace(/^\s+/, '');
}

function isNoiseLine(line: string): boolean {
  if (line.trim().length === 0) {
    return false;
  }
  if (/^第\s*\d+\s*页\s*(?:共\s*\d+\s*页)?$/.test(line)) {
    return true;
  }
  if (/^-?\d{8,}$/.test(line)) {
    return true;
  }
  if (/^(?:绝密|请勿外传|忽略此处\.\.)$/.test(line)) {
    return true;
  }
  return false;
}

export function normalizeText(raw: string): string {
  if (raw.trim().length === 0) {
    return '';
  }
  const replaced = normalizeFullWidthAscii(raw)
    .replace(/\uFEFF/g, '')
    .replace(/\uFE0F/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\u3000/g, ' ')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/：/g, ':')
    .replace(/．/g, '.')
    .replace(/，/g, ',')
    .replace(/；/g, ';')
    .replace(/【/g, '[')
    .replace(/】/g, ']')
    .replace(/✔/g, '√')
    .replace(/✅/g, '√')
    .replace(/☑/g, '√')
    .replace(/✘/g, '×')
    .replace(/✖/g, '×')
    .replace(/❌/g, '×')
    .replace(/❎/g, '×')
    .replace(/√/g, '√')
    .replace(/×/g, '×');
  const lines = replaced.split('\n')
    .map((line: string): string => stripProfileHeaderBeforeQuestion(line.replace(/\s+$/, '')))
    .filter((line: string): boolean => !isNoiseLine(line.trim()));
  return lines.join('\n')
    .replace(/ {2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
