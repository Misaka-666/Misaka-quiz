// M6：备份编解码自检 — 导出→导入语义一致 / web_backup（crossPlatform + 旧结构）/ id 修复 / 命名去重 / 边界
// 运行：node --import ./test/harmony-parser-regression/ts-node.mjs test/harmony-parser-regression/backup-roundtrip.mjs
import assert from 'node:assert/strict';

const base = '../../apps/harmony/entry/src/main/ets';
const { Question, QuestionType, Option, QuestionImage, QuizBank, WrongQuestionEntry,
  FavoriteQuestionEntry, StudyRecord, StudyQuestionResult, WrongStatus, DEFAULT_BANK_GROUP_NAME } =
  await import(new URL(`${base}/domain/Models.ts`, import.meta.url));
const { buildBackupJson, importBackupText, parseStandaloneJsonPreview, isWebBackupJson,
  uniqueImportedBankName, sanitizeImportQuestion, decodeBase64Bytes, parseBackupTimeMillis,
  BACKUP_KIND_FULL, BACKUP_KIND_SELECTED } =
  await import(new URL(`${base}/state/BackupCodec.ts`, import.meta.url));

const NOW = 1758900000000;
let uuidCounter = 0;
const randomId = () => `uuid-${++uuidCounter}`;
const emptyAssets = new Map();
const sinkNoop = (_name, _bytes) => null;
let sinkWrites = [];
const sinkFake = (name, bytes) => { sinkWrites.push({ name, bytes }); return `/fake_assets/${name}`; };

// ---------- 造数据 ----------
function q(id, stem, answer, extra) {
  const question = new Question(id, QuestionType.SINGLE, stem);
  question.options = [new Option('A', '甲'), new Option('B', '乙')];
  question.answer = answer ?? ['A'];
  if (extra) {
    Object.assign(question, extra);
  }
  return question;
}
const img1 = new QuestionImage('img-1', '/data/app/files/question_assets/import_1/a.png', 'a.png', 1, 100, 80, 1024);
const bank1 = new QuizBank('b1', 'C1 题库', '默认组');
bank1.questions = [
  q('q1', '以下哪个是箭头函数', ['A'], { analysis: 'lambda' }),
  q('q2', 'TCP 三次握手', ['B']),
  (() => { const iq = q('q3', '看图题（图片题）', ['A']); iq.images = [img1]; return iq; })()
];
const bank2 = new QuizBank('b2', 'C2 题库', '分组X');
bank2.questions = [q('q1', '同 ID 跨库题', ['B'])];

const wrong = new WrongQuestionEntry('b1', 'C1 题库', bank1.questions[0], ['B'], '练习', 1758800000000);
wrong.wrongCount = 3;
wrong.rightCount = 1;
wrong.streakCorrectCount = 1;
wrong.nextReviewAt = NOW + 86400000;
const fav = new FavoriteQuestionEntry('b2', 'C2 题库', bank2.questions[0], 1758850000000);
const rec = new StudyRecord('rec-1', 'C1 题库', '练习', '顺序练习', 2, 1, 1758860000000);
rec.bankId = 'b1';
rec.durationSeconds = 95;
const recResult = new StudyQuestionResult(bank1.questions[0], ['A'], true, 'A');
recResult.sourceBankId = 'b1';
recResult.sourceBankName = 'C1 题库';
rec.questionResults = [recResult];

// ---------- 导出：字段齐全 + 资产注册 + 键省略规则 ----------
const assetBytes = new Map([['assets/img-1.png', new Uint8Array([1, 2, 3, 4])]]);
const registerAsset = (image) => image.localPath === img1.localPath ? 'assets/img-1.png' : null;
const exportRoot = buildBackupJson(BACKUP_KIND_FULL, [bank1, bank2], 'b1', [wrong], [fav], [rec],
  true, true, true, registerAsset, NOW);
assert.equal(exportRoot['app'], 'Misaka Quiz');
assert.equal(exportRoot['kind'], 'misaka_quiz_full_backup');
assert.equal(exportRoot['version'], 3);
assert.equal(exportRoot['schemaVersion'], 3);
assert.equal(exportRoot['crossPlatformSchemaVersion'], 1);
assert.equal(exportRoot['exportedBy'], 'harmony');
assert.equal(exportRoot['activeBankId'], 'b1');
assert.equal(exportRoot['banks'].length, 2);
assert.equal(exportRoot['wrongBook'].length, 1);
assert.equal(exportRoot['favoriteQuestions'].length, 1);
assert.equal(exportRoot['studyRecords'].length, 1);
// 图片 localPath 在备份里改写为 zip 相对路径
const exportedImages = exportRoot['banks'][0]['questions'][2]['images'];
assert.equal(exportedImages[0]['localPath'], 'assets/img-1.png');
// null 字段省略（nextReviewAt 有值、lastCorrectAt 无值）
assert.equal('lastCorrectAt' in exportRoot['wrongBook'][0], false);
assert.equal(exportRoot['wrongBook'][0]['nextReviewAt'], NOW + 86400000);

// 选择性导出：不含错题/收藏/记录
const selectedRoot = buildBackupJson(BACKUP_KIND_SELECTED, [bank2], 'b2', [wrong], [fav], [rec],
  false, false, false, registerAsset, NOW);
assert.equal('wrongBook' in selectedRoot, false);
assert.equal('favoriteQuestions' in selectedRoot, false);
assert.equal('studyRecords' in selectedRoot, false);

// ---------- 往返：导出 JSON → 导入（zip 资产 sink 落地）→ 语义一致 ----------
sinkWrites = [];
const outcome = importBackupText(JSON.stringify(exportRoot), [], assetBytes, sinkFake, randomId, NOW + 1000);
assert.equal(outcome.ok, true, `导入应成功：${outcome.message}`);
assert.equal(outcome.banks.length, 2);
assert.equal(outcome.wrongBook.length, 1);
assert.equal(outcome.favorites.length, 1);
assert.equal(outcome.records.length, 1);
// id 重映射：bank id 变为 bank_<now>_<i>，错题/收藏/记录引用跟随
const nb1 = outcome.banks[0];
const nb2 = outcome.banks[1];
assert.match(nb1.id, /^bank_\d+_0$/);
assert.match(nb2.id, /^bank_\d+_1$/);
assert.equal(outcome.wrongBook[0].bankId, nb1.id);
assert.equal(outcome.wrongBook[0].bankName, 'C1 题库');
assert.equal(outcome.wrongBook[0].wrongCount, 3);
assert.equal(outcome.wrongBook[0].nextReviewAt, NOW + 86400000);
// 错题题目引用映射到新库中的题目对象（同 id）
assert.equal(outcome.wrongBook[0].question === nb1.questions[0], true, '错题题目应指向新库题目');
assert.equal(outcome.favorites[0].bankId, nb2.id);
assert.equal(outcome.records[0].bankId, nb1.id);
assert.equal(outcome.records[0].questionResults[0].sourceBankId, nb1.id);
// activeBankId 映射
assert.equal(outcome.activeBankId, nb1.id);
// zip 资产落地 + localPath 回写为 sink 返回路径
assert.equal(sinkWrites.some((w) => w.name === 'img-1.png'), true, 'zip 资产应写入');
assert.equal(nb1.questions[2].images[0].localPath, '/fake_assets/img-1.png');

// ---------- 重名去重：同名同组追加「 导入2」；跨组不去重 ----------
assert.equal(uniqueImportedBankName('C1 题库', '默认组', [bank1], new Set()), 'C1 题库 导入2');
assert.equal(uniqueImportedBankName('C2 题库', '默认组', [bank1], new Set()), 'C2 题库', '不同名不受影响');
assert.equal(uniqueImportedBankName('C1 题库', '分组X', [bank1], new Set()), 'C1 题库', '跨组不去重');
assert.equal(uniqueImportedBankName('', '默认组', [], new Set(['导入题库'])), '导入题库 导入2', '空名回退导入题库');

// 重复导入：同一备份导入两次 → 第二次全部改名追加
const again = importBackupText(JSON.stringify(exportRoot), outcome.banks, assetBytes, sinkFake, randomId, NOW + 2000);
assert.equal(again.ok, true);
assert.equal(again.banks[0].name, 'C1 题库 导入2');
assert.equal(again.banks.length, 2);

// ---------- 空白/重复 question id 修复 + 引用跟随 ----------
const legacyBank = new QuizBank('lb', '旧库', DEFAULT_BANK_GROUP_NAME);
const lq1 = q('', '旧题一（A）', ['A']);
const lq2 = q('', '旧题二', ['B']);
const lq3 = q('dup', '重复题干甲', ['A']);
const lq4 = q('dup', '重复题干乙', ['B']);
legacyBank.questions = [lq1, lq2, lq3, lq4];
const legacyRoot = buildBackupJson(BACKUP_KIND_FULL, [legacyBank], 'lb', [], [], [],
  true, true, true, null, NOW);
const legacyJson = JSON.stringify(legacyRoot);
// 引号内嵌答案剥离：题干尾部的（A）应被剥掉
const legacyOutcome = importBackupText(legacyJson, [], emptyAssets, sinkNoop, randomId, NOW + 3000);
assert.equal(legacyOutcome.ok, true);
const lbNew = legacyOutcome.banks[0];
assert.equal(lbNew.questions.length, 4);
assert.equal(lbNew.questions[0].question, '旧题一', `内嵌答案括号应剥离，实际：${lbNew.questions[0].question}`);
assert.equal(lbNew.questions[0].id.length > 0, true, '空白 id 应生成新 id');
const distinctIds = new Set(lbNew.questions.map((x) => x.id));
assert.equal(distinctIds.size, 4, '重复 id 应去重');
// 错题引用旧 id '' 时按指纹解析到修复后的题目
const legacyWrong = new WrongQuestionEntry('lb', '旧库', q('', '旧题一（A）', ['A']), ['B'], '练习', NOW);
const legacyWrongJson = JSON.stringify(buildBackupJson(BACKUP_KIND_FULL, [legacyBank], 'lb', [legacyWrong], [], [],
  true, true, true, null, NOW));
const legacyWrongOutcome = importBackupText(legacyWrongJson, [], emptyAssets, sinkNoop, randomId, NOW + 4000);
assert.equal(legacyWrongOutcome.wrongBook.length, 1);
assert.equal(legacyWrongOutcome.wrongBook[0].question === legacyWrongOutcome.banks[0].questions[0], true,
  '旧空白 id 错题按指纹解析到修复后的题目');

// ---------- web_backup：crossPlatform 原生结构 ----------
const webCrossBank = {
  id: 'wb1', name: 'Web 库', groupName: 'Web组', questions: [
    { id: 'wq1', type: 'SINGLE', question: 'Web 题目一', options: [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }], answer: ['A'] },
    { id: 'wq2', type: 'JUDGE', question: 'Web 判断题', options: [], answer: ['A'] }
  ]
};
const webCrossRoot = {
  app: 'Misaka Quiz', kind: 'misaka_quiz_web_full_backup', schemaVersion: 58,
  crossPlatformSchemaVersion: 1, banks: [webCrossBank], activeBankId: 'wb1',
  wrongBook: { wb1: [{ id: 'wq1', wrongCount: 2 }] },
  favorites: { wb1: ['wq2'] },
  records: [],
  crossPlatform: {
    schemaVersion: 1,
    wrongBook: [{
      bankId: 'wb1', bankName: 'Web 库', question: webCrossBank.questions[0], lastAnswer: ['B'],
      source: 'web-export', timestamp: NOW, wrongCount: 2, rightCount: 1, reviewRightCount: 0,
      streakCorrectCount: 0, lastWrongAt: NOW, status: '未掌握', reviewLevel: 0
    }],
    favoriteQuestions: [{
      bankId: 'wb1', bankName: 'Web 库', question: webCrossBank.questions[1], favoritedAt: NOW
    }],
    studyRecords: [{
      id: 'wrec-1', bankId: 'wb1', bankName: 'Web 库', source: 'web', title: '练习',
      total: 1, correct: 1, timestamp: NOW, durationSeconds: 30, questionResults: [{
        question: webCrossBank.questions[0], userAnswer: ['A'], correct: true, answerText: 'A',
        sourceBankId: 'wb1', sourceBankName: 'Web 库'
      }]
    }]
  }
};
assert.equal(isWebBackupJson(webCrossRoot), true, 'crossPlatform 即识别为 web 备份');
const webCrossOutcome = importBackupText(JSON.stringify(webCrossRoot), [], emptyAssets, sinkNoop, randomId, NOW + 5000);
assert.equal(webCrossOutcome.ok, true, `web crossPlatform 导入：${webCrossOutcome.message}`);
assert.equal(webCrossOutcome.banks.length, 1);
assert.equal(webCrossOutcome.wrongBook.length, 1, 'crossPlatform.wrongBook 生效');
assert.equal(webCrossOutcome.favorites.length, 1, 'crossPlatform.favoriteQuestions 生效');
assert.equal(webCrossOutcome.records.length, 1, 'crossPlatform.studyRecords 生效');
assert.equal(webCrossOutcome.wrongBook[0].bankId, webCrossOutcome.banks[0].id);
assert.equal(webCrossOutcome.wrongBook[0].wrongCount, 2);
assert.equal(webCrossOutcome.wrongBook[0].question === webCrossOutcome.banks[0].questions[0], true,
  'web 错题题目应指向新库题目');

// ---------- web_backup 旧结构（无 crossPlatform）----------
const webLegacyRoot = {
  app: 'Misaka Quiz', kind: 'misaka_quiz_web_full_backup', schemaVersion: 58,
  banks: [webCrossBank], activeBankId: 'wb1',
  wrongBook: { wb1: [{ id: 'wq1', wrongCount: 4, rightCount: 2, lastWrongAt: NOW, status: '未掌握' }] },
  favorites: { wb1: ['wq2'] },
  records: [{
    id: 'wrec-2', bankId: 'wb1', bankName: 'Web 库', mode: '考试', date: '2026-01-01T00:00:00.000Z',
    total: 2, duration: 120, score: 8, totalScore: 10,
    details: [
      { questionId: 'wq1', type: 'SINGLE', question: 'Web 题目一', answer: ['A'], chosen: ['A'], correct: true, score: 4, fullScore: 5 },
      { questionId: 'wq2', type: 'JUDGE', question: 'Web 判断题', answer: ['A'], chosen: ['B'], correct: false, score: 4, fullScore: 5 }
    ]
  }]
};
const webLegacyOutcome = importBackupText(JSON.stringify(webLegacyRoot), [], emptyAssets, sinkNoop, randomId, NOW + 6000);
assert.equal(webLegacyOutcome.ok, true, `web 旧结构导入：${webLegacyOutcome.message}`);
assert.equal(webLegacyOutcome.wrongBook.length, 1, '旧结构 wrongBook 映射');
assert.equal(webLegacyOutcome.wrongBook[0].wrongCount, 4);
assert.equal(webLegacyOutcome.wrongBook[0].source, 'web-backup');
assert.equal(webLegacyOutcome.favorites.length, 1, '旧结构 favorites 映射');
assert.equal(webLegacyOutcome.favorites[0].question === webLegacyOutcome.banks[0].questions[1], true);
assert.equal(webLegacyOutcome.records.length, 1, '旧结构 records 映射');
const wlRec = webLegacyOutcome.records[0];
assert.equal(wlRec.source, 'web');
assert.equal(wlRec.title, '考试');
assert.equal(wlRec.total, 2);
assert.equal(wlRec.correct, 1, 'correct 缺省时按 details 统计');
assert.equal(wlRec.durationSeconds, 120);
assert.equal(wlRec.earnedScore, 8);
assert.equal(wlRec.totalScore, 10);
assert.equal(wlRec.questionResults[0].question === webLegacyOutcome.banks[0].questions[0], true,
  '旧记录逐题按 questionId 解析回新库题目');
assert.equal(wlRec.questionResults[1].correct, false);
assert.equal(wlRec.questionResults[0].maxScore, 5);

// ---------- data URI 图片（web 端 images[].dataUrl）落地 ----------
const tinyPng = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3]);
const b64 = Buffer.from(tinyPng).toString('base64');
const dataUriBank = {
  id: 'db1', name: '图片库', questions: [{
    id: 'dq1', type: 'SINGLE', question: `看图答题 ![示意图](data:image/png;base64,${b64})`,
    options: [{ key: 'A', text: '甲' }], answer: ['A'],
    images: [{ id: 'di1', dataUrl: `data:image/png;base64,${b64}`, order: 1 }]
  }]
};
sinkWrites = [];
const dataUriOutcome = importBackupText(JSON.stringify({ banks: [dataUriBank] }), [], emptyAssets, sinkFake, randomId, NOW + 7000);
assert.equal(dataUriOutcome.ok, true);
const dq = dataUriOutcome.banks[0].questions[0];
assert.equal(dq.question.includes('【示意图】'), true, '内嵌 data URI 图占位替换');
assert.equal(dq.question.includes('data:image'), false, '题干不再含 data URI');
assert.equal(dq.images.length, 2, '内嵌 1 + images 1');
assert.equal(dq.images[0].localPath, '/fake_assets/di1.png', 'images[] data URI 落地回写');
assert.equal(dq.images[1].localPath.startsWith('/fake_assets/web_'), true, '内嵌图落地回写');
assert.equal(sinkWrites.length, 2);

// ---------- base64 / 时间解析 单元 ----------
assert.deepEqual(Array.from(decodeBase64Bytes('AQIDBA==')), [1, 2, 3, 4]);
assert.deepEqual(Array.from(decodeBase64Bytes('AQI=')), [1, 2]);
assert.deepEqual(Array.from(decodeBase64Bytes(Buffer.from(tinyPng).toString('base64'))), Array.from(tinyPng));
assert.equal(decodeBase64Bytes('!!!!'), null);
assert.equal(parseBackupTimeMillis(1758900000000, 1), 1758900000000);
assert.equal(parseBackupTimeMillis('1758900000000', 1), 1758900000000);
assert.equal(parseBackupTimeMillis('2026-01-01T00:00:00Z', 1), Date.parse('2026-01-01T00:00:00Z'), 'ISO 串按 UTC');
assert.equal(parseBackupTimeMillis('2026-01-01 00:00:00', 1), Date.parse('2026-01-01T00:00:00Z'), '空格分隔按 UTC');
assert.equal(parseBackupTimeMillis(null, 7), 7);
assert.equal(parseBackupTimeMillis(-5, 7), 7, '非正数回退');

// ---------- 预览/边界 ----------
assert.equal(parseStandaloneJsonPreview('[]', NOW), null, '空数组无题库');
assert.equal(parseStandaloneJsonPreview('{"foo":1}', NOW), null, '无 banks/questions');
// 非法 JSON 由 parseStandaloneJsonPreview 抛出、importBackupText 捕获（对齐 Android runCatching）
assert.throws(() => parseStandaloneJsonPreview('不是json', NOW));
// 题目数组 → 新题库
const arrayPreview = parseStandaloneJsonPreview('[{"question":"甲题","options":[],"answer":["A"]}]', NOW);
assert.notEqual(arrayPreview, null);
assert.equal(arrayPreview.kind, 'question_array');
// 单题库对象
const singlePreview = parseStandaloneJsonPreview(JSON.stringify({ name: '单库', questions: webCrossBank.questions }), NOW);
assert.equal(singlePreview.kind, 'single_bank');
assert.equal(singlePreview.banks[0].name, '单库');
// 导入边界：空文本 / 非法 JSON / 无题库
assert.equal(importBackupText('   ', [], emptyAssets, sinkNoop, randomId, NOW).message, '导入失败：文件内容为空。');
assert.equal(importBackupText('{bad', [], emptyAssets, sinkNoop, randomId, NOW).message, '导入失败：不是有效的 JSON / ZIP 备份文件。');
assert.equal(importBackupText('{"banks":[]}', [], emptyAssets, sinkNoop, randomId, NOW).message, '导入失败：备份中没有可用题库。');
// 未知 bankId 的错题条目被丢弃，不炸整包
const orphanRoot = {
  app: 'Misaka Quiz', kind: 'misaka_quiz_full_backup', version: 3, schemaVersion: 3,
  banks: [webCrossBank], activeBankId: '',
  wrongBook: [{ bankId: 'not-exist', bankName: 'X', question: webCrossBank.questions[0], lastAnswer: [], source: '练习', timestamp: NOW, wrongCount: 1, rightCount: 0, reviewRightCount: 0, streakCorrectCount: 0, lastWrongAt: NOW, status: '未掌握', reviewLevel: 0 }],
  favoriteQuestions: [], studyRecords: []
};
const orphanOutcome = importBackupText(JSON.stringify(orphanRoot), [], emptyAssets, sinkNoop, randomId, NOW + 8000);
assert.equal(orphanOutcome.ok, true);
assert.equal(orphanOutcome.wrongBook.length, 0, '孤儿错题条目丢弃');

console.log('backup-roundtrip ALL PASS');
