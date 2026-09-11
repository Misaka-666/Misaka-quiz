/**
 * 导入解析编排器 — 1:1 移植自 Android QuizImportParser.kt。
 * parseStandardText / parseDualText 是整个导入链路的入口。
 */
import { Question, QuestionType, Option } from '../../domain/Models';
import { ImportWarning, WarningLevel, ImportDiagnostics, ImportResult } from '../model/ImportModels';
import { score } from '../score/ImportStrategyScorer';
import { validate } from '../validate/ImportValidator';
import { normalizeText } from './QuestionTextNormalizer';
import { hasAnswerSection, splitSections, parseAnswerSection } from './AnswerSectionParser';
import { rewrite as rewriteSharedStem } from './SharedStemQuestionFallbackParser';
import { parseStandardFirst } from './QuestionParser';
import { parseExcelTable } from './ExcelQuestionTableParser';
import { shouldTryFullPaper, parseFullPaper, looksLikeFullPaper } from './FullPaperFallbackStrategy';
import { mergeAuto } from './DualFileMerger';
import { parseAnswers, ParsedAnswerEntry } from './AnswerParser';
import { splitQuestionBlocks } from './QuestionBlockSplitter';
import { hasCompactOptionSequence } from './CompactQuestionRepair';
import { cloneQuestion } from '../model/MultiBlankSupport';

const PURE_FRONT_MATTER_FRAGMENT_REGEX = /^(?:[【\[]?\s*)?(?:绝密|密卷|注意事项(?:\s*[:：].*)?|说明\s*[:：]\s*(?:请|考试|答题|作答|时间|考生).*|请(?:认真|仔细)作答|请在规定时间内完成(?:答题|作答)|请将答案(?:填写|填涂|写在|写到).*|请用\s*2B.*|请勿.*|答题前.*|答题卡.*|考试时间\s*[:：].*|时间\s*[:：].*|在考试结束.*|考试结束.*|全部测验到此结束.*|祝各位考生.*|监考老师.*)(?:\s*[】\]])?$/i;
const MISPARSED_CHOICE_CUE_REGEX = /(?:下列|以下|哪项|哪个|选择|选出|正确|错误|不正确|最合适|最符合)/;
const SUBJECTIVE_CATEGORY_REGEX = /(?:简答|填空|问答|论述|主观|案例分析|材料分析)/;
const CHOICE_INTENT_REGEX = /(?:下列|以下).{0,24}(?:哪|正确|错误|不正确|符合)|选择|选出|最(?:合适|符合|恰当)|应(?:选择|选)/;
const SUBJECTIVE_LEAD_REGEX = /^(?:请|试)?(?:分别)?(?:说明|简述|阐述|论述|比较|解释|概述|谈谈|回答|分析)/;
const SUBJECTIVE_PURPOSE_REGEX = /(?:差异|区别|联系|原因|影响|措施|方法|原则|条件|优缺点|意义|作用|过程|依据|适用|如何|为什么|各自|分别)/;
const COMPARISON_REGEX = /(?:有何|有什么).*(?:区别|差异|联系)/;
const FRONT_MATTER_CONTAMINATION_REGEX = /(?:^|\s)(?:说明\s*[:：]|注意事项|密卷|绝密|祝各位考生|请仔细阅读|监考老师|请用\s*2B|答题卡|请勿|考试时间\s*[:：]|时间\s*[:：])/;
const STRICT_OBJECTIVE_CHARS_REGEX = /^[A-Ga-g\s,，、;；/\\]+$/;
const ANSWER_SEPARATOR_COLLAPSE_REGEX = /[\s,，、;；/\\]+/g;
const COMPACT_LETTERS_ONLY_REGEX = /^[A-G]+$/;
const SENTENCE_FRAGMENT_SPLIT_REGEX = /[。；;!?！？]+/;

class Candidate {
  name: string;
  questions: Question[];
  warnings: ImportWarning[];
  score: number;
  constructor(name: string, questions: Question[], warnings: ImportWarning[], score: number) {
    this.name = name;
    this.questions = questions;
    this.warnings = warnings;
    this.score = score;
  }
}

class AnswerCandidateSource {
  name: string;
  answers: ParsedAnswerEntry[];
  constructor(name: string, answers: ParsedAnswerEntry[]) {
    this.name = name;
    this.answers = answers;
  }
}

export function parseStandardText(raw: string): ImportResult {
  const normalized = normalizeText(raw);
  const candidates: Candidate[] = [];
  const hasSection = hasAnswerSection(normalized);
  const questionArea = hasSection
    ? splitSections(normalized).questionArea
    : normalized;

  const rewrittenQuestionArea = rewriteSharedStem(questionArea);
  const primaryQuestions = parseStandardFirst(rewrittenQuestionArea ?? questionArea);
  let primaryCandidate: Candidate;
  if (hasSection) {
    const answerEntries = parseAnswerSection(normalized);
    const merged = mergeAuto(primaryQuestions, answerEntries);
    primaryCandidate = buildCandidate(
      buildPrimaryStrategyName(rewrittenQuestionArea !== null, true, merged.name),
      merged.questions,
      merged.warnings
    );
  } else {
    primaryCandidate = buildCandidate(
      buildPrimaryStrategyName(rewrittenQuestionArea !== null, false),
      primaryQuestions
    );
  }
  candidates.push(primaryCandidate);

  const tableQuestions = parseExcelTable(normalized);
  const tableCandidate = tableQuestions.length > 0
    ? buildCandidate('Excel/CSV 表格题库解析', tableQuestions)
    : null;
  if (tableCandidate !== null) candidates.push(tableCandidate);

  // 整卷兜底是否需要启动，必须依据答案合并前的题目结构判断。
  const fullPaperCandidate = shouldTryFullPaper(normalized, primaryQuestions)
    ? buildFullPaperCandidate(parseFullPaper(normalized), '整卷真题复杂兜底解析')
    : null;
  if (fullPaperCandidate !== null) candidates.push(fullPaperCandidate);

  const best = chooseBestCandidate(normalized, primaryCandidate, tableCandidate, fullPaperCandidate);

  return buildResult(normalized, candidates, best);
}

export function parseDualText(questionText: string, answerText: string): ImportResult {
  const normalizedQuestion = normalizeText(questionText);
  const normalizedAnswer = normalizeText(answerText);
  const questionCandidates: Candidate[] = [];

  const rewrittenQuestion = rewriteSharedStem(normalizedQuestion);
  const primaryQuestionCandidate = buildCandidate(
    buildPrimaryStrategyName(rewrittenQuestion !== null, false),
    parseStandardFirst(rewrittenQuestion ?? normalizedQuestion)
  );
  questionCandidates.push(primaryQuestionCandidate);

  const tableQuestions = parseExcelTable(normalizedQuestion);
  const tableQuestionCandidate = tableQuestions.length > 0
    ? buildCandidate('Excel/CSV 表格题目解析', tableQuestions)
    : null;
  if (tableQuestionCandidate !== null) questionCandidates.push(tableQuestionCandidate);

  const fullPaperQuestionCandidate = shouldTryFullPaper(normalizedQuestion, primaryQuestionCandidate.questions)
    ? buildFullPaperCandidate(parseFullPaper(normalizedQuestion), '整卷真题复杂题目兜底解析')
    : null;
  if (fullPaperQuestionCandidate !== null) questionCandidates.push(fullPaperQuestionCandidate);

  const answerCandidates: AnswerCandidateSource[] = [];
  const plainAnswers = parseAnswers(normalizedAnswer);
  if (plainAnswers.length > 0) answerCandidates.push(new AnswerCandidateSource('普通答案表', plainAnswers));
  const sectionAnswers = parseAnswerSection(normalizedAnswer);
  if (sectionAnswers.length > 0) answerCandidates.push(new AnswerCandidateSource('答案分区表', sectionAnswers));
  const fullParsedQuestions = parseStandardFirst(normalizedAnswer)
    .filter((q: Question): boolean => q.answer.length > 0);
  const fullParsedAnswers = fullParsedQuestions.map((question: Question, index: number): ParsedAnswerEntry => {
    const entry = new ParsedAnswerEntry(question.number, question.answer, question.type, '', index);
    entry.analysis = question.analysis;
    return entry;
  });
  if (fullParsedAnswers.length > 0) answerCandidates.push(new AnswerCandidateSource('完整题库答案兜底', fullParsedAnswers));
  const mixedSeen = new Set<string>();
  const mixed: ParsedAnswerEntry[] = [];
  for (const entry of plainAnswers.concat(sectionAnswers).concat(fullParsedAnswers)) {
    const key = `${entry.type}|${entry.number}|${entry.sequence}`;
    if (!mixedSeen.has(key)) {
      mixedSeen.add(key);
      mixed.push(entry);
    }
  }
  if (mixed.length > 0) answerCandidates.push(new AnswerCandidateSource('混合答案来源', mixed));

  const mergedCandidates: Candidate[] = [];
  const mergeQuestionCandidate = (questionCandidate: Candidate | null): Candidate | null => {
    if (questionCandidate === null) return null;
    let best: Candidate | null = null;
    for (const source of answerCandidates) {
      const merged = mergeAuto(questionCandidate.questions, source.answers);
      const candidate = buildCandidate(
        `${questionCandidate.name} + ${source.name}/${merged.name}`,
        merged.questions,
        merged.warnings
      );
      mergedCandidates.push(candidate);
      if (best === null || candidate.score > best.score) {
        best = candidate;
      }
    }
    return best ?? questionCandidate;
  };

  // 各题目策略先分别完成答案合并，再按受控规则选择题目策略，避免提前淘汰
  // “未合并答案时看不出优势、合并后才正确”的候选。
  const mergedPrimaryCandidate = mergeQuestionCandidate(primaryQuestionCandidate) ?? primaryQuestionCandidate;
  const mergedTableCandidate = mergeQuestionCandidate(tableQuestionCandidate);
  const mergedFullPaperCandidate = mergeQuestionCandidate(fullPaperQuestionCandidate);
  const best = chooseBestCandidate(
    normalizedQuestion,
    mergedPrimaryCandidate,
    mergedTableCandidate,
    mergedFullPaperCandidate
  );
  const diagnosticCandidates = questionCandidates.concat(mergedCandidates);

  return buildResult(
    normalizedQuestion + '\n' + normalizedAnswer,
    diagnosticCandidates,
    best
  );
}

function buildPrimaryStrategyName(
  hasSharedStemRewrite: boolean,
  hasAnswerSection: boolean,
  mergeName: string = ''
): string {
  const localFallback = hasSharedStemRewrite
    ? '标准优先解析（单题紧凑修复 + 共用题干局部兜底）'
    : '标准优先解析（单题紧凑修复）';
  return hasAnswerSection ? `${localFallback} + 答案集中区识别/${mergeName}` : localFallback;
}

function buildFullPaperCandidate(questions: Question[], name: string): Candidate | null {
  if (questions.length === 0) return null;
  return buildCandidate(name, questions);
}

function chooseBestCandidate(
  normalized: string,
  primaryCandidate: Candidate,
  tableCandidate: Candidate | null,
  fullPaperCandidate: Candidate | null
): Candidate {
  let best = primaryCandidate;

  if (tableCandidate !== null && shouldUseSpecializedTable(primaryCandidate, tableCandidate)) {
    best = tableCandidate;
  }

  if (fullPaperCandidate !== null && shouldUseFullPaper(normalized, best, fullPaperCandidate)) {
    best = fullPaperCandidate;
  }

  return best;
}

function shouldUseSpecializedTable(primary: Candidate, table: Candidate): boolean {
  if (primary.questions.length === 0) return true;
  const primaryErrors = primary.warnings.filter((w: ImportWarning): boolean => w.level === WarningLevel.ERROR).length;
  const tableErrors = table.warnings.filter((w: ImportWarning): boolean => w.level === WarningLevel.ERROR).length;
  const countFloor = Math.max(Math.floor(primary.questions.length * 0.8), 1);
  const preservesMostQuestions = table.questions.length >= countFloor;
  const materiallyCleaner = tableErrors < primaryErrors || table.score >= primary.score + 30;
  return preservesMostQuestions && materiallyCleaner;
}

function shouldUseFullPaper(
  normalized: string,
  primary: Candidate,
  fullPaper: Candidate
): boolean {
  if (!looksLikeFullPaper(normalized)) return false;
  if (fullPaper.questions.length === 0) return false;
  if (primary.questions.length === 0) return true;

  const primaryCount = primary.questions.length;
  const fullCount = fullPaper.questions.length;
  const primaryErrors = primary.warnings.filter((w: ImportWarning): boolean => w.level === WarningLevel.ERROR).length;
  const fullErrors = fullPaper.warnings.filter((w: ImportWarning): boolean => w.level === WarningLevel.ERROR).length;
  const primarySuspiciousSubjective = primary.questions.filter(looksLikeMisparsedObjectiveQuestion).length;
  const fullSuspiciousSubjective = fullPaper.questions.filter(looksLikeMisparsedObjectiveQuestion).length;
  const primaryShortStem = primary.questions.filter((q: Question): boolean =>
    q.question.trim().length <= 3 && q.options.length === 0).length;
  const fullShortStem = fullPaper.questions.filter((q: Question): boolean =>
    q.question.trim().length <= 3 && q.options.length === 0).length;
  const primaryFrontMatter = primary.questions.filter((q: Question): boolean =>
    containsFrontMatterContamination(q.question)).length;
  const fullFrontMatter = fullPaper.questions.filter((q: Question): boolean =>
    containsFrontMatterContamination(q.question)).length;
  const primaryValidObjective = primary.questions.filter(isStructurallyValidObjectiveQuestion).length;
  const fullValidObjective = fullPaper.questions.filter(isStructurallyValidObjectiveQuestion).length;

  if (downgradesExplicitSubjectiveQuestions(primary.questions, fullPaper.questions)) return false;

  const primaryOverallUnreliable =
    primaryErrors >= Math.max(Math.floor(primaryCount / 5), 2) ||
    primarySuspiciousSubjective >= Math.max(Math.floor(primaryCount / 5), 2) ||
    primaryShortStem >= 3 ||
    primaryFrontMatter > 0;

  // 双文件/密集整卷中，标准路径可能只得到少量“看起来正常”的题，因而没有错误告警。
  // 此时允许结构完整的整卷候选凭“明确补回多题”接管，但必须同时满足客观结构、
  // 错误数和前言污染均不退化，避免重新回到按总分自由覆盖标准结果。
  const recoveryGain = Math.max(Math.floor(primaryCount / 10), 2);
  const strongMissingQuestionRecovery =
    fullCount >= primaryCount + recoveryGain &&
    fullValidObjective >= primaryValidObjective + recoveryGain &&
    fullErrors <= primaryErrors &&
    fullShortStem <= primaryShortStem &&
    fullFrontMatter <= primaryFrontMatter &&
    fullValidObjective * 10 >= fullCount * 7;
  if (!primaryOverallUnreliable && !strongMissingQuestionRecovery) return false;

  const countIsReasonable = fullCount >= Math.max(Math.floor(primaryCount * 0.7), 3);
  const concreteStructureGain =
    fullErrors < primaryErrors ||
    strongMissingQuestionRecovery ||
    fullSuspiciousSubjective < primarySuspiciousSubjective ||
    fullValidObjective >= primaryValidObjective + 2 ||
    fullShortStem < primaryShortStem ||
    fullFrontMatter < primaryFrontMatter;
  const scoreDoesNotRegressMaterially = fullPaper.score >= primary.score - 20;

  return countIsReasonable && concreteStructureGain && scoreDoesNotRegressMaterially;
}

function looksLikeMisparsedObjectiveQuestion(question: Question): boolean {
  if (question.type !== QuestionType.SHORT && question.type !== QuestionType.BLANK) return false;
  if (isExplicitSubjectiveQuestion(question)) return false;
  if (question.options.length > 0) return false;
  if (hasCompactOptionSequence(question.question)) return true;
  return MISPARSED_CHOICE_CUE_REGEX.test(question.question);
}

function isStructurallyValidObjectiveQuestion(question: Question): boolean {
  const isObjective = question.type === QuestionType.SINGLE ||
    question.type === QuestionType.MULTIPLE ||
    question.type === QuestionType.JUDGE;
  if (!isObjective || question.options.length < 2) return false;
  const optionKeys = question.options.map((o: Option): string => o.key.toUpperCase());
  return question.answer.length === 0 ||
    question.answer.every((a: string): boolean => optionKeys.includes(a.toUpperCase()));
}

function isExplicitSubjectiveQuestion(question: Question): boolean {
  if (question.type !== QuestionType.SHORT && question.type !== QuestionType.BLANK) return false;
  if (SUBJECTIVE_CATEGORY_REGEX.test(question.category)) {
    return true;
  }
  if (looksLikeSubjectivePrompt(question.question)) return true;
  return question.answer.length > 0 && strictObjectiveAnswer(question.answer) === null;
}

function looksLikeSubjectivePrompt(stem: string): boolean {
  const normalized = stem.trim();
  if (CHOICE_INTENT_REGEX.test(normalized)) return false;

  const subjectiveLead = SUBJECTIVE_LEAD_REGEX.test(normalized);
  const subjectivePurpose = SUBJECTIVE_PURPOSE_REGEX.test(normalized);
  const comparisonQuestion = COMPARISON_REGEX.test(normalized);
  return (subjectiveLead && subjectivePurpose) || comparisonQuestion;
}

function containsFrontMatterContamination(stem: string): boolean {
  const prefix = stem.trim().substring(0, 140);
  if (prefix.length === 0) return false;
  return FRONT_MATTER_CONTAMINATION_REGEX.test(prefix);
}

function strictObjectiveAnswer(answers: string[]): string[] | null {
  if (answers.length === 0) return [];
  const raw = answers.join(',').trim()
    .replace(/^[[\]【】()（）]+/, '')
    .replace(/[[\]【】()（）]+$/, '')
    .trim();
  if (raw.trim().length === 0) return [];
  if (!STRICT_OBJECTIVE_CHARS_REGEX.test(raw)) return null;
  const compact = raw.replace(ANSWER_SEPARATOR_COLLAPSE_REGEX, '').toUpperCase();
  if (!COMPACT_LETTERS_ONLY_REGEX.test(compact)) return null;
  const letters = compact.split('');
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const l of letters) {
    if (!seen.has(l)) {
      seen.add(l);
      normalized.push(l);
    }
  }
  if (normalized.length !== letters.length) return null;
  return normalized.slice().sort();
}

function downgradesExplicitSubjectiveQuestions(
  primaryQuestions: Question[],
  fullPaperQuestions: Question[]
): boolean {
  const fullByNumber = new Map<string, Question[]>();
  for (const q of fullPaperQuestions) {
    const group = fullByNumber.get(q.number);
    if (group !== undefined) {
      group.push(q);
    } else {
      fullByNumber.set(q.number, [q]);
    }
  }
  for (let index = 0; index < primaryQuestions.length; index++) {
    const primaryQuestion = primaryQuestions[index];
    if (!isExplicitSubjectiveQuestion(primaryQuestion)) continue;
    const byNumber = fullByNumber.get(primaryQuestion.number);
    const candidate = (byNumber !== undefined && byNumber.length > 0 ? byNumber[0] : null) ??
      (index < fullPaperQuestions.length ? fullPaperQuestions[index] : null);
    if (candidate === null) continue;
    if (candidate.type === QuestionType.SINGLE ||
      candidate.type === QuestionType.MULTIPLE ||
      candidate.type === QuestionType.JUDGE) {
      return true;
    }
  }
  return false;
}

function buildCandidate(
  name: string,
  questions: Question[],
  extraWarnings: ImportWarning[] = []
): Candidate {
  const repairedQuestions: Question[] = [];
  for (const question of questions) {
    if (isPureFrontMatterPseudoQuestion(question)) continue;
    repairedQuestions.push(repairQuestionForDisplay(question));
  }
  const warnings = validate(repairedQuestions).concat(extraWarnings);
  const candidateScore = score(repairedQuestions, warnings);
  return new Candidate(name, repairedQuestions, warnings, candidateScore);
}

function isPureFrontMatterPseudoQuestion(question: Question): boolean {
  if (question.type !== QuestionType.SHORT && question.type !== QuestionType.BLANK) return false;
  if (question.options.length > 0 || question.answer.length > 0 || question.analysis.trim().length > 0) return false;

  const fragments: string[] = [];
  for (const line of question.question.split('\n')) {
    for (const fragment of line.split(SENTENCE_FRAGMENT_SPLIT_REGEX)) {
      const trimmed = fragment.trim();
      if (trimmed.length > 0) fragments.push(trimmed);
    }
  }
  if (fragments.length === 0) return false;
  return fragments.every((fragment: string): boolean => PURE_FRONT_MATTER_FRAGMENT_REGEX.test(fragment));
}

function repairQuestionForDisplay(question: Question): Question {
  if (question.type === QuestionType.JUDGE && question.options.length === 0) {
    const copy = cloneQuestion(question);
    copy.options = [new Option('A', '正确'), new Option('B', '错误')];
    return copy;
  }
  return question;
}

function buildResult(normalized: string, candidates: Candidate[], best: Candidate): ImportResult {
  const finalWarnings = best.questions.length === 0 &&
    !best.warnings.some((w: ImportWarning): boolean => w.level === WarningLevel.ERROR)
    ? best.warnings.concat([new ImportWarning(WarningLevel.ERROR, null, '未识别到任何题目')])
    : best.warnings;
  const diagnostics = new ImportDiagnostics();
  diagnostics.normalizedLength = normalized.length;
  diagnostics.blockCount = splitQuestionBlocks(normalized).length;
  diagnostics.answeredCount = best.questions.filter((q: Question): boolean => q.answer.length > 0).length;
  diagnostics.candidateCount = candidates.length;
  diagnostics.notes = buildDiagnosticNotes(best, candidates);
  return new ImportResult(best.questions, best.name, finalWarnings, diagnostics);
}

function buildDiagnosticNotes(best: Candidate, candidates: Candidate[]): string[] {
  const counts = new Map<string, number>();
  for (const q of best.questions) {
    counts.set(q.type, (counts.get(q.type) ?? 0) + 1);
  }
  const typeNote = `题型分布：单选${counts.get(QuestionType.SINGLE) ?? 0} / 多选${counts.get(QuestionType.MULTIPLE) ?? 0} / 判断${counts.get(QuestionType.JUDGE) ?? 0} / 填空${counts.get(QuestionType.BLANK) ?? 0} / 简答${counts.get(QuestionType.SHORT) ?? 0}`;
  const seenNames = new Set<string>();
  const deduped: Candidate[] = [];
  for (const candidate of candidates) {
    if (!seenNames.has(candidate.name)) {
      seenNames.add(candidate.name);
      deduped.push(candidate);
    }
  }
  deduped.sort((a: Candidate, b: Candidate): number => b.score - a.score);
  const candidateNotes = deduped.slice(0, 5).map((candidate: Candidate): string =>
    `${candidate.name}：${candidate.questions.length}题 / 答案${candidate.questions.filter((q: Question): boolean => q.answer.length > 0).length} / 分数${candidate.score}`);
  return [typeNote].concat(candidateNotes);
}
