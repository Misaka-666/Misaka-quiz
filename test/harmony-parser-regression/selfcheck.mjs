// M0 spike③：Node 侧运行与 Android ParserUtils.kt 行为对齐的自检
// 运行：node test/harmony-parser-regression/selfcheck.mjs
import assert from 'node:assert/strict';

const tsPath = new URL('../../apps/harmony/entry/src/main/ets/importer/parser/ParserUtils.ts', import.meta.url);
const mod = await import(tsPath);

const { normalizeQuestionIndex, chineseNumberToInt, isJudgeOptionPair, shouldInferJudgeFromBinaryOptions } = mod;

assert.equal(normalizeQuestionIndex('  42 '), '42');
assert.equal(normalizeQuestionIndex('一百二十三'), '123');
assert.equal(normalizeQuestionIndex('十'), '10');
assert.equal(normalizeQuestionIndex('十五'), '15');
// Android 行为对齐：'两百零五'尾段'零五'只取首字（零→0），因此结果是 200 而非 205
assert.equal(normalizeQuestionIndex('两百零五'), '200');
assert.equal(normalizeQuestionIndex('abc'), '');

assert.equal(chineseNumberToInt(''), null);
assert.equal(chineseNumberToInt('九'), 9);
assert.equal(chineseNumberToInt('百'), 100);

assert.equal(isJudgeOptionPair(['a', 'b'], ['正确', '错误']), true);
assert.equal(isJudgeOptionPair(['A', 'B'], ['正确', '可能']), false);
assert.equal(isJudgeOptionPair(['A', 'B', 'C'], ['正确', '错误', '其他']), false);

assert.equal(shouldInferJudgeFromBinaryOptions('判断下列说法是否正确'), true);
assert.equal(shouldInferJudgeFromBinaryOptions('下列哪项正确'), false);
assert.equal(shouldInferJudgeFromBinaryOptions('地球是圆的', '正确'), true);

console.log('SELFCHECK_PASS ParserUtils.ts (node)');
