/**
 * 题型标签解析 — 1:1 移植自 Android QuestionTypeLabelParser.kt。
 */
import { QuestionType } from '../../domain/Models';

export class LeadingTypeLabel {
  type: string;
  label: string;
  remainder: string;
  constructor(type: string, label: string, remainder: string) {
    this.type = type;
    this.label = label;
    this.remainder = remainder;
  }
}

const WRAPPERS: string[][] = [
  ['【', '】'], ['[', ']'], ['（', '）'], ['(', ')'],
  ['〔', '〕'], ['〖', '〗'], ['《', '》']
];

class AliasGroup {
  aliases: string[];
  type: string;
  constructor(aliases: string[], type: string) {
    this.aliases = aliases;
    this.type = type;
  }
}

class AliasEntry {
  alias: string;
  type: string;
  constructor(alias: string, type: string) {
    this.alias = alias;
    this.type = type;
  }
}

const ALIAS_GROUPS: AliasGroup[] = [
  new AliasGroup(['单项选择题', '单选题', '选择题', '单项选择', '单选'], QuestionType.SINGLE),
  new AliasGroup(['不定项选择题', '多项选择题', '多选题', '不定项选择', '多项选择', '多选'], QuestionType.MULTIPLE),
  new AliasGroup(['判断题', '是非题', '对错题', '判断', '是非', '对错'], QuestionType.JUDGE),
  new AliasGroup(['填空题', '补全题', '填空', '补全'], QuestionType.BLANK),
  new AliasGroup([
    '结构化面试题', '公考面试题', '公务员面试题', '材料分析题', '案例分析题',
    '名词解释', '论述题', '简答题', '问答题', '面试题', '综合题',
    '结构化面试', '公考面试', '公务员', '材料分析', '案例分析',
    '论述', '简答', '问答', '面试', '综合'
  ], QuestionType.SHORT)
];

// 按别名长度降序排列（先匹配更长的别名）
const ALIASES_BY_LENGTH: AliasEntry[] = (() => {
  const flat: AliasEntry[] = [];
  for (const group of ALIAS_GROUPS) {
    for (const alias of group.aliases) {
      flat.push(new AliasEntry(alias, group.type));
    }
  }
  flat.sort((a: AliasEntry, b: AliasEntry): number => b.alias.length - a.alias.length);
  return flat;
})();

const LEADING_DELIMITERS: string[] = [':', '：', '-', '－', '—', '、', '.', '．', '(', '（', '[', '【', '〔', '〖', '《'];

function unwrap(raw: string): string {
  const text = raw.trim();
  for (const [open, close] of WRAPPERS) {
    if (text.startsWith(open) && text.endsWith(close) && text.length > open.length + close.length) {
      return text.substring(open.length, text.length - close.length).trim();
    }
  }
  return text;
}

function cleanLeadingRemainder(raw: string): string {
  return raw.replace(/^\s+/, '')
    .replace(/^[:：\-－—]+/, '')
    .replace(/^\s+/, '');
}

export function parseTypeLabel(raw: string): string | null {
  const label = unwrap(raw).trim().replace(/[:：]+$/, '');
  for (const entry of ALIASES_BY_LENGTH) {
    if (label === entry.alias) {
      return entry.type;
    }
  }
  return null;
}

export function extractLeadingTypeLabel(raw: string): LeadingTypeLabel | null {
  const text = raw.replace(/^\s+/, '');
  if (text.length === 0) {
    return null;
  }

  for (const [open, close] of WRAPPERS) {
    if (text.startsWith(open)) {
      const end = text.indexOf(close, open.length);
      if (end > open.length) {
        const label = text.substring(open.length, end).trim();
        const type = parseTypeLabel(label);
        if (type !== null) {
          const remainder = cleanLeadingRemainder(text.substring(end + close.length));
          return new LeadingTypeLabel(type, label, remainder);
        }
      }
    }
  }

  for (const entry of ALIASES_BY_LENGTH) {
    if (text.startsWith(entry.alias)) {
      const next = text.length > entry.alias.length ? text.charAt(entry.alias.length) : null;
      if (next === null || /\s/.test(next) || LEADING_DELIMITERS.includes(next)) {
        const remainder = cleanLeadingRemainder(text.substring(entry.alias.length));
        return new LeadingTypeLabel(entry.type, entry.alias, remainder);
      }
    }
  }

  return null;
}

export function hasLeadingTypeLabel(raw: string): boolean {
  return extractLeadingTypeLabel(raw) !== null;
}
