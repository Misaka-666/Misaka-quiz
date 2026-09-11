// M2：MultiBlank + StandardQuestionParser + QuestionParser 移植行为自检
// 运行：node --import ./test/harmony-parser-regression/ts-node.mjs test/harmony-parser-regression/question-parser.mjs
import assert from 'node:assert/strict';

const { parseStandard, parseCompact, looksCompact, parseSectioned, looksSectioned } =
  await import(new URL('../../apps/harmony/entry/src/main/ets/importer/parser/QuestionParser.ts', import.meta.url));

const qs1 = parseStandard('1.下列哪项正确？\nA.第一项\nB.第二项\n答案：A\n解析：A正确');
assert.equal(qs1.length, 1);
assert.equal(qs1[0].type, 'SINGLE');
assert.ok(qs1[0].question.includes('下列哪项正确'));
assert.deepEqual(qs1[0].options.map(o => o.key), ['A', 'B']);
assert.deepEqual(qs1[0].answer, ['A']);
assert.equal(qs1[0].analysis, 'A正确');

const qs2 = parseStandard('1.多选题干\nA.x\nB.y\nC.z\n答案：ABC');
assert.equal(qs2[0].type, 'MULTIPLE');
assert.deepEqual(qs2[0].answer, ['A', 'B', 'C']);

const qs3 = parseStandard('1.地球是圆的。\n答案：对');
assert.equal(qs3[0].type, 'JUDGE');
assert.deepEqual(qs3[0].answer, ['A']);
assert.deepEqual(qs3[0].options.map(o => o.text), ['正确', '错误']);

const text4 = '一、单选题\n1.题干一\nA.甲\nB.乙\n答案：A\n二、判断题\n2.题干二\n答案：对';
assert.ok(looksSectioned(text4));
const qs4 = parseSectioned(text4);
assert.equal(qs4.length, 2);
assert.equal(qs4[0].category, '一、单选题');
assert.equal(qs4[1].type, 'JUDGE');
assert.equal(qs4[1].category, '二、判断题');

const compactText = '1.下列哪个对？A.甲 B.乙 C.丙 答案：C';
assert.ok(looksCompact(compactText));
const qs5 = parseCompact(compactText);
assert.equal(qs5.length, 1);
assert.equal(qs5[0].options.length, 3);
assert.deepEqual(qs5[0].answer, ['C']);

const qs6 = parseStandard('1.中国的首都是（北京），最大的经济城市是（上海）。\n答案：北京；上海');
assert.equal(qs6[0].type, 'BLANK');
assert.equal(qs6[0].blankAnswers.length, 2);
assert.ok(qs6[0].question.includes('（ ）'), qs6[0].question);

console.log('QUESTION_PARSER_PASS');
