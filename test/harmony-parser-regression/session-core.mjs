// M4：练习/考试会话核心移植自检（判分、顺序进度、批量、斩题收藏、考试交卷）
// 运行：node --import ./test/harmony-parser-regression/ts-node.mjs test/harmony-parser-regression/session-core.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

const base = '../../apps/harmony/entry/src/main/ets';
const { Question, QuestionType, Option, QuizBank, FavoriteQuestionEntry } = await import(new URL(`${base}/domain/Models.ts`, import.meta.url));
const { evaluateQuestion, normalizeBlankAnswer, isAutoScoredQuestionType, parseQuickEditAnswer } = await import(new URL(`${base}/state/AnswerJudge.ts`, import.meta.url));
const { JavaRandom, javaStringHashCode, practiceDisplayKey, practiceDisplayOptions, practiceAnswersForDisplay } = await import(new URL(`${base}/state/OptionShuffle.ts`, import.meta.url));
const {
  PracticeSessionCore, PracticeHost, PracticeQuestionSource, bankPoolSources,
  ALL_QUESTION_TYPES, PRACTICE_MODE_INSTANT, PRACTICE_MODE_BATCH, SEQUENTIAL_START_LAST, resolveSequentialStartIndex
} = await import(new URL(`${base}/state/PracticeSessionCore.ts`, import.meta.url));
const { ExamSessionCore, defaultExamTypeScores } = await import(new URL(`${base}/state/ExamSessionCore.ts`, import.meta.url));
const { applyWrongAnswer, applyWrongRight } = await import(new URL(`${base}/state/WrongBookOps.ts`, import.meta.url));
const { appendAiReasoningPreview } = await import(new URL(`${base}/ai/AiSse.ts`, import.meta.url));

// ---------- JavaRandom 与 java.util.Random 逐位一致 ----------
assert.equal(new JavaRandom(0).nextInt(), -1155484576, 'Random(0).nextInt() 公认值');
assert.equal(new JavaRandom(42).nextInt(), -1170105035, 'Random(42).nextInt() 公认值');
assert.equal(javaStringHashCode(''), 0);
assert.equal(javaStringHashCode('abc'), 'abc'.split('').reduce((h, c) => h * 31 + c.charCodeAt(0), 0) | 0);
for (let seed = 1; seed < 50; seed++) {
  const bound = 3 + seed;
  const value = new JavaRandom(seed).nextInt(bound);
  assert.ok(value >= 0 && value < bound, `nextInt(${bound}) 在界内`);
}

// ---------- 判分 ----------
function single(id, answer, options) {
  const q = new Question(id, QuestionType.SINGLE, `题干-${id}`);
  q.options = options ?? [new Option('A', '甲'), new Option('B', '乙')];
  q.answer = answer;
  return q;
}
function multiBlank(id, groups) {
  const q = new Question(id, QuestionType.BLANK, `多空-${id}`);
  q.blankAnswers = groups;
  q.answer = groups.map((g) => g[0]);
  return q;
}

assert.ok(evaluateQuestion(single('s1', ['A']), ['A']).correct, '单选答对');
assert.ok(!evaluateQuestion(single('s2', ['A']), ['B']).correct, '单选答错');
assert.ok(!evaluateQuestion(single('s3', ['A']), []).correct, '未作答判错');

const mq = single('m1', ['A', 'C']);
mq.type = QuestionType.MULTIPLE;
mq.options = [new Option('A', '1'), new Option('B', '2'), new Option('C', '3')];
assert.ok(evaluateQuestion(mq, ['C', 'A']).correct, '多选乱序判对');
assert.ok(!evaluateQuestion(mq, ['A']).correct, '多选漏选判错');

// 填空归一化：全角/大小写/空白/边界句点
assert.ok(evaluateQuestion(single('b1', ['Ａｂｃ。'], [new Option('A', 'x')]), [' ａｂc ．']).correct
  || normalizeBlankAnswer(' ａｂc ．') === normalizeBlankAnswer('Ａｂｃ。'), '填空全角等价');
assert.equal(normalizeBlankAnswer('　ＸＹ　。'), 'xy', '全角+空白+边界句点');
assert.equal(normalizeBlankAnswer('（１，２）；'), '(1,2)', '全角标点转半角+边界分号');
const bq = single('b2', ['正确答案/同义答案'], [new Option('A', 'x')]);
bq.type = QuestionType.BLANK;
assert.ok(evaluateQuestion(bq, ['同义答案']).correct, '斜杠备选答案');
const sq = new Question('sh1', QuestionType.SHORT, '简述');
assert.ok(!evaluateQuestion(sq, ['任意长回答']).correct, '简答不自动判对');
assert.ok(!isAutoScoredQuestionType(QuestionType.SHORT), '简答非自动判分');

// 多空填空：第 2 空有备选
const mb = multiBlank('mb1', [['甲'], ['乙', 'also乙'], ['丙']]);
assert.ok(evaluateQuestion(mb, ['甲', 'also乙', '丙']).correct, '多空命中备选');
assert.ok(!evaluateQuestion(mb, ['甲', '', '丙']).correct, '多空有空判错');
assert.ok(!evaluateQuestion(mb, ['甲', '乙']).correct, '多空缺一空判错');

// ---------- 快速编辑答案解析（对齐 Android parseQuickEditAnswer） ----------
const abOptions = [new Option('A', '正确'), new Option('B', '错误')];
const abcdOptions = ['A', 'B', 'C', 'D'].map((k) => new Option(k, `选项${k}`));
assert.deepEqual(parseQuickEditAnswer('  ', QuestionType.JUDGE, abOptions), [], '空串');
assert.deepEqual(parseQuickEditAnswer('对', QuestionType.JUDGE, abOptions), ['A'], '判断题「对」→A');
assert.deepEqual(parseQuickEditAnswer('正确', QuestionType.JUDGE, abOptions), ['A']);
assert.deepEqual(parseQuickEditAnswer('√', QuestionType.JUDGE, abOptions), ['A'], '√→A');
assert.deepEqual(parseQuickEditAnswer('×', QuestionType.JUDGE, abOptions), ['B'], '×→B');
assert.deepEqual(parseQuickEditAnswer('X', QuestionType.JUDGE, abOptions), ['B'], 'X→B');
assert.deepEqual(parseQuickEditAnswer('FALSE', QuestionType.JUDGE, abOptions), ['B']);
assert.deepEqual(parseQuickEditAnswer('ABC', QuestionType.MULTIPLE, abcdOptions), ['A', 'B', 'C'], '多字母拆单键');
assert.deepEqual(parseQuickEditAnswer('a、c', QuestionType.MULTIPLE, abcdOptions), ['A', 'C'], '小写+顿号分隔');
assert.deepEqual(parseQuickEditAnswer('A,C,A', QuestionType.MULTIPLE, abcdOptions), ['A', 'C'], '去重');
assert.deepEqual(parseQuickEditAnswer('E', QuestionType.SINGLE, abcdOptions), [], '非法选项键过滤');
assert.deepEqual(parseQuickEditAnswer('对 错', QuestionType.JUDGE, abOptions), [], '部分 token 不做对错映射（整串才映射）');
assert.deepEqual(parseQuickEditAnswer(' 任意长答案 ', QuestionType.SHORT, abcdOptions), ['任意长答案'], '主观题整串保留');
assert.deepEqual(parseQuickEditAnswer('甲/乙', QuestionType.BLANK, abcdOptions), ['甲/乙'], '填空不按选项键过滤');


const shuffleQ = single('sh-q', ['B'], [new Option('A', '1'), new Option('B', '2'), new Option('C', '3'), new Option('D', '4')]);
const d1 = practiceDisplayOptions(shuffleQ, true, 12345, 'bank#sh-q');
const d2 = practiceDisplayOptions(shuffleQ, true, 12345, 'bank#sh-q');
assert.deepEqual(d1.map((o) => `${o.displayKey}:${o.originalKey}`), d2.map((o) => `${o.displayKey}:${o.originalKey}`), '同种子打乱稳定');
const d3 = practiceDisplayOptions(shuffleQ, true, 67890, 'bank#sh-q');
assert.ok(JSON.stringify(d1) !== JSON.stringify(d3) || practiceDisplayOptions(shuffleQ, true, 999, 'bank#sh-q').some((o, i) => o.originalKey !== d1[i].originalKey), '换种子顺序变化');
const dNo = practiceDisplayOptions(shuffleQ, false, 12345, 'bank#sh-q');
assert.deepEqual(dNo.map((o) => o.originalKey), ['A', 'B', 'C', 'D'], '关闭打乱保持原序');
assert.deepEqual(dNo.map((o) => o.displayKey), ['A', 'B', 'C', 'D'], '不打乱时展示键=原键');

// ---------- 会话流程 ----------
const FIXED_NOW = 1750000000000;
class FakeHost extends PracticeHost {
  constructor(bank) {
    super();
    this.bankRef = bank;
    this.wrongBookArr = [];
    this.slashedArr = [];
    this.favoritesArr = [];
    this.records = [];
    this.progressMap = new Map();
    this.persistCount = 0;
  }
  banks = () => [this.bankRef];
  activeBankId = () => this.bankRef.id;
  wrongBook = () => this.wrongBookArr;
  slashedQuestions = () => this.slashedArr;
  favoriteQuestions = () => this.favoritesArr;
  isSlashed = (bankId, q) => this.slashedArr.some((e) => e.bankId === bankId && e.questionKey === q.id);
  addRecord = (r) => { this.records.unshift(r); };
  sequentialProgress = (k) => (this.progressMap.has(k) ? this.progressMap.get(k) : null);
  setSequentialProgress = (k, v) => { this.progressMap.set(k, v); };
  now = () => FIXED_NOW;
  persist = () => { this.persistCount += 1; };
}

const bank = new QuizBank('b1', '自检题库');
bank.questions = [
  single('q1', ['A']), single('q2', ['B']), single('q3', ['A']),
  mq, multiBlank('mb2', [['x'], ['y']]), new Question('sh2', QuestionType.SHORT, '简答2')
];

const host = new FakeHost(bank);
const session = new PracticeSessionCore(host);
const pool = bankPoolSources(bank, host.isSlashed);
assert.equal(pool.length, 6, '未斩题时池=全部');

// 顺序练习：3 题，从进度 0
assert.ok(session.startSequential(pool, [], 3, SEQUENTIAL_START_LAST, 1, 'BANK:b1', 0, 'instant_feedback', 10, '自检题库'));
assert.equal(session.questions.length, 3);
assert.equal(session.currentQuestion().id, 'q1');
assert.equal(session.sessionKeyAt(0), 'b1#q1');

// 答对第 1 题
session.toggleAnswer('A', false);
session.submitQuestion();
assert.ok(session.lastResult.correct);
assert.equal(host.wrongBookArr.length, 0, '答对不进错题本');

// 第 2 题答错 → 入错题本 + 复习排期明天
session.nextQuestion();
session.toggleAnswer('A', false);
const wrongResult = session.submitQuestion();
assert.ok(!wrongResult.correct);
assert.equal(host.wrongBookArr.length, 1);
assert.equal(host.wrongBookArr[0].question.id, 'q2');
assert.equal(host.wrongBookArr[0].wrongCount, 1);
assert.equal(host.wrongBookArr[0].status, '未掌握');
const dayMs = 24 * 60 * 60 * 1000;
const startOfFixed = new Date(new Date(FIXED_NOW).getFullYear(), new Date(FIXED_NOW).getMonth(), new Date(FIXED_NOW).getDate()).getTime();
assert.equal(host.wrongBookArr[0].nextReviewAt, startOfFixed + dayMs, 'nextReviewAt=明日零点');

// 返回已答题应恢复结果，不把复盘当作新一次作答。
const persistBeforeReview = host.persistCount;
session.previousQuestion();
assert.deepEqual(session.selectedAnswer, ['A'], '返回保留刚才的答案');
assert.equal(session.lastResult.correct, true, '返回恢复已提交的正确结果');
session.goToQuestion(1);
assert.deepEqual(session.selectedAnswer, ['A'], '答题卡跳转保留错误答案');
assert.equal(session.lastResult.correct, false, '答题卡跳转恢复错误结果');
session.previousQuestion();
session.nextQuestion();
assert.equal(session.lastResult.correct, false, '向前翻题也恢复结果');
assert.equal(host.persistCount, persistBeforeReview, '复盘不重复持久化或判分');
assert.equal(host.wrongBookArr[0].wrongCount, 1, '复盘不重复累计错题');

// 第 3 题单选答对
session.nextQuestion();
assert.equal(session.lastResult, null, '未答题仍为未提交');
session.toggleAnswer('A', false);
assert.ok(session.submitQuestion().correct);

// 完成会话 → 记录 + 顺序进度推进到 3
session.completeSession();
assert.equal(host.records.length, 1);
assert.equal(host.records[0].source, '练习');
assert.equal(host.records[0].total, 3);
assert.equal(host.records[0].correct, 2);
assert.equal(host.progressMap.get('BANK:b1'), 3, '顺序进度推进到 3');
assert.equal(session.questions.length, 0, '会话已重置');

// 再次顺序练习：客观题池只有 4 题（BLANK/SHORT 默认过滤），从进度 3 起只剩多选 1 题
assert.ok(session.startSequential(pool, [], 2, SEQUENTIAL_START_LAST, 1, 'BANK:b1', host.progressMap.get('BANK:b1'), 'instant_feedback', 10, '自检题库'));
assert.equal(session.questions.length, 1);
assert.equal(session.currentQuestion().id, 'm1', '从第 4 题继续');
session.toggleAnswer('A', true);
session.toggleAnswer('C', true);
assert.ok(session.submitQuestion().correct);
assert.ok(session.canSaveSequentialProgressOnExit(false));
session.endSessionSavingSequentialProgress(false);
assert.equal(host.progressMap.get('BANK:b1'), 0, '客观池做满后进度回绕到 0');

// 同一题再答对两次 → 掌握
const wb = host.wrongBookArr[0];
applyWrongRight(host.wrongBookArr, bank, wb.question, FIXED_NOW);
applyWrongRight(host.wrongBookArr, bank, wb.question, FIXED_NOW);
assert.equal(host.wrongBookArr[0].status, '已掌握', '连续 2 次答对判掌握');
applyWrongAnswer(host.wrongBookArr, bank, wb.question, ['A'], '练习', FIXED_NOW);
assert.equal(host.wrongBookArr[0].status, '未掌握', '再错复位');

// ---------- 批量模式 ----------
const batchSession = new PracticeSessionCore(host);
assert.ok(batchSession.start(pool, ['SINGLE','MULTIPLE','JUDGE','BLANK','SHORT'], false, PRACTICE_MODE_BATCH, 4, null, '自检题库'));
assert.deepEqual(batchSession.batchIndexes(), [0, 1, 2, 3], '第 1 批 0-3');
assert.equal(batchSession.batchGroupCount(), 2);
batchSession.nextQuestion();
batchSession.nextQuestion();
batchSession.toggleAnswer('A', false); // q3 的草稿（index 2）
assert.equal(batchSession.draftAnsweredCount(), 1);
batchSession.goToQuestion(0);
batchSession.toggleAnswer('A', false); // q1 草稿
assert.equal(batchSession.submitQuestion(), null, '批量未提交时即时提交返回 null');
assert.ok(batchSession.submitBatch());
assert.equal(batchSession.answerResults.size, 4);
assert.equal(batchSession.batchSubmitted, true);
assert.equal(batchSession.index, 0, '提交后回到批首');
// 提交后重进第 3 题能看到结果
batchSession.goToQuestion(2);
assert.equal(batchSession.resultCorrectAt(2), true);
assert.ok(batchSession.canStartNextBatchGroup());
assert.ok(batchSession.startNextBatchGroup());
assert.deepEqual(batchSession.batchIndexes(), [4, 5]);
batchSession.updateTextAnswer('');
assert.equal(batchSession.isDraftAnswered(4), false);
assert.ok(batchSession.submitBatch());
assert.ok(batchSession.isAllBatchGroupsSubmitted(), '全部批次已提交');
batchSession.completeSession();
assert.equal(host.records[0].source, '练习');
assert.equal(host.records[0].total, 6);

// ---------- 斩题 / 收藏 ----------
const slashSession = new PracticeSessionCore(host);
assert.ok(slashSession.start(pool, ['SINGLE','MULTIPLE','JUDGE','BLANK','SHORT'], false, 'instant_feedback', 10, null, '自检题库'));
slashSession.goToQuestion(1);
const slashTarget = slashSession.currentQuestion();
assert.ok(slashSession.canSlashCurrent(true));
assert.ok(slashSession.slashCurrent());
assert.equal(host.slashedArr.length, 1);
assert.equal(slashSession.questions.length, 5);
assert.equal(bankPoolSources(bank, host.isSlashed).length, 5, '斩后池缩小');
assert.ok(!slashSession.canSlashCurrent(false), '开关关闭时不可斩');
assert.ok(slashSession.toggleCurrentFavorite());
assert.equal(host.favoritesArr.length, 1);
assert.ok(slashSession.isCurrentFavorited());
assert.ok(slashSession.toggleCurrentFavorite());
assert.equal(host.favoritesArr.length, 0);
slashSession.endSession();

// ---------- 考试 ----------
const examHost = new FakeHost(bank);
const exam = new ExamSessionCore(examHost);
const counts = new Map();
counts.set(QuestionType.SINGLE, 2);
counts.set(QuestionType.MULTIPLE, 1);
assert.ok(exam.startByTypeCounts(bank.questions, counts, 5, defaultExamTypeScores()));
assert.equal(exam.questions.length, 3);
assert.equal(exam.remainingSeconds, 300);
// 逐题作答：单选×2 对、多选错
const singleList = exam.questions.filter((q) => q.type === QuestionType.SINGLE);
for (const q of singleList) {
  exam.jumpToQuestion(exam.questions.indexOf(q));
  exam.toggleAnswer(q.answer[0], false);
}
const multiQ = exam.questions.find((q) => q.type === QuestionType.MULTIPLE);
exam.jumpToQuestion(exam.questions.indexOf(multiQ));
exam.toggleAnswer('A', true); // 答案 AC → 错
assert.equal(exam.answeredCount(), 3);
// 分值：单选 1×2 + 多选 2 = 4 总分；得分 2
const outcome = exam.submit(false);
assert.equal(outcome.summary.total, 3);
assert.equal(outcome.summary.correct, 2);
assert.equal(outcome.summary.totalScore, 4);
assert.equal(outcome.summary.earnedScore, 2);
assert.equal(examHost.records.length, 1);
assert.equal(examHost.records[0].source, '考试');
assert.equal(examHost.records[0].earnedScore, 2);
assert.equal(examHost.wrongBookArr.length, 1, '多选错进错题本');
assert.ok(exam.finished);
assert.equal(exam.submit(false), null, '重复交卷无效');

// 倒计时自动交卷
const exam2 = new ExamSessionCore(examHost);
assert.ok(exam2.start(bank.questions, 2, 1, [QuestionType.JUDGE, QuestionType.SINGLE], defaultExamTypeScores(), false,
  ['SINGLE', 'MULTIPLE', 'JUDGE']));
exam2.remainingSeconds = 1;
exam2.tick();
assert.equal(exam2.remainingSeconds, 0);
assert.ok(exam2.finished);
assert.ok(exam2.autoSubmitted, '到点自动交卷');

// 执行页面的实际提交方法，用可控定时器验证查看解析与自动跳题的区别。
const pageSource = readFileSync(new URL(`${base}/pages/PracticePage.ets`, import.meta.url), 'utf8');
const submitMethod = pageSource.slice(pageSource.indexOf('  private submitCurrent('), pageSource.indexOf('  private onOptionTap('));
const timers = new Map();
let timerId = 0;
const PageHarness = new Function('setTimeout', 'clearTimeout',
  `${stripTypeScriptTypes(`class PageHarness { ${submitMethod} }`)}; return PageHarness;`
)((callback) => { timers.set(++timerId, callback); return timerId; }, (id) => timers.delete(id));
const page = new PageHarness();
const reviewSession = new PracticeSessionCore(new FakeHost(bank));
reviewSession.start(pool, [], false, 'instant_feedback', 10, null, '自检题库');
page.session = reviewSession;
page.repo = { settings: { practiceAutoNextEnabled: true } };
page.autoNextTimer = -1;
page.bump = () => {};
page.isSubmittedNow = () => reviewSession.lastResult !== null;
page.goNext = () => reviewSession.nextQuestion();
const runTimers = () => { const pending = [...timers.values()]; timers.clear(); pending.forEach((fn) => fn()); };
reviewSession.toggleAnswer('A', false);
page.submitCurrent();
assert.equal(timers.size, 1, '首次答对仍安排自动跳题');
runTimers();
assert.equal(reviewSession.index, 1);
reviewSession.previousQuestion();
page.submitCurrent(false);
assert.equal(timers.size, 0, '返回看解析不再次跳题');
assert.equal(reviewSession.lastResult.correct, true);
reviewSession.nextQuestion();
reviewSession.toggleAnswer('B', false);
page.submitCurrent(false);
assert.equal(timers.size, 0, '未提交题点击查看解析也不自动跳题');
assert.equal(reviewSession.lastResult.correct, true);
reviewSession.nextQuestion();
reviewSession.toggleAnswer('A', false);
page.submitCurrent();
assert.equal(timers.size, 1);
page.submitCurrent(false);
assert.equal(timers.size, 0, '查看解析取消已经排队的跳题');
assert.match(pageSource, /label: '查看解析'[\s\S]*?this\.submitCurrent\(false\)/, '解析按钮使用不跳题路径');

console.log('session-core self-check: ALL PASS');

// 自动保存：模拟序列化、重启和续答，不得再次计分。
{
  const h = new FakeHost(bank);
  let checkpoints = 0;
  h.checkpoint = () => checkpoints++;
  const original = new PracticeSessionCore(h);
  original.startSequential(bankPoolSources(bank, h.isSlashed), [], 3,
    SEQUENTIAL_START_LAST, 1, 'BANK:b1', 0, 'instant_feedback', 10, bank.name);
  original.toggleAnswer('B', false);
  original.submitQuestion();
  original.nextQuestion();
  original.toggleAnswer('B', false); // 尚未提交
  const stored = JSON.parse(JSON.stringify(original.snapshot()));
  const effects = JSON.stringify(h.wrongBookArr);
  const resumed = new PracticeSessionCore(h);
  assert.ok(resumed.restoreSnapshot(stored));
  assert.equal(resumed.index, 1);
  assert.deepEqual(resumed.selectedAnswer, ['B']);
  assert.equal(resumed.lastResult, null);
  assert.equal(resumed.optionShuffleSeed, original.optionShuffleSeed);
  assert.deepEqual(resumed.questions.map(q => q.id), original.questions.map(q => q.id));
  resumed.previousQuestion();
  assert.deepEqual(resumed.selectedAnswer, ['B']);
  assert.equal(resumed.lastResult.correct, false);
  assert.equal(JSON.stringify(h.wrongBookArr), effects);
  resumed.nextQuestion();
  assert.deepEqual(resumed.selectedAnswer, ['B']);
  resumed.submitQuestion();
  let committed;
  h.persist = () => { committed = JSON.parse(JSON.stringify(resumed.snapshot())); };
  resumed.completeSession();
  assert.deepEqual(committed, {}, '结束时原子保存记录和清空的会话');
  assert.equal(h.records.length, 1);
  assert.equal(h.records[0].total, 2);
  assert.ok(checkpoints >= 5, '开始、输入和翻题均触发自动保存');
  assert.equal(new PracticeSessionCore(h).restoreSnapshot({}), false);
  assert.equal(original.restoreSnapshot({ ...stored, index: 999 }), false);
  assert.equal(original.index, 1, '坏存档不改当前会话');
  assert.equal(original.restoreSnapshot({ ...stored, keys: ['same', 'same', 'same'] }), false);
  assert.equal(original.restoreSnapshot({ ...stored, drafts: { [stored.keys[1]]: [42] } }), false);
}
{
  const h = new FakeHost(bank);
  const first = new PracticeSessionCore(h);
  first.start(bankPoolSources(bank, h.isSlashed), [QuestionType.SINGLE], true, PRACTICE_MODE_BATCH, 2, null, null);
  first.toggleAnswer('B', false);
  first.nextQuestion();
  const restored = new PracticeSessionCore(h);
  assert.ok(restored.restoreSnapshot(JSON.parse(JSON.stringify(first.snapshot()))));
  assert.equal(restored.batchSubmitted, false);
  restored.previousQuestion();
  assert.deepEqual(restored.selectedAnswer, ['B']);
  restored.submitBatch();
  const reviewed = new PracticeSessionCore(h);
  assert.ok(reviewed.restoreSnapshot(JSON.parse(JSON.stringify(restored.snapshot()))));
  assert.equal(reviewed.batchSubmitted, true);
  assert.equal(reviewed.answerResults.size, 2);
  assert.ok(reviewed.lastResult);
  assert.ok(reviewed.startNextBatchGroup());
  const nextGroup = new PracticeSessionCore(h);
  assert.ok(nextGroup.restoreSnapshot(JSON.parse(JSON.stringify(reviewed.snapshot()))));
  assert.equal(nextGroup.batchGroupStartIndex, 2);
  assert.equal(nextGroup.batchSubmitted, false);
}
{
  const h = new FakeHost(bank);
  const first = new PracticeSessionCore(h);
  first.start(bankPoolSources(bank, h.isSlashed), [QuestionType.BLANK, QuestionType.SHORT], false, 'instant_feedback', 10, null, null);
  first.updateBlankAnswer(1, 'y');
  first.nextQuestion();
  first.updateTextAnswer('未写完的简答');
  const restored = new PracticeSessionCore(h);
  assert.ok(restored.restoreSnapshot(JSON.parse(JSON.stringify(first.snapshot()))));
  assert.deepEqual(restored.selectedAnswer, ['未写完的简答']);
  restored.previousQuestion();
  assert.deepEqual(restored.selectedAnswer, ['', 'y']);
}
// 收藏夹的筛选列表就是练习范围。随机只影响新会话的题序。
{
  const favoritePage = readFileSync(new URL(`${base}/pages/FavoritePage.ets`, import.meta.url), 'utf8');
  const repository = readFileSync(new URL(`${base}/state/QuizRepository.ets`, import.meta.url), 'utf8');
  const filter = favoritePage.slice(favoritePage.indexOf('  private filtered('), favoritePage.indexOf('  private filterLabel('));
  const start = favoritePage.slice(favoritePage.indexOf('  private startPractice('), favoritePage.indexOf('  private isGroupExpanded('));
  const repoStart = repository.slice(repository.indexOf('  startFavoritePractice('), repository.indexOf('  findStudyRecord('));
  const sourceStart = repository.slice(repository.indexOf('  private startSourceEntryPractice('), repository.indexOf('  importWebBankJson('));
  const harness = stripTypeScriptTypes(`
    class FavoritePageHarness { ${filter} ${start} }
    class FavoriteRepositoryHarness { ${repoStart} ${sourceStart} }
  `);
  let opens = 0;
  const [FavoritePageHarness, FavoriteRepositoryHarness] = new Function(
    'PracticeQuestionSource', 'ALL_QUESTION_TYPES', 'PRACTICE_MODE_INSTANT', 'router',
    `${harness}; return [FavoritePageHarness, FavoriteRepositoryHarness];`
  )(PracticeQuestionSource, ALL_QUESTION_TYPES, PRACTICE_MODE_INSTANT, { pushUrl: () => { opens += 1; } });
  const h = new FakeHost(bank);
  const practice = new PracticeSessionCore(h);
  const repo = new FavoriteRepositoryHarness();
  repo.practice = practice;
  repo.settings = { resolvePreferredBatchGroupSize: () => 10 };
  repo.groupNameOfBank = (id) => id === bank.id ? '甲组' : '乙组';
  const entries = bank.questions.map((q) => new FavoriteQuestionEntry(bank.id, bank.name, q, FIXED_NOW));
  entries.push(new FavoriteQuestionEntry('b2', '另一个题库', bank.questions[0], FIXED_NOW));
  const favorite = new FavoritePageHarness();
  Object.assign(favorite, {
    repo, favorites: () => entries, groupNameOf: (entry) => repo.groupNameOfBank(entry.bankId),
    favBankFilter: null, favGroupFilter: null, questionType: '', randomize: false
  });
  assert.deepEqual(favorite.filtered(), entries, '全部题型保留填空和简答');
  favorite.favBankFilter = 'b2';
  favorite.questionType = QuestionType.SINGLE;
  assert.deepEqual(favorite.filtered(), [entries.at(-1)]);
  favorite.favBankFilter = null;
  favorite.favGroupFilter = '甲组';
  favorite.startPractice();
  assert.deepEqual(practice.questions.map(q => q.id), ['q1', 'q2', 'q3']);
  assert.equal(practice.sourceLabel, '收藏夹');
  favorite.randomize = true;
  const random = Math.random;
  try {
    Math.random = () => 0;
    favorite.startPractice();
  } finally {
    Math.random = random;
  }
  const restored = new PracticeSessionCore(h);
  assert.ok(restored.restoreSnapshot(JSON.parse(JSON.stringify(practice.snapshot()))));
  assert.deepEqual(restored.questions.map(q => q.id), ['q2', 'q3', 'q1']);
  favorite.questionType = QuestionType.JUDGE;
  favorite.startPractice();
  assert.equal(opens, 2, '无匹配题时不进入练习');
}

// AI @State 自行更新；禁止异步解析路径翻转整页 tick。
{
  const page = readFileSync(new URL(`${base}/pages/PracticePage.ets`, import.meta.url), 'utf8');
  const ai = page.slice(page.indexOf('  private runSingleQuestionAiAnalysis'), page.indexOf('  private sessionKey()'));
  assert.ok(!ai.includes('this.bump()'));
  assert.equal((ai.match(/requestGeneration !== this.aiRequestGeneration/g) ?? []).length, 6);
}
console.log('practice autosave + AI view regression: ALL PASS');

// 执行真实页面分析方法：等待、成功、失败与过期结果均不重建整页。
{
  const page = readFileSync(new URL(`${base}/pages/PracticePage.ets`, import.meta.url), 'utf8');
  const method = page.slice(page.indexOf('  private runSingleQuestionAiAnalysis'), page.indexOf('  private runFreeAsk'));
  let resolveRequest, rejectRequest, emitReasoning;
  const Client = { analyzeSingleQuestion: (_url, _key, _model, _question, _answer, onReasoning) => new Promise((resolve, reject) => {
    resolveRequest = resolve; rejectRequest = reject;
    emitReasoning = onReasoning;
  }) };
  const Harness = new Function('MisakaAiClient', 'aiDisplayQuestionWithAnswer', 'appendAiReasoningPreview',
    stripTypeScriptTypes(`class Harness { ${method} }`) + '; return Harness;')(Client,
      (q, options, answer) => ({ question: q, userAnswer: answer }), appendAiReasoningPreview);
  const view = new Harness();
  view.repo = { isAiConfigured: () => true, settings: {} };
  view.session = { currentQuestion: () => bank.questions[0], lastResult: null, selectedAnswer: ['A'] };
  view.currentDisplayOptions = () => [];
  view.sessionKey = () => 'q1';
  view.aiRequestGeneration = 1;
  view.bump = () => { throw new Error('AI must not rebuild page'); };
  view.runSingleQuestionAiAnalysis();
  assert.equal(view.aiQuestionLoading, true);
  emitReasoning('先核对题干\n正在比对选项');
  assert.equal(view.aiQuestionReasoning, '正在比对选项');
  resolveRequest({ analysis: '已完成' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(view.aiQuestionAnalysis.analysis, '已完成');
  assert.equal(view.aiQuestionLoading, false);
  assert.equal(view.aiQuestionReasoning, '');
  view.runSingleQuestionAiAnalysis();
  emitReasoning('正在思考');
  rejectRequest(new Error('network test'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(view.aiQuestionError, 'network test');
  assert.equal(view.aiQuestionReasoning, '');
  view.runSingleQuestionAiAnalysis();
  view.aiRequestGeneration++;
  view.aiQuestionAnalysis = null;
  emitReasoning('旧思考内容');
  assert.equal(view.aiQuestionReasoning, '');
  resolveRequest({ analysis: '旧请求' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(view.aiQuestionAnalysis, null);
}
console.log('AI asynchronous view state: ALL PASS');

// 执行页面实际展示方法：先映射当前字母，再按字母排序。
{
  const methods = pageSource.slice(pageSource.indexOf('  private reciteAnswerText('), pageSource.indexOf('  private nextButtonLabel('));
  const DisplayHarness = new Function('QuestionType', 'practiceAnswersForDisplay', 'hasStructuredAnswers',
    stripTypeScriptTypes(`class Harness { ${methods} }`) + '; return Harness;')(
      QuestionType, practiceAnswersForDisplay, q => q.blankAnswers.length > 0);
  for (const type of [QuestionType.SINGLE, QuestionType.MULTIPLE]) {
    const q = single('display', type === QuestionType.SINGLE ? ['C'] : ['E', 'B', 'D'],
      'ABCDE'.split('').map(key => new Option(key, `内容-${key}`)));
    q.type = type;
    const original = JSON.stringify(q);
    const userAnswer = q.answer.slice().reverse();
    for (let seed = 0; seed < 30; seed++) {
      for (const shuffled of [false, true]) {
        const options = practiceDisplayOptions(q, shuffled, seed, 'display');
        const view = new DisplayHarness();
        view.session = { lastResult: evaluateQuestion(q, userAnswer) };
        const expected = options.filter(option => q.answer.includes(option.originalKey)).map(option => option.displayKey);
        assert.equal(view.resultAnswerText(q, options), expected.join(' / '));
        assert.equal(view.resultUserAnswerText(q, options), `你的答案：${expected.join('、')}`);
        assert.equal(view.session.lastResult.correct, true);
        assert.deepEqual(view.session.lastResult.userAnswer, userAnswer);
        const wrongOption = options.find(option => !q.answer.includes(option.originalKey));
        view.session.lastResult = evaluateQuestion(q, [wrongOption.originalKey]);
        assert.equal(view.session.lastResult.correct, false);
        assert.equal(view.resultAnswerText(q, options), expected.join(' / '));
        assert.equal(view.resultUserAnswerText(q, options), `你的答案：${wrongOption.displayKey}`);
        view.session.lastResult = null;
        assert.equal(view.resultAnswerText(q, options), expected.join(' / '), '背题使用同一映射');
        assert.equal(view.resultUserAnswerText(q, options), '未作答');
        assert.equal(JSON.stringify(q), original);
      }
    }
  }
  const manyOptions = Array.from({ length: 28 }, (_, index) => new Option(practiceDisplayKey(index), `选项${index + 1}`));
  const longQuestion = single('display-many', ['28', 'Z', '27'], manyOptions);
  longQuestion.type = QuestionType.MULTIPLE;
  assert.deepEqual(practiceAnswersForDisplay(longQuestion.answer, practiceDisplayOptions(longQuestion, false, 0, 'display')),
    ['Z', '27', '28']);

  const q = multiBlank('display-blank', [['B'], ['A', '甲']]);
  const view = new DisplayHarness();
  view.session = { lastResult: evaluateQuestion(q, ['B', 'A']) };
  assert.equal(view.resultAnswerText(q, []), view.session.lastResult.answerText);
  assert.equal(view.resultUserAnswerText(q, []), '你的答案：B、A');
  assert.ok(!pageSource.includes("AnswerResultBlock({ correct: true"), '解析和背题不能伪造答对状态');
  console.log('乱序结果展示：单选、多选、背题、填空、原始数据不变通过');
}
