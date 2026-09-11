/**
 * 分区标题解析 — 1:1 移植自 Android SectionTitleParser.kt。
 */
import { parseTypeLabel, extractLeadingTypeLabel } from './QuestionTypeLabelParser';

export class SectionInfo {
  title: string;
  forcedType: string | null;
  isAnswerSection: boolean;
  constructor(title: string, forcedType: string | null, isAnswerSection: boolean) {
    this.title = title;
    this.forcedType = forcedType;
    this.isAnswerSection = isAnswerSection;
  }
}

const CHINESE_INDEX = '[一二三四五六七八九十百]+';
const LEADING_INDEX_REGEX = new RegExp(`^\\s*(?:第?${CHINESE_INDEX}[、.．、]?|第?\\d{1,3}[、.．、]?|\\(\\s*${CHINESE_INDEX}\\s*\\)|（\\s*${CHINESE_INDEX}\\s*）)?\\s*`);
const ARABIC_NUMBERED_REMAINDER_REGEX = /^\s*\d{1,4}\s*[.、．:：)）]\s*(.+)$/;
const SECTION_LIKE_REGEX = /^\s*(?:第[一二三四五六七八九十百0-9]+(?:部分|卷|章|节|模块)|[一二三四五六七八九十百]+[、.．]\s*(?:常识判断|言语理解|语言理解|数量关系|数学能力|数学运算|判断推理|图形推理|定义判断|类比推理|逻辑判断|资料分析|材料分析|综合知识|公共基础知识|专业知识|基础知识|安全知识|理论知识|综合能力|结构化面试|公考面试|公务员面试|面试真题).*)\s*$/;
const NON_TYPE_SECTION_KEYWORD_REGEX = /(部分|试卷|常识判断|言语理解|语言理解|数量关系|数学能力|数学运算|判断推理|图形推理|定义判断|类比推理|逻辑判断|资料分析|材料分析|综合知识|公共基础知识|专业知识|基础知识|安全知识|理论知识|综合能力|结构化面试|公考面试|公务员面试|面试真题)/;
const GENERIC_SECTION_HEADING_REGEX = /^\s*(?:[一二三四五六七八九十百]+|\d{1,3})[、.．]\s*(?:.*(?:测试区|样本|题库|格式|边界|极端|客观题|主观题|材料题|集中答案|AI\s*解析|AI\s*核对|功能测试).*)\s*$/i;
const ANSWER_SECTION_REGEX = /(集中答案|集中解析|参考答案|标准答案|正确答案|答案(?:与|及)?解析|答案解析|试题答案|答题要点|参考要点|参考思路|答题思路|作答思路|评分要点|答案区|解析区|答案部分)/;
const EXACT_ANSWER_SECTION_TITLE_REGEX = /^\s*(?:[一二三四五六七八九十百]+|\d{1,3})?[、.．]?\s*(?:集中答案|集中解析|参考答案|标准答案|正确答案|答案(?:与|及)?解析|答案解析|试题答案|答题要点|参考要点|参考思路|答题思路|作答思路|评分要点|答案区|解析区|答案部分)\s*[:：]?\s*$/;
const QUESTION_BLANK_MARKER_REGEX = /[（(]\s*[)）]/;
const QUESTION_PROMPT_KEYWORD_REGEX = /(?:[?？]|(?:下列|以下|哪[一项种个]|哪个|哪种|哪项|不正确|不属于|正确|错误|属于|包括|主要|应当|应该|可以|能够|能否|是否|为什么|如何))/;

function looksLikeShortGenericSectionTitle(rest: string): boolean {
  const text = rest.trim().replace(/[:：]+$/, '');
  if (text.length > 16) {
    return false;
  }
  return /(?:测试区|样本|题库|格式|边界|极端|客观题|主观题|材料题|集中答案|AI\s*解析|AI\s*核对|功能测试)/i.test(text);
}

function looksLikeTypeSectionRemainder(remainder: string): boolean {
  const text = remainder.trim();
  if (text.length === 0) {
    return true;
  }
  const scoreOrCountKeywords = '题|小题|道|分|共|共计|每题|每小题|本题|本大题|本部分|满分';
  if (new RegExp(`^[（(].*(?:${scoreOrCountKeywords}).*[）)]$`).test(text)) {
    return true;
  }
  if (/^(?:共|共计|每题|每小题|本题|本大题|本部分|以下|含|满分)/.test(text)) {
    return true;
  }
  return /^(?:[，,、；;]\s*)?(?:共|共计|每题|每小题|本题|本大题|本部分|以下|含|满分)/.test(text);
}

function isExactAnswerSectionTitle(title: string): boolean {
  const stripped = title.trim().replace(/^[\[\]【】（）()]+/, '').replace(/[\[\]【】（）()]+$/, '').trim();
  return EXACT_ANSWER_SECTION_TITLE_REGEX.test(stripped);
}

function isInlineAnswerLine(title: string): boolean {
  return /^\s*(?:[\[【]\s*)?(?:答案|正确答案|参考答案|标准答案|参考要点|参考思路|答题要点|答题思路|作答思路|评分要点|参考作答|答)(?:\s*[\]】])?\s*(?:[:：]|为|\s+)\s*\S+/.test(title);
}

function looksLikeArabicNumberedTypedQuestionLine(title: string): boolean {
  const match = ARABIC_NUMBERED_REMAINDER_REGEX.exec(title);
  const rest = match !== null && match[1] !== undefined ? match[1] : '';
  return rest.trim().length > 0 && extractLeadingTypeLabel(rest) !== null;
}

function looksLikeNumberedQuestionStemLine(title: string): boolean {
  const match = ARABIC_NUMBERED_REMAINDER_REGEX.exec(title);
  const rest = match !== null && match[1] !== undefined ? match[1].trim() : '';
  if (rest.length === 0) {
    return false;
  }
  if (looksLikeArabicNumberedTypedQuestionLine(title)) {
    return true;
  }
  if (QUESTION_BLANK_MARKER_REGEX.test(rest)) {
    return true;
  }
  if (QUESTION_PROMPT_KEYWORD_REGEX.test(rest) && !looksLikeShortGenericSectionTitle(rest)) {
    return true;
  }
  return false;
}

export function parseSectionTitle(rawLine: string): SectionInfo | null {
  const title = rawLine.trim();
  if (title.length === 0 || title.length > 60) {
    return null;
  }

  if (isExactAnswerSectionTitle(title)) {
    return new SectionInfo(title, null, true);
  }
  if (looksLikeNumberedQuestionStemLine(title)) {
    return null;
  }
  if (GENERIC_SECTION_HEADING_REGEX.test(title)) {
    return new SectionInfo(title, null, false);
  }
  if (ANSWER_SECTION_REGEX.test(title) && !isInlineAnswerLine(title)) {
    return new SectionInfo(title, null, true);
  }
  if (looksLikeArabicNumberedTypedQuestionLine(title)) {
    return null;
  }

  const simplified = title.replace(LEADING_INDEX_REGEX, '')
    .replace(/[\s:：]+$/, '');

  const leadingType = extractLeadingTypeLabel(simplified);
  if (leadingType !== null) {
    if (leadingType.remainder.trim().length === 0 || looksLikeTypeSectionRemainder(leadingType.remainder)) {
      return new SectionInfo(title, leadingType.type, false);
    }
    return null;
  }

  const type = parseTypeLabel(simplified);
  if (type !== null) {
    return new SectionInfo(title, type, false);
  }
  if (SECTION_LIKE_REGEX.test(title) && NON_TYPE_SECTION_KEYWORD_REGEX.test(title)) {
    return new SectionInfo(title, null, false);
  }
  return null;
}

export function isSectionHeading(rawLine: string): boolean {
  return parseSectionTitle(rawLine) !== null;
}

export function forcedTypeOf(rawLine: string): string | null {
  const info = parseSectionTitle(rawLine);
  return info !== null ? info.forcedType : null;
}

export function isAnswerSectionHeading(rawLine: string): boolean {
  const info = parseSectionTitle(rawLine);
  return info !== null && info.isAnswerSection;
}
