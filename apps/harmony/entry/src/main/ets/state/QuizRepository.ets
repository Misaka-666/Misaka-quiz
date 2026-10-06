import { common } from '@kit.AbilityKit';
import { util } from '@kit.ArkTS';
import { fileIo } from '@kit.CoreFileKit';
import { FileStore } from './FileStore';
import { AppSettings } from './AppSettings';
import {
  QuizBank, Question, QuestionType, Option, WrongQuestionEntry, SlashedQuestionEntry,
  FavoriteQuestionEntry, StudyRecord, WrongStatus, DEFAULT_BANK_GROUP_NAME, normalizeBankGroupName,
  uniqueBankNameAmong, bankToJson, parseBank, parseWebQuestionBank, wrongEntryToJson, parseWrongEntry, slashedEntryToJson,
  parseSlashedEntry, favoriteEntryToJson, parseFavoriteEntry, studyRecordToJson,
  parseStudyRecord
} from '../domain/Models';
import {
  BACKUP_KIND_FULL, BACKUP_KIND_SELECTED, importBackupText
} from './BackupCodec';
import { BackupBuildRequest, buildBackupZipBytes, openBackupZip } from './BackupFiles';
import {
  PracticeSessionCore, PracticeHost, PracticeQuestionSource, bankPoolSources,
  PRACTICE_MODE_INSTANT, ALL_QUESTION_TYPES
} from './PracticeSessionCore';
import { ExamSessionCore } from './ExamSessionCore';
import {
  questionKeyOf, filterWrongEntriesByScope, wrongBookScopeLabel, isWrongEntryDueForSmartReview,
  sortTodaySmartReviewEntries, applyManualMastered, WRONG_BOOK_SCOPE_CURRENT_BANK,
  WRONG_BOOK_SCOPE_BANK, WRONG_BOOK_SCOPE_GROUP
} from './WrongBookOps';
import {
  KEY_WRONG_BOOK_SMART_REVIEW_ENABLED, KEY_WRONG_BOOK_SCOPE_MODE,
  KEY_WRONG_BOOK_SCOPE_GROUP_NAME, KEY_WRONG_BOOK_SCOPE_BANK_ID,
  KEY_AI_PROVIDER, KEY_AI_API_BASE_URL, KEY_AI_API_KEY, KEY_AI_MODEL_NAME,
  KEY_AI_REFACTOR_ENABLED, KEY_AI_REVIEW_ENABLED, KEY_AI_ANALYSIS_ENABLED,
  KEY_AI_SINGLE_QUESTION_ANALYSIS_ENABLED, KEY_AI_ONLY_ANOMALY, KEY_AI_REQUIRE_CONFIRM,
  KEY_AI_MAX_QUESTIONS, KEY_AI_TIMEOUT_SECONDS, KEY_AI_REFACTOR_MAX_CHARS
} from './AppSettings';

export class WrongBookSmartReviewSummary {
  total: number;
  notMastered: number;
  masteredReview: number;
  constructor(total: number, notMastered: number, masteredReview: number) {
    this.total = total;
    this.notMastered = notMastered;
    this.masteredReview = masteredReview;
  }
}

const STATE_DIR = 'misaka';
const STATE_FILE = `${STATE_DIR}/state.json`;

// Array.isArray 在 ArkTS 中收窄为 any[]，统一经此转为 Object[] 再逐项判型
function toJsonArray(value: Object | undefined): Object[] {
  if (value === undefined || value === null || !Array.isArray(value)) {
    return [];
  }
  const arr: Object[] = [];
  for (let i = 0; i < value.length; i++) {
    arr.push(value[i] as Object);
  }
  return arr;
}

function isJsonObject(value: Object | undefined): boolean {
  return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value);
}

function writeBytesToFile(path: string, data: Uint8Array): void {
  const file: fileIo.File = fileIo.openSync(path, fileIo.OpenMode.READ_WRITE | fileIo.OpenMode.CREATE | fileIo.OpenMode.TRUNC);
  try {
    // Uint8Array 可能是底层 buffer 的子视图，直接写 data.buffer 会落盘整段底层数据；
    // 未对齐时用 slice() 复制出恰好等于视图内容的独立 buffer
    const bytes: ArrayBuffer = data.byteOffset === 0 && data.byteLength === data.buffer.byteLength
      ? data.buffer as ArrayBuffer
      : data.slice().buffer as ArrayBuffer;
    fileIo.writeSync(file.fd, bytes);
  } finally {
    fileIo.closeSync(file);
  }
}

/**
 * 全局状态仓 — 移植自 Android QuizRepository（M1 骨架：加载/持久化/题库 CRUD）。
 * 练习考试会话、错题逻辑、收藏交互等随 M4/M5 移植补充。
 * Android 端用 SharedPreferences 存大 JSON；鸿蒙端为规避 preferences 单值容量限制，
 * 状态整体存 filesDir/misaka/state.json（字段结构与 Android 各 key 的 JSON 完全一致）。
 */
export class QuizRepository {
  private static instance: QuizRepository | null = null;

  private context: common.UIAbilityContext | null = null;
  banks: QuizBank[] = [];
  activeBankId: string = '';
  wrongBook: WrongQuestionEntry[] = [];
  slashedQuestions: SlashedQuestionEntry[] = [];
  favoriteQuestions: FavoriteQuestionEntry[] = [];
  studyRecords: StudyRecord[] = [];
  practiceSequentialProgress: Record<string, number> = {};
  settings: AppSettings = new AppSettings();
  practice: PracticeSessionCore = new PracticeSessionCore(new PracticeHost());
  exam: ExamSessionCore = new ExamSessionCore(new PracticeHost());

  static getInstance(): QuizRepository {
    if (QuizRepository.instance === null) {
      QuizRepository.instance = new QuizRepository();
    }
    return QuizRepository.instance;
  }

  init(context: common.UIAbilityContext): void {
    this.context = context;
    const state = FileStore.readJson(context.filesDir, STATE_FILE);
    if (state !== null) {
      this.loadFromState(state);
    }
    this.settings = AppSettings.load();
    const host = this.buildHost();
    this.practice = new PracticeSessionCore(host);
    this.exam = new ExamSessionCore(host);
    this.exam.examOptionShufflePrefEnabled = this.settings.examOptionShuffleEnabled;
  }

  /** preferences 就绪后重读设置（EntryAbility 回调） */
  loadSettings(): void {
    this.settings = AppSettings.load();
    this.exam.examOptionShufflePrefEnabled = this.settings.examOptionShuffleEnabled;
  }

  /** 会话核心的仓库侧钩子：题库/错题本/收藏/记录/顺序进度/持久化 */
  private buildHost(): PracticeHost {
    const repo = this;
    const host = new PracticeHost();
    host.banks = (): QuizBank[] => repo.banks;
    host.activeBankId = (): string => repo.activeBankId;
    host.wrongBook = (): WrongQuestionEntry[] => repo.wrongBook;
    host.slashedQuestions = (): SlashedQuestionEntry[] => repo.slashedQuestions;
    host.favoriteQuestions = (): FavoriteQuestionEntry[] => repo.favoriteQuestions;
    host.isSlashed = (bankId: string, question: Question): boolean => repo.isQuestionSlashed(bankId, question);
    host.addRecord = (record: StudyRecord): void => {
      repo.studyRecords.unshift(record);
    };
    host.sequentialProgress = (key: string): number | null => {
      const value = repo.practiceSequentialProgress[key];
      return value !== undefined ? value : null;
    };
    host.setSequentialProgress = (key: string, value: number): void => {
      repo.practiceSequentialProgress[key] = value;
    };
    host.now = (): number => Date.now();
    host.persist = (): void => {
      repo.persist();
    };
    return host;
  }

  // ---------- 练习/考试入口（M4） ----------

  isQuestionSlashed(bankId: string, question: Question): boolean {
    const key = questionKeyOf(question);
    return this.slashedQuestions.some((entry): boolean => entry.bankId === bankId && entry.questionKey === key);
  }

  restoreSlashed(bankId: string, question: Question): boolean {
    const key = questionKeyOf(question);
    const before = this.slashedQuestions.length;
    this.slashedQuestions = this.slashedQuestions.filter((entry): boolean => !(entry.bankId === bankId && entry.questionKey === key));
    if (this.slashedQuestions.length !== before) {
      this.persist();
      return true;
    }
    return false;
  }

  /** 当前练习池（活动题库，过滤斩题）；等价 Android 单库作用域 activePracticePoolSources */
  poolSources(): PracticeQuestionSource[] {
    const bank = this.activeBank();
    return bank !== null
      ? bankPoolSources(bank, (bankId: string, question: Question): boolean => this.isQuestionSlashed(bankId, question))
      : [];
  }

  poolTypeCounts(): Map<string, number> {
    const counts = new Map<string, number>();
    for (const type of ALL_QUESTION_TYPES) {
      counts.set(type, 0);
    }
    for (const source of this.poolSources()) {
      counts.set(source.question.type, (counts.get(source.question.type) as number) + 1);
    }
    return counts;
  }

  sequentialProgressKey(): string {
    const bank = this.activeBank();
    return `BANK:${bank !== null ? bank.id : ''}`;
  }

  sequentialProgressValue(): number {
    const value = this.practiceSequentialProgress[this.sequentialProgressKey()];
    return value !== undefined ? value : 0;
  }

  resetSequentialProgress(): void {
    this.practiceSequentialProgress[this.sequentialProgressKey()] = 0;
    this.persist();
  }

  // ---------- 错题本 / 收藏夹 / 学习记录（M5） ----------

  wrongBookEntriesForScope(): WrongQuestionEntry[] {
    const active = this.activeBank();
    return filterWrongEntriesByScope(this.wrongBook, this.banks, active !== null ? active.id : null,
      this.settings.wrongBookScopeMode, this.settings.wrongBookScopeGroupName, this.settings.wrongBookScopeBankId);
  }

  currentWrongBookScopeLabel(): string {
    const active = this.activeBank();
    return wrongBookScopeLabel(this.banks, active !== null ? active.name : null,
      this.settings.wrongBookScopeMode, this.settings.wrongBookScopeGroupName, this.settings.wrongBookScopeBankId);
  }

  setWrongBookScopeMode(mode: string, groupName: string): void {
    const s = this.settings;
    s.wrongBookScopeMode = mode;
    if (mode === WRONG_BOOK_SCOPE_GROUP) {
      s.wrongBookScopeGroupName = groupName;
    } else if (mode === WRONG_BOOK_SCOPE_BANK) {
      s.wrongBookScopeBankId = groupName;
    }
    s.putString(KEY_WRONG_BOOK_SCOPE_MODE, mode);
    s.putString(KEY_WRONG_BOOK_SCOPE_GROUP_NAME, s.wrongBookScopeGroupName);
    s.putString(KEY_WRONG_BOOK_SCOPE_BANK_ID, s.wrongBookScopeBankId);
  }

  setWrongBookSmartReviewEnabled(enabled: boolean): void {
    this.settings.wrongBookSmartReviewEnabled = enabled;
    this.settings.putBool(KEY_WRONG_BOOK_SMART_REVIEW_ENABLED, enabled);
  }

  // ---------- AI 设置（M8，对齐 Android setAi*/clearAiConfig/isAiConfigured） ----------

  isAiConfigured(): boolean {
    return this.settings.aiApiBaseUrl.trim().length > 0 && this.settings.aiApiKey.trim().length > 0 &&
      this.settings.aiModelName.trim().length > 0;
  }

  setAiInterfaceConfig(provider: string, apiBaseUrl: string, apiKey: string, modelName: string): void {
    const s = this.settings;
    s.aiProvider = provider.trim().length > 0 ? provider : 'DeepSeek';
    s.aiApiBaseUrl = apiBaseUrl.trim();
    s.aiApiKey = apiKey.trim();
    s.aiModelName = modelName.trim();
    s.putString(KEY_AI_PROVIDER, s.aiProvider);
    s.putString(KEY_AI_API_BASE_URL, s.aiApiBaseUrl);
    s.putString(KEY_AI_API_KEY, s.aiApiKey);
    s.putString(KEY_AI_MODEL_NAME, s.aiModelName);
  }

  setAiFeatureEnabled(feature: 'refactor' | 'review' | 'analysis' | 'single' | 'onlyAnomaly' | 'requireConfirm',
    enabled: boolean): void {
    const s = this.settings;
    if (feature === 'refactor') {
      s.aiRefactorEnabled = enabled;
      s.putBool(KEY_AI_REFACTOR_ENABLED, enabled);
    } else if (feature === 'review') {
      s.aiReviewEnabled = enabled;
      s.putBool(KEY_AI_REVIEW_ENABLED, enabled);
    } else if (feature === 'analysis') {
      s.aiAnalysisEnabled = enabled;
      s.putBool(KEY_AI_ANALYSIS_ENABLED, enabled);
    } else if (feature === 'single') {
      s.aiSingleQuestionAnalysisEnabled = enabled;
      s.putBool(KEY_AI_SINGLE_QUESTION_ANALYSIS_ENABLED, enabled);
    } else if (feature === 'onlyAnomaly') {
      s.aiOnlyAnomaly = enabled;
      s.putBool(KEY_AI_ONLY_ANOMALY, enabled);
    } else {
      s.aiRequireConfirm = enabled;
      s.putBool(KEY_AI_REQUIRE_CONFIRM, enabled);
    }
  }

  setAiProcessingLimits(maxQuestions: number, timeoutSeconds: number, refactorMaxChars: number): void {
    const s = this.settings;
    s.aiMaxQuestions = Math.min(Math.max(maxQuestions, 5), 100);
    s.aiTimeoutSeconds = Math.min(Math.max(timeoutSeconds, 15), 180);
    s.aiRefactorMaxChars = Math.min(Math.max(refactorMaxChars, 5000), 80000);
    s.putNumber(KEY_AI_MAX_QUESTIONS, s.aiMaxQuestions);
    s.putNumber(KEY_AI_TIMEOUT_SECONDS, s.aiTimeoutSeconds);
    s.putNumber(KEY_AI_REFACTOR_MAX_CHARS, s.aiRefactorMaxChars);
  }

  clearAiConfig(): void {
    const s = this.settings;
    s.aiApiBaseUrl = '';
    s.aiApiKey = '';
    s.aiModelName = '';
    s.aiRefactorEnabled = false;
    s.aiReviewEnabled = false;
    s.aiAnalysisEnabled = false;
    s.aiSingleQuestionAnalysisEnabled = false;
    s.putString(KEY_AI_API_BASE_URL, '');
    s.putString(KEY_AI_API_KEY, '');
    s.putString(KEY_AI_MODEL_NAME, '');
    s.putBool(KEY_AI_REFACTOR_ENABLED, false);
    s.putBool(KEY_AI_REVIEW_ENABLED, false);
    s.putBool(KEY_AI_ANALYSIS_ENABLED, false);
    s.putBool(KEY_AI_SINGLE_QUESTION_ANALYSIS_ENABLED, false);
  }

  /** 待复习（未掌握 + 未斩题） */
  reviewDueWrongEntries(): WrongQuestionEntry[] {
    return this.wrongBookEntriesForScope()
      .filter((entry): boolean => entry.status !== WrongStatus.MASTERED)
      .filter((entry): boolean => !this.isQuestionSlashed(entry.bankId, entry.question));
  }

  todaySmartReviewEntries(): WrongQuestionEntry[] {
    if (!this.settings.wrongBookSmartReviewEnabled) {
      return [];
    }
    const now = Date.now();
    const due = this.wrongBookEntriesForScope()
      .filter((entry): boolean => !this.isQuestionSlashed(entry.bankId, entry.question))
      .filter((entry): boolean => isWrongEntryDueForSmartReview(entry, now));
    return sortTodaySmartReviewEntries(due);
  }

  todaySmartReviewSummary(): WrongBookSmartReviewSummary {
    const entries = this.todaySmartReviewEntries();
    let notMastered = 0;
    for (const entry of entries) {
      if (entry.status !== WrongStatus.MASTERED) {
        notMastered += 1;
      }
    }
    return new WrongBookSmartReviewSummary(entries.length, notMastered, entries.length - notMastered);
  }

  removeWrongQuestion(bankId: string, questionId: string): boolean {
    const before = this.wrongBook.length;
    this.wrongBook = this.wrongBook.filter((entry): boolean => !(entry.bankId === bankId && entry.question.id === questionId));
    if (this.wrongBook.length !== before) {
      this.persist();
      return true;
    }
    return false;
  }

  markWrongQuestionMastered(bankId: string, questionId: string, mastered: boolean): boolean {
    const changed = applyManualMastered(this.wrongBook, bankId, questionId, mastered, Date.now());
    if (changed) {
      this.persist();
    }
    return changed;
  }

  clearWrongBookForScope(): void {
    const mode = this.settings.wrongBookScopeMode;
    if (mode === WRONG_BOOK_SCOPE_CURRENT_BANK) {
      const active = this.activeBank();
      if (active !== null) {
        this.wrongBook = this.wrongBook.filter((entry): boolean => entry.bankId !== active.id);
      }
    } else if (mode === WRONG_BOOK_SCOPE_GROUP) {
      const group = this.settings.wrongBookScopeGroupName.trim().length > 0
        ? this.settings.wrongBookScopeGroupName.trim() : DEFAULT_BANK_GROUP_NAME;
      if (group === DEFAULT_BANK_GROUP_NAME) {
        this.wrongBook = [];
      } else {
        const ids = new Set<string>(this.banks.filter((bank): boolean => bank.groupName === group)
          .map((bank): string => bank.id));
        this.wrongBook = this.wrongBook.filter((entry): boolean => !ids.has(entry.bankId));
      }
    } else if (mode === WRONG_BOOK_SCOPE_BANK) {
      const bankId = this.settings.wrongBookScopeBankId;
      this.wrongBook = this.wrongBook.filter((entry): boolean => entry.bankId !== bankId);
    } else {
      this.wrongBook = [];
    }
    this.persist();
  }

  /** 错题练习（默认刷当前筛选）；sourceLabel 决定记录来源（错题本/今日复习） */
  startWrongBookPractice(entries: WrongQuestionEntry[], includeMastered: boolean, sourceLabel: string): boolean {
    const selected = entries
      .filter((entry): boolean => includeMastered || entry.status !== WrongStatus.MASTERED)
      .filter((entry): boolean => !this.isQuestionSlashed(entry.bankId, entry.question));
    return this.startSourceEntryPractice(selected.map((entry): PracticeQuestionSource =>
      new PracticeQuestionSource(entry.bankId, entry.bankName, this.groupNameOfBank(entry.bankId), entry.question)
    ), sourceLabel);
  }

  startTodayWrongBookReview(): boolean {
    return this.startWrongBookPractice(this.todaySmartReviewEntries(), true, '今日复习');
  }

  /** 打开单道错题即时练习（等价 Android openWrongQuestion） */
  openWrongQuestion(entry: WrongQuestionEntry): boolean {
    const bank = this.banks.find((item): boolean => item.id === entry.bankId);
    if (bank === undefined) {
      return false;
    }
    const question = bank.questions.find((item): boolean => item.id === entry.question.id);
    if (question === undefined) {
      return false;
    }
    return this.startSourceEntryPractice(
      [new PracticeQuestionSource(bank.id, bank.name, bank.groupName, question)], '错题本');
  }

  removeFavoriteQuestion(bankId: string, questionId: string): boolean {
    const before = this.favoriteQuestions.length;
    this.favoriteQuestions = this.favoriteQuestions.filter((entry): boolean =>
      !(entry.bankId === bankId && entry.question.id === questionId));
    if (this.favoriteQuestions.length !== before) {
      this.persist();
      return true;
    }
    return false;
  }

  startFavoritePractice(entries: FavoriteQuestionEntry[]): boolean {
    return this.startSourceEntryPractice(entries.map((entry): PracticeQuestionSource =>
      new PracticeQuestionSource(entry.bankId, entry.bankName, this.groupNameOfBank(entry.bankId), entry.question)
    ), '收藏夹');
  }

  findStudyRecord(recordId: string): StudyRecord | null {
    if (recordId.length === 0) {
      return null;
    }
    const found = this.studyRecords.find((record): boolean => record.id === recordId);
    return found !== undefined ? found : null;
  }

  deleteStudyRecord(recordId: string): boolean {
    const before = this.studyRecords.length;
    this.studyRecords = this.studyRecords.filter((record): boolean => record.id !== recordId);
    if (this.studyRecords.length !== before) {
      this.persist();
      return true;
    }
    return false;
  }

  private groupNameOfBank(bankId: string): string {
    const bank = this.banks.find((item): boolean => item.id === bankId);
    return bank !== undefined ? bank.groupName : DEFAULT_BANK_GROUP_NAME;
  }

  /** 收藏/错题会话启动公共路径：全部题型、不乱序、即时判题、记录来源由 sourceLabel 决定 */
  private startSourceEntryPractice(items: PracticeQuestionSource[], sourceLabel: string): boolean {
    const seen = new Set<string>();
    const distinct: PracticeQuestionSource[] = [];
    for (const item of items) {
      const key = `${item.bankId}#${item.question.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        distinct.push(item);
      }
    }
    if (distinct.length === 0) {
      return false;
    }
    return this.practice.start(distinct, ALL_QUESTION_TYPES.slice(), false, PRACTICE_MODE_INSTANT,
      this.settings.resolvePreferredBatchGroupSize(), null, sourceLabel);
  }

  importWebBankJson(rawText: string, fallbackName: string): QuizBank | null {
    try {
      const parsed: Object | null = JSON.parse(rawText) as Object;
      const bank = parseWebQuestionBank(parsed);
      if (bank === null) {
        return null;
      }
      bank.id = util.generateRandomUUID(true);
      if (bank.name.trim().length === 0) {
        bank.name = fallbackName;
      }
      return this.importBank(bank.name, DEFAULT_BANK_GROUP_NAME, bank.questions);
    } catch (_err) {
      return null;
    }
  }

  private loadFromState(state: Record<string, Object>): void {
    // init 可能在 ability 重建（进程未死、单例仍在）时二次触发，先复位再装载，避免往已有数组 push 导致数据翻倍
    this.banks = [];
    this.activeBankId = '';
    this.wrongBook = [];
    this.slashedQuestions = [];
    this.favoriteQuestions = [];
    this.studyRecords = [];
    this.practiceSequentialProgress = {};
    for (const raw of toJsonArray(state['banks'])) {
      if (isJsonObject(raw)) {
        this.banks.push(parseBank(raw));
      }
    }
    this.activeBankId = typeof state['activeBankId'] === 'string' ? state['activeBankId'] as string : '';
    for (const raw of toJsonArray(state['wrongBook'])) {
      if (isJsonObject(raw)) {
        const entry = parseWrongEntry(raw);
        if (entry !== null) {
          this.wrongBook.push(entry);
        }
      }
    }
    for (const raw of toJsonArray(state['slashedQuestions'])) {
      if (isJsonObject(raw)) {
        this.slashedQuestions.push(parseSlashedEntry(raw));
      }
    }
    for (const raw of toJsonArray(state['favoriteQuestions'])) {
      if (isJsonObject(raw)) {
        const entry = parseFavoriteEntry(raw);
        if (entry !== null) {
          this.favoriteQuestions.push(entry);
        }
      }
    }
    for (const raw of toJsonArray(state['studyRecords'])) {
      if (isJsonObject(raw)) {
        const record = parseStudyRecord(raw);
        if (record !== null) {
          this.studyRecords.push(record);
        }
      }
    }
    const rawProgress = state['practiceSequentialProgress'];
    if (isJsonObject(rawProgress)) {
      const pm = rawProgress as Record<string, Object>;
      for (const key of Object.keys(pm)) {
        const value = pm[key];
        if (typeof value === 'number' && value >= 0) {
          this.practiceSequentialProgress[key] = value;
        }
      }
    }
    if (this.activeBankId.length === 0 && this.banks.length > 0) {
      this.activeBankId = this.banks[0].id;
    }
  }

  persist(): void {
    const context = this.context;
    if (context === null) {
      return;
    }
    const banks: Object[] = [];
    for (const bank of this.banks) {
      banks.push(bankToJson(bank));
    }
    const wrongBook: Object[] = [];
    for (const entry of this.wrongBook) {
      wrongBook.push(wrongEntryToJson(entry));
    }
    const slashed: Object[] = [];
    for (const entry of this.slashedQuestions) {
      slashed.push(slashedEntryToJson(entry));
    }
    const favorites: Object[] = [];
    for (const entry of this.favoriteQuestions) {
      favorites.push(favoriteEntryToJson(entry));
    }
    const records: Object[] = [];
    for (const record of this.studyRecords) {
      records.push(studyRecordToJson(record));
    }
    const progress: Record<string, Object> = {};
    for (const key of Object.keys(this.practiceSequentialProgress)) {
      const value = this.practiceSequentialProgress[key];
      if (key.length > 0 && value >= 0) {
        progress[key] = value;
      }
    }
    const state: Record<string, Object> = {
      'banks': banks,
      'activeBankId': this.activeBankId,
      'wrongBook': wrongBook,
      'slashedQuestions': slashed,
      'favoriteQuestions': favorites,
      'studyRecords': records,
      'practiceSequentialProgress': progress
    };
    FileStore.writeTextAtomic(context.filesDir, STATE_FILE, JSON.stringify(state));
  }

  // ---------- 备份导入/导出（M6，协议对齐 Android backup.json v3 + web_backup） ----------

  private looksLikeZipBytes(view: Uint8Array): boolean {
    return view.length >= 4 && view[0] === 0x50 && view[1] === 0x4B && view[2] === 0x03 && view[3] === 0x04;
  }

  async exportFullBackupZip(): Promise<ArrayBuffer | null> {
    return this.exportBackupZip(null, true, true, true);
  }

  async exportBanksBackupZip(bankIds: Set<string>): Promise<ArrayBuffer | null> {
    return this.exportBackupZip(bankIds, false, false, false);
  }

  private async exportBackupZip(bankIds: Set<string> | null,
    includeWrongBook: boolean, includeFavorites: boolean, includeRecords: boolean): Promise<ArrayBuffer | null> {
    if (this.context === null) {
      return null;
    }
    const req = new BackupBuildRequest();
    req.kind = bankIds === null ? BACKUP_KIND_FULL : BACKUP_KIND_SELECTED;
    req.banks = bankIds === null ? this.banks
      : this.banks.filter((bank: QuizBank): boolean => bankIds.has(bank.id));
    req.activeBankId = this.activeBankId;
    req.wrongBook = this.wrongBook;
    req.favorites = this.favoriteQuestions;
    req.records = this.studyRecords;
    req.includeWrongBook = includeWrongBook;
    req.includeFavorites = includeFavorites;
    req.includeStudyRecords = includeRecords;
    return buildBackupZipBytes(this.context, req);
  }

  /** ZIP（PK 魔数/后缀）或 JSON 文本 → 返回用户可读结果消息 */
  async importBackupBytes(fileName: string, bytes: ArrayBuffer): Promise<string> {
    if (bytes.byteLength === 0) {
      return '导入失败：文件内容为空。';
    }
    const view = new Uint8Array(bytes);
    if (fileName.toLowerCase().endsWith('.zip') || this.looksLikeZipBytes(view)) {
      if (this.context === null) {
        return '导入失败：内部状态未初始化。';
      }
      const content = await openBackupZip(this.context, bytes);
      if (content === null) {
        return '导入失败：ZIP 备份无法读取。';
      }
      return this.applyBackupImport(content.jsonText, content.assets);
    }
    return this.applyBackupImport(util.TextDecoder.create('utf-8').decodeWithStream(view), new Map<string, Uint8Array>());
  }

  private applyBackupImport(jsonText: string, zipAssets: Map<string, Uint8Array>): string {
    const context = this.context;
    if (context === null) {
      return '导入失败：内部状态未初始化。';
    }
    // 图片资产统一落到独立会话目录，避免与旧引用冲突（对齐 Android question_assets/backup_<ts>）
    const assetDir = `${context.filesDir}/question_assets/backup_${Date.now()}`;
    try {
      fileIo.mkdirSync(assetDir, true);
    } catch (_err) {
      return '导入失败：无法创建资产目录。';
    }
    const writeAsset = (fileName: string, data: Uint8Array): string | null => {
      const safeName = (fileName.split('/').pop() ?? fileName).replace(/[^A-Za-z0-9_.-]/g, '_');
      if (safeName.length === 0 || safeName === '.' || safeName === '..') {
        return null;
      }
      try {
        writeBytesToFile(`${assetDir}/${safeName}`, data);
        return `${assetDir}/${safeName}`;
      } catch (_err) {
        return null;
      }
    };
    const outcome = importBackupText(jsonText, this.banks, zipAssets, writeAsset,
      (): string => util.generateRandomUUID(true), Date.now());
    if (!outcome.ok) {
      return outcome.message;
    }
    this.banks = this.banks.concat(outcome.banks);
    this.wrongBook = outcome.wrongBook.concat(this.wrongBook);
    this.favoriteQuestions = outcome.favorites.concat(this.favoriteQuestions);
    this.studyRecords = outcome.records.concat(this.studyRecords);
    if (outcome.activeBankId.length > 0) {
      this.activeBankId = outcome.activeBankId;
    } else if (this.activeBankId.length === 0 && outcome.banks.length > 0) {
      this.activeBankId = outcome.banks[0].id;
    }
    this.practice.resetState();
    this.exam.reset();
    this.persist();
    return outcome.message;
  }

  /** 清除本地全部数据（设置项保留，对齐 Android clearAllLocalData） */
  clearAllLocalData(): void {
    this.banks = [];
    this.wrongBook = [];
    this.slashedQuestions = [];
    this.favoriteQuestions = [];
    this.studyRecords = [];
    this.practiceSequentialProgress = {};
    this.activeBankId = '';
    this.practice.resetState();
    this.exam.reset();
    this.persist();
  }

  // ---------- 题库 CRUD ----------

  importBank(name: string, groupName: string, questions: Question[]): QuizBank {
    const cleanName = this.uniqueBankNameInGroup(name, groupName);
    const bank = new QuizBank(util.generateRandomUUID(true), cleanName, normalizeBankGroupName(groupName));
    bank.questions = questions;
    this.banks.push(bank);
    this.activeBankId = bank.id;
    this.persist();
    return bank;
  }

  // 关联清理对齐 Android deleteBank：错题/斩题/收藏/随库记录 + 两级顺序进度键 + 会话复位
  deleteBank(bankId: string): void {
    const index = this.banks.findIndex((bank: QuizBank): boolean => bank.id === bankId);
    if (index < 0) {
      return;
    }
    this.banks.splice(index, 1);
    this.wrongBook = this.wrongBook.filter((entry: WrongQuestionEntry): boolean => entry.bankId !== bankId);
    this.slashedQuestions = this.slashedQuestions.filter((entry: SlashedQuestionEntry): boolean => entry.bankId !== bankId);
    this.favoriteQuestions = this.favoriteQuestions.filter((entry: FavoriteQuestionEntry): boolean => entry.bankId !== bankId);
    this.studyRecords = this.studyRecords.filter((record: StudyRecord): boolean => record.bankId !== bankId);
    // ArkTS 禁 delete 操作符，重建 Record 回收两级进度键（裸 id + BANK: 前缀，与 Android 一致）
    const progress: Record<string, number> = {};
    for (const key of Object.keys(this.practiceSequentialProgress)) {
      if (key !== bankId && key !== `BANK:${bankId}`) {
        progress[key] = this.practiceSequentialProgress[key];
      }
    }
    this.practiceSequentialProgress = progress;
    if (this.activeBankId === bankId) {
      this.activeBankId = this.banks.length > 0 ? this.banks[0].id : '';
    }
    this.practice.resetState();
    this.exam.reset();
    this.persist();
  }

  renameBank(bankId: string, newName: string): boolean {
    const bank = this.banks.find((b: QuizBank): boolean => b.id === bankId);
    if (bank === undefined) {
      return false;
    }
    const cleanName = uniqueBankNameAmong(this.banks, newName, bank.groupName, bankId, '未命名题库');
    bank.name = cleanName;
    // 错题/收藏/记录内嵌的库名快照同步（对齐 Android updateBankInfo）
    for (const entry of this.wrongBook) {
      if (entry.bankId === bankId) {
        entry.bankName = cleanName;
      }
    }
    for (const entry of this.favoriteQuestions) {
      if (entry.bankId === bankId) {
        entry.bankName = cleanName;
      }
    }
    for (const record of this.studyRecords) {
      if (record.bankId === bankId) {
        record.bankName = cleanName;
      }
      for (const result of record.questionResults) {
        if (result.sourceBankId === bankId) {
          result.sourceBankName = cleanName;
        }
      }
    }
    this.persist();
    return true;
  }

  setActiveBank(bankId: string): void {
    this.activeBankId = bankId;
    this.persist();
  }

  activeBank(): QuizBank | null {
    const found = this.banks.find((bank: QuizBank): boolean => bank.id === this.activeBankId);
    return found !== undefined ? found : (this.banks.length > 0 ? this.banks[0] : null);
  }

  totalQuestionCount(): number {
    let total = 0;
    for (const bank of this.banks) {
      total += bank.questions.length;
    }
    return total;
  }

  // 组内重名时追加 " 2/3/..."（实现在 Models.uniqueBankNameAmong，Node 可测）
  private uniqueBankNameInGroup(rawName: string, groupName: string): string {
    return uniqueBankNameAmong(this.banks, rawName, groupName, null, '导入题库');
  }

  // 供 M1 设备自检：生成两道示例题并入库
  createDemoBank(): void {
    const q1 = new Question(util.generateRandomUUID(true), QuestionType.SINGLE, 'HarmonyOS 的应用开发语言是？');
    q1.options = [new Option('A', 'ArkTS'), new Option('B', 'Java')];
    q1.answer = ['A'];
    q1.analysis = 'ArkTS 是 HarmonyOS 主推的应用开发语言。';
    const q2 = new Question(util.generateRandomUUID(true), QuestionType.JUDGE, 'Misaka Quiz 已在鸿蒙端跑通领域层持久化。');
    q2.options = [new Option('A', '正确'), new Option('B', '错误')];
    q2.answer = ['A'];
    this.importBank('M1 自检题库', DEFAULT_BANK_GROUP_NAME, [q1, q2]);
  }
}
