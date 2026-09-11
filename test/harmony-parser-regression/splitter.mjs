// M2：QuestionBlockSplitter 移植行为自检
// 运行：node --import ./test/harmony-parser-regression/ts-node.mjs test/harmony-parser-regression/splitter.mjs
import assert from 'node:assert/strict';

const { splitQuestionBlocks } = await import(new URL('../../apps/harmony/entry/src/main/ets/importer/parser/QuestionBlockSplitter.ts', import.meta.url));

const t1 = splitQuestionBlocks('1.第一题题干\nA.甲\nB.乙\n答案：A\n2.第二题\nA.丙\nB.丁\n答案：B\n解析：略');
assert.equal(t1.length, 2);
assert.equal(t1[0].number, '1');
assert.equal(t1[1].number, '2');
assert.ok(t1[0].lines[0].includes('第一题'));
assert.equal(t1[1].lines[t1[1].lines.length - 1], '解析：略');

const t2 = splitQuestionBlocks('一、单选题\n1.题干一\nA.x\nB.y\n答案：A\n二、多选题\n2.题干二\n答案：AB');
assert.equal(t2.length, 2);
assert.equal(t2[0].category, '一、单选题');
assert.equal(t2[1].category, '二、多选题');

const t3 = splitQuestionBlocks('1.题目\nA.甲\nB.乙\n答案：A\n参考答案\n1.A 2.B 3.C');
assert.equal(t3.length, 1, '全局答案区之后的行被跳过');

const t4 = splitQuestionBlocks('下列哪项正确？\nA.甲\nB.乙\n答案：A\n下列哪项错误？\nA.丙\nB.丁\n答案：B');
assert.equal(t4.length, 2);
assert.equal(t4[0].number, '1');
assert.equal(t4[1].number, '1-2', '父块相对合成编号（对齐 Android）');

const t5 = splitQuestionBlocks('1.【判断题】地球是圆的吗\n答案：对');
assert.equal(t5.length, 1);
assert.equal(t5[0].forcedType, 'JUDGE');
assert.equal(t5[0].lines[0], '地球是圆的吗');

const t6 = splitQuestionBlocks('绝密★启用前\n考试时间：120分钟\n1.真实题目\nA.甲\n答案：A');
assert.equal(t6.length, 1);
assert.ok(t6[0].lines[0].includes('真实题目'));

const t7 = splitQuestionBlocks('【12】括号题号题干\n答案：A\n第三题 中文题号\n答案：B');
assert.equal(t7.length, 2);
assert.equal(t7[0].number, '12');
assert.equal(t7[1].number, '3');

console.log('SPLITTER_PASS');
