// M5：题目搜索 + 错题作用域/到期/手动掌握 自检
// 运行：node --import ./test/harmony-parser-regression/ts-node.mjs test/harmony-parser-regression/study-ops.mjs
import assert from 'node:assert/strict';

const base = '../../apps/harmony/entry/src/main/ets';
const { Question, QuestionType, Option, QuizBank, WrongQuestionEntry, WrongStatus, DEFAULT_BANK_GROUP_NAME } =
  await import(new URL(`${base}/domain/Models.ts`, import.meta.url));
const { searchQuestions, resolveSearchScope, SEARCH_SCOPE_ACTIVE, SEARCH_SCOPE_ALL } =
  await import(new URL(`${base}/state/QuestionSearch.ts`, import.meta.url));
const {
  filterWrongEntriesByScope, filterWrongEntries, wrongBookScopeLabel, isWrongEntryDueForSmartReview,
  sortTodaySmartReviewEntries, sortWrongEntries, applyManualMastered,
  WRONG_BOOK_SCOPE_CURRENT_BANK, WRONG_BOOK_SCOPE_ALL_BANKS, WRONG_BOOK_SCOPE_GROUP, WRONG_BOOK_SCOPE_BANK,
  WRONG_FILTER_ALL, WRONG_FILTER_MASTERED, WRONG_FILTER_NOT_MASTERED,
  WRONG_SORT_RECENT, WRONG_SORT_COUNT, WRONG_SORT_MASTERY, WRONG_SORT_RANDOM
} = await import(new URL(`${base}/state/WrongBookOps.ts`, import.meta.url));

// ---------- 造题 ----------
function q(id, stem, options, answer, analysis) {
  const question = new Question(id, QuestionType.SINGLE, stem);
  question.options = options ?? [new Option('A', '甲'), new Option('B', '乙')];
  question.answer = answer ?? ['A'];
  question.analysis = analysis ?? '';
  return question;
}
const bank1 = new QuizBank('b1', 'C1 题库', '默认组');
bank1.questions = [
  q('q1', '以下哪个是箭头函数', [new Option('A', '=>'), new Option('B', '+=')], ['A'], '箭头函数即 lambda'),
  q('q2', 'TCP 三次握手', [new Option('A', 'syn'), new Option('B', 'ack')], ['B'], '')
];
const bank2 = new QuizBank('b2', 'C2 题库', '分组X');
bank2.questions = [q('q1', '同 ID 题干：箭头', undefined, ['B'], '跨库同 ID 不串')];
const banks = [bank1, bank2];

// ---------- 搜索：字段命中 / AND / 标点归一 / 空关键字 ----------
let rs = searchQuestions(banks, 'b1', '箭头', SEARCH_SCOPE_ACTIVE);
assert.equal(rs.length, 1, '当前库命中题干');
assert.equal(rs[0].bankId, 'b1');
assert.equal(rs[0].matchedFields.includes('题干'), true, '命中字段含题干');
assert.equal(rs[0].questionIndex, 1, '题号从 1 计');

rs = searchQuestions(banks, 'b1', 'syn', SEARCH_SCOPE_ACTIVE);
assert.equal(rs.length, 1, '选项命中');
assert.equal(rs[0].matchedFields.includes('选项'), true);

rs = searchQuestions(banks, 'b1', 'lambda', SEARCH_SCOPE_ACTIVE);
assert.equal(rs.length, 1, '解析命中');
assert.equal(rs[0].matchedFields.includes('解析'), true);

rs = searchQuestions(banks, 'b1', '箭头 函数', SEARCH_SCOPE_ACTIVE);
assert.equal(rs.length, 1, '多关键词 AND：题干同时含两词');

rs = searchQuestions(banks, 'b1', '箭头 不存在的词', SEARCH_SCOPE_ACTIVE);
assert.equal(rs.length, 0, '多关键词 AND：一词未命中即排除');

rs = searchQuestions(banks, 'b1', '', SEARCH_SCOPE_ACTIVE);
assert.equal(rs.length, 0, '空关键字返回空');

rs = searchQuestions(banks, 'b1', '   ', SEARCH_SCOPE_ACTIVE);
assert.equal(rs.length, 0, '空白关键字返回空');

// 全角标点归一：题干全角逗号、查询半角逗号
const punct = new QuizBank('b3', '标点库', DEFAULT_BANK_GROUP_NAME);
punct.questions = [q('p1', '关系模型中，实体之间的联系', undefined, ['A'])];
rs = searchQuestions([punct], 'b3', '模型中,实体', SEARCH_SCOPE_ACTIVE);
assert.equal(rs.length, 1, '全角/半角标点归一后命中');

// 大小写归一
rs = searchQuestions(banks, 'b1', 'LAMBDA', SEARCH_SCOPE_ACTIVE);
assert.equal(rs.length, 1, '大小写归一');

// ---------- 搜索：范围 ----------
rs = searchQuestions(banks, 'b1', '箭头', SEARCH_SCOPE_ALL);
assert.equal(rs.length, 2, '全部题库跨库命中');
assert.equal(rs[1].bankId, 'b2', '跨库同 ID 各自成条');
assert.equal(rs[1].groupName, '分组X', '分组名随库');

rs = searchQuestions(banks, 'b1', '箭头', 'bank:b2');
assert.equal(rs.length, 1, '指定题库范围');
assert.equal(rs[0].bankName, 'C2 题库');

assert.equal(resolveSearchScope(SEARCH_SCOPE_ACTIVE, null), SEARCH_SCOPE_ALL, '无当前库 active 回退 all');

// ---------- 错题作用域过滤 ----------
function wrong(bankId, qid, status) {
  const bank = banks.find((b) => b.id === bankId);
  const entry = new WrongQuestionEntry(bankId, bank ? bank.name : '已删库', q(qid, `错-${qid}`), ['B'], '练习', 1000);
  entry.status = status ?? WrongStatus.NOT_MASTERED;
  return entry;
}
const wAll = [
  wrong('b1', 'q1'), wrong('b1', 'q2'), wrong('b2', 'q1', WrongStatus.MASTERED)
];
assert.equal(filterWrongEntriesByScope(wAll, banks, 'b1', WRONG_BOOK_SCOPE_CURRENT_BANK, '', '').length, 2, '当前题库=2');
assert.equal(filterWrongEntriesByScope(wAll, banks, null, WRONG_BOOK_SCOPE_CURRENT_BANK, '', '').length, 0, '无当前库为空');
assert.equal(filterWrongEntriesByScope(wAll, banks, 'b1', WRONG_BOOK_SCOPE_ALL_BANKS, '', '').length, 3, '全部=3');
assert.equal(filterWrongEntriesByScope(wAll, banks, 'b1', WRONG_BOOK_SCOPE_GROUP, '分组X', '').length, 1, '分组X=1');
assert.equal(filterWrongEntriesByScope(wAll, banks, 'b1', WRONG_BOOK_SCOPE_GROUP, '', '').length, 3, '空分组名回退全部');
assert.equal(filterWrongEntriesByScope(wAll, banks, 'b1', WRONG_BOOK_SCOPE_GROUP, DEFAULT_BANK_GROUP_NAME, '').length, 3, '未分组回退全部');
assert.equal(filterWrongEntriesByScope(wAll, banks, 'b1', WRONG_BOOK_SCOPE_BANK, '', 'b2').length, 1, '指定题库=1');
assert.equal(filterWrongEntriesByScope(wAll, banks, 'b1', WRONG_BOOK_SCOPE_BANK, '', '').length, 3, '空库 id 回退全部');

assert.equal(wrongBookScopeLabel(banks, 'C1 题库', WRONG_BOOK_SCOPE_CURRENT_BANK, '', ''), '当前题库');
assert.equal(wrongBookScopeLabel(banks, 'C1 题库', WRONG_BOOK_SCOPE_ALL_BANKS, '', ''), '全部题库');
assert.equal(wrongBookScopeLabel(banks, 'C1 题库', WRONG_BOOK_SCOPE_GROUP, '分组X', ''), '分组X');
assert.equal(wrongBookScopeLabel(banks, 'C1 题库', WRONG_BOOK_SCOPE_GROUP, '', ''), '分组');
assert.equal(wrongBookScopeLabel(banks, 'C1 题库', WRONG_BOOK_SCOPE_BANK, '', 'b2'), 'C2 题库');
assert.equal(wrongBookScopeLabel(banks, 'C1 题库', WRONG_BOOK_SCOPE_BANK, '', 'gone'), '题库');

// ---------- 题型与范围、掌握状态叠加 ----------
const typedEntries = [
  [QuestionType.SINGLE, 'b1', WrongStatus.NOT_MASTERED],
  [QuestionType.MULTIPLE, 'b1', WrongStatus.REVIEWING],
  [QuestionType.MULTIPLE, 'b2', WrongStatus.NOT_MASTERED],
  [QuestionType.MULTIPLE, 'b1', WrongStatus.MASTERED],
  [QuestionType.JUDGE, 'b1', WrongStatus.NOT_MASTERED],
  [QuestionType.BLANK, 'b1', WrongStatus.NOT_MASTERED],
  [QuestionType.SHORT, 'b2', WrongStatus.NOT_MASTERED]
].map(([type, bankId, status], i) => {
  const entry = wrong(bankId, `type-${i}`, status);
  entry.question.type = type;
  return entry;
});
const scoped = filterWrongEntriesByScope(typedEntries, banks, 'b1', WRONG_BOOK_SCOPE_CURRENT_BANK, '', '');
assert.deepEqual(filterWrongEntries(scoped, WRONG_FILTER_NOT_MASTERED, QuestionType.SINGLE), [typedEntries[0]]);
assert.deepEqual(filterWrongEntries(scoped, WRONG_FILTER_NOT_MASTERED, QuestionType.MULTIPLE), [typedEntries[1]]);
assert.deepEqual(filterWrongEntries(scoped, WRONG_FILTER_MASTERED, QuestionType.MULTIPLE), [typedEntries[3]]);
assert.deepEqual(filterWrongEntries(scoped, WRONG_FILTER_ALL, QuestionType.MULTIPLE), [typedEntries[1], typedEntries[3]]);
assert.deepEqual(filterWrongEntries(scoped, WRONG_FILTER_ALL, QuestionType.JUDGE), [typedEntries[4]]);
assert.deepEqual(filterWrongEntries(scoped, WRONG_FILTER_MASTERED, QuestionType.JUDGE), []);
assert.deepEqual(filterWrongEntries(typedEntries, WRONG_FILTER_ALL, ''), typedEntries, '全部题型保留填空和简答');

// ---------- 到期判定（注入固定时间） ----------
const NOW = new Date(2026, 8, 18, 12, 0, 0).getTime(); // 2026-09-18 正午
const dayMs = 24 * 60 * 60 * 1000;
const dueNone = wrong('b1', 'q1'); // nextReviewAt=null 未掌握 → 到期
dueNone.nextReviewAt = null;
assert.equal(isWrongEntryDueForSmartReview(dueNone, NOW), true, '无排期未掌握=当日到期');
const dueMastered = wrong('b1', 'q2', WrongStatus.MASTERED);
dueMastered.nextReviewAt = null;
assert.equal(isWrongEntryDueForSmartReview(dueMastered, NOW), false, '无排期已掌握=不到期');
const future = wrong('b1', 'q1');
future.nextReviewAt = NOW + dayMs;
assert.equal(isWrongEntryDueForSmartReview(future, NOW), false, '明天到期=未到期');
const past = wrong('b1', 'q1');
past.nextReviewAt = NOW - 1;
assert.equal(isWrongEntryDueForSmartReview(past, NOW), true, '已过排期=到期');

// ---------- 今日复习排序：未掌握在前 → nextReviewAt 升序 → wrongCount 降序 ----------
const a = wrong('b1', 'q1'); a.nextReviewAt = NOW + dayMs; a.wrongCount = 9;
const b = wrong('b1', 'q2'); b.nextReviewAt = NOW - dayMs; b.wrongCount = 1;
const c = wrong('b2', 'q1', WrongStatus.MASTERED); c.nextReviewAt = NOW - 2 * dayMs; c.wrongCount = 5;
const sortedToday = sortTodaySmartReviewEntries([a, c, b]);
assert.deepEqual(sortedToday.map((e) => e.bankId), ['b1', 'b1', 'b2'], '未掌握在前、已掌握垫底');
assert.equal(sortedToday[0].bankId, 'b1');
assert.equal(sortedToday[0].nextReviewAt, NOW - dayMs, 'nextReviewAt 早者在前');
assert.equal(sortedToday[2].status, WrongStatus.MASTERED, '已掌握垫底');

// ---------- 列表排序 ----------
const r1 = wrong('b1', 'q1'); r1.lastWrongAt = 10; r1.wrongCount = 1;
const r2 = wrong('b1', 'q2'); r2.lastWrongAt = 20; r2.wrongCount = 3;
const r3 = wrong('b2', 'q1', WrongStatus.MASTERED); r3.lastWrongAt = 30; r3.wrongCount = 2;
assert.deepEqual(sortWrongEntries([r1, r2, r3], WRONG_SORT_RECENT).map((e) => e.lastWrongAt), [30, 20, 10], '最近错=lastWrongAt 降序');
assert.deepEqual(sortWrongEntries([r1, r2, r3], WRONG_SORT_COUNT).map((e) => e.wrongCount), [3, 2, 1], '错误次数降序（已掌握 2 次在 1 前）');
assert.equal(sortWrongEntries([r1, r2, r3], WRONG_SORT_MASTERY)[2].status, WrongStatus.MASTERED, '掌握程度：已掌握垫底');
assert.deepEqual(sortWrongEntries([r1, r3], WRONG_SORT_MASTERY).map((e) => e.wrongCount), [1, 2], '未掌握段恒在已掌握段前');
assert.deepEqual(sortWrongEntries([r1, r2, r3], WRONG_SORT_RANDOM), [r3, r2, r1], '随机模式的列表保持最近错顺序');

// ---------- 手动掌握 / 取消（注入固定时间） ----------
const book = [wrong('b1', 'q1')];
book[0].reviewLevel = 0;
book[0].streakCorrectCount = 0;
assert.equal(applyManualMastered(book, 'b1', 'q1', true, NOW), true);
const m = book[0];
assert.equal(m.status, WrongStatus.MASTERED);
assert.equal(m.reviewLevel, 2, '手动掌握 level 至少 2');
assert.equal(m.streakCorrectCount, 2);
const startOfToday = new Date(2026, 8, 18, 0, 0, 0).getTime();
assert.equal(m.nextReviewAt, startOfToday + 3 * dayMs, 'level2 → 3 天后排期');
assert.equal(m.lastCorrectAt, NOW);
assert.equal(m.lastReviewedAt, NOW);

assert.equal(applyManualMastered(book, 'b1', 'q1', false, NOW), true);
const u = book[0];
assert.equal(u.status, WrongStatus.NOT_MASTERED);
assert.equal(u.reviewLevel, 0);
assert.equal(u.streakCorrectCount, 0);
assert.equal(u.nextReviewAt, startOfToday, '取消掌握 → 当日零点');

assert.equal(applyManualMastered(book, 'b1', '不存在', true, NOW), false, '条目不存在无变更');

console.log('study-ops ALL PASS');
