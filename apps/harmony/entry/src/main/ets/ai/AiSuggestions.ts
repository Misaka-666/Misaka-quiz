/**
 * AI 建议应用规则 — 1:1 移植 Android ImportScreen.kt / PracticeScreen.kt 的 AI 辅助纯函数段：
 * 建议可否采纳判定、核对建议合并、缺解析判定与写入、建议应用到题目、
 * 练习页选项乱序映射（让 AI 看到与用户一致的选项字母）。
 */
import { Question, QuestionType, Option } from '../domain/Models';
import { cloneQuestion } from '../importer/model/MultiBlankSupport';
import { AiReviewSuggestion } from './AiTypes';
import { PracticeDisplayOption } from '../state/OptionShuffle';

export function canApplyAiSuggestion(suggestion: AiReviewSuggestion): boolean {
  return suggestion.canApply && suggestion.riskLevel.toLowerCase() !== 'hard_error';
}

export function isActionableAiSuggestion(suggestion: AiReviewSuggestion): boolean {
  const hasStructuredSuggestion = suggestion.suggestedType !== null ||
    suggestion.suggestedAnswer.length > 0 ||
    suggestion.suggestedQuestion !== null ||
    suggestion.suggestedOptions.length > 0 ||
    suggestion.suggestedAnalysis !== null;
  const pureOk = suggestion.status.toLowerCase() === 'ok' &&
    suggestion.issueTypes.length === 0 &&
    !suggestion.needHumanReview &&
    !canApplyAiSuggestion(suggestion) &&
    !hasStructuredSuggestion;
  return !pureOk && (
    suggestion.status.toLowerCase() !== 'ok' ||
    suggestion.needHumanReview ||
    canApplyAiSuggestion(suggestion) ||
    suggestion.issueTypes.length > 0 ||
    hasStructuredSuggestion);
}

export function isHardErrorAiSuggestion(suggestion: AiReviewSuggestion): boolean {
  return suggestion.riskLevel.toLowerCase() === 'hard_error';
}

export function isNeedHumanReviewAiSuggestion(suggestion: AiReviewSuggestion): boolean {
  return isActionableAiSuggestion(suggestion) && (
    suggestion.needHumanReview ||
    !canApplyAiSuggestion(suggestion) ||
    suggestion.riskLevel.toLowerCase() === 'needs_confirm' ||
    suggestion.riskLevel.toLowerCase() === 'needs_review');
}

export function mergeAiReviewSuggestions(current: AiReviewSuggestion[], incoming: AiReviewSuggestion[],
  processedQuestionIds: string[]): AiReviewSuggestion[] {
  const processed = new Set<string>(processedQuestionIds);
  const kept = current.filter((s: AiReviewSuggestion): boolean => !processed.has(s.questionId));
  return kept.concat(incoming.filter(isActionableAiSuggestion));
}

export function aiSuggestionsForQuestion(questionId: string,
  suggestions: AiReviewSuggestion[]): AiReviewSuggestion[] {
  return suggestions.filter((s: AiReviewSuggestion): boolean =>
    s.questionId === questionId && isActionableAiSuggestion(s));
}

export function suggestedTypeLabel(type: string): string {
  const clean = type.toLowerCase();
  if (clean === 'single') {
    return '单选题';
  }
  if (clean === 'multiple') {
    return '多选题';
  }
  if (clean === 'judge') {
    return '判断题';
  }
  if (clean === 'blank') {
    return '填空题';
  }
  if (clean === 'short') {
    return '简答题';
  }
  return type;
}

export function aiSuggestionApplySummary(suggestion: AiReviewSuggestion): string {
  const parts: string[] = [];
  if (suggestion.suggestedType !== null) {
    parts.push(`题型→${suggestedTypeLabel(suggestion.suggestedType ?? '')}`);
  }
  if (suggestion.suggestedAnswer.length > 0) {
    parts.push(`答案→${suggestion.suggestedAnswer.join('')}`);
  }
  if (suggestion.suggestedQuestion !== null) {
    parts.push('题干');
  }
  if (suggestion.suggestedOptions.length > 0) {
    parts.push(`选项 ${suggestion.suggestedOptions.length} 项`);
  }
  if (suggestion.suggestedAnalysis !== null) {
    parts.push('解析');
  }
  return parts.join('、');
}

function suggestedQuestionType(type: string): string | null {
  const clean = type.trim().toLowerCase();
  if (clean === 'single' || clean === '单选' || clean === '单选题') {
    return QuestionType.SINGLE;
  }
  if (clean === 'multiple' || clean === 'multi' || clean === '多选' || clean === '多选题') {
    return QuestionType.MULTIPLE;
  }
  if (clean === 'judge' || clean === 'true_false' || clean === '判断' || clean === '判断题') {
    return QuestionType.JUDGE;
  }
  if (clean === 'blank' || clean === '填空' || clean === '填空题') {
    return QuestionType.BLANK;
  }
  if (clean === 'short' || clean === 'essay' || clean === '简答' || clean === '简答题') {
    return QuestionType.SHORT;
  }
  return null;
}

export function normalizeSuggestedAnswer(answer: string[], type: string): string[] {
  const normalized: string[] = [];
  for (const item of answer) {
    for (const part of item.split(/[,，、\/\s]+/)) {
      const text = part.trim().toUpperCase();
      if (text.length > 0) {
        normalized.push(text);
      }
    }
  }
  if (type === QuestionType.SINGLE) {
    return normalized.slice(0, 1);
  }
  if (type === QuestionType.JUDGE) {
    return normalized.map((value: string): string => {
      if (value === '正确' || value === '对' || value === 'TRUE' || value === 'T') {
        return 'A';
      }
      if (value === '错误' || value === '错' || value === 'FALSE' || value === 'F') {
        return 'B';
      }
      return value.substring(0, 1);
    }).slice(0, 1);
  }
  if (type === QuestionType.MULTIPLE) {
    return Array.from(new Set<string>(normalized)).sort();
  }
  return normalized;
}

function defaultJudgeOptions(): Option[] {
  return [new Option('A', '正确'), new Option('B', '错误')];
}

/** 采纳核对建议 → 返回应用后的题目副本（不改动原题）。对齐 Android applyAiReviewSuggestion。 */
export function applyAiReviewSuggestion(question: Question, suggestion: AiReviewSuggestion): Question {
  let next = cloneQuestion(question);
  if (suggestion.suggestedType !== null) {
    const targetType = suggestedQuestionType(suggestion.suggestedType ?? '');
    if (targetType !== null) {
      next.type = targetType;
    }
  }
  if (suggestion.suggestedQuestion !== null) {
    next.question = suggestion.suggestedQuestion ?? '';
  }
  if (suggestion.suggestedOptions.length > 0) {
    next.options = suggestion.suggestedOptions.map((o: Option): Option => new Option(o.key, o.text));
  } else if (next.type === QuestionType.JUDGE && next.options.length === 0) {
    next.options = defaultJudgeOptions();
  }
  if (suggestion.suggestedAnswer.length > 0) {
    next.answer = normalizeSuggestedAnswer(suggestion.suggestedAnswer, next.type);
    next.blankAnswers = [];
  }
  if (suggestion.suggestedAnalysis !== null) {
    next.analysis = suggestion.suggestedAnalysis ?? '';
  }
  return next;
}

/** 缺解析/解析过短判定（对齐 Android shouldApplyAiAnalysis） */
export function shouldApplyAiAnalysis(question: Question): boolean {
  const clean = question.analysis.trim();
  const missingOrShort = clean.length === 0 || clean.length < 20 || clean === '无' || clean === '暂无解析';
  const subjectiveMissingAnswer = question.type === QuestionType.SHORT &&
    question.answer.length === 0 && question.options.length === 0;
  return missingOrShort || subjectiveMissingAnswer;
}

/** 解析建议写入（简答无答案题：参考作答同时进 answer 与 analysis）。返回副本。 */
export function applyAiAnalysisSuggestion(question: Question, generatedAnalysis: string): Question {
  const clean = generatedAnalysis.trim();
  if (clean.length === 0) {
    return question;
  }
  const next = cloneQuestion(question);
  if (question.type === QuestionType.SHORT && question.answer.length === 0 && question.options.length === 0) {
    next.answer = [clean];
    next.analysis = clean;
  } else {
    next.analysis = clean;
  }
  return next;
}

export function aiConfidenceLabel(confidence: string): string {
  const clean = confidence.trim().toUpperCase();
  if (clean === 'HIGH') {
    return '可信度 高';
  }
  if (clean === 'LOW') {
    return '可信度 低';
  }
  return '可信度 中';
}

export class AiDisplayQuestionResult {
  question: Question;
  userAnswer: string[];
  constructor(question: Question, userAnswer: string[]) {
    this.question = question;
    this.userAnswer = userAnswer;
  }
}

/** 练习页 AI 视图题（题 + 映射后的用户答案），见文件头注释 */
export function aiDisplayQuestionWithAnswer(question: Question, displayOptions: PracticeDisplayOption[],
  userAnswer: string[]): AiDisplayQuestionResult {
  const next = cloneQuestion(question);
  next.options = displayOptions.map((o: PracticeDisplayOption): Option => new Option(o.displayKey, o.text));
  const remapKey = (original: string): string => {
    const lower = original.trim().toUpperCase();
    for (const option of displayOptions) {
      if (option.originalKey.trim().toUpperCase() === lower) {
        return option.displayKey;
      }
    }
    return original;
  };
  next.answer = question.answer.map((value: string): string => remapKey(value));
  return new AiDisplayQuestionResult(next, userAnswer.map((value: string): string => remapKey(value)));
}
