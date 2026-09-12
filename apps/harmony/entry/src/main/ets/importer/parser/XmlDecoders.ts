/**
 * 导入文件 XML/文本解码（纯文本层）— 1:1 移植自 Android TextImportDecoder.kt /
 * QuestionImportAssetExtractor.kt 的纯变换部分。
 * ZIP 读取/字符集探测/图片处理在平台层 ImportDecoder.ets；本文件只做字符串变换，
 * 可被 hvigor 与 Node 双端运行。
 */

const MAX_OMML_DEPTH = 32;

export class ScriptStyle {
  static readonly NORMAL: string = 'NORMAL';
  static readonly SUPERSCRIPT: string = 'SUPERSCRIPT';
  static readonly SUBSCRIPT: string = 'SUBSCRIPT';
}

function g(match: RegExpExecArray | null, index: number): string {
  if (match === null) {
    return '';
  }
  return match[index] !== undefined ? match[index] : '';
}

function ifBlank(value: string, fallback: string): string {
  return value.trim().length === 0 ? fallback : value;
}

function toIntOrNull(raw: string, radix: number = 10): number | null {
  if (raw.length === 0) return null;
  const v = parseInt(raw, radix);
  return Number.isNaN(v) ? null : v;
}

function matchAllOf(text: string, regex: RegExp): RegExpExecArray[] {
  const out: RegExpExecArray[] = [];
  const re = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : `${regex.flags}g`);
  let m: RegExpExecArray | null;
  re.lastIndex = 0;
  while ((m = re.exec(text)) !== null) {
    out.push(m);
  }
  return out;
}

// ---------- Word 文档 ----------

export function extractTextFromWordXml(xml: string): string {
  const paragraphs = matchAllOf(xml, /<w:p\b[\s\S]*?<\/w:p>/)
    .map((m: RegExpExecArray): string => extractTextFromWordParagraphXml(m[0]).replace(/\s+$/, ''))
    .filter((p: string): boolean => p.length > 0);

  const text = paragraphs.length > 0 ? paragraphs.join('\n') : extractPlainTextFromXml(xml);

  return text
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function extractTextFromWordParagraphXml(xml: string): string {
  const tokenRegex = /<m:oMathPara\b[\s\S]*?<\/m:oMathPara>|<m:oMath\b[\s\S]*?<\/m:oMath>|<w:r\b[\s\S]*?<\/w:r>|<w:tab\s*\/>|<w:br\s*\/>|<w:t\b[^>]*>[\s\S]*?<\/w:t>/g;
  const matches = matchAllOf(xml, tokenRegex);
  if (matches.length === 0) return extractPlainTextFromXml(xml);

  let out = '';
  for (const match of matches) {
    const token = match[0];
    if (token.startsWith('<w:tab')) {
      out += '\t';
    } else if (token.startsWith('<w:br')) {
      out += '\n';
    } else if (token.startsWith('<m:oMath')) {
      out += extractOmmlText(token, 0);
    } else if (token.startsWith('<w:r')) {
      out += extractWordRunText(token);
    } else if (token.startsWith('<w:t')) {
      out += extractTextTagValue(token);
    }
  }
  return out.replace(/[ \t]{2,}/g, ' ');
}

function extractWordRunText(xml: string): string {
  if (xml.includes('<m:oMath') || xml.includes('<m:oMathPara')) return extractOmmlText(xml, 0);
  const script = detectVertAlign(xml);
  const tokenRegex = /<w:tab\s*\/>|<w:br\s*\/>|<(?:w|m):t\b[^>]*>[\s\S]*?<\/(?:w|m):t>/g;
  let out = '';
  for (const match of matchAllOf(xml, tokenRegex)) {
    const token = match[0];
    if (token.startsWith('<w:tab')) {
      out += '\t';
    } else if (token.startsWith('<w:br')) {
      out += '\n';
    } else {
      out += convertScript(extractTextTagValue(token), script);
    }
  }
  return out;
}

// ---------- OMML 公式 ----------

function extractOmmlText(xml: string, depth: number): string {
  if (depth > MAX_OMML_DEPTH) return extractPlainTextFromXml(xml);
  let working = xml;
  working = replaceOmmlScriptBlock(working, 'sSubSup', (block: string): string => {
    const base = extractOmmlChildText(block, 'e', depth + 1);
    const sub = convertScript(extractOmmlChildText(block, 'sub', depth + 1), ScriptStyle.SUBSCRIPT);
    const sup = convertScript(extractOmmlChildText(block, 'sup', depth + 1), ScriptStyle.SUPERSCRIPT);
    return base + sub + sup;
  });
  working = replaceOmmlScriptBlock(working, 'sSup', (block: string): string => {
    const base = extractOmmlChildText(block, 'e', depth + 1);
    const sup = convertScript(extractOmmlChildText(block, 'sup', depth + 1), ScriptStyle.SUPERSCRIPT);
    return base + sup;
  });
  working = replaceOmmlScriptBlock(working, 'sSub', (block: string): string => {
    const base = extractOmmlChildText(block, 'e', depth + 1);
    const sub = convertScript(extractOmmlChildText(block, 'sub', depth + 1), ScriptStyle.SUBSCRIPT);
    return base + sub;
  });
  working = working.replace(/<m:f\b[\s\S]*?<\/m:f>/g, (fraction: string): string => {
    const numerator = extractOmmlChildText(fraction, 'num', depth + 1);
    const denominator = extractOmmlChildText(fraction, 'den', depth + 1);
    if (numerator.trim().length > 0 && denominator.trim().length > 0) {
      return `(${numerator})/(${denominator})`;
    }
    return extractPlainTextFromXml(fraction);
  });
  working = working.replace(/<m:rad\b[\s\S]*?<\/m:rad>/g, (rad: string): string => {
    const degree = extractOmmlChildText(rad, 'deg', depth + 1);
    const radicand = extractOmmlChildText(rad, 'e', depth + 1);
    if (degree.trim().length > 0 && radicand.trim().length > 0) {
      return `${degree}\u221A(${radicand})`;
    }
    if (radicand.trim().length > 0) {
      return `\u221A(${radicand})`;
    }
    return extractPlainTextFromXml(rad);
  });
  working = working.replace(/<m:func\b[\s\S]*?<\/m:func>/g, (fn: string): string =>
    ifBlank(formatOmmlFunction(fn, depth + 1), extractPlainTextFromXml(fn)));
  working = working.replace(/<m:nary\b[\s\S]*?<\/m:nary>/g, (nary: string): string => {
    const operator = ifBlank(extractOmmlNaryOperator(nary), '∑');
    const sub = extractOmmlChildText(nary, 'sub', depth + 1);
    const sup = extractOmmlChildText(nary, 'sup', depth + 1);
    const expression = extractOmmlChildText(nary, 'e', depth + 1);
    let out = operator;
    if (sub.trim().length > 0) out += convertScript(sub, ScriptStyle.SUBSCRIPT);
    if (sup.trim().length > 0) out += convertScript(sup, ScriptStyle.SUPERSCRIPT);
    if (expression.trim().length > 0) out += expression;
    return ifBlank(out, extractPlainTextFromXml(nary));
  });
  working = working.replace(/<m:limLow\b[\s\S]*?<\/m:limLow>/g, (lim: string): string => {
    const base = extractOmmlChildText(lim, 'e', depth + 1);
    const limit = extractOmmlChildText(lim, 'lim', depth + 1);
    if (base.trim().length > 0 && limit.trim().length > 0) {
      return base + convertScript(limit, ScriptStyle.SUBSCRIPT);
    }
    if (base.trim().length > 0) return base;
    return extractPlainTextFromXml(lim);
  });
  working = working.replace(/<m:limUpp\b[\s\S]*?<\/m:limUpp>/g, (lim: string): string => {
    const base = extractOmmlChildText(lim, 'e', depth + 1);
    const limit = extractOmmlChildText(lim, 'lim', depth + 1);
    if (base.trim().length > 0 && limit.trim().length > 0) {
      return base + convertScript(limit, ScriptStyle.SUPERSCRIPT);
    }
    if (base.trim().length > 0) return base;
    return extractPlainTextFromXml(lim);
  });
  working = working.replace(/<m:m\b[\s\S]*?<\/m:m>/g, (matrix: string): string =>
    ifBlank(formatOmmlMatrix(matrix, depth + 1), extractPlainTextFromXml(matrix)));
  working = working.replace(/<m:acc\b[\s\S]*?<\/m:acc>/g, (acc: string): string =>
    ifBlank(formatOmmlAccent(acc, depth + 1), extractPlainTextFromXml(acc)));
  working = working.replace(/<m:bar\b[\s\S]*?<\/m:bar>/g, (bar: string): string =>
    ifBlank(formatOmmlBar(bar, depth + 1), extractPlainTextFromXml(bar)));
  working = working.replace(/<m:d\b[\s\S]*?<\/m:d>/g, (d: string): string =>
    ifBlank(formatOmmlDelimiter(d, depth + 1), extractPlainTextFromXml(d)));
  working = working.replace(/<m:chr\b[^>]*(?:m:val|val)="([^"]+)"[^>]*\/?>/g,
    (matched: string, value: string): string => decodeXmlEntities(value));
  return extractPlainTextFromXml(working);
}

function extractOmmlNaryOperator(xml: string): string {
  const match = /<m:chr\b[^>]*(?:m:val|val)="([^"]+)"[^>]*\/?>/.exec(xml);
  if (match === null) return '';
  return decodeXmlEntities(g(match, 1));
}

function formatOmmlDelimiter(xml: string, depth: number): string {
  const content = extractOmmlChildText(xml, 'e', depth + 1);
  if (content.trim().length === 0) return '';
  const begin = ifBlank(extractOmmlControlValue(xml, 'begChr'), '(');
  const end = ifBlank(extractOmmlControlValue(xml, 'endChr'), matchingEndDelimiter(begin));
  return begin + content + end;
}

function formatOmmlMatrix(xml: string, depth: number): string {
  const rows = matchAllOf(xml, /<m:mr\b[\s\S]*?<\/m:mr>/)
    .map((rowMatch: RegExpExecArray): string[] =>
      extractOmmlChildTexts(rowMatch[0], 'e', depth + 1).filter((v: string): boolean => v.trim().length > 0))
    .filter((row: string[]): boolean => row.length > 0);
  if (rows.length === 0) return '';
  const hasMultipleColumns = rows.some((row: string[]): boolean => row.length > 1);
  if (hasMultipleColumns) {
    const inner = rows.map((row: string[]): string => `[${row.join(', ')}]`).join('; ');
    return `[${inner}]`;
  }
  const single = rows.map((row: string[]): string => row[0]).join('; ');
  return `{${single}}`;
}

function formatOmmlAccent(xml: string, depth: number): string {
  const base = extractOmmlChildText(xml, 'e', depth + 1);
  if (base.trim().length === 0) return '';
  const accent = extractOmmlControlValue(xml, 'chr');
  if (accent === '→' || accent === '⃗') return base + '⃗';
  if (accent === '^' || accent === '̂') return base + '̂';
  if (accent === '~' || accent === '˜' || accent === '̃') return base + '̃';
  if (accent === '¯' || accent === 'ˉ' || accent === '̄') return base + '̄';
  if (accent === '˙' || accent === '·' || accent === '̇') return base + '̇';
  if (accent === '¨' || accent === '̈') return base + '̈';
  if (accent.length === 0) return base;
  return base + accent;
}

function formatOmmlBar(xml: string, depth: number): string {
  const base = extractOmmlChildText(xml, 'e', depth + 1);
  if (base.trim().length === 0) return '';
  const position = extractOmmlControlValue(xml, 'pos').toLowerCase();
  return position === 'bot' || position === 'bottom' ? base + '̲' : base + '̄';
}

function formatOmmlFunction(xml: string, depth: number): string {
  const rawName = extractOmmlChildText(xml, 'fName', depth + 1).trim();
  const argument = extractOmmlChildText(xml, 'e', depth + 1).trim();
  if (rawName.length === 0) return argument;
  const normalizedName = normalizeOmmlFunctionName(rawName);
  if (argument.length === 0) return normalizedName;
  const lower = normalizedName.toLowerCase();
  if (lower === 'lim') return normalizedName + argument;
  return `${normalizedName}(${argument})`;
}

function normalizeOmmlFunctionName(name: string): string {
  const compact = name.replace(/\s+/g, '');
  const lower = compact.toLowerCase();
  if (['sin', 'sine'].includes(lower)) return 'sin';
  if (['cos', 'cosine'].includes(lower)) return 'cos';
  if (['tan', 'tangent'].includes(lower)) return 'tan';
  if (lower === 'cot') return 'cot';
  if (lower === 'sec') return 'sec';
  if (lower === 'csc') return 'csc';
  if (lower === 'log') return 'log';
  if (lower === 'ln') return 'ln';
  if (lower === 'lg') return 'lg';
  if (lower === 'lim') return 'lim';
  return compact.length > 0 ? compact : name;
}

function matchingEndDelimiter(begin: string): string {
  if (begin === '(') return ')';
  if (begin === '[') return ']';
  if (begin === '{') return '}';
  if (begin === '|') return '|';
  if (begin === '‖') return '‖';
  if (begin === '⟨') return '⟩';
  return begin;
}

function extractOmmlControlValue(xml: string, tagName: string): string {
  const match = new RegExp(`<m:${tagName}\\b[^>]*(?:m:val|val)="([^"]*)"[^>]*/?>`).exec(xml);
  if (match === null) return '';
  return decodeXmlEntities(g(match, 1));
}

function replaceOmmlScriptBlock(xml: string, tag: string, replacement: (block: string) => string): string {
  return xml.replace(new RegExp(`<m:${tag}\\b[\\s\\S]*?</m:${tag}>`, 'g'), (block: string): string => replacement(block));
}

function extractOmmlChildText(xml: string, childName: string, depth: number): string {
  if (depth > MAX_OMML_DEPTH) return extractPlainTextFromXml(xml);
  const childMatch = new RegExp(`<m:${childName}\\b[\\s\\S]*?</m:${childName}>`).exec(xml);
  if (childMatch === null) return '';
  const inner = childMatch[0]
    .replace(new RegExp(`^<m:${childName}\\b[^>]*>`), '')
    .replace(new RegExp(`</m:${childName}>$`), '');
  return extractOmmlText(inner, depth);
}

function extractOmmlChildTexts(xml: string, childName: string, depth: number): string[] {
  if (depth > MAX_OMML_DEPTH) {
    return [extractPlainTextFromXml(xml)].filter((v: string): boolean => v.trim().length > 0);
  }
  return matchAllOf(xml, new RegExp(`<m:${childName}\\b[\\s\\S]*?</m:${childName}>`))
    .map((match: RegExpExecArray): string => match[0]
      .replace(new RegExp(`^<m:${childName}\\b[^>]*>`), '')
      .replace(new RegExp(`</m:${childName}>$`), ''))
    .map((inner: string): string => extractOmmlText(inner, depth));
}

// ---------- XLSX 电子表格 ----------

export function extractSpreadsheetSharedStrings(xml: string): string[] {
  return matchAllOf(xml, /<(?:[A-Za-z0-9_]+:)?si\b[\s\S]*?<\/(?:[A-Za-z0-9_]+:)?si>/)
    .map((m: RegExpExecArray): string => extractSpreadsheetRichText(m[0]));
}

export function extractSpreadsheetRows(xml: string, sharedStrings: string[]): string {
  const rows = matchAllOf(xml, /<(?:[A-Za-z0-9_]+:)?row\b[\s\S]*?<\/(?:[A-Za-z0-9_]+:)?row>/)
    .map((rowMatch: RegExpExecArray): string | null => {
      const cells = new Map<number, string>();
      let nextColumn = 0;
      const cellRegex = /<(?:[A-Za-z0-9_]+:)?c\b[^>]*\/>|<(?:[A-Za-z0-9_]+:)?c\b[\s\S]*?<\/(?:[A-Za-z0-9_]+:)?c>/g;
      for (const cellMatch of matchAllOf(rowMatch[0], cellRegex)) {
        const cellXml = cellMatch[0];
        const extracted = extractCellColumnIndex(cellXml);
        const columnIndex = extracted !== null ? extracted : nextColumn;
        nextColumn = columnIndex + 1;
        const cellText = extractSpreadsheetCellText(cellXml, sharedStrings);
        if (cellText !== null && cellText.trim().length > 0) {
          cells.set(columnIndex, cellText
            .split('\r\n').join('\n')
            .split('\r').join('\n')
            .split('\n').join('\\n'));
        }
      }
      if (cells.size === 0) return null;
      let maxColumn = 0;
      cells.forEach((_v: string, k: number): void => {
        if (k > maxColumn) maxColumn = k;
      });
      const values: string[] = [];
      for (let i = 0; i <= maxColumn; i++) {
        values.push(cells.get(i) ?? '');
      }
      while (values.length > 0 && values[values.length - 1].trim().length === 0) {
        values.pop();
      }
      const joined = values.join('\t');
      return joined.trim().length > 0 ? joined : null;
    })
    .filter((row: string | null): boolean => row !== null)
    .map((row: string | null): string => row ?? '');
  return rows.join('\n');
}

function extractSpreadsheetCellText(cellXml: string, sharedStrings: string[]): string | null {
  const cellType = extractAttribute(cellXml, 't');
  let result: string | null = null;
  if (cellType === 's') {
    const index = toIntOrNull((extractFirstTagText(cellXml, 'v') ?? '').trim());
    result = index !== null && index >= 0 && index < sharedStrings.length ? sharedStrings[index] : null;
  } else if (cellType === 'inlineStr') {
    const isMatch = /<(?:[A-Za-z0-9_]+:)?is\b[\s\S]*?<\/(?:[A-Za-z0-9_]+:)?is>/.exec(cellXml);
    result = isMatch !== null ? extractSpreadsheetRichText(isMatch[0]) : null;
  } else if (cellType === 'b') {
    const v = (extractFirstTagText(cellXml, 'v') ?? '').trim();
    if (v === '1') result = 'TRUE';
    else if (v === '0') result = 'FALSE';
    else result = extractFirstTagText(cellXml, 'v');
  } else {
    const isMatch = /<(?:[A-Za-z0-9_]+:)?is\b[\s\S]*?<\/(?:[A-Za-z0-9_]+:)?is>/.exec(cellXml);
    result = isMatch !== null
      ? extractSpreadsheetRichText(isMatch[0])
      : (extractFirstTagText(cellXml, 'v') ?? extractFirstTagText(cellXml, 't'));
  }
  return result !== null ? result.split('_x000D_').join('\n') : null;
}

function extractSpreadsheetRichText(xml: string): string {
  const runs = matchAllOf(xml, /<(?:[A-Za-z0-9_]+:)?r\b[\s\S]*?<\/(?:[A-Za-z0-9_]+:)?r>/);
  let text: string;
  if (runs.length > 0) {
    text = runs.map((run: RegExpExecArray): string => {
      const script = detectVertAlign(run[0]);
      return matchAllOf(run[0], /<(?:[A-Za-z0-9_]+:)?t\b[^>]*>[\s\S]*?<\/(?:[A-Za-z0-9_]+:)?t>/)
        .map((t: RegExpExecArray): string => convertScript(extractTextTagValue(t[0]), script))
        .join('');
    }).join('');
  } else {
    text = matchAllOf(xml, /<(?:[A-Za-z0-9_]+:)?t\b[^>]*>[\s\S]*?<\/(?:[A-Za-z0-9_]+:)?t>/)
      .map((t: RegExpExecArray): string => extractTextTagValue(t[0]))
      .join('');
  }
  return text.split('_x000D_').join('\n');
}

// ---------- 通用 XML 工具 ----------

export function extractPlainTextFromXml(xml: string): string {
  const tagText = xml.replace(
    /<(?:w|m|a|r|v|is|si|c|row)?:?t\b[^>]*>([\s\S]*?)<\/(?:w|m|a|r|v|is|si|c|row)?:?t>/g,
    (matched: string, inner: string): string => decodeXmlEntities(inner));
  return decodeXmlEntities(tagText
    .replace(/<w:tab\s*\/>/g, '\t')
    .replace(/<w:br\s*\/>/g, '\n')
    .replace(/<[^>]+>/g, ''));
}

export function extractTextTagValue(xml: string): string {
  const match = /<[^>]+>([\s\S]*?)<\/[^>]+>/.exec(xml);
  if (match === null) return '';
  return decodeXmlEntities(g(match, 1));
}

export function extractFirstTagText(xml: string, tagName: string): string | null {
  const match = new RegExp(
    `<(?:[A-Za-z0-9_]+:)?${tagName}\\b[^>]*>([\\s\\S]*?)</(?:[A-Za-z0-9_]+:)?${tagName}>`
  ).exec(xml);
  if (match === null) return null;
  return decodeXmlEntities(g(match, 1));
}

export function extractAttribute(xml: string, name: string): string | null {
  const openTag = xml.split('>', 1)[0] ?? '';
  const match = new RegExp(`(?:^|\\s)(?:[A-Za-z0-9_]+:)?${name}="([^"]*)"`).exec(openTag);
  if (match === null) return null;
  return decodeXmlEntities(g(match, 1));
}

function detectVertAlign(xml: string): string {
  const match = /<[^>]*vertAlign\b[^>]*(?:[A-Za-z0-9_]+:)?val="([^"]+)"[^>]*\/?>/.exec(xml);
  const value = match !== null ? g(match, 1).toLowerCase() : '';
  if (value === 'superscript' || value === 'super') return ScriptStyle.SUPERSCRIPT;
  if (value === 'subscript' || value === 'sub') return ScriptStyle.SUBSCRIPT;
  return ScriptStyle.NORMAL;
}

function convertScript(text: string, script: string): string {
  if (script === ScriptStyle.NORMAL || text.length === 0) return text;
  let out = '';
  for (const ch of text) {
    if (script === ScriptStyle.SUPERSCRIPT) {
      out += SUPERSCRIPT_MAP.get(ch) ?? ch;
    } else {
      out += SUBSCRIPT_MAP.get(ch) ?? ch;
    }
  }
  return out;
}

export function extractCellColumnIndex(cellXml: string): number | null {
  const ref = extractAttribute(cellXml, 'r');
  if (ref === null) return null;
  const lettersMatch = /^[A-Za-z]+/.exec(ref);
  const letters = lettersMatch !== null ? lettersMatch[0] : '';
  if (letters.length === 0) return null;
  let index = 0;
  for (const ch of letters.toUpperCase()) {
    index = index * 26 + (ch.charCodeAt(0) - 'A'.charCodeAt(0) + 1);
  }
  return index - 1;
}

export function sheetOrder(name: string): number {
  const match = /sheet(\d+)\.xml$/.exec(name);
  if (match === null) return 2147483647; // Int.MAX_VALUE
  const value = toIntOrNull(g(match, 1));
  return value ?? 2147483647;
}

export function decodeXmlEntities(text: string): string {
  const hexDecoded = text.replace(/&#x([0-9a-fA-F]+);/g, (matched: string, hex: string): string =>
    codePointToString(toIntOrNull(hex, 16)));
  const decDecoded = hexDecoded.replace(/&#(\d+);/g, (matched: string, dec: string): string =>
    codePointToString(toIntOrNull(dec)));
  return decDecoded
    .split('&lt;').join('<')
    .split('&gt;').join('>')
    .split('&quot;').join('"')
    .split('&apos;').join("'")
    .split('&amp;').join('&');
}

function codePointToString(codePoint: number | null): string {
  if (codePoint === null || codePoint < 0 || codePoint > 0x10FFFF) return '';
  try {
    return String.fromCodePoint(codePoint);
  } catch (_err) {
    return '';
  }
}

// ---------- DOCX 图片引用（QuestionImportAssetExtractor 纯文本部分） ----------

// 移植自 QuestionImportAssetExtractor.decodeDocxWithImagesDetailed 的段落遍历核心：
// 段落文本与图片标记（按出现顺序）合成单一文本；marker→媒体条目名配对返回，
// 图片落盘/降采样由平台层（ImportDecoder.ets）完成。
export class DocxImageMarkerEntry {
  marker: string;
  mediaName: string;
  constructor(marker: string, mediaName: string) {
    this.marker = marker;
    this.mediaName = mediaName;
  }
}

export class DocxExtractResult {
  text: string;
  imageMarkers: DocxImageMarkerEntry[];
  constructor(text: string, imageMarkers: DocxImageMarkerEntry[]) {
    this.text = text;
    this.imageMarkers = imageMarkers;
  }
}

export function extractDocxTextWithImageMarkers(
  documentXml: string,
  relationshipsXml: string,
  mediaNames: string[]
): DocxExtractResult {
  const relationshipTargets = parseRelationships(relationshipsXml);
  const mediaNameSet = new Set<string>(mediaNames);
  // 注意：与 extractTextFromWordXml 不同，此处上游正则没有 \b（忠实保留）
  const paragraphMatches = matchAllOf(documentXml, /<w:p[\s\S]*?<\/w:p>/);
  let builder = '';
  let order = 0;
  const imageMarkers: DocxImageMarkerEntry[] = [];
  for (const paragraphMatch of paragraphMatches) {
    const paragraphXml = paragraphMatch[0];
    const paragraphText = extractTextFromWordParagraphXml(paragraphXml).replace(/\s+$/, '');
    if (paragraphText.length > 0) {
      builder += `${paragraphText}\n`;
    }
    for (const relationId of extractEmbedIds(paragraphXml)) {
      const target = relationshipTargets.get(relationId);
      if (target === undefined) continue;
      const mediaName = normalizeWordTarget(target);
      if (!mediaNameSet.has(mediaName)) continue;
      order += 1;
      const id = order.toString().padStart(4, '0');
      const marker = `[[MISAKA_IMAGE:img_${id}]]`;
      builder += `${marker}\n`;
      imageMarkers.push(new DocxImageMarkerEntry(marker, mediaName));
    }
  }
  return new DocxExtractResult(builder, imageMarkers);
}

export function parseRelationships(xml: string): Map<string, string> {
  const map = new Map<string, string>();
  if (xml.trim().length === 0) return map;
  for (const match of matchAllOf(xml, /<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"[^>]*\/?>/)) {
    if (!map.has(g(match, 1))) {
      map.set(g(match, 1), g(match, 2));
    }
  }
  return map;
}

export function normalizeWordTarget(target: string): string {
  const clean = target.split('\\').join('/').replace(/^\//, '');
  if (clean.startsWith('word/')) return clean;
  if (clean.startsWith('media/')) return `word/${clean}`;
  if (clean.startsWith('../')) {
    return `word/${clean.replace(/^\.\.\//, '')}`.split('word/word/').join('word/');
  }
  return `word/${clean}`;
}

export function extractEmbedIds(xml: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of matchAllOf(xml, /r:embed="([^"]+)"/)) {
    const id = g(match, 1);
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

// ---------- 上下标映射 ----------

const SUPERSCRIPT_MAP: Map<string, string> = new Map<string, string>([
  ['0', '\u2070'], ['1', '\u00B9'], ['2', '\u00B2'], ['3', '\u00B3'], ['4', '\u2074'],
  ['5', '\u2075'], ['6', '\u2076'], ['7', '\u2077'], ['8', '\u2078'], ['9', '\u2079'],
  ['+', '\u207A'], ['-', '\u207B'], ['=', '\u207C'], ['(', '\u207D'], [')', '\u207E'],
  ['n', '\u207F'], ['i', '\u2071']
]);

const SUBSCRIPT_MAP: Map<string, string> = new Map<string, string>([
  ['0', '\u2080'], ['1', '\u2081'], ['2', '\u2082'], ['3', '\u2083'], ['4', '\u2084'],
  ['5', '\u2085'], ['6', '\u2086'], ['7', '\u2087'], ['8', '\u2088'], ['9', '\u2089'],
  ['+', '\u208A'], ['-', '\u208B'], ['=', '\u208C'], ['(', '\u208D'], [')', '\u208E'],
  ['a', '\u2090'], ['e', '\u2091'], ['h', '\u2095'], ['i', '\u1D62'], ['j', '\u2C7C'],
  ['k', '\u2096'], ['l', '\u2097'], ['m', '\u2098'], ['n', '\u2099'], ['o', '\u2092'],
  ['p', '\u209A'], ['r', '\u1D63'], ['s', '\u209B'], ['t', '\u209C'], ['u', '\u1D64'],
  ['v', '\u1D65'], ['x', '\u2093']
]);
