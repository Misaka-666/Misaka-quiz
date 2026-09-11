/**
 * 导入策略评分 — 1:1 移植自 Android ImportStrategyScorer.kt。
 */
import { Question, QuestionType } from '../../domain/Models';
import { ImportWarning, WarningLevel } from '../model/ImportModels';

const FRONT_MATTER_REGEX = /^(?:说明|注意事项|密卷|绝密|祝各位考生|时间[:：]|考试时间[:：])/;

export function score(questions: Question[], warnings: ImportWarning[]): number {
  if (questions.length === 0) return -1073741824; // Int.MIN_VALUE / 2
  const answeredCount = questions.filter((q: Question): boolean => q.answer.length > 0).length;
  const hardErrors = warnings.filter((w: ImportWarning): boolean => w.level === WarningLevel.ERROR).length;
  const softWarnings = warnings.filter((w: ImportWarning): boolean => w.level === WarningLevel.WARNING).length;
  const analysisCount = questions.filter((q: Question): boolean => q.analysis.trim().length > 0).length;
  const answerCoverage = answeredCount / questions.length;
  const isObjective = (q: Question): boolean =>
    q.type === QuestionType.SINGLE || q.type === QuestionType.MULTIPLE || q.type === QuestionType.JUDGE;
  const objectiveCount = questions.filter(isObjective).length;
  const optionCoverage = objectiveCount === 0 ? 0.0 :
    questions.filter((q: Question): boolean => isObjective(q) && q.options.length >= 2).length / objectiveCount;
  const sectionBonus = questions.some((q: Question): boolean => q.category.trim().length > 0) ? 20 : 0;
  const suspiciousFrontMatterCount = questions.filter((q: Question): boolean =>
    q.number === '00' || FRONT_MATTER_REGEX.test(q.question.trim())).length;
  const subjectiveCount = questions.filter((q: Question): boolean =>
    q.type === QuestionType.SHORT || q.type === QuestionType.BLANK).length;
  const suspiciousSubjectivePenalty =
    questions.length >= 30 && subjectiveCount > Math.floor(questions.length / 2) && suspiciousFrontMatterCount > 0
      ? 400
      : 0;

  return questions.length * 5 +
    answeredCount * 12 +
    analysisCount * 4 +
    Math.floor(answerCoverage * 150) +
    Math.floor(optionCoverage * 80) +
    sectionBonus -
    hardErrors * 35 -
    softWarnings * 6 -
    suspiciousFrontMatterCount * 1200 -
    suspiciousSubjectivePenalty;
}
