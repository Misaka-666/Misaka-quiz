// M4：练习/考试会话核心移植自检（判分、顺序进度、批量、斩题收藏、考试交卷）
// 运行：node --import ./test/harmony-parser-regression/ts-node.mjs test/harmony-parser-regression/session-core.mjs
import assert from 'node:assert/strict';

const base = '../../apps/harmony/entry/src/main/ets';
const { Question, QuestionType, Option, QuizBank } = await import(new URL(`${base}/domain/Models.ts`, import.meta.url));
const { evaluateQuestion, normalizeBlankAnswer, isAutoScoredQuestionType } = await import(new URL(`${base}/state/AnswerJudge.ts`, import.meta.url));
const { JavaRandom, javaStringHashCode, practiceDisplayOptions } = await import(new URL(`${base}/state/OptionShuffle.ts`, import.meta.url));
const {
  PracticeSessionCore, PracticeHost, bankPoolSources,
  PRACTICE_MODE_BATCH, SEQUENTIAL_START_LAST, resolveSequentialStartIndex
} = await import(new URL(`${base}/state/PracticeSessionCore.ts`, import.meta.url));
const { ExamSessionCore, defaultExamTypeScores } = await import(new URL(`${base}/state/ExamSessionCore.ts`, import.meta.url));
const { applyWrongAnswer, applyWrongRight } = await import(new URL(`${base}/state/WrongBookOps.ts`, import.meta.url));

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

// ---------- 选项打乱 ----------
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

// 第 3 题单选答对
session.nextQuestion();
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

console.log('session-core self-check: ALL PASS');
