/**
 * 整卷兜底策略 — 1:1 移植自 Android FullPaperFallbackStrategy.kt（含 FullPaperSectionParser）。
 * 仅当文本形似完整公考卷且标准解析答案覆盖率低时启用。
 */
import { Question, QuestionType, Option } from '../../domain/Models';
import { parseStandardFirst } from './QuestionParser';
import { parseAnswers, ParsedAnswerEntry } from './AnswerParser';
import { mergeAuto, mergeByNumber, mergeBySequence } from './DualFileMerger';
import { hasCompactOptionSequence } from './CompactQuestionRepair';
import { containsMarker } from '../assets/QuestionImageMarker';
import { cloneQuestion } from '../model/MultiBlankSupport';

const MODE_QUESTION = 'QUESTION';
const MODE_ANSWER = 'ANSWER';

const PAPER_FRONT_MATTER_REGEX = /^(?:说明\s*[:：]|注意事项|密卷|绝密|祝各位考生|时间[:：]|考试时间[:：]|请仔细阅读|监考老师|请用\s*2B|答题卡|请勿|在考试结束|全部测验到此结束)/;
const ANSWER_HEADING_REGEX = /^(?:答案|答案解析|参考答案|参考答案解析|试题答案|解析|答案及解析|答案与解析)[:：]?$/;
const ANSWER_LIKE_LINE_REGEX = /^\s*(?:第\s*)?\d{1,4}\s*(?:题)?\s*[.、．:：]?\s*(?:[【\[]\s*(?:答案|解析)\s*[】\]]|(?:答案|解析)\s*[:：]|[A-Ga-g](?:\s|$|[\u4e00-\u9fa5]))/i;
const QUESTION_START_REGEX = /^\s*(?:[【\[]\s*)?\d{1,4}(?:\s*[】\]])?\s*[.、．:：)）]?\s*\S+/;
const MATERIAL_INTRO_REGEX = /(根据(?:以下|下列|上述|给定)?(?:资料|材料|图表|统计资料).*回答\s*\d+\s*[~～\-—至到]\s*\d+\s*题)/;
const MATERIAL_INTRO_LINE_REGEX = /^\s*(?:[一二三四五六七八九十0-9]+[、.．:：]\s*)?根据(?:以下|下列|上述|给定)?(?:资料|材料|图表|统计资料).*回答\s*\d{1,4}\s*[~～\-—至到]\s*\d{1,4}\s*题/;
const QUESTION_LIKE_REGEX = /(问|哪|何|多少|几个|几|下列|以下|选择|选出|正确|错误|最|能够|能由|意在|主要|填入|划线|划横线|\?|？|\(\s*\)|（\s*）)/;
const TABLE_ROW_LIKE_REGEX = /^\s*\d+(?:\.\d+)?\s+(?:\d+(?:\.\d+)?\s+){1,}|^\s*\d+(?:\.\d+)?\s*(?:第一|第二|第三|固定资产|社会消费|地方财政|实际利用|进出口|指标|占全国|增长速度|产业产值)/;
const DENSE_NUMBER_SPLIT_REGEX = /(?<!^)(?<![\d.])(\d{1,3}\s*[.、．:：]\s*(?=[\u4e00-\u9fa5]))/g;
const DENSE_OPTION_SPLIT_A_REGEX = /([^\n\s])([A-Ga-g]\s*[.、．:：)）]\s*)/g;
const DENSE_OPTION_SPLIT_B_REGEX = /\s+([A-Ga-g]\s*[.、．:：)）]\s*)/g;
const TABLE_PREFIX_REGEX = /^\d+\s*表\d*/;
const OBJECTIVE_LETTER_REGEX = /^[A-G]$/;
const FRONT_MATTER_CONTAMINATION_REGEX = /(?:^|\s)(?:注意事项|绝密|密卷|祝各位考生|请仔细阅读|监考老师|请用\s*2B|答题卡|考试时间|请勿|考试结束)\s*[:：]?/;
const FRONT_MATTER_SOFT_REGEX = /(?:注意事项|绝密|密卷|祝各位考生|请仔细阅读|监考老师|请用\s*2B|答题卡|考试时间\s*[:：]|请勿|考试结束)/;
const SUBJECTIVE_CATEGORY_REGEX = /(?:简答|填空|问答|论述|主观|案例分析|材料分析)/;
const CHOICE_INTENT_REGEX = /(?:下列|以下).{0,24}(?:哪|正确|错误|不正确|符合)|选择|选出|最(?:合适|符合|恰当)|应(?:选择|选)/;
const SUBJECTIVE_LEAD_REGEX = /^(?:请|试)?(?:分别)?(?:说明|简述|阐述|论述|比较|解释|概述|谈谈|回答|分析)/;
const SUBJECTIVE_PURPOSE_REGEX = /(?:差异|区别|联系|原因|影响|措施|方法|原则|条件|优缺点|意义|作用|过程|依据|适用|如何|为什么|各自|分别)/;
const COMPARISON_REGEX = /(?:有何|有什么).*(?:区别|差异|联系)/;
const MISPARSED_CHOICE_CUE_REGEX = /(?:下列|以下|哪项|哪个|选择|选出|正确|错误|不正确|最合适|最符合)/;

class QuestionSegment {
  index: number;
  category: string;
  text: string;
  constructor(index: number, category: string, text: string) {
    this.index = index;
    this.category = category;
    this.text = text;
  }
}

class AnswerSegment {
  targetQuestionSegmentIndex: number | null;
  text: string;
  constructor(targetQuestionSegmentIndex: number | null, text: string) {
    this.targetQuestionSegmentIndex = targetQuestionSegmentIndex;
    this.text = text;
  }
}

class PaperChunk {
  isQuestions: boolean;
  question: QuestionSegment | null;
  answer: AnswerSegment | null;
  constructor(isQuestions: boolean, question: QuestionSegment | null, answer: AnswerSegment | null) {
    this.isQuestions = isQuestions;
    this.question = question;
    this.answer = answer;
  }
}

function toIntOrNull(raw: string): number | null {
  const clean = raw.trim();
  if (!/^-?\d+$/.test(clean)) return null;
  return parseInt(clean, 10);
}

export function shouldTryFullPaper(text: string, standardQuestions: Question[]): boolean {
  if (!looksLikeFullPaper(text)) return false;
  if (standardQuestions.length === 0) return true;

  const answeredCoverage = standardQuestions.filter((q: Question): boolean => q.answer.length > 0).length /
    standardQuestions.length;
  const suspiciousQuestionCount = standardQuestions.filter((question: Question): boolean => {
    const stem = question.question.substring(0, 40);
    return stem.includes('说明') || stem.includes('绝密') || stem.includes('密卷') || stem.includes('注意事项');
  }).length;
  const suspiciousSubjectiveCount = standardQuestions.filter(looksLikeMisparsedObjectiveQuestion).length;
  return answeredCoverage < 0.85 || suspiciousQuestionCount > 0 || suspiciousSubjectiveCount >= 2;
}

export function looksLikeFullPaper(text: string): boolean {
  const lines = text.split('\n').map((l: string): string => l.trim()).filter((l: string): boolean => l.length > 0);
  if (lines.length === 0) return false;
  const sectionHits = lines.filter((l: string): boolean => parseExamSection(l) !== null).length;
  const paperSignals = ['说明：', '说明:', '注意事项', '密卷', '绝密', '答题卡', '考试结束']
    .filter((signal: string): boolean => text.includes(signal)).length;
  const answerSignals = lines.filter((l: string): boolean =>
    ANSWER_HEADING_REGEX.test(l) || ANSWER_LIKE_LINE_REGEX.test(l)).length;
  const materialSignals = lines.filter((l: string): boolean => MATERIAL_INTRO_REGEX.test(l)).length;
  return sectionHits >= 2 ||
    (sectionHits >= 1 && answerSignals >= 5) ||
    (paperSignals >= 2 && answerSignals >= 5) ||
    (materialSignals >= 1 && answerSignals >= 5);
}

export function parseFullPaper(text: string): Question[] {
  const chunks = splitIntoPaperChunks(text);
  if (!chunks.some((c: PaperChunk): boolean => c.isQuestions)) return [];

  const questionsBySegment = new Map<number, Question[]>();
  const orderedQuestions: Question[] = [];
  for (const chunk of chunks) {
    if (chunk.isQuestions && chunk.question !== null) {
      const segment = chunk.question;
      const parsed = parseStandardFirst(preprocessQuestionSegment(segment.text), null, segment.category, false)
        .map((question: Question): Question => {
          const copy = cloneQuestion(question);
          copy.category = segment.category.length > 0 ? segment.category : question.category;
          return copy;
        })
        .filter(isValidPaperQuestion);
      questionsBySegment.set(segment.index, parsed);
      for (const q of parsed) orderedQuestions.push(q);
    }
  }

  if (orderedQuestions.length === 0) return [];

  const answerSegments: AnswerSegment[] = [];
  for (const chunk of chunks) {
    if (!chunk.isQuestions && chunk.answer !== null) {
      answerSegments.push(chunk.answer);
    }
  }
  if (answerSegments.length === 0) return normalizeFullPaperQuestions(orderedQuestions);

  let mergedQuestions: Question[] = orderedQuestions;
  const globalAnswers: ParsedAnswerEntry[] = [];

  for (const segment of answerSegments) {
    const answers = parseAnswers(segment.text);
    if (answers.length === 0) continue;
    const targetIndex = segment.targetQuestionSegmentIndex;
    const targetQuestions = targetIndex !== null ? questionsBySegment.get(targetIndex) ?? [] : [];

    const shouldMergeGlobally = targetQuestions.length === 0 ||
      answers.length > Math.max(Math.floor(targetQuestions.length * 1.5), 4);
    if (shouldMergeGlobally) {
      for (const a of answers) globalAnswers.push(a);
    } else {
      const mergedSegment = mergeFullPaperSegmentAnswers(targetQuestions, answers);
      mergedQuestions = replaceSegmentQuestions(mergedQuestions, targetQuestions, mergedSegment);
    }
  }

  if (globalAnswers.length > 0) {
    mergedQuestions = mergeAuto(mergedQuestions, globalAnswers).questions;
  }

  return normalizeFullPaperQuestions(mergedQuestions);
}

function splitIntoPaperChunks(text: string): PaperChunk[] {
  const chunks: PaperChunk[] = [];
  let mode = MODE_QUESTION;
  let category = '';
  let started = false;
  let segmentIndex = 0;
  let lastQuestionSegmentIndex: number | null = null;
  let buffer: string[] = [];

  const flush = (): void => {
    const body = buffer.join('\n').trim();
    if (body.length === 0) {
      buffer = [];
      return;
    }
    if (mode === MODE_QUESTION) {
      segmentIndex += 1;
      lastQuestionSegmentIndex = segmentIndex;
      chunks.push(new PaperChunk(true, new QuestionSegment(segmentIndex, category, body), null));
    } else {
      chunks.push(new PaperChunk(false, null, new AnswerSegment(lastQuestionSegmentIndex, body)));
    }
    buffer = [];
  };

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.length === 0) continue;

    const section = parseExamSection(line);
    if (section !== null) {
      flush();
      started = true;
      mode = MODE_QUESTION;
      category = section;
      continue;
    }

    if (!started) {
      if (PAPER_FRONT_MATTER_REGEX.test(line)) continue;
      if (!QUESTION_START_REGEX.test(line)) continue;
      started = true;
    }

    if (ANSWER_HEADING_REGEX.test(line)) {
      flush();
      mode = MODE_ANSWER;
      continue;
    }

    if (mode === MODE_QUESTION && ANSWER_LIKE_LINE_REGEX.test(line) && buffer.length > 0) {
      const nextWindowQuestionCount = buffer.filter((l: string): boolean => QUESTION_START_REGEX.test(l.trim())).length;
      if (nextWindowQuestionCount >= 3 || buffer.join('\n').length > 500) {
        flush();
        mode = MODE_ANSWER;
      }
    }

    buffer.push(raw);
  }
  flush();
  return chunks;
}

function preprocessQuestionSegment(text: string): string {
  const out: string[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (isPaperFrontMatterLine(trimmed) || ANSWER_HEADING_REGEX.test(trimmed) || MATERIAL_INTRO_LINE_REGEX.test(trimmed)) {
      continue;
    }
    for (const repaired of repairDenseQuestionLine(line).split('\n')) {
      out.push(repaired);
    }
  }
  return out.join('\n');
}

function isPaperFrontMatterLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0) return false;
  if (PAPER_FRONT_MATTER_REGEX.test(trimmed)) return true;
  if (QUESTION_START_REGEX.test(trimmed)) return false;
  if (trimmed.length > 160) return false;
  return FRONT_MATTER_SOFT_REGEX.test(trimmed);
}

function containsPaperFrontMatterContamination(stem: string): boolean {
  const prefix = stem.trim().substring(0, 160);
  if (prefix.length === 0) return false;
  if (PAPER_FRONT_MATTER_REGEX.test(prefix)) return true;
  return FRONT_MATTER_CONTAMINATION_REGEX.test(prefix);
}

function repairDenseQuestionLine(raw: string): string {
  let line = raw;
  if (line.length >= 80) {
    line = line.replace(DENSE_NUMBER_SPLIT_REGEX, '\n$1');
  }
  if (line.length >= 40) {
    line = line
      .replace(DENSE_OPTION_SPLIT_A_REGEX, '$1\n$2')
      .replace(DENSE_OPTION_SPLIT_B_REGEX, '\n$1');
  }
  return line;
}

function isValidPaperQuestion(question: Question): boolean {
  const stem = question.question.trim();
  if (stem.length === 0) return false;
  if (containsPaperFrontMatterContamination(stem)) return false;
  if (containsMarker(stem)) return true;
  if (TABLE_ROW_LIKE_REGEX.test(stem)) return false;
  if (TABLE_PREFIX_REGEX.test(stem)) return false;
  if (stem.includes('表') && stem.includes('指标')) return false;
  if (stem.includes('增长速度') && stem.includes('占全国')) return false;
  if (stem.length <= 2 && question.options.length === 0) return false;
  if (ANSWER_LIKE_LINE_REGEX.test(stem) && question.options.length === 0) return false;
  if (question.options.length === 0 && !QUESTION_LIKE_REGEX.test(stem)) return false;
  return true;
}

function mergeFullPaperSegmentAnswers(
  targetQuestions: Question[],
  answers: ParsedAnswerEntry[]
): Question[] {
  if (targetQuestions.length === 0 || answers.length === 0) return targetQuestions;
  const byNumber = mergeByNumber(targetQuestions, answers).questions;
  const beforeAnswered = targetQuestions.filter((q: Question): boolean => q.answer.length > 0).length;
  const byNumberGain = byNumber.filter((q: Question): boolean => q.answer.length > 0).length - beforeAnswered;
  const numberHitCount = targetQuestions.filter((question: Question): boolean =>
    answers.some((a: ParsedAnswerEntry): boolean => a.number === question.number)).length;
  if (byNumberGain > 0 || numberHitCount >= Math.max(Math.floor(targetQuestions.length / 2), 3)) {
    return byNumber;
  }
  return mergeBySequence(targetQuestions, answers).questions;
}

function replaceSegmentQuestions(
  all: Question[],
  oldSegment: Question[],
  newSegment: Question[]
): Question[] {
  if (oldSegment.length === 0) return all.slice();
  let firstIndex = -1;
  for (let i = 0; i < all.length; i++) {
    if (all[i].id === oldSegment[0].id) {
      firstIndex = i;
      break;
    }
  }
  if (firstIndex < 0) return all.slice();
  const result = all.slice();
  result.splice(firstIndex, oldSegment.length);
  for (let i = 0; i < newSegment.length; i++) {
    result.splice(firstIndex + i, 0, newSegment[i]);
  }
  return result;
}

function normalizeFullPaperQuestions(questions: Question[]): Question[] {
  const scopedQuestions = assignImplicitSectionCategoriesForFullPaper(questions);
  return scopedQuestions.map((question: Question): Question => {
    const objectiveAnswer = question.answer.filter((a: string): boolean => OBJECTIVE_LETTER_REGEX.test(a));
    const imageChoiceWithoutTextOptions = question.options.length === 0 &&
      containsMarker(question.question) &&
      objectiveAnswer.length > 0;
    const normalizedOptions = imageChoiceWithoutTextOptions
      ? 'ABCD'.split('').map((key: string): Option => new Option(key, `图中选项${key}`))
      : question.options;
    let normalizedType = question.type;
    if (normalizedOptions.length >= 2 && objectiveAnswer.length > 1) {
      normalizedType = QuestionType.MULTIPLE;
    } else if (normalizedOptions.length >= 2 && objectiveAnswer.length === 1 && question.type !== QuestionType.JUDGE) {
      normalizedType = QuestionType.SINGLE;
    }
    const category = enrichMaterialHint(question.category, question.question);
    const copy = cloneQuestion(question);
    copy.type = normalizedType;
    copy.options = normalizedOptions;
    copy.category = category;
    return copy;
  });
}

function looksLikeMisparsedObjectiveQuestion(question: Question): boolean {
  if (question.type !== QuestionType.SHORT && question.type !== QuestionType.BLANK) return false;
  if (isExplicitSubjectiveCategory(question.category)) return false;
  if (looksLikeSubjectivePrompt(question.question)) return false;
  if (question.options.length > 0) return false;

  const stem = question.question.trim();
  if (hasCompactOptionSequence(stem)) return true;
  return QUESTION_LIKE_REGEX.test(stem) && MISPARSED_CHOICE_CUE_REGEX.test(stem);
}

function isExplicitSubjectiveCategory(category: string): boolean {
  return SUBJECTIVE_CATEGORY_REGEX.test(category);
}

function looksLikeSubjectivePrompt(stem: string): boolean {
  const normalized = stem.trim();
  if (CHOICE_INTENT_REGEX.test(normalized)) return false;

  const subjectiveLead = SUBJECTIVE_LEAD_REGEX.test(normalized);
  const subjectivePurpose = SUBJECTIVE_PURPOSE_REGEX.test(normalized);
  const comparisonQuestion = COMPARISON_REGEX.test(normalized);
  return (subjectiveLead && subjectivePurpose) || comparisonQuestion;
}

function assignImplicitSectionCategoriesForFullPaper(questions: Question[]): Question[] {
  if (questions.length === 0) return questions;
  let lastNumericNumber: number | null = null;
  let sectionIndex = 1;
  return questions.map((question: Question): Question => {
    const numericNumber = toIntOrNull(question.number);
    if (numericNumber === 1 && lastNumericNumber !== null && lastNumericNumber >= 2) {
      sectionIndex += 1;
    }
    if (numericNumber !== null) {
      lastNumericNumber = numericNumber;
    }
    if (question.category.trim().length > 0) {
      return question;
    }
    const copy = cloneQuestion(question);
    copy.category = implicitFullPaperSectionTitle(question.type, sectionIndex);
    return copy;
  });
}

function implicitFullPaperSectionTitle(type: string, sectionIndex: number): string {
  let label = '';
  if (type === QuestionType.SINGLE) label = '单选题';
  else if (type === QuestionType.MULTIPLE) label = '多选题';
  else if (type === QuestionType.JUDGE) label = '判断题';
  else if (type === QuestionType.BLANK) label = '填空题';
  else label = '简答题';
  return `第${sectionIndex}组/${label}`;
}

function enrichMaterialHint(category: string, stem: string): string {
  if (MATERIAL_INTRO_REGEX.test(stem) && !category.includes('材料')) {
    return [category, '材料题'].filter((v: string): boolean => v.length > 0).join(' / ');
  }
  return category;
}

// ---------- FullPaperSectionParser ----------

const EXAM_SECTION_PREFIX_REGEX = /^\s*(?:(?:第[一二三四五六七八九十百0-9]+|[一二三四五六七八九十百0-9]+)\s*(?:部分|模块|章|节)[、.．:：]?|[一二三四五六七八九十百]+[、.．:：]|\([一二三四五六七八九十百]+\)|（[一二三四五六七八九十百]+）|Part\s*[IVX0-9]+|Section\s*[A-Z0-9]+)\s*/i;

// 公考/事业编五类主科目别名，按常识→言语→数理→推理→资料顺序排列
const EXAM_SECTION_ALIASES = [
  '常识判断', '常识', '公共基础知识', '综合知识', '基础知识',
  '言语理解与表达', '语言理解与表达', '言语理解', '语言理解', '言语表达', '阅读理解', '片段阅读', '选词填空', '逻辑填空', '语句表达', '语句排序', '文章阅读',
  '数量关系', '数学能力', '数学运算', '数字推理', '数学推理', '数量分析',
  '判断推理', '图形推理', '定义判断', '类比推理', '逻辑判断', '演绎推理', '分析推理', '事件排序', '空间推理',
  '资料分析', '材料分析', '资料判断', '统计资料分析', '图表分析', '文字资料', '表格资料', '图形资料', '综合资料分析'
];

export function parseExamSection(rawLine: string): string | null {
  let line = rawLine.trim().replace(/[:：]+$/, '');
  if (line.length === 0 || line.length > 80) return null;
  const simplified = line.replace(EXAM_SECTION_PREFIX_REGEX, '').trim().replace(/[:：]+$/, '');
  let matched: string | null = null;
  for (const alias of EXAM_SECTION_ALIASES) {
    if (simplified.includes(alias) || line.includes(alias)) {
      matched = alias;
      break;
    }
  }
  if (matched === null) return null;
  return canonicalName(matched);
}

function canonicalName(alias: string): string {
  if (['语言理解与表达', '言语理解', '语言理解', '言语表达', '阅读理解', '片段阅读', '选词填空', '逻辑填空', '语句表达', '语句排序', '文章阅读'].includes(alias)) {
    return '言语理解与表达';
  }
  if (['数学能力', '数学运算', '数字推理', '数学推理', '数量分析'].includes(alias)) {
    return '数量关系';
  }
  if (['材料分析', '资料判断', '统计资料分析', '图表分析', '文字资料', '表格资料', '图形资料', '综合资料分析'].includes(alias)) {
    return '资料分析';
  }
  if (['常识', '公共基础知识', '综合知识', '基础知识'].includes(alias)) {
    return '常识判断';
  }
  return alias;
}
