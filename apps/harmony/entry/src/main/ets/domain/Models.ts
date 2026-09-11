/**
 * 领域模型与 JSON 序列化 — 1:1 移植自 Android QuizRepository.kt 的序列化部分。
 * 字段与字段出现规则与 Android backup.json 完全一致（跨端互通契约）。
 * 约束：TS/ArkTS 公共子集，可被 hvigor 与 Node 同时编译运行。
 * 注：Android 的 sanitizeQuestion（多空清洗+内嵌答案括号剥离）属于导入管线，
 * 在 M2 移植 MultiBlankSupport 后接入，此处解析不做 sanitize。
 */

export const DEFAULT_BANK_GROUP_NAME = '未分组';

// ponytail: 用静态常量类而非 enum——Node strip-only 不支持 enum（非可擦除语法），
// ArkTS 的 .ts 文件对静态常量类同样兼容；升级路径是未来统一改用 tsc 编译
export class QuestionType {
  static readonly SINGLE: string = 'SINGLE';
  static readonly MULTIPLE: string = 'MULTIPLE';
  static readonly JUDGE: string = 'JUDGE';
  static readonly BLANK: string = 'BLANK';
  static readonly SHORT: string = 'SHORT';
}

export class WrongStatus {
  static readonly REVIEWING: string = '复习中';
  static readonly NOT_MASTERED: string = '未掌握';
  static readonly MASTERED: string = '已掌握';
}

export class Option {
  key: string;
  text: string;
  constructor(key: string, text: string) {
    this.key = key;
    this.text = text;
  }
}

export class QuestionImage {
  id: string;
  localPath: string;
  sourceName: string;
  order: number;
  width: number | null;
  height: number | null;
  sizeBytes: number;
  constructor(id: string, localPath: string, sourceName: string, order: number,
    width: number | null, height: number | null, sizeBytes: number) {
    this.id = id;
    this.localPath = localPath;
    this.sourceName = sourceName;
    this.order = order;
    this.width = width;
    this.height = height;
    this.sizeBytes = sizeBytes;
  }
}

export class Question {
  id: string;
  number: string;
  type: string;
  question: string;
  options: Option[];
  answer: string[];
  blankAnswers: string[][];
  analysis: string;
  category: string;
  images: QuestionImage[];
  score: number | null;
  subject: string;
  grade: string;
  difficulty: string;
  knowledgePoints: string[];
  tags: string[];
  source: string;
  sourceFileId: string;
  version: number;
  reviewStatus: string;
  aiConfidence: number | null;
  warnings: string[];
  constructor(id: string, type: string, question: string) {
    this.id = id;
    this.number = '';
    this.type = type;
    this.question = question;
    this.options = [];
    this.answer = [];
    this.blankAnswers = [];
    this.analysis = '';
    this.category = '';
    this.images = [];
    this.score = null;
    this.subject = '';
    this.grade = '';
    this.difficulty = '';
    this.knowledgePoints = [];
    this.tags = [];
    this.source = '';
    this.sourceFileId = '';
    this.version = 1;
    this.reviewStatus = 'approved';
    this.aiConfidence = null;
    this.warnings = [];
  }
}

export class QuizBank {
  id: string;
  name: string;
  questions: Question[];
  groupName: string;
  constructor(id: string, name: string, groupName: string = DEFAULT_BANK_GROUP_NAME) {
    this.id = id;
    this.name = name;
    this.questions = [];
    this.groupName = groupName;
  }
}

export function normalizeWrongStatus(value: string): string {
  if (value === WrongStatus.REVIEWING || value === WrongStatus.MASTERED) {
    return value;
  }
  return WrongStatus.NOT_MASTERED;
}

export class WrongQuestionEntry {
  bankId: string;
  bankName: string;
  question: Question;
  lastAnswer: string[];
  source: string;
  timestamp: number;
  wrongCount: number;
  rightCount: number;
  reviewRightCount: number;
  streakCorrectCount: number;
  lastWrongAt: number;
  lastCorrectAt: number | null;
  status: string;
  lastReviewedAt: number | null;
  nextReviewAt: number | null;
  reviewLevel: number;
  constructor(bankId: string, bankName: string, question: Question, lastAnswer: string[],
    source: string, timestamp: number) {
    this.bankId = bankId;
    this.bankName = bankName;
    this.question = question;
    this.lastAnswer = lastAnswer;
    this.source = source;
    this.timestamp = timestamp;
    this.wrongCount = 1;
    this.rightCount = 0;
    this.reviewRightCount = 0;
    this.streakCorrectCount = 0;
    this.lastWrongAt = timestamp;
    this.lastCorrectAt = null;
    this.status = WrongStatus.REVIEWING;
    this.lastReviewedAt = null;
    this.nextReviewAt = null;
    this.reviewLevel = 0;
  }
}

export class SlashedQuestionEntry {
  bankId: string;
  questionKey: string;
  slashedAt: number;
  constructor(bankId: string, questionKey: string, slashedAt: number) {
    this.bankId = bankId;
    this.questionKey = questionKey;
    this.slashedAt = slashedAt;
  }
}

export class FavoriteQuestionEntry {
  bankId: string;
  bankName: string;
  question: Question;
  favoritedAt: number;
  constructor(bankId: string, bankName: string, question: Question, favoritedAt: number) {
    this.bankId = bankId;
    this.bankName = bankName;
    this.question = question;
    this.favoritedAt = favoritedAt;
  }
}

export class StudyQuestionResult {
  question: Question;
  userAnswer: string[];
  userBlankAnswers: string[];
  correct: boolean;
  answerText: string;
  earnedScore: number | null;
  maxScore: number | null;
  autoScored: boolean;
  sourceBankId: string | null;
  sourceBankName: string | null;
  constructor(question: Question, userAnswer: string[], correct: boolean, answerText: string) {
    this.question = question;
    this.userAnswer = userAnswer;
    this.userBlankAnswers = [];
    this.correct = correct;
    this.answerText = answerText;
    this.earnedScore = null;
    this.maxScore = null;
    this.autoScored = true;
    this.sourceBankId = null;
    this.sourceBankName = null;
  }
}

export class StudyRecord {
  id: string;
  bankId: string | null;
  bankName: string;
  source: string;
  title: string;
  total: number;
  correct: number;
  timestamp: number;
  durationSeconds: number | null;
  autoSubmitted: boolean;
  startedAt: number | null;
  earnedScore: number | null;
  totalScore: number | null;
  questionResults: StudyQuestionResult[];
  scopeType: string | null;
  scopeName: string | null;
  constructor(id: string, bankName: string, source: string, title: string,
    total: number, correct: number, timestamp: number) {
    this.id = id;
    this.bankId = null;
    this.bankName = bankName;
    this.source = source;
    this.title = title;
    this.total = total;
    this.correct = correct;
    this.timestamp = timestamp;
    this.durationSeconds = null;
    this.autoSubmitted = false;
    this.startedAt = null;
    this.earnedScore = null;
    this.totalScore = null;
    this.questionResults = [];
    this.scopeType = null;
    this.scopeName = null;
  }
}

// ---------- JSON helpers（对齐 org.json 的 optXxx 宽松语义） ----------

type JsonValue = Object | null | undefined;

function isRecord(v: JsonValue): boolean {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function optStr(obj: Record<string, Object>, key: string, def: string = ''): string {
  const v: JsonValue = obj[key];
  if (v === undefined || v === null) {
    return def;
  }
  if (typeof v === 'string') {
    return v;
  }
  return String(v);
}

function optNum(obj: Record<string, Object>, key: string, def: number): number {
  const v: JsonValue = obj[key];
  if (typeof v === 'number' && isFinite(v)) {
    return v;
  }
  return def;
}

function optBool(obj: Record<string, Object>, key: string, def: boolean): boolean {
  const v: JsonValue = obj[key];
  if (typeof v === 'boolean') {
    return v;
  }
  if (v === 'true') {
    return true;
  }
  if (v === 'false') {
    return false;
  }
  return def;
}

function optNullableNum(obj: Record<string, Object>, key: string): number | null {
  const v: JsonValue = obj[key];
  if (typeof v === 'number' && isFinite(v)) {
    return v;
  }
  return null;
}

function firstNonBlank(values: string[]): string {
  for (const v of values) {
    if (v.length > 0) {
      return v;
    }
  }
  return '';
}

// ---------- Question 序列化/解析 ----------

export function questionToJson(q: Question, registerAsset?: (image: QuestionImage) => string | null): Record<string, Object> {
  const json: Record<string, Object> = {};
  json['id'] = q.id;
  json['number'] = q.number;
  json['type'] = q.type;
  json['question'] = q.question;
  json['analysis'] = q.analysis;
  json['category'] = q.category;
  if (q.score !== null && isFinite(q.score)) {
    json['score'] = q.score;
  }
  const options: Record<string, Object>[] = [];
  for (const o of q.options) {
    options.push({ 'key': o.key, 'text': o.text } as Record<string, Object>);
  }
  json['options'] = options;
  json['answer'] = q.answer.slice();
  if (q.blankAnswers.length > 0) {
    json['blankAnswers'] = q.blankAnswers.map((blanks: string[]): Object => blanks.slice());
  }
  const images: Record<string, Object>[] = [];
  for (const img of q.images) {
    const exportPath: string | null = registerAsset ? registerAsset(img) : null;
    const imageJson: Record<string, Object> = {
      'id': img.id,
      'localPath': exportPath !== null ? exportPath : img.localPath,
      'sourceName': img.sourceName,
      'order': img.order,
      'sizeBytes': img.sizeBytes
    };
    // 对齐 org.json 语义：null 字段整个键省略
    if (img.width !== null) {
      imageJson['width'] = img.width;
    }
    if (img.height !== null) {
      imageJson['height'] = img.height;
    }
    images.push(imageJson);
  }
  json['images'] = images;
  if (q.subject.length > 0) {
    json['subject'] = q.subject;
  }
  if (q.grade.length > 0) {
    json['grade'] = q.grade;
  }
  if (q.difficulty.length > 0) {
    json['difficulty'] = q.difficulty;
  }
  if (q.knowledgePoints.length > 0) {
    json['knowledgePoints'] = q.knowledgePoints.slice();
  }
  if (q.tags.length > 0) {
    json['tags'] = q.tags.slice();
  }
  if (q.source.length > 0) {
    json['source'] = q.source;
  }
  if (q.sourceFileId.length > 0) {
    json['sourceFileId'] = q.sourceFileId;
  }
  json['version'] = q.version;
  if (q.reviewStatus !== 'approved') {
    json['reviewStatus'] = q.reviewStatus;
  }
  if (q.aiConfidence !== null && isFinite(q.aiConfidence)) {
    json['aiConfidence'] = q.aiConfidence;
  }
  if (q.warnings.length > 0) {
    json['warnings'] = q.warnings.slice();
  }
  return json;
}

export function parseQuestionType(rawType: string): string {
  const value = rawType.trim();
  if (value.length === 0) {
    return QuestionType.SINGLE;
  }
  const norm = value.toLowerCase().replace(/-/g, '_').replace(/ /g, '_');
  switch (norm) {
    case 'single':
    case 'single_choice':
    case 'singlechoice':
    case 'choice':
    case 'radio':
      return QuestionType.SINGLE;
    case 'multiple':
    case 'multiple_choice':
    case 'multiplechoice':
    case 'multi':
    case 'checkbox':
      return QuestionType.MULTIPLE;
    case 'judge':
    case 'judgement':
    case 'judgment':
    case 'true_false':
    case 'truefalse':
    case 'boolean':
      return QuestionType.JUDGE;
    case 'blank':
    case 'fill_blank':
    case 'fillblank':
    case 'fill_in_blank':
      return QuestionType.BLANK;
    case 'short':
    case 'subjective':
    case 'essay':
    case 'qa':
    case 'question_answer':
      return QuestionType.SHORT;
    default: {
      const upper = value.toUpperCase();
      // 对齐 Kotlin：QuestionType.valueOf(upper) 失败回落 SINGLE
      const known: string[] = [QuestionType.SINGLE, QuestionType.MULTIPLE, QuestionType.JUDGE, QuestionType.BLANK, QuestionType.SHORT];
      return known.includes(upper) ? upper : QuestionType.SINGLE;
    }
  }
}

function optionKeyForIndex(index: number): string {
  return String.fromCharCode('A'.charCodeAt(0) + index);
}

function parseFlexibleAnswer(json: Record<string, Object>): string[] {
  const arrayKeys = ['answer', 'answers', 'correctAnswer', 'correctAnswers'];
  for (const key of arrayKeys) {
    const v: JsonValue = json[key];
    if (Array.isArray(v)) {
      const out: string[] = [];
      for (const item of v) {
        const s = (typeof item === 'string' ? item : String(item)).trim();
        if (s.length > 0) {
          out.push(s);
        }
      }
      return out;
    }
  }
  const answerText = firstNonBlank(arrayKeys.map((k: string): string => optStr(json, k)));
  if (answerText.trim().length === 0) {
    return [];
  }
  return answerText.split(/[\s,，;；/|]+/).map((s: string): string => s.trim()).filter((s: string): boolean => s.length > 0);
}

function parseNestedStringArray(v: JsonValue): string[][] {
  if (!Array.isArray(v)) {
    return [];
  }
  const out: string[][] = [];
  for (const item of v) {
    if (Array.isArray(item)) {
      const inner: string[] = [];
      for (const x of item) {
        inner.push(typeof x === 'string' ? x : String(x));
      }
      out.push(inner);
    } else {
      const value = typeof item === 'string' ? item : String(item);
      out.push(value.trim().length === 0 ? [] : [value]);
    }
  }
  return out;
}

function parseStringArray(v: JsonValue): string[] {
  if (!Array.isArray(v)) {
    return [];
  }
  const out: string[] = [];
  for (const item of v) {
    const s = (typeof item === 'string' ? item : String(item)).trim();
    if (s.length > 0) {
      out.push(s);
    }
  }
  return out;
}

export function parseQuestion(raw: Object): Question {
  const json = raw as Record<string, Object>;
  // options：数组(对象/字符串)或对象映射，三种形态都兼容
  const options: Option[] = [];
  const rawOptions: JsonValue = json['options'];
  if (Array.isArray(rawOptions)) {
    for (let k = 0; k < rawOptions.length; k++) {
      const item = rawOptions[k];
      if (isRecord(item)) {
        const oj = item as Record<string, Object>;
        const key = optStr(oj, 'key');
        const text = firstNonBlank([optStr(oj, 'text'), optStr(oj, 'value'), optStr(oj, 'content'), optStr(oj, 'label')]);
        options.push(new Option(key.length > 0 ? key : optionKeyForIndex(k), text));
      } else {
        const text = (typeof item === 'string' ? item : String(item)).trim();
        if (text.length > 0) {
          options.push(new Option(optionKeyForIndex(k), text));
        }
      }
    }
  } else if (isRecord(rawOptions)) {
    const om = rawOptions as Record<string, Object>;
    for (const key of Object.keys(om)) {
      const value: JsonValue = om[key];
      let text = '';
      if (isRecord(value)) {
        const vj = value as Record<string, Object>;
        text = firstNonBlank([optStr(vj, 'text'), optStr(vj, 'value'), optStr(vj, 'content'), optStr(vj, 'label')]);
      } else if (value !== null && value !== undefined) {
        text = String(value);
      }
      text = text.trim();
      if (key.length > 0 && text.length > 0) {
        options.push(new Option(key, text));
      }
    }
  }

  // images：多字段路径兼容
  const images: QuestionImage[] = [];
  const rawImages: JsonValue = json['images'];
  if (Array.isArray(rawImages)) {
    for (let k = 0; k < rawImages.length; k++) {
      const item = rawImages[k];
      if (!isRecord(item)) {
        continue;
      }
      const ij = item as Record<string, Object>;
      const path = firstNonBlank([optStr(ij, 'localPath'), optStr(ij, 'dataUrl'), optStr(ij, 'dataUri'), optStr(ij, 'src'), optStr(ij, 'url')]);
      if (path.length === 0) {
        continue;
      }
      images.push(new QuestionImage(
        optStr(ij, 'id'), path,
        firstNonBlank([optStr(ij, 'sourceName'), optStr(ij, 'name'), optStr(ij, 'alt')]),
        optNum(ij, 'order', k + 1),
        optNullableNum(ij, 'width'),
        optNullableNum(ij, 'height'),
        optNum(ij, 'sizeBytes', 0)
      ));
    }
  }

  const q = new Question(optStr(json, 'id'), QuestionType.SINGLE, optStr(json, 'question'));
  q.number = optStr(json, 'number');
  q.type = parseQuestionType(optStr(json, 'type'));
  q.options = options;
  q.answer = parseFlexibleAnswer(json);
  q.blankAnswers = parseNestedStringArray(json['blankAnswers']);
  q.analysis = optStr(json, 'analysis');
  q.category = firstNonBlank([optStr(json, 'category'), optStr(json, 'group'), optStr(json, 'volume')]);
  q.images = images;
  q.score = optNullableNum(json, 'score');
  q.subject = optStr(json, 'subject');
  q.grade = optStr(json, 'grade');
  q.difficulty = optStr(json, 'difficulty');
  q.knowledgePoints = parseStringArray(json['knowledgePoints']);
  q.tags = parseStringArray(json['tags']);
  q.source = optStr(json, 'source');
  q.sourceFileId = optStr(json, 'sourceFileId');
  q.version = optNum(json, 'version', 1);
  q.reviewStatus = optStr(json, 'reviewStatus', 'approved');
  q.aiConfidence = optNullableNum(json, 'aiConfidence');
  q.warnings = parseStringArray(json['warnings']);
  return q;
}

// ---------- Bank / 各记录序列化/解析 ----------

export function normalizeBankGroupName(rawName: string | null): string {
  const trimmed = rawName === null ? '' : rawName.trim();
  return trimmed.length > 0 ? trimmed : DEFAULT_BANK_GROUP_NAME;
}

export function bankToJson(bank: QuizBank, registerAsset?: (image: QuestionImage) => string | null): Record<string, Object> {
  const questions: Object[] = [];
  for (const q of bank.questions) {
    questions.push(questionToJson(q, registerAsset));
  }
  return {
    'id': bank.id,
    'name': bank.name,
    'groupName': normalizeBankGroupName(bank.groupName),
    'questions': questions
  } as Record<string, Object>;
}

export function parseBank(raw: Object): QuizBank {
  const json = raw as Record<string, Object>;
  const bank = new QuizBank(optStr(json, 'id'), optStr(json, 'name'), normalizeBankGroupName(optStr(json, 'groupName', DEFAULT_BANK_GROUP_NAME)));
  const rawQuestions: JsonValue = json['questions'];
  if (Array.isArray(rawQuestions)) {
    for (const item of rawQuestions) {
      if (isRecord(item)) {
        bank.questions.push(parseQuestion(item));
      }
    }
  }
  return bank;
}

export function wrongEntryToJson(e: WrongQuestionEntry, registerAsset?: (image: QuestionImage) => string | null): Record<string, Object> {
  const json: Record<string, Object> = {
    'bankId': e.bankId,
    'bankName': e.bankName,
    'source': e.source,
    'timestamp': e.timestamp,
    'lastAnswer': e.lastAnswer.slice(),
    'wrongCount': e.wrongCount,
    'rightCount': e.rightCount,
    'reviewRightCount': e.reviewRightCount,
    'streakCorrectCount': e.streakCorrectCount,
    'lastWrongAt': e.lastWrongAt,
    'reviewLevel': e.reviewLevel,
    'status': e.status,
    'question': questionToJson(e.question, registerAsset)
  };
  if (e.lastCorrectAt !== null) {
    json['lastCorrectAt'] = e.lastCorrectAt;
  }
  if (e.lastReviewedAt !== null) {
    json['lastReviewedAt'] = e.lastReviewedAt;
  }
  if (e.nextReviewAt !== null) {
    json['nextReviewAt'] = e.nextReviewAt;
  }
  return json;
}

export function parseWrongEntry(raw: Object): WrongQuestionEntry | null {
  const json = raw as Record<string, Object>;
  const rawQuestion: JsonValue = json['question'];
  if (!isRecord(rawQuestion)) {
    return null;
  }
  const normalizedStatus = normalizeWrongStatus(optStr(json, 'status', WrongStatus.NOT_MASTERED));
  const fallbackCount = normalizedStatus === WrongStatus.MASTERED ? 2 : 0;
  const lastAnswer = parseOrderedStrings(json['lastAnswer']);
  const timestamp = optNum(json, 'timestamp', 0);
  const entry = new WrongQuestionEntry(optStr(json, 'bankId'), optStr(json, 'bankName'), parseQuestion(rawQuestion), lastAnswer, optStr(json, 'source'), timestamp);
  entry.wrongCount = optNum(json, 'wrongCount', 1);
  entry.rightCount = optNum(json, 'rightCount', 0);
  entry.reviewRightCount = optNum(json, 'reviewRightCount', fallbackCount);
  entry.streakCorrectCount = optNum(json, 'streakCorrectCount', fallbackCount);
  entry.lastWrongAt = optNum(json, 'lastWrongAt', timestamp);
  entry.lastCorrectAt = optNullableNum(json, 'lastCorrectAt');
  entry.status = normalizedStatus;
  entry.lastReviewedAt = optNullableNum(json, 'lastReviewedAt');
  entry.nextReviewAt = optNullableNum(json, 'nextReviewAt');
  entry.reviewLevel = optNum(json, 'reviewLevel', normalizedStatus === WrongStatus.MASTERED ? 2 : 0);
  return entry;
}

function parseOrderedStrings(v: JsonValue): string[] {
  if (!Array.isArray(v)) {
    return [];
  }
  const out: string[] = [];
  for (const item of v) {
    out.push(typeof item === 'string' ? item : String(item));
  }
  return out;
}

export function slashedEntryToJson(e: SlashedQuestionEntry): Record<string, Object> {
  return { 'bankId': e.bankId, 'questionKey': e.questionKey, 'slashedAt': e.slashedAt } as Record<string, Object>;
}

export function parseSlashedEntry(raw: Object): SlashedQuestionEntry {
  const json = raw as Record<string, Object>;
  return new SlashedQuestionEntry(optStr(json, 'bankId'), optStr(json, 'questionKey'), optNum(json, 'slashedAt', 0));
}

export function favoriteEntryToJson(e: FavoriteQuestionEntry, registerAsset?: (image: QuestionImage) => string | null): Record<string, Object> {
  return {
    'bankId': e.bankId,
    'bankName': e.bankName,
    'favoritedAt': e.favoritedAt,
    'question': questionToJson(e.question, registerAsset)
  } as Record<string, Object>;
}

export function parseFavoriteEntry(raw: Object): FavoriteQuestionEntry | null {
  const json = raw as Record<string, Object>;
  const rawQuestion: JsonValue = json['question'];
  if (!isRecord(rawQuestion)) {
    return null;
  }
  return new FavoriteQuestionEntry(optStr(json, 'bankId'), optStr(json, 'bankName'), parseQuestion(rawQuestion), optNum(json, 'favoritedAt', 0));
}

export function studyRecordToJson(r: StudyRecord, registerAsset?: (image: QuestionImage) => string | null): Record<string, Object> {
  const results: Object[] = [];
  for (const res of r.questionResults) {
    const item: Record<string, Object> = {
      'question': questionToJson(res.question, registerAsset),
      'userAnswer': res.userAnswer.slice(),
      'correct': res.correct,
      'answerText': res.answerText,
      'autoScored': res.autoScored
    };
    if (res.userBlankAnswers.length > 0 || hasStructuredBlankAnswers(res.question)) {
      item['userBlankAnswers'] = res.userBlankAnswers.slice();
    }
    if (res.earnedScore !== null) {
      item['earnedScore'] = res.earnedScore;
    }
    if (res.maxScore !== null) {
      item['maxScore'] = res.maxScore;
    }
    if (res.sourceBankId !== null && res.sourceBankId.length > 0) {
      item['sourceBankId'] = res.sourceBankId;
    }
    if (res.sourceBankName !== null && res.sourceBankName.length > 0) {
      item['sourceBankName'] = res.sourceBankName;
    }
    results.push(item);
  }
  const json: Record<string, Object> = {
    'id': r.id,
    'bankName': r.bankName,
    'source': r.source,
    'title': r.title,
    'total': r.total,
    'correct': r.correct,
    'timestamp': r.timestamp,
    'autoSubmitted': r.autoSubmitted,
    'questionResults': results
  };
  if (r.bankId !== null && r.bankId.length > 0) {
    json['bankId'] = r.bankId;
  }
  if (r.durationSeconds !== null) {
    json['durationSeconds'] = r.durationSeconds;
  }
  if (r.startedAt !== null) {
    json['startedAt'] = r.startedAt;
  }
  if (r.earnedScore !== null) {
    json['earnedScore'] = r.earnedScore;
  }
  if (r.totalScore !== null) {
    json['totalScore'] = r.totalScore;
  }
  if (r.scopeType !== null && r.scopeType.length > 0) {
    json['scopeType'] = r.scopeType;
  }
  if (r.scopeName !== null && r.scopeName.length > 0) {
    json['scopeName'] = r.scopeName;
  }
  return json;
}

export function parseStudyRecord(raw: Object): StudyRecord | null {
  const json = raw as Record<string, Object>;
  const r = new StudyRecord(optStr(json, 'id'), optStr(json, 'bankName'), optStr(json, 'source'), optStr(json, 'title'),
    optNum(json, 'total', 0), optNum(json, 'correct', 0), optNum(json, 'timestamp', 0));
  const bankId = optStr(json, 'bankId');
  r.bankId = bankId.length > 0 ? bankId : null;
  r.durationSeconds = optNullableNum(json, 'durationSeconds');
  r.autoSubmitted = optBool(json, 'autoSubmitted', false);
  const startedAt = optNullableNum(json, 'startedAt');
  r.startedAt = startedAt !== null ? startedAt : r.timestamp - (r.durationSeconds !== null ? r.durationSeconds : 0) * 1000;
  r.earnedScore = optNullableNum(json, 'earnedScore');
  r.totalScore = optNullableNum(json, 'totalScore');
  const scopeType = optStr(json, 'scopeType');
  r.scopeType = scopeType.length > 0 ? scopeType : null;
  const scopeName = optStr(json, 'scopeName');
  r.scopeName = scopeName.length > 0 ? scopeName : null;
  const rawResults: JsonValue = json['questionResults'];
  if (Array.isArray(rawResults)) {
    for (const item of rawResults) {
      if (!isRecord(item)) {
        continue;
      }
      const rj = item as Record<string, Object>;
      const rawQuestion: JsonValue = rj['question'];
      if (!isRecord(rawQuestion)) {
        continue;
      }
      const res = new StudyQuestionResult(parseQuestion(rawQuestion), parseOrderedStrings(rj['userAnswer']), optBool(rj, 'correct', false), optStr(rj, 'answerText'));
      const userBlankAnswers = parseOrderedStrings(rj['userBlankAnswers']);
      res.userBlankAnswers = userBlankAnswers.length > 0 ? userBlankAnswers :
        (hasStructuredBlankAnswers(res.question) ? res.userAnswer.slice() : []);
      res.earnedScore = optNullableNum(rj, 'earnedScore');
      res.maxScore = optNullableNum(rj, 'maxScore');
      res.autoScored = optBool(rj, 'autoScored', true);
      const sourceBankId = optStr(rj, 'sourceBankId');
      res.sourceBankId = sourceBankId.length > 0 ? sourceBankId : null;
      const sourceBankName = optStr(rj, 'sourceBankName');
      res.sourceBankName = sourceBankName.length > 0 ? sourceBankName : null;
      r.questionResults.push(res);
    }
  }
  return r;
}

// ponytail: 与 Android MultiBlankSupport.hasStructuredAnswers 同义；M2 移植完整实现后替换
export function hasStructuredBlankAnswers(q: Question): boolean {
  return q.blankAnswers.length > 0;
}
