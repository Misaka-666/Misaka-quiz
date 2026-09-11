// M1：领域模型序列化往返与 Android backup.json 字段规则对齐测试
// 运行：node test/harmony-parser-regression/models-roundtrip.mjs
import assert from 'node:assert/strict';

const mod = await import(new URL('../../apps/harmony/entry/src/main/ets/domain/Models.ts', import.meta.url));
const {
  Question, QuestionType, QuizBank, WrongQuestionEntry, WrongStatus, StudyRecord, StudyQuestionResult,
  QuestionImage, Option,
  questionToJson, parseQuestion, bankToJson, parseBank,
  wrongEntryToJson, parseWrongEntry, studyRecordToJson, parseStudyRecord,
  normalizeBankGroupName, parseQuestionType
} = mod;

// 1. 全字段 Question：序列化 → 解析 → 再序列化 幂等
const q = new Question('q1', QuestionType.MULTIPLE, '下列哪些正确？');
q.number = '3';
q.options = [new Option('A', '选项一'), new Option('B', '选项二')];
q.answer = ['A', 'B'];
q.blankAnswers = [['x'], ['y', 'z']];
q.analysis = '解析文本';
q.category = '第一章';
q.images = [new QuestionImage('img1', '/data/img1.png', 'pic.png', 1, 100, 200, 1234)];
q.score = 2.5;
q.subject = '语文';
q.difficulty = 'hard';
q.knowledgePoints = ['kp1', 'kp2'];
q.warnings = ['w1'];
q.reviewStatus = 'pending';
q.aiConfidence = 0.87;

const j1 = questionToJson(q);
assert.equal(j1.score, 2.5);
assert.equal(j1.blankAnswers.length, 2);
assert.equal(j1.subject, '语文');
const back1 = parseQuestion(j1);
assert.equal(back1.type, QuestionType.MULTIPLE);
assert.deepEqual(back1.answer, ['A', 'B']);
assert.deepEqual(back1.blankAnswers, [['x'], ['y', 'z']]);
assert.deepEqual(back1.knowledgePoints, ['kp1', 'kp2']);
assert.deepEqual(JSON.stringify(questionToJson(back1)), JSON.stringify(j1), 'roundtrip 不幂等');

// 2. 空可选字段：键必须省略（对齐 org.json put(null) 删键语义）
const q2 = new Question('q2', QuestionType.SINGLE, '最简题目');
const j2 = questionToJson(q2);
assert.equal('score' in j2, false, 'score 应省略');
assert.equal('blankAnswers' in j2, false, 'blankAnswers 应省略');
assert.equal('subject' in j2, false, 'subject 应省略');
assert.equal('reviewStatus' in j2, false, 'approved 默认值应省略');
assert.equal('warnings' in j2, false);
assert.equal(j2.images.length, 0);

// 3. Web 风格输入归一化
const webJson = {
  type: 'single_choice',
  question: '题干',
  options: { 'A': '对', 'B': '错' },
  answer: 'A B C',
  group: '法规篇',
  images: [{ src: '/x.png', name: 'y.png' }]
};
const w = parseQuestion(webJson);
assert.equal(w.type, QuestionType.SINGLE);
assert.deepEqual(w.options.map(o => o.key), ['A', 'B']);
assert.deepEqual(w.answer, ['A', 'B', 'C'], '字符串答案按分隔符拆分');
assert.equal(w.category, '法规篇', 'group 字段回落到 category');
assert.equal(w.images.length, 1);
assert.equal(w.images[0].localPath, '/x.png');
assert.equal(w.images[0].sourceName, 'y.png');
assert.equal(w.images[0].order, 1);
assert.equal(w.images[0].width, null);

// 4. 题型别名
assert.equal(parseQuestionType('TRUE_FALSE'), QuestionType.JUDGE);
assert.equal(parseQuestionType('fill-blank'), QuestionType.BLANK);
assert.equal(parseQuestionType(''), QuestionType.SINGLE);
assert.equal(parseQuestionType('未知'), QuestionType.SINGLE);

// 5. Bank 往返 + 分组规范化
const bank = new QuizBank('b1', '题库1', '');
assert.equal(normalizeBankGroupName(bank.groupName), '未分组');
bank.questions.push(q);
const bj = bankToJson(bank);
assert.equal(bj.groupName, '未分组');
const bankBack = parseBank(bj);
assert.equal(bankBack.questions.length, 1);
assert.equal(bankBack.questions[0].id, 'q1');

// 6. 错题条目：已掌握状态的回退计数（仅对缺键的旧数据生效，round-trip 保持原值）
const entry = new WrongQuestionEntry('b1', '题库1', q, ['B'], 'practice', 1700000000000);
entry.status = '已掌握';
const ej = wrongEntryToJson(entry);
assert.equal(ej.status, '已掌握');
assert.equal(ej.reviewRightCount, 0, 'round-trip 保留实际值 0');
const eBack = parseWrongEntry(ej);
assert.equal(eBack.reviewRightCount, 0);
assert.equal('lastCorrectAt' in ej, false, 'null 时间戳键省略');

// 6b. 旧数据（缺 reviewRightCount/streakCorrectCount/reviewLevel 键）+ 已掌握 → 回退 2
const legacyEntryJson = {
  bankId: 'b1', bankName: '题库1', source: 'practice', timestamp: 1700000000000,
  lastAnswer: ['B'], wrongCount: 1, status: '已掌握',
  question: questionToJson(q)
};
const legacyBack = parseWrongEntry(legacyEntryJson);
assert.equal(legacyBack.reviewRightCount, 2, '旧数据已掌握缺省 reviewRightCount=2');
assert.equal(legacyBack.streakCorrectCount, 2);
assert.equal(legacyBack.reviewLevel, 2);

// 7. 学习记录：null 省略 + startedAt 回退计算
const rec = new StudyRecord('r1', '题库1', 'practice', '练习', 10, 8, 1700000000000);
rec.durationSeconds = 120;
rec.questionResults.push(new StudyQuestionResult(q, ['A', 'B'], true, 'AB'));
const rj = studyRecordToJson(rec);
assert.equal('startedAt' in rj, false);
assert.equal('bankId' in rj, false);
assert.equal('scopeType' in rj, false);
assert.equal(rj.questionResults[0].userBlankAnswers.length, 0, '结构化多空时序列化保留空数组键');
const rBack = parseStudyRecord(rj);
assert.equal(rBack.startedAt, 1700000000000 - 120 * 1000, 'startedAt = timestamp - duration*1000');
assert.equal(rBack.durationSeconds, 120);
assert.equal(rBack.questionResults[0].correct, true);
assert.deepEqual(rBack.questionResults[0].userBlankAnswers, ['A', 'B'], '解析时空多空答案回落 userAnswer');

console.log('MODELS_ROUNDTRIP_PASS');
