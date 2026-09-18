import { common } from '@kit.AbilityKit';
import { util } from '@kit.ArkTS';
import { FileStore } from './FileStore';
import { SettingsStore } from './SettingsStore';
import { AppSettings } from './AppSettings';
import {
  QuizBank, Question, QuestionType, Option, WrongQuestionEntry, SlashedQuestionEntry,
  FavoriteQuestionEntry, StudyRecord, DEFAULT_BANK_GROUP_NAME, normalizeBankGroupName,
  bankToJson, parseBank, parseWebQuestionBank, wrongEntryToJson, parseWrongEntry, slashedEntryToJson,
  parseSlashedEntry, favoriteEntryToJson, parseFavoriteEntry, studyRecordToJson,
  parseStudyRecord
} from '../domain/Models';
import {
  PracticeSessionCore, PracticeHost, PracticeQuestionSource, bankPoolSources,
  PRACTICE_MODE_INSTANT, OBJECTIVE_QUESTION_TYPES, ALL_QUESTION_TYPES
} from './PracticeSessionCore';
import { ExamSessionCore } from './ExamSessionCore';
import { questionKeyOf } from './WrongBookOps';

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

  deleteBank(bankId: string): void {
    const index = this.banks.findIndex((bank: QuizBank): boolean => bank.id === bankId);
    if (index >= 0) {
      this.banks.splice(index, 1);
    }
    if (this.activeBankId === bankId) {
      this.activeBankId = this.banks.length > 0 ? this.banks[0].id : '';
    }
    this.persist();
  }

  renameBank(bankId: string, newName: string): boolean {
    const bank = this.banks.find((b: QuizBank): boolean => b.id === bankId);
    if (bank === undefined) {
      return false;
    }
    bank.name = newName;
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

  // 组内重名时追加 " 2/3/..."（对齐 Android uniqueBankNameInGroup）
  private uniqueBankNameInGroup(rawName: string, groupName: string): string {
    const cleanGroupName = normalizeBankGroupName(groupName);
    const baseName = rawName.trim().length > 0 ? rawName.trim() : '导入题库';
    const existingNames = new Set<string>();
    for (const bank of this.banks) {
      if (normalizeBankGroupName(bank.groupName) === cleanGroupName) {
        existingNames.add(bank.name);
      }
    }
    if (!existingNames.has(baseName)) {
      return baseName;
    }
    let index = 2;
    let candidate = `${baseName} ${index}`;
    while (existingNames.has(candidate)) {
      index += 1;
      candidate = `${baseName} ${index}`;
    }
    return candidate;
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
