/**
 * 备份编解码 — 1:1 移植自 Android QuizRepository.kt 的备份段
 * （buildBackupJson/buildBackupZip 的 JSON 部分/isWebBackupJson/parseStandaloneJsonPreview/
 *  questionMigrationFingerprint 与 id 修复链/stripEmbeddedAnswerBracket/sanitizeWrongEntry/
 *  sanitizeFavoriteEntry/parseBackupTimeMillis/data URI 图片转换/remapQuestionAssets/
 *  uniqueImportedBankName/importBackupJsonInternal）。
 * 协议契约：ZIP 根 backup.json + assets/<safeId>.<ext>；kind=misaka_quiz_full_backup（version 3）
 * 与 web_backup（misaka_quiz_web 前缀 / crossPlatform 字段）互通。
 * 文件 IO 经回调注入（writeAsset/randomId），Node 可测；约束：TS/ArkTS 公共子集。
 */
import {
  Question, QuestionImage, QuestionType, QuizBank, WrongQuestionEntry, FavoriteQuestionEntry,
  StudyRecord, StudyQuestionResult, WrongStatus, DEFAULT_BANK_GROUP_NAME, normalizeBankGroupName,
  normalizeWrongStatus, bankToJson, wrongEntryToJson, favoriteEntryToJson, studyRecordToJson,
  parseBank, parseQuestion, parseWrongEntry, parseFavoriteEntry, parseStudyRecord
} from '../domain/Models';
import {
  sanitizeQuestion as sanitizeMultiBlankQuestion, cloneQuestion, hasStructuredAnswers, expectedAnswerText
} from '../importer/model/MultiBlankSupport';
import { isWrongEntryMastered } from './WrongBookOps';

export const BACKUP_KIND_FULL = 'misaka_quiz_full_backup';
export const BACKUP_KIND_SELECTED = 'misaka_quiz_selected_banks';

// ---------- JSON 宽松读取（对齐 org.json optXxx） ----------

type JsonValue = Object | null | undefined;

function isRecord(v: JsonValue): boolean {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function optStr(obj: Record<string, Object>, key: string, def: string = ''): string {
  const v: JsonValue = obj[key];
  if (v === undefined || v === null) {
    return def;
  }
  return typeof v === 'string' ? v : String(v);
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

function optArray(obj: Record<string, Object>, key: string): Object[] | null {
  const v: JsonValue = obj[key];
  if (Array.isArray(v)) {
    const out: Object[] = [];
    for (let i = 0; i < v.length; i++) {
      out.push(v[i] as Object);
    }
    return out;
  }
  return null;
}

function asRecord(v: JsonValue): Record<string, Object> | null {
  return isRecord(v) ? v as Record<string, Object> : null;
}

function stringArray(v: JsonValue): string[] {
  if (!Array.isArray(v)) {
    return [];
  }
  const out: string[] = [];
  for (const item of v) {
    out.push(typeof item === 'string' ? item : String(item));
  }
  return out;
}

// 有序字符串数组：保留空串（对齐 Android parseOrderedStringArray/optString 语义）
function orderedStringArray(v: JsonValue): string[] {
  if (!Array.isArray(v)) {
    return [];
  }
  const out: string[] = [];
  for (const item of v) {
    out.push(typeof item === 'string' ? item : String(item));
  }
  return out;
}

function nestedStringArray(v: JsonValue): string[][] {
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

// ---------- 导出：backup.json 构建 ----------

export function buildBackupJson(
  kind: string,
  banks: QuizBank[],
  activeBankId: string,
  wrongBook: WrongQuestionEntry[],
  favoriteQuestions: FavoriteQuestionEntry[],
  studyRecords: StudyRecord[],
  includeWrongBook: boolean,
  includeFavorites: boolean,
  includeStudyRecords: boolean,
  registerAsset?: (image: QuestionImage) => string | null,
  now: number = 0
): Record<string, Object> {
  const root: Record<string, Object> = {};
  root['app'] = 'Misaka Quiz';
  root['kind'] = kind;
  root['version'] = 3;
  root['schemaVersion'] = 3;
  root['crossPlatformSchemaVersion'] = 1;
  root['exportedBy'] = 'harmony';
  root['exportedAt'] = now;
  root['activeBankId'] = activeBankId;
  const banksJson: Object[] = [];
  for (const bank of banks) {
    banksJson.push(bankToJson(bank, registerAsset));
  }
  root['banks'] = banksJson;
  if (includeWrongBook) {
    const wrong: Object[] = [];
    for (const entry of wrongBook) {
      wrong.push(wrongEntryToJson(entry, registerAsset));
    }
    root['wrongBook'] = wrong;
  }
  if (includeFavorites) {
    const favorites: Object[] = [];
    for (const entry of favoriteQuestions) {
      favorites.push(favoriteEntryToJson(entry, registerAsset));
    }
    root['favoriteQuestions'] = favorites;
  }
  if (includeStudyRecords) {
    const records: Object[] = [];
    for (const record of studyRecords) {
      records.push(studyRecordToJson(record, registerAsset));
    }
    root['studyRecords'] = records;
  }
  return root;
}

// ---------- 时间解析（web 备份兼容 ISO 字符串/数字毫秒） ----------

export function parseBackupTimeMillis(value: JsonValue, fallback: number | null): number | null {
  if (value === null || value === undefined) {
    return fallback;
  }
  if (typeof value === 'number' && isFinite(value)) {
    return value > 0 ? value : fallback;
  }
  const raw = String(value).trim();
  if (raw.length === 0) {
    return fallback;
  }
  const numeric = Number(raw);
  if (isFinite(numeric) && numeric > 0) {
    return numeric;
  }
  // 对齐 Android：三种模式均按 UTC 解析；JS 空格分隔形式需显式补 Z
  const normalized = raw.replace(' ', 'T');
  const withZone = /[Zz]$|[+-]\d{2}:?\d{2}$/.test(normalized) ? normalized : `${normalized}Z`;
  const parsed = Date.parse(withZone);
  return isFinite(parsed) ? parsed : fallback;
}

// ---------- 格式识别 ----------

export function isWebBackupJson(root: Record<string, Object>): boolean {
  if (!('banks' in root)) {
    return false;
  }
  const kind = optStr(root, 'kind');
  if (kind.startsWith('misaka_quiz_web') || kind.startsWith('shiroha_quiz_web') || ('crossPlatform' in root)) {
    return true;
  }
  if (kind.startsWith('misaka_quiz') || kind.startsWith('shiroha_quiz')) {
    return false;
  }
  const app = optStr(root, 'app');
  if (app.toLowerCase() === 'misaka quiz' || app.toLowerCase() === 'shiroha quiz' ||
    ('schemaVersion' in root) || ('exportType' in root) || ('settings' in root) ||
    ('favorites' in root) || ('records' in root)) {
    return true;
  }
  return false;
}

export class JsonImportPreview {
  banks: QuizBank[] = [];
  kind: string = '';
  message: string = '';
}

function looksLikeBankArray(array: Object[]): boolean {
  if (array.length === 0) {
    return false;
  }
  const first = asRecord(array[0]);
  return first !== null && optArray(first, 'questions') !== null;
}

function parseQuestionsFromArray(array: Object[]): Question[] {
  const out: Question[] = [];
  for (const item of array) {
    if (isRecord(item)) {
      out.push(parseQuestion(item));
    }
  }
  return out;
}

function parseStandaloneQuestionArrayBank(array: Object[], now: number): QuizBank | null {
  const questions = parseQuestionsFromArray(array);
  if (questions.length === 0) {
    return null;
  }
  const bank = new QuizBank(`bank_json_${now}`, '导入题库', DEFAULT_BANK_GROUP_NAME);
  bank.questions = questions;
  return bank;
}

function parseStandaloneBankJsonObject(root: Record<string, Object>, now: number): QuizBank | null {
  const questionsArray = optArray(root, 'questions');
  if (questionsArray === null) {
    return null;
  }
  const questions = parseQuestionsFromArray(questionsArray);
  if (questions.length === 0) {
    return null;
  }
  let rawName = optStr(root, 'name');
  if (rawName.length === 0) {
    rawName = optStr(root, 'bankName');
  }
  if (rawName.length === 0) {
    rawName = optStr(root, 'title');
  }
  let rawGroupName = optStr(root, 'groupName');
  if (rawGroupName.length === 0) {
    rawGroupName = optStr(root, 'group');
  }
  if (rawGroupName.length === 0) {
    rawGroupName = optStr(root, 'category');
  }
  const id = optStr(root, 'id');
  const bank = new QuizBank(id.length > 0 ? id : `bank_json_${now}`,
    rawName.length > 0 ? rawName : '导入题库',
    rawGroupName.length > 0 ? rawGroupName : DEFAULT_BANK_GROUP_NAME);
  bank.questions = questions;
  return bank;
}

export function parseStandaloneJsonPreview(rawText: string, now: number): JsonImportPreview | null {
  const text = rawText.trim();
  if (text.length === 0) {
    return null;
  }
  const parsed: JsonValue = JSON.parse(text);
  if (text.startsWith('[')) {
    const array = optArrayFromValue(parsed);
    if (array === null) {
      return null;
    }
    if (looksLikeBankArray(array)) {
      const banks = parseBanksFromValue(array);
      if (banks.length === 0) {
        return null;
      }
      const preview = new JsonImportPreview();
      preview.banks = banks;
      preview.kind = 'multi_bank_array';
      preview.message = `检测到多题库 JSON：共 ${banks.length} 个题库，将只导入题库内容。`;
      return preview;
    }
    const bank = parseStandaloneQuestionArrayBank(array, now);
    if (bank === null) {
      return null;
    }
    const preview = new JsonImportPreview();
    preview.banks = [bank];
    preview.kind = 'question_array';
    preview.message = `检测到题目数组 JSON：共 ${bank.questions.length} 题，将导入为一个新题库。`;
    return preview;
  }
  const root = asRecord(parsed);
  if (root === null) {
    return null;
  }
  const standaloneBank = parseStandaloneBankJsonObject(root, now);
  if (standaloneBank !== null) {
    const preview = new JsonImportPreview();
    preview.banks = [standaloneBank];
    preview.kind = 'single_bank';
    preview.message = `检测到 JSON 单题库：${standaloneBank.name}，共 ${standaloneBank.questions.length} 题。`;
    return preview;
  }
  const banksArray = optArray(root, 'banks');
  if (banksArray !== null) {
    const banks = parseBanksFromValue(banksArray);
    if (banks.length === 0) {
      return null;
    }
    const webBackup = isWebBackupJson(root);
    const preview = new JsonImportPreview();
    preview.banks = banks;
    preview.kind = webBackup ? 'web_backup' : 'multi_bank_backup';
    preview.message = webBackup
      ? `检测到 Web 备份包：共 ${banks.length} 个题库；将同步可映射的错题本、收藏夹和学习记录，平台专用设置不会跨端覆盖。`
      : `检测到多题库 JSON：共 ${banks.length} 个题库，将只导入题库内容。`;
    return preview;
  }
  return null;
}

function optArrayFromValue(v: JsonValue): Object[] | null {
  if (!Array.isArray(v)) {
    return null;
  }
  const out: Object[] = [];
  for (let i = 0; i < v.length; i++) {
    out.push(v[i] as Object);
  }
  return out;
}

function parseBanksFromValue(array: Object[]): QuizBank[] {
  const out: QuizBank[] = [];
  for (const item of array) {
    if (isRecord(item)) {
      out.push(parseBank(item));
    }
  }
  return out;
}

// ---------- 题目清洗与 id 修复 ----------

const EMBEDDED_ANSWER_REGEX = /[（(]\s*([A-Ga-g]{1,7}|正确|错误|对|错|是|否|√|×|True|False)\s*[）)]/gi;

function embeddedAnswerToKeys(raw: string): string[] {
  const value = raw.trim().toUpperCase();
  if (/^[A-G]{1,7}$/.test(value)) {
    const keys: string[] = [];
    for (let i = 0; i < value.length; i++) {
      const ch = value.charAt(i);
      if (keys.indexOf(ch) < 0) {
        keys.push(ch);
      }
    }
    return keys.sort();
  }
  if (['正确', '对', '是', '√', 'TRUE', 'T'].indexOf(value) >= 0) {
    return ['A'];
  }
  if (['错误', '错', '否', '×', 'X', 'FALSE', 'F'].indexOf(value) >= 0) {
    return ['B'];
  }
  return [];
}

function stripEmbeddedAnswerBracket(stem: string, answer: string[]): string {
  if (stem.trim().length === 0 || answer.length === 0) {
    return stem;
  }
  const expected = answer.map((v: string): string => v.trim().toUpperCase()).filter((v: string): boolean => v.length > 0).sort();
  if (expected.length === 0) {
    return stem;
  }
  const matches: RegExpMatchArray[] = [];
  let probe = stem;
  let m = EMBEDDED_ANSWER_REGEX.exec(probe);
  while (m !== null) {
    matches.push(m);
    probe = probe.substring(m.index + m[0].length);
    EMBEDDED_ANSWER_REGEX.lastIndex = 0;
    m = EMBEDDED_ANSWER_REGEX.exec(probe);
  }
  let hit: RegExpMatchArray | null = null;
  for (let i = matches.length - 1; i >= 0; i--) {
    const keys = embeddedAnswerToKeys(matches[i][1]);
    if (keys.length === expected.length && keys.every((k: string, idx: number): boolean => k === expected[idx])) {
      hit = matches[i];
      break;
    }
  }
  if (hit === null) {
    return stem;
  }
  // 各 match 的 index 相对各自切片：先累加到 hit 所在切片的起点，再补 hit 自身偏移
  let start = 0;
  for (const probeMatch of matches) {
    if (probeMatch === hit) {
      break;
    }
    start += probeMatch.index + probeMatch[0].length;
  }
  start += hit.index;
  const end = start + hit[0].length;
  return stem.substring(0, start) + stem.substring(end)
    .replace(/\s+([?？。；;，,])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[，,；;:：]+$/, '')
    .trim();
}

/** Android sanitizeQuestion = MultiBlankSupport.sanitizeQuestion + stripEmbeddedAnswerBracket。
 *  注意：MultiBlankSupport.sanitizeQuestion 无变化时返回原引用，此处改动必须先 cloneQuestion，
 *  否则会污染修复链持有的 original 快照。 */
export function sanitizeImportQuestion(question: Question): Question {
  const blankSanitized = sanitizeMultiBlankQuestion(question);
  const cleanStem = stripEmbeddedAnswerBracket(blankSanitized.question, blankSanitized.answer);
  if (cleanStem === blankSanitized.question) {
    return blankSanitized;
  }
  const cleaned = cloneQuestion(blankSanitized);
  cleaned.question = cleanStem;
  return cleaned;
}

export function sanitizeWrongEntry(entry: WrongQuestionEntry): WrongQuestionEntry {
  const normalizedStatus = normalizeWrongStatus(entry.status);
  const normalizedReviewRightCount = Math.max(0, entry.reviewRightCount);
  const normalizedStreakCorrectCount = Math.max(0, entry.streakCorrectCount);
  let sanitizedStatus: string;
  if (normalizedStatus === WrongStatus.MASTERED) {
    sanitizedStatus = WrongStatus.MASTERED;
  } else if (isWrongEntryMastered(normalizedReviewRightCount, normalizedStreakCorrectCount)) {
    sanitizedStatus = WrongStatus.MASTERED;
  } else {
    sanitizedStatus = normalizedStatus;
  }
  entry.question = sanitizeImportQuestion(entry.question);
  entry.wrongCount = Math.max(0, entry.wrongCount);
  entry.rightCount = Math.max(0, entry.rightCount);
  const bothZero = normalizedReviewRightCount === 0 && normalizedStreakCorrectCount === 0;
  entry.reviewRightCount = sanitizedStatus === WrongStatus.MASTERED && bothZero ? 2 : normalizedReviewRightCount;
  entry.streakCorrectCount = sanitizedStatus === WrongStatus.MASTERED && bothZero ? 2 : normalizedStreakCorrectCount;
  entry.lastWrongAt = entry.lastWrongAt > 0 ? entry.lastWrongAt : entry.timestamp;
  entry.status = sanitizedStatus;
  entry.lastReviewedAt = entry.lastReviewedAt !== null && entry.lastReviewedAt > 0 ? entry.lastReviewedAt : null;
  entry.nextReviewAt = entry.nextReviewAt !== null && entry.nextReviewAt > 0 ? entry.nextReviewAt : null;
  entry.reviewLevel = Math.min(5, Math.max(0, entry.reviewLevel));
  return entry;
}

export function sanitizeFavoriteEntry(entry: FavoriteQuestionEntry, now: number): FavoriteQuestionEntry {
  entry.question = sanitizeImportQuestion(entry.question);
  entry.favoritedAt = entry.favoritedAt > 0 ? entry.favoritedAt : now;
  return entry;
}

// ---------- 题目 id 修复链（空白/重复 id 的旧备份迁移） ----------

export class QuestionIdRepair {
  original: Question = new Question('', QuestionType.SINGLE, '');
  repaired: Question = new Question('', QuestionType.SINGLE, '');
}

export class BankQuestionIdRepair {
  bank: QuizBank = new QuizBank('', '', DEFAULT_BANK_GROUP_NAME);
  repairs: QuestionIdRepair[] = [];
  affectedLegacyIds: Set<string> = new Set<string>();
  idChanged: boolean = false;
}

function nfkcNormalized(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
}

export function questionMigrationFingerprint(question: Question): string {
  const parts: string[] = [];
  parts.push(nfkcNormalized(question.number));
  parts.push(question.type);
  parts.push(nfkcNormalized(question.question));
  const optionParts: string[] = [];
  for (const option of question.options) {
    optionParts.push(`${nfkcNormalized(option.key)}:${nfkcNormalized(option.text)}`);
  }
  parts.push(optionParts.join('|'));
  const answerParts: string[] = [];
  for (const a of question.answer) {
    answerParts.push(nfkcNormalized(a));
  }
  parts.push(answerParts.join('|'));
  const blankParts: string[] = [];
  for (const group of question.blankAnswers) {
    const inner: string[] = [];
    for (const a of group) {
      inner.push(nfkcNormalized(a));
    }
    blankParts.push(inner.join('|'));
  }
  parts.push(blankParts.join('||'));
  parts.push(nfkcNormalized(question.category));
  const sortedImages = question.images.slice().sort((a: QuestionImage, b: QuestionImage): number => a.order - b.order);
  const imageParts: string[] = [];
  for (const image of sortedImages) {
    imageParts.push([
      String(image.order), nfkcNormalized(image.sourceName),
      image.width === null ? '' : String(image.width),
      image.height === null ? '' : String(image.height)
    ].join(':'));
  }
  parts.push(imageParts.join('|'));
  return parts.join('#');
}

export function sanitizeBankWithQuestionIdRepair(bank: QuizBank, randomId: () => string): BankQuestionIdRepair {
  const originalQuestions = bank.questions;
  const cleanQuestions: Question[] = [];
  for (const q of originalQuestions) {
    cleanQuestions.push(sanitizeImportQuestion(q));
  }
  const idCounts = new Map<string, number>();
  for (const q of cleanQuestions) {
    idCounts.set(q.id, (idCounts.get(q.id) ?? 0) + 1);
  }
  const affectedLegacyIds = new Set<string>();
  for (const entry of idCounts.entries()) {
    if (entry[0].length === 0 || entry[1] > 1) {
      affectedLegacyIds.add(entry[0]);
    }
  }
  const usedIds = new Set<string>();
  const repairs: QuestionIdRepair[] = [];
  const finalQuestions: Question[] = [];
  for (let i = 0; i < cleanQuestions.length; i++) {
    const originalQuestion = originalQuestions[i];
    const cleanQuestion = cleanQuestions[i];
    let repairedId: string;
    if (cleanQuestion.id.length > 0 && !usedIds.has(cleanQuestion.id)) {
      usedIds.add(cleanQuestion.id);
      repairedId = cleanQuestion.id;
    } else {
      repairedId = generateUniqueQuestionId(usedIds, randomId);
    }
    let repairedQuestion = cleanQuestion;
    if (repairedId !== cleanQuestion.id) {
      repairedQuestion = cloneQuestion(cleanQuestion);
      repairedQuestion.id = repairedId;
    }
    finalQuestions.push(repairedQuestion);
    const repair = new QuestionIdRepair();
    repair.original = originalQuestion;
    repair.repaired = repairedQuestion;
    repairs.push(repair);
  }
  const repairedBank = new QuizBank(bank.id, bank.name.length > 0 ? bank.name : '未命名题库', normalizeBankGroupName(bank.groupName));
  repairedBank.questions = finalQuestions;
  const result = new BankQuestionIdRepair();
  result.bank = repairedBank;
  result.repairs = repairs;
  result.affectedLegacyIds = affectedLegacyIds;
  result.idChanged = affectedLegacyIds.size > 0;
  return result;
}

function generateUniqueQuestionId(usedIds: Set<string>, randomId: () => string): string {
  while (true) {
    const candidate = randomId();
    if (!usedIds.has(candidate)) {
      usedIds.add(candidate);
      return candidate;
    }
  }
}

export function resolveRepairedQuestion(reference: Question, repair: BankQuestionIdRepair | null): Question | null {
  if (repair === null) {
    return null;
  }
  if (reference.id.length > 0 && !repair.affectedLegacyIds.has(reference.id)) {
    return null;
  }
  const sameLegacyId: QuestionIdRepair[] = [];
  for (const item of repair.repairs) {
    if (item.original.id === reference.id) {
      sameLegacyId.push(item);
    }
  }
  const candidates = sameLegacyId.length > 0 ? sameLegacyId : repair.repairs;
  const fingerprint = questionMigrationFingerprint(reference);
  const exactMatches: QuestionIdRepair[] = [];
  for (const item of candidates) {
    if (questionMigrationFingerprint(item.original) === fingerprint) {
      exactMatches.push(item);
    }
  }
  if (exactMatches.length > 0) {
    return exactMatches[0].repaired;
  }
  const normalizedStem = reference.question.normalize('NFKC').trim();
  if (normalizedStem.length > 0) {
    const stemMatches: QuestionIdRepair[] = [];
    for (const item of candidates) {
      if (item.original.type === reference.type && item.original.question.normalize('NFKC').trim() === normalizedStem) {
        stemMatches.push(item);
      }
    }
    if (stemMatches.length === 1) {
      return stemMatches[0].repaired;
    }
  }
  if (reference.number.length > 0) {
    const numberMatches: QuestionIdRepair[] = [];
    for (const item of candidates) {
      if (item.original.type === reference.type && item.original.number.trim() === reference.number.trim()) {
        numberMatches.push(item);
      }
    }
    if (numberMatches.length === 1) {
      return numberMatches[0].repaired;
    }
  }
  if (reference.id.length > 0) {
    for (const item of repair.repairs) {
      if (item.repaired.id === reference.id) {
        return item.repaired;
      }
    }
    if (sameLegacyId.length > 0) {
      return sameLegacyId[0].repaired;
    }
  }
  return null;
}

export function resolveRepairedQuestionByLegacyId(legacyId: string, repair: BankQuestionIdRepair | null): Question | null {
  if (repair === null || !repair.affectedLegacyIds.has(legacyId)) {
    return null;
  }
  for (const item of repair.repairs) {
    if (item.original.id === legacyId) {
      return item.repaired;
    }
  }
  return null;
}

// ---------- data URI 图片落地 + ZIP 资产重映射 ----------

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function decodeBase64Bytes(text: string): Uint8Array | null {
  const clean = text.replace(/\s+/g, '');
  let dataLen = clean.length;
  while (dataLen > 0 && clean.charAt(dataLen - 1) === '=') {
    dataLen -= 1;
  }
  if (dataLen === 0) {
    return new Uint8Array(0);
  }
  const out = new Uint8Array(Math.floor(dataLen * 3 / 4));
  let buffer = 0;
  let bits = 0;
  let outIndex = 0;
  for (let i = 0; i < dataLen; i++) {
    const v = B64_ALPHABET.indexOf(clean.charAt(i));
    if (v < 0) {
      return null;
    }
    buffer = ((buffer << 6) | v) & 0xFFFFFF;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[outIndex] = (buffer >> bits) & 0xFF;
      outIndex += 1;
    }
  }
  return outIndex === out.length ? out : out.slice(0, outIndex);
}

function imageExtensionForMimeSuffix(mimeSuffix: string): string {
  const lower = mimeSuffix.toLowerCase();
  if (lower === 'jpeg' || lower === 'jpg') {
    return 'jpg';
  }
  if (lower === 'png' || lower === 'gif' || lower === 'webp' || lower === 'bmp') {
    return lower;
  }
  return 'bin';
}

function isAllowedDataImageMimeSuffix(mimeSuffix: string): boolean {
  return ['jpeg', 'jpg', 'png', 'gif', 'webp', 'bmp'].indexOf(mimeSuffix.toLowerCase()) >= 0;
}

class ParsedDataImage {
  extension: string = '';
  bytes: Uint8Array = new Uint8Array(0);
}

function parseDataImageUri(dataUri: string): ParsedDataImage | null {
  const match = /^data:image\/([A-Za-z0-9.+-]+);base64,([A-Za-z0-9+/=\r\n\s]+)$/i.exec(dataUri.trim());
  if (match === null) {
    return null;
  }
  const mimeSuffix = match[1].toLowerCase();
  if (!isAllowedDataImageMimeSuffix(mimeSuffix)) {
    return null;
  }
  const bytes = decodeBase64Bytes(match[2].replace(/\s+/g, ''));
  if (bytes === null || bytes.length === 0) {
    return null;
  }
  const parsed = new ParsedDataImage();
  parsed.extension = imageExtensionForMimeSuffix(mimeSuffix);
  parsed.bytes = bytes;
  return parsed;
}

function sanitizeFileToken(raw: string, fallback: string, maxLen: number): string {
  const safe = raw.replace(/[^A-Za-z0-9_.-]/g, '_').substring(0, maxLen);
  return safe.length > 0 ? safe : fallback;
}

/** 题干内嵌 `![alt](data:image/...;base64,...)` → 落地文件 + 【alt】占位（对齐 Android convertEmbeddedDataImages） */
function convertEmbeddedDataImages(question: Question, writeAsset: (fileName: string, bytes: Uint8Array) => string | null, now: number): Question {
  const rawQuestion = question.question;
  if (rawQuestion.toLowerCase().indexOf('data:image/') < 0) {
    return question;
  }
  let maxOrder = question.images.length;
  for (const image of question.images) {
    if (image.order > maxOrder) {
      maxOrder = image.order;
    }
  }
  let nextOrder = maxOrder + 1;
  const addedImages: QuestionImage[] = [];
  const regex = /!\[([^\]]*)\]\(data:image\/([A-Za-z0-9.+-]+);base64,([A-Za-z0-9+/=\r\n]+)\)/gi;
  let cleanedQuestion = rawQuestion.replace(regex, (_substring: string, altRaw: string, mimeRaw: string, base64Raw: string): string => {
    const alt = altRaw.length > 0 ? altRaw : `题目图片${nextOrder}`;
    const mimeSuffix = mimeRaw.toLowerCase();
    const bytes = decodeBase64Bytes(base64Raw.replace(/\s+/g, ''));
    if (bytes === null || bytes.length === 0) {
      return `【${alt}】`;
    }
    const ext = imageExtensionForMimeSuffix(mimeSuffix);
    const safeQuestionId = sanitizeFileToken(question.id.length > 0 ? question.id : 'question', 'question', 96);
    const imageId = sanitizeFileToken(`web_${safeQuestionId}_${nextOrder}_${now}`, 'web_image', 96);
    const fileName = `${imageId}.${ext}`;
    const savedPath = writeAsset(fileName, bytes);
    if (savedPath === null) {
      return `【${alt}】`;
    }
    addedImages.push(new QuestionImage(imageId, savedPath, `${alt}.${ext}`, nextOrder, null, null, bytes.length));
    nextOrder += 1;
    return `\n【${alt}】\n`;
  });
  cleanedQuestion = cleanedQuestion.replace(/\n{3,}/g, '\n\n').trim();
  if (addedImages.length === 0) {
    return question;
  }
  const converted = cloneQuestion(question);
  converted.question = cleanedQuestion;
  converted.images = converted.images.concat(addedImages);
  return converted;
}

/** images[] 中 localPath 为 data URI 的项 → 落地文件并回写绝对路径（对齐 Android convertDataUriQuestionImages） */
function convertDataUriQuestionImages(question: Question, writeAsset: (fileName: string, bytes: Uint8Array) => string | null): Question {
  if (question.images.length === 0) {
    return question;
  }
  let changed = false;
  const convertedImages: QuestionImage[] = [];
  for (let index = 0; index < question.images.length; index++) {
    const image = question.images[index];
    const dataUri = image.localPath.trim();
    if (dataUri.toLowerCase().indexOf('data:image/') !== 0) {
      convertedImages.push(image);
      continue;
    }
    const parsed = parseDataImageUri(dataUri);
    if (parsed === null) {
      convertedImages.push(image);
      continue;
    }
    const safeImageId = sanitizeFileToken(image.id.length > 0 ? image.id : `json_image_${index + 1}`, `json_image_${index + 1}`, 96);
    const savedPath = writeAsset(`${safeImageId}.${parsed.extension}`, parsed.bytes);
    if (savedPath === null) {
      convertedImages.push(image);
      continue;
    }
    changed = true;
    const converted = new QuestionImage(image.id, savedPath,
      image.sourceName.length > 0 ? image.sourceName : `题目图片${index + 1}.${parsed.extension}`,
      image.order > 0 ? image.order : index + 1,
      image.width, image.height, parsed.bytes.length);
    convertedImages.push(converted);
  }
  if (!changed) {
    return question;
  }
  const converted = cloneQuestion(question);
  converted.images = convertedImages;
  return converted;
}

/** ZIP 资产按 backup.json 内的相对路径落地，localPath 回写绝对路径（对齐 Android remapQuestionAssets） */
function remapQuestionAssets(question: Question, zipAssets: Map<string, Uint8Array>, writeAsset: (fileName: string, bytes: Uint8Array) => string | null): Question {
  if (question.images.length === 0 || zipAssets.size === 0) {
    return question;
  }
  const converted = cloneQuestion(question);
  const images: QuestionImage[] = [];
  let changed = false;
  for (const image of converted.images) {
    const backupPath = image.localPath.replace(/\\/g, '/').replace(/^\//, '');
    const imageBytes = zipAssets.get(backupPath);
    if (imageBytes === undefined) {
      images.push(image);
      continue;
    }
    const baseName = backupPath.split('/').pop() ?? backupPath;
    const savedPath = writeAsset(baseName, imageBytes);
    if (savedPath === null) {
      images.push(image);
      continue;
    }
    changed = true;
    images.push(new QuestionImage(image.id, savedPath, image.sourceName, image.order, image.width, image.height, imageBytes.length));
  }
  if (!changed) {
    return question;
  }
  converted.images = images;
  return converted;
}

function normalizeImportedQuestionAssets(
  question: Question,
  zipAssets: Map<string, Uint8Array>,
  writeAsset: (fileName: string, bytes: Uint8Array) => string | null,
  now: number
): Question {
  const convertedQuestionText = convertEmbeddedDataImages(question, writeAsset, now);
  const convertedStructuredImages = convertDataUriQuestionImages(convertedQuestionText, writeAsset);
  return remapQuestionAssets(convertedStructuredImages, zipAssets, writeAsset);
}

// ---------- 命名去重 ----------

export function uniqueImportedBankName(rawName: string, groupName: string, existingBanks: QuizBank[], reservedNames: Set<string>): string {
  const cleanGroupName = normalizeBankGroupName(groupName);
  const baseName = rawName.length > 0 ? rawName : '导入题库';
  const existingNames = new Set<string>(reservedNames);
  for (const bank of existingBanks) {
    if (normalizeBankGroupName(bank.groupName) === cleanGroupName) {
      existingNames.add(bank.name);
    }
  }
  if (!existingNames.has(baseName)) {
    return baseName;
  }
  let index = 2;
  let candidate = `${baseName} 导入${index}`;
  while (existingNames.has(candidate)) {
    index += 1;
    candidate = `${baseName} 导入${index}`;
  }
  return candidate;
}

// ---------- 导入主体（对齐 Android importBackupJsonInternal） ----------

export class BackupImportOutcome {
  ok: boolean = false;
  message: string = '';
  banks: QuizBank[] = [];
  idMap: Map<string, string> = new Map<string, string>();
  wrongBook: WrongQuestionEntry[] = [];
  favorites: FavoriteQuestionEntry[] = [];
  records: StudyRecord[] = [];
  activeBankId: string = '';
}

export function importBackupText(
  rawText: string,
  existingBanks: QuizBank[],
  zipAssets: Map<string, Uint8Array>,
  writeAsset: (fileName: string, bytes: Uint8Array) => string | null,
  randomId: () => string,
  now: number
): BackupImportOutcome {
  const outcome = new BackupImportOutcome();
  const text = rawText.trim();
  if (text.length === 0) {
    outcome.message = '导入失败：文件内容为空。';
    return outcome;
  }
  let root: Record<string, Object>;
  try {
    const parsed: JsonValue = JSON.parse(text);
    if (text.startsWith('[')) {
      const array = optArrayFromValue(parsed);
      if (array === null) {
        outcome.message = '导入失败：不是有效的 JSON / ZIP 备份文件。';
        return outcome;
      }
      if (looksLikeBankArray(array)) {
        root = { 'banks': array };
      } else {
        root = { 'name': '导入题库', 'groupName': DEFAULT_BANK_GROUP_NAME, 'questions': array };
      }
    } else {
      const object = asRecord(parsed);
      if (object === null) {
        outcome.message = '导入失败：不是有效的 JSON / ZIP 备份文件。';
        return outcome;
      }
      root = object;
    }
  } catch (_err) {
    outcome.message = '导入失败：不是有效的 JSON / ZIP 备份文件。';
    return outcome;
  }

  let preview: JsonImportPreview | null = null;
  try {
    preview = parseStandaloneJsonPreview(text, now);
  } catch (_err) {
    outcome.message = '导入失败：题库数据无法解析。';
    return outcome;
  }
  if (preview === null) {
    outcome.message = '导入失败：备份中没有可用题库。';
    return outcome;
  }
  const importedRepairs: BankQuestionIdRepair[] = [];
  for (const bank of preview.banks) {
    const normalizedQuestions: Question[] = [];
    for (const q of bank.questions) {
      normalizedQuestions.push(normalizeImportedQuestionAssets(q, zipAssets, writeAsset, now));
    }
    const normalized = new QuizBank(bank.id, bank.name, bank.groupName);
    normalized.questions = normalizedQuestions;
    importedRepairs.push(sanitizeBankWithQuestionIdRepair(normalized, randomId));
  }
  const importedBanks: QuizBank[] = [];
  for (const repair of importedRepairs) {
    importedBanks.push(repair.bank);
  }
  if (importedBanks.length === 0) {
    outcome.message = '导入失败：备份中没有可用题库。';
    return outcome;
  }

  const isWebBackup = isWebBackupJson(root);
  const crossPlatformRoot = asRecord(root['crossPlatform']);
  const canonicalStateRoot = crossPlatformRoot !== null ? crossPlatformRoot : root;

  const idMap = new Map<string, string>();
  const importedNamesByGroup = new Map<string, Set<string>>();
  const addedBanks: QuizBank[] = [];
  for (let index = 0; index < importedBanks.length; index++) {
    const bank = importedBanks[index];
    const newId = `bank_${now}_${index}`;
    idMap.set(bank.id, newId);
    const cleanGroupName = normalizeBankGroupName(bank.groupName);
    let reservedNames = importedNamesByGroup.get(cleanGroupName);
    if (reservedNames === undefined) {
      reservedNames = new Set<string>();
      importedNamesByGroup.set(cleanGroupName, reservedNames);
    }
    const cleanName = uniqueImportedBankName(bank.name, cleanGroupName, existingBanks, reservedNames);
    reservedNames.add(cleanName);
    const added = new QuizBank(newId, cleanName, cleanGroupName);
    added.questions = bank.questions;
    addedBanks.push(added);
  }

  const importedActiveBankId = optStr(root, 'activeBankId');
  const mappedActiveBankId = idMap.get(importedActiveBankId);
  let finalActiveBankId = '';
  if (mappedActiveBankId !== undefined) {
    finalActiveBankId = mappedActiveBankId;
  }

  const repairByOriginalBankId = new Map<string, BankQuestionIdRepair>();
  for (const repair of importedRepairs) {
    repairByOriginalBankId.set(repair.bank.id, repair);
  }
  const importedBankById = new Map<string, QuizBank>();
  for (const bank of addedBanks) {
    importedBankById.set(bank.id, bank);
  }

  // 旧 Web 备份（无 crossPlatform）：按旧对象结构映射状态
  let importedStateCount = 0;
  if (isWebBackup && crossPlatformRoot === null) {
    const webWrongBookObj = asRecord(root['wrongBook']);
    if (webWrongBookObj !== null) {
      for (const originalBankId of Object.keys(webWrongBookObj)) {
        const mappedBankId = idMap.get(originalBankId);
        if (mappedBankId === undefined) {
          continue;
        }
        const mappedBank = importedBankById.get(mappedBankId);
        if (mappedBank === undefined) {
          continue;
        }
        const entries = optArray(webWrongBookObj, originalBankId);
        if (entries === null) {
          continue;
        }
        for (const rawEntry of entries) {
          const entry = asRecord(rawEntry);
          if (entry === null) {
            continue;
          }
          const qid = optStr(entry, 'id');
          const repair = repairByOriginalBankId.get(originalBankId) ?? null;
          let question: Question | null = null;
          const repairedQuestion = resolveRepairedQuestionByLegacyId(qid, repair);
          if (repairedQuestion !== null && mappedBank !== undefined) {
            const found = mappedBank.questions.find((q: Question): boolean => q.id === repairedQuestion.id);
            question = found !== undefined ? found : null;
          }
          if (question === null) {
            const found = mappedBank.questions.find((q: Question): boolean => q.id === qid);
            question = found !== undefined ? found : null;
          }
          if (question === null) {
            continue;
          }
          const imported = new WrongQuestionEntry(mappedBankId, mappedBank.name, question, [], 'web-backup',
            parseBackupTimeMillis(entry['lastWrongAt'], now) ?? now);
          imported.wrongCount = optNum(entry, 'wrongCount', 1);
          imported.rightCount = optNum(entry, 'rightCount', 0);
          imported.reviewRightCount = optNum(entry, 'reviewRightCount', 0);
          imported.streakCorrectCount = optNum(entry, 'streakCorrectCount', 0);
          const lastWrongAt = parseBackupTimeMillis(entry['lastWrongAt'], now);
          imported.lastWrongAt = lastWrongAt !== null ? lastWrongAt : now;
          imported.lastCorrectAt = parseBackupTimeMillis(entry['lastCorrectAt'], null);
          imported.status = optStr(entry, 'status', '未掌握');
          imported.lastReviewedAt = parseBackupTimeMillis(entry['lastReviewedAt'], null);
          imported.nextReviewAt = parseBackupTimeMillis(entry['nextReviewAt'], null);
          imported.reviewLevel = optNum(entry, 'reviewLevel', 0);
          outcome.wrongBook.push(sanitizeWrongEntry(imported));
        }
      }
      importedStateCount += outcome.wrongBook.length;
    }
    const webFavoritesObj = asRecord(root['favorites']);
    if (webFavoritesObj !== null) {
      const importedFavorites: FavoriteQuestionEntry[] = [];
      for (const originalBankId of Object.keys(webFavoritesObj)) {
        const mappedBankId = idMap.get(originalBankId);
        if (mappedBankId === undefined) {
          continue;
        }
        const mappedBank = importedBankById.get(mappedBankId);
        if (mappedBank === undefined) {
          continue;
        }
        const qids = optArray(webFavoritesObj, originalBankId);
        if (qids === null) {
          continue;
        }
        for (const rawQid of qids) {
          const qid = typeof rawQid === 'string' ? rawQid : String(rawQid);
          const repair = repairByOriginalBankId.get(originalBankId) ?? null;
          let question: Question | null = null;
          const repairedQuestion = resolveRepairedQuestionByLegacyId(qid, repair);
          if (repairedQuestion !== null && mappedBank !== undefined) {
            const found = mappedBank.questions.find((q: Question): boolean => q.id === repairedQuestion.id);
            question = found !== undefined ? found : null;
          }
          if (question === null) {
            const found = mappedBank.questions.find((q: Question): boolean => q.id === qid);
            question = found !== undefined ? found : null;
          }
          if (question === null) {
            continue;
          }
          importedFavorites.push(sanitizeFavoriteEntry(new FavoriteQuestionEntry(mappedBankId, mappedBank.name, question, now), now));
        }
      }
      outcome.favorites = importedFavorites;
      importedStateCount += importedFavorites.length;
    }
    const webRecords = optArray(root, 'records');
    if (webRecords !== null) {
      const importedRecords: StudyRecord[] = [];
      for (let k = 0; k < webRecords.length; k++) {
        const rec = asRecord(webRecords[k]);
        if (rec === null) {
          continue;
        }
        const originalBankId = optStr(rec, 'bankId');
        const mappedBankId = idMap.get(originalBankId) ?? originalBankId;
        const mappedBank = importedBankById.get(mappedBankId);
        const details = optArray(rec, 'details');
        const questionResults: StudyQuestionResult[] = [];
        if (details !== null) {
          for (let d = 0; d < details.length; d++) {
            const detail = asRecord(details[d]);
            if (detail === null) {
              continue;
            }
            const nestedQuestion = asRecord(detail['question']);
            const questionId = optStr(detail, 'questionId');
            const repair = repairByOriginalBankId.get(originalBankId) ?? null;
            let resolvedQuestion: Question | null = null;
            if (nestedQuestion !== null) {
              const reference = parseQuestion(nestedQuestion);
              const repaired = resolveRepairedQuestion(reference, repair);
              if (repaired !== null && mappedBank !== undefined) {
                const found = mappedBank.questions.find((q: Question): boolean => q.id === repaired.id);
                resolvedQuestion = found !== undefined ? found : reference;
              } else {
                resolvedQuestion = reference;
              }
            }
            if (resolvedQuestion === null) {
              const repaired = resolveRepairedQuestionByLegacyId(questionId, repair);
              if (repaired !== null && mappedBank !== undefined) {
                const found = mappedBank.questions.find((q: Question): boolean => q.id === repaired.id);
                resolvedQuestion = found !== undefined ? found : null;
              }
            }
            if (resolvedQuestion === null && mappedBank !== undefined) {
              const found = mappedBank.questions.find((q: Question): boolean => q.id === questionId);
              resolvedQuestion = found !== undefined ? found : null;
            }
            if (resolvedQuestion === null) {
              const fallback = new Question(questionId.length > 0 ? questionId : `record_question_${k}_${d}`,
                parseQuestionTypeOrSingle(optStr(detail, 'type')), optStr(detail, 'question'));
              fallback.answer = stringArray(detail['answer']);
              fallback.blankAnswers = nestedStringArray(detail['blankAnswers']);
              fallback.category = optStr(detail, 'category');
              resolvedQuestion = fallback;
            }
            const chosen = orderedStringArray(detail['chosen']);
            const referenceAnswer = stringArray(detail['answer']);
            const result = new StudyQuestionResult(resolvedQuestion, chosen, optBool(detail, 'correct', false), '');
            const directUserBlank = orderedStringArray(detail['userBlankAnswers']);
            result.userBlankAnswers = directUserBlank.length > 0 ? directUserBlank :
              (hasStructuredAnswers(resolvedQuestion) ? chosen.slice() : []);
            result.answerText = hasStructuredAnswers(resolvedQuestion)
              ? expectedAnswerText(resolvedQuestion.blankAnswers)
              : referenceAnswer.join(' / ');
            const earnedScore = optNullableNum(detail, 'score');
            const maxScore = optNullableNum(detail, 'fullScore');
            result.earnedScore = earnedScore;
            result.maxScore = maxScore;
            result.autoScored = true;
            const originalSourceBankId = optStr(detail, 'sourceBankId');
            const mappedSourceBankId = idMap.get(originalSourceBankId) ?? (originalSourceBankId.length > 0 ? originalSourceBankId : mappedBankId);
            result.sourceBankId = mappedSourceBankId;
            const mappedSourceBank = importedBankById.get(mappedSourceBankId);
            result.sourceBankName = mappedSourceBank !== undefined ? mappedSourceBank.name
              : (optStr(detail, 'sourceBankName').length > 0 ? optStr(detail, 'sourceBankName')
                : (mappedBank !== undefined ? mappedBank.name : ''));
            questionResults.push(result);
          }
        }
        const recordId = optStr(rec, 'id');
        let correctCount = 0;
        for (const res of questionResults) {
          if (res.correct) {
            correctCount += 1;
          }
        }
        const importedRecord = new StudyRecord(recordId.length > 0 ? recordId : `rec_${now}_${k}`,
          optStr(rec, 'bankName').length > 0 ? optStr(rec, 'bankName') : (mappedBank !== undefined ? mappedBank.name : ''),
          'web', optStr(rec, 'mode', '练习'),
          optNum(rec, 'total', questionResults.length), optNum(rec, 'correct', correctCount),
          parseBackupTimeMillis(rec['timestamp'], null) ?? parseBackupTimeMillis(rec['date'], null) ?? now);
        const mappedRecordBankId = mappedBankId.length > 0 ? mappedBankId : null;
        importedRecord.bankId = mappedRecordBankId;
        const duration = optNum(rec, 'duration', 0);
        importedRecord.durationSeconds = duration > 0 ? duration : null;
        importedRecord.autoSubmitted = optBool(rec, 'autoSubmitted', false);
        importedRecord.startedAt = parseBackupTimeMillis(rec['startedAt'], null);
        importedRecord.earnedScore = optNullableNum(rec, 'score');
        importedRecord.totalScore = optNullableNum(rec, 'totalScore');
        importedRecord.questionResults = questionResults;
        const scopeType = optStr(rec, 'scopeType');
        importedRecord.scopeType = scopeType.length > 0 ? scopeType : null;
        const scopeName = optStr(rec, 'scopeName');
        importedRecord.scopeName = scopeName.length > 0 ? scopeName : null;
        importedRecords.push(importedRecord);
      }
      outcome.records = importedRecords;
      importedStateCount += importedRecords.length;
    }
    outcome.banks = addedBanks;
    outcome.idMap = idMap;
    outcome.activeBankId = finalActiveBankId;
    outcome.ok = true;
    outcome.message = importedStateCount > 0
      ? `已导入 ${addedBanks.length} 个题库；已同步错题本、收藏夹和记录。`
      : `已导入 ${addedBanks.length} 个题库。`;
    return outcome;
  }

  // 原生备份 / web crossPlatform：wrongBook、favoriteQuestions、studyRecords 均为原生条目数组
  const importedWrongBook = parseNativeArray(canonicalStateRoot, 'wrongBook', parseWrongEntry);
  for (const entry of importedWrongBook) {
    const mappedBankId = idMap.get(entry.bankId);
    if (mappedBankId === undefined) {
      continue;
    }
    const mappedBank = importedBankById.get(mappedBankId);
    const mappedBankName = mappedBank !== undefined ? mappedBank.name : entry.bankName;
    const repair = repairByOriginalBankId.get(entry.bankId) ?? null;
    let mappedQuestion: Question | null = null;
    const repaired = resolveRepairedQuestion(entry.question, repair);
    if (repaired !== null && mappedBank !== undefined) {
      const found = mappedBank.questions.find((q: Question): boolean => q.id === repaired.id);
      mappedQuestion = found !== undefined ? found : null;
    }
    if (mappedQuestion === null && mappedBank !== undefined) {
      const found = mappedBank.questions.find((q: Question): boolean => q.id === entry.question.id);
      mappedQuestion = found !== undefined ? found : null;
    }
    if (mappedQuestion === null) {
      mappedQuestion = normalizeImportedQuestionAssets(entry.question, zipAssets, writeAsset, now);
    }
    const mapped = new WrongQuestionEntry(mappedBankId, mappedBankName, mappedQuestion, entry.lastAnswer, entry.source, entry.timestamp);
    mapped.wrongCount = entry.wrongCount;
    mapped.rightCount = entry.rightCount;
    mapped.reviewRightCount = entry.reviewRightCount;
    mapped.streakCorrectCount = entry.streakCorrectCount;
    mapped.lastWrongAt = entry.lastWrongAt;
    mapped.lastCorrectAt = entry.lastCorrectAt;
    mapped.status = entry.status;
    mapped.lastReviewedAt = entry.lastReviewedAt;
    mapped.nextReviewAt = entry.nextReviewAt;
    mapped.reviewLevel = entry.reviewLevel;
    outcome.wrongBook.push(sanitizeWrongEntry(mapped));
  }

  const importedFavorites = parseNativeArray(canonicalStateRoot, 'favoriteQuestions', parseFavoriteEntry);
  for (const entry of importedFavorites) {
    const mappedBankId = idMap.get(entry.bankId);
    if (mappedBankId === undefined) {
      continue;
    }
    const mappedBank = importedBankById.get(mappedBankId);
    const mappedBankName = mappedBank !== undefined ? mappedBank.name : entry.bankName;
    const repair = repairByOriginalBankId.get(entry.bankId) ?? null;
    let mappedQuestion: Question | null = null;
    const repaired = resolveRepairedQuestion(entry.question, repair);
    if (repaired !== null && mappedBank !== undefined) {
      const found = mappedBank.questions.find((q: Question): boolean => q.id === repaired.id);
      mappedQuestion = found !== undefined ? found : null;
    }
    if (mappedQuestion === null && mappedBank !== undefined) {
      const found = mappedBank.questions.find((q: Question): boolean => q.id === entry.question.id);
      mappedQuestion = found !== undefined ? found : null;
    }
    if (mappedQuestion === null) {
      mappedQuestion = normalizeImportedQuestionAssets(entry.question, zipAssets, writeAsset, now);
    }
    outcome.favorites.push(sanitizeFavoriteEntry(
      new FavoriteQuestionEntry(mappedBankId, mappedBankName, mappedQuestion, entry.favoritedAt), now));
  }

  const importedRecords = parseNativeArray(canonicalStateRoot, 'studyRecords', parseStudyRecord);
  for (const record of importedRecords) {
    const mappedBankId = record.bankId !== null ? (idMap.get(record.bankId) ?? record.bankId) : null;
    const mappedBank = mappedBankId !== null ? importedBankById.get(mappedBankId) : undefined;
    const mappedBankName = mappedBank !== undefined ? mappedBank.name : record.bankName;
    const mappedRecord = new StudyRecord(record.id, mappedBankName, record.source, record.title,
      record.total, record.correct, record.timestamp);
    mappedRecord.bankId = mappedBankId;
    mappedRecord.durationSeconds = record.durationSeconds;
    mappedRecord.autoSubmitted = record.autoSubmitted;
    mappedRecord.startedAt = record.startedAt;
    mappedRecord.earnedScore = record.earnedScore;
    mappedRecord.totalScore = record.totalScore;
    mappedRecord.scopeType = record.scopeType;
    mappedRecord.scopeName = record.scopeName;
    const mappedResults: StudyQuestionResult[] = [];
    for (const result of record.questionResults) {
      const mappedSourceBankId = result.sourceBankId !== null
        ? (idMap.get(result.sourceBankId) ?? result.sourceBankId) : mappedBankId;
      const mappedSourceBank = mappedSourceBankId !== null ? importedBankById.get(mappedSourceBankId) : undefined;
      const originalSourceBankId = result.sourceBankId !== null ? result.sourceBankId : record.bankId;
      const repair = originalSourceBankId !== null ? (repairByOriginalBankId.get(originalSourceBankId) ?? null) : null;
      let mappedQuestion: Question | null = null;
      const repaired = resolveRepairedQuestion(result.question, repair);
      if (repaired !== null && mappedSourceBank !== undefined) {
        const found = mappedSourceBank.questions.find((q: Question): boolean => q.id === repaired.id);
        mappedQuestion = found !== undefined ? found : null;
      }
      if (mappedQuestion === null && mappedSourceBank !== undefined) {
        const found = mappedSourceBank.questions.find((q: Question): boolean => q.id === result.question.id);
        mappedQuestion = found !== undefined ? found : null;
      }
      if (mappedQuestion === null) {
        mappedQuestion = normalizeImportedQuestionAssets(result.question, zipAssets, writeAsset, now);
      }
      const mappedResult = new StudyQuestionResult(mappedQuestion, result.userAnswer, result.correct, result.answerText);
      mappedResult.userBlankAnswers = result.userBlankAnswers;
      mappedResult.earnedScore = result.earnedScore;
      mappedResult.maxScore = result.maxScore;
      mappedResult.autoScored = result.autoScored;
      mappedResult.sourceBankId = mappedSourceBank !== undefined ? mappedSourceBank.id : mappedSourceBankId;
      mappedResult.sourceBankName = mappedSourceBank !== undefined ? mappedSourceBank.name : result.sourceBankName;
      mappedResults.push(mappedResult);
    }
    mappedRecord.questionResults = mappedResults;
    outcome.records.push(mappedRecord);
  }

  outcome.banks = addedBanks;
  outcome.idMap = idMap;
  outcome.activeBankId = finalActiveBankId;
  outcome.ok = true;
  outcome.message = `已导入 ${addedBanks.length} 个题库` +
    (outcome.wrongBook.length > 0 || outcome.favorites.length > 0 || outcome.records.length > 0
      ? `，同时恢复 ${outcome.wrongBook.length} 条错题、${outcome.favorites.length} 条收藏、${outcome.records.length} 条记录。`
      : '。');
  return outcome;
}

function parseQuestionTypeOrSingle(rawType: string): string {
  const known: string[] = [QuestionType.SINGLE, QuestionType.MULTIPLE, QuestionType.JUDGE, QuestionType.BLANK, QuestionType.SHORT];
  const upper = rawType.trim().toUpperCase();
  return known.indexOf(upper) >= 0 ? upper : QuestionType.SINGLE;
}

function parseNativeArray<T>(root: Record<string, Object>, key: string, parseItem: (raw: Object) => T | null): T[] {
  const array = optArray(root, key);
  const out: T[] = [];
  if (array === null) {
    return out;
  }
  for (const raw of array) {
    try {
      const item = parseItem(raw);
      if (item !== null) {
        out.push(item);
      }
    } catch (_err) {
      // 对齐 Android runCatching.getOrDefault：单条损坏不中断整包
    }
  }
  return out;
}
