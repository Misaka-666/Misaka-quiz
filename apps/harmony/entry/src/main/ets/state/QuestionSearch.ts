/**
 * 题目搜索 — 移植自 Android QuestionSearch.kt（QuestionSearchEngine）。
 * 关键词按空白切分、全角标点归一；四个字段（题干/选项/答案/解析）须全部关键词命中才入选，
 * matchedFields 记录任一关键词命中的字段（保持 题干→选项→答案→解析 顺序）。纯函数，Node 可测。
 */
import { Question, QuizBank, DEFAULT_BANK_GROUP_NAME } from '../domain/Models';

export const SEARCH_SCOPE_ACTIVE = 'active';
export const SEARCH_SCOPE_ALL = 'all';
export const SEARCH_SCOPE_BANK_PREFIX = 'bank:';

export const SEARCH_FIELD_QUESTION = '题干';
export const SEARCH_FIELD_OPTIONS = '选项';
export const SEARCH_FIELD_ANSWER = '答案';
export const SEARCH_FIELD_ANALYSIS = '解析';

const FIELD_ORDER: string[] = [
  SEARCH_FIELD_QUESTION, SEARCH_FIELD_OPTIONS, SEARCH_FIELD_ANSWER, SEARCH_FIELD_ANALYSIS
];

export class QuestionSearchResult {
  bankId: string;
  bankName: string;
  groupName: string;
  questionIndex: number;
  question: Question;
  matchedFields: string[];
  constructor(bankId: string, bankName: string, groupName: string, questionIndex: number,
    question: Question, matchedFields: string[]) {
    this.bankId = bankId;
    this.bankName = bankName;
    this.groupName = groupName;
    this.questionIndex = questionIndex;
    this.question = question;
    this.matchedFields = matchedFields;
  }
  resultKey(): string {
    return `${this.bankId}:${this.question.id}:${this.questionIndex}`;
  }
}

/** scopeKey: 'active' / 'all' / 'bank:<id>'（active 无当前题库时回退 all，对齐 Android toSearchScope） */
export function resolveSearchScope(scopeKey: string, activeBankId: string | null): string {
  if (scopeKey === SEARCH_SCOPE_ACTIVE && activeBankId !== null) {
    return SEARCH_SCOPE_ACTIVE;
  }
  if (scopeKey.startsWith(SEARCH_SCOPE_BANK_PREFIX)) {
    return scopeKey;
  }
  return SEARCH_SCOPE_ALL;
}

export function searchQuestions(
  banks: QuizBank[],
  activeBankId: string | null,
  query: string,
  scopeKey: string
): QuestionSearchResult[] {
  const tokens: string[] = [];
  const seen = new Set<string>();
  const rawParts = query.split(/\s+/);
  for (const part of rawParts) {
    const token = normalizeForSearch(part);
    if (token.length === 0 || seen.has(token)) {
      continue;
    }
    seen.add(token);
    tokens.push(token);
  }
  if (tokens.length === 0) {
    return [];
  }
  const scope = resolveSearchScope(scopeKey, activeBankId);
  const targetBankId = scope.startsWith(SEARCH_SCOPE_BANK_PREFIX)
    ? scope.substring(SEARCH_SCOPE_BANK_PREFIX.length) : '';
  const results: QuestionSearchResult[] = [];
  for (const bank of banks) {
    if (scope === SEARCH_SCOPE_ACTIVE && bank.id !== activeBankId) {
      continue;
    }
    if (targetBankId.length > 0 && bank.id !== targetBankId) {
      continue;
    }
    for (let index = 0; index < bank.questions.length; index++) {
      const question = bank.questions[index];
      const fieldTexts = fieldTextsOf(question);
      const normalized: string[] = [];
      for (const text of fieldTexts) {
        normalized.push(normalizeForSearch(text));
      }
      let allMatched = true;
      for (const token of tokens) {
        let hit = false;
        for (const text of normalized) {
          if (text.indexOf(token) >= 0) {
            hit = true;
            break;
          }
        }
        if (!hit) {
          allMatched = false;
          break;
        }
      }
      if (!allMatched) {
        continue;
      }
      const matchedFields: string[] = [];
      for (let f = 0; f < FIELD_ORDER.length; f++) {
        let hit = false;
        for (const token of tokens) {
          if (normalized[f].indexOf(token) >= 0) {
            hit = true;
            break;
          }
        }
        if (hit) {
          matchedFields.push(FIELD_ORDER[f]);
        }
      }
      results.push(new QuestionSearchResult(
        bank.id,
        bank.name,
        bank.groupName.trim().length > 0 ? bank.groupName : DEFAULT_BANK_GROUP_NAME,
        index + 1,
        question,
        matchedFields
      ));
    }
  }
  return results;
}

/** 与 Android 字段顺序一致：题干 / "key text" 串接的选项 / 答案(含多空) / 解析 */
function fieldTextsOf(question: Question): string[] {
  let optionsText = '';
  for (const option of question.options) {
    optionsText += `${option.key} ${option.text} `;
  }
  let answerText = question.answer.join(' ');
  if (question.blankAnswers.length > 0) {
    for (const blanks of question.blankAnswers) {
      answerText += ` ${blanks.join(' ')}`;
    }
  }
  return [question.question, optionsText, answerText, question.analysis];
}

function normalizeForSearch(value: string): string {
  if (value.trim().length === 0) {
    return '';
  }
  return value.trim().toLowerCase()
    .replace(/，/g, ',').replace(/。/g, '.').replace(/；/g, ';').replace(/：/g, ':')
    .replace(/（/g, '(').replace(/）/g, ')').replace(/！/g, '!').replace(/？/g, '?')
    .replace(/\s+/g, ' ');
}
