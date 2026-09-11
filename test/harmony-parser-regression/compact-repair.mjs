// M2：QuestionImageMarker + CompactQuestionRepair 移植行为自检
// 运行：node --import ./test/harmony-parser-regression/ts-node.mjs test/harmony-parser-regression/compact-repair.mjs
import assert from 'node:assert/strict';

const img = await import(new URL('../../apps/harmony/entry/src/main/ets/importer/assets/QuestionImageMarker.ts', import.meta.url));
const { canonicalMarker, markerId, containsMarker, markerRangesIn, markerIdsIn, removeAllMarkers, canonicalizeMarkers } = img;
const repairMod = await import(new URL('../../apps/harmony/entry/src/main/ets/importer/parser/CompactQuestionRepair.ts', import.meta.url));
const { hasCompactPattern, hasCompactOptionSequence, compactOptionKeys, isStandardOptionLine, repair } = repairMod;

// QuestionImageMarker
assert.equal(canonicalMarker(' img_0001 '), '[[MISAKA_IMAGE:img_0001]]');
assert.equal(markerId('[ MISAKA_IMAGE : img_0012 ]'), 'img_0012');
assert.equal(markerId('【MISAKA_IMAGE:img_0034】'), 'img_0034');
assert.equal(markerId('plain text'), null);
assert.ok(containsMarker('x [MISAKA_IMAGE:img_0001] y'));
assert.deepEqual(markerRangesIn('a[[MISAKA_IMAGE:img_0002]]b'), [[1, 25]]);
assert.deepEqual(markerIdsIn('[[MISAKA_IMAGE:img_0001]] 和 [MISAKA_IMAGE:img_0001]'), ['img_0001']);
assert.equal(removeAllMarkers('看图 [[MISAKA_IMAGE:img_0001]] 回答'), '看图 回答');
assert.equal(canonicalizeMarkers('【MISAKA_IMAGE:img_0007】'), '[[MISAKA_IMAGE:img_0007]]');

// CompactQuestionRepair
assert.ok(hasCompactOptionSequence('下列哪个正确？A.第一个 B.第二个 C.第三个'));
assert.ok(!hasCompactOptionSequence('例如 E.U 和 U.S 的写法'));
assert.ok(!hasCompactOptionSequence('使用 e.g. 举例说明'));
assert.ok(hasCompactPattern('1.题目内容 答案：A'));
assert.deepEqual(compactOptionKeys('A.x B.y C.z'), ['A', 'B', 'C']);
assert.ok(isStandardOptionLine('A. 选项内容'));
assert.ok(!isStandardOptionLine('参考 E.U 文档'));
assert.ok(hasCompactOptionSequence('A.甲B.乙C.丙'), '中文粘连选项组');
assert.ok(!hasCompactOptionSequence('A.oneB.twoC.three'), 'ASCII 粘连被代码守卫过滤（对齐 Android）');

const repaired = repair('1.下面哪个是对的？A.甲 B.乙 C.丙 答案：C 解析：丙正确');
assert.ok(repaired.includes('\n答案：C'));
assert.ok(repaired.includes('\n解析：丙正确'));
assert.ok(repaired.split('\n').some(l => l.trim().startsWith('A.')));
assert.equal(repair('1.题干内容A.甲B.乙C.丙'), '1.题干内容\nA.甲\nB.乙\nC.丙');
assert.ok(repair('题干 [[MISAKA_IMAGE:img_0001]] A.x B.y').includes('[[MISAKA_IMAGE:img_0001]]'), '图片标记在修复后保留');

console.log('COMPACT_REPAIR_PASS');
