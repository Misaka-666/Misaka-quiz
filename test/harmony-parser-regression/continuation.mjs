// node --import ./test/harmony-parser-regression/ts-node.mjs test/harmony-parser-regression/continuation.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { stripTypeScriptTypes } from 'node:module';
import * as codec from '../../apps/harmony/entry/src/main/ets/state/ContinuationCodec.ts';
import * as models from '../../apps/harmony/entry/src/main/ets/domain/Models.ts';
import * as practice from '../../apps/harmony/entry/src/main/ets/state/PracticeSessionCore.ts';
import * as exam from '../../apps/harmony/entry/src/main/ets/state/ExamSessionCore.ts';
import * as wrong from '../../apps/harmony/entry/src/main/ets/state/WrongBookOps.ts';

const base = new URL('../../apps/harmony/entry/src/main/ets/state/', import.meta.url);
function loadEts(name, dependencies, exported) {
  const source = fs.readFileSync(new URL(name, base), 'utf8')
    .replace(/^import[\s\S]*?;\r?\n/gm, '').replace(/^export /gm, '');
  return Function(...Object.keys(dependencies), `${stripTypeScriptTypes(source)}\nreturn {${exported.join(',')}};`)(...Object.values(dependencies));
}

const memory = new Map();
let failSave = false;
const FileStore = {
  readJson(dir) { return memory.has(dir) ? structuredClone(memory.get(dir)) : null; },
  writeTextAtomic(dir, _name, text) { if (failSave) return false; memory.set(dir, JSON.parse(text)); return true; }
};
class AppSettings { static load() { return new AppSettings(); } practiceReciteModeEnabled = false; practiceOptionShuffleEnabled = true; }
const { QuizRepository } = loadEts('QuizRepository.ets', {
  ...codec, ...models, ...practice, ...exam, ...wrong, FileStore, AppSettings,
  promptAction: { showToast() {} }
}, ['QuizRepository']);

function bank(id = 'bank') {
  const b = new models.QuizBank(id, '测试题库');
  for (let i = 0; i < 3; i++) {
    const q = new models.Question(`q${i}`, models.QuestionType.SINGLE, `题目 ${i}`);
    q.options = [new models.Option('A', '甲'), new models.Option('B', '乙')]; q.answer = ['A']; b.questions.push(q);
  }
  return b;
}
function repo(name, b = bank()) {
  const r = new QuizRepository(); r.init({ filesDir: name }); r.banks = [b]; r.activeBankId = b.id;
  r.practice.start(practice.bankPoolSources(b, () => false), [models.QuestionType.SINGLE], false, practice.PRACTICE_MODE_INSTANT, 10, null, b.name);
  r.preparePracticeView(); return r;
}
function received(payload) { return { payload: codec.validatePayload(JSON.parse(JSON.stringify(payload))), paths: new Map() }; }
const identityFiles = { async portableBanks(banks) { return banks; } };
const source = repo('source');
source.practice.toggleAnswer('B', false); source.practice.submitQuestion(); source.practice.nextQuestion(); source.practice.toggleAnswer('A', false);
const payload = source.continuationPayload();
assert.equal(payload.snapshot.shuffleEnabled, true);
assert.equal(payload.wrongBook.length, 1);
assert.equal(payload.banks.length, 1);
assert.ok(!JSON.stringify(payload).includes('aiApiKey'));
const target = repo('target', bank('different'));
const oldId = target.practice.sessionId;
await target.acceptContinuation(received(payload), identityFiles, () => true);
assert.equal(target.savedPractices[0].sessionId, oldId);
assert.deepEqual(target.practice.selectedAnswer, ['A']);
assert.equal(target.practice.index, 1);
assert.equal(target.wrongBook[0].wrongCount, source.wrongBook[0].wrongCount);
assert.equal(target.practice.optionShuffleSeed, source.practice.optionShuffleSeed);
await target.acceptContinuation(received(payload), identityFiles, () => true);
assert.equal(target.savedPractices.length, 1, '重复包不新增练习');
assert.equal(target.wrongBook[0].wrongCount, 1, '重复包不累加错题');
const restart = new QuizRepository(); restart.init({ filesDir: 'target' });
assert.equal(restart.savedPractices[0].sessionId, oldId);
assert.equal(restart.practice.sessionId, payload.snapshot.sessionId);
assert.ok(restart.switchSavedPractice(0));
assert.equal(restart.practice.sessionId, oldId);
assert.ok(restart.switchSavedPractice(0));
assert.equal(restart.practice.sessionId, payload.snapshot.sessionId);

const conflicting = repo('conflicting'); conflicting.banks[0].questions[0].question = '本地修改';
const localBank = JSON.stringify(models.bankToJson(conflicting.banks[0]));
await conflicting.acceptContinuation(received(payload), identityFiles, () => true);
assert.equal(conflicting.banks.length, 2);
assert.equal(JSON.stringify(models.bankToJson(conflicting.banks[0])), localBank);
assert.ok(Object.values(conflicting.practice.snapshot().banks).every(id => id !== 'bank'));
assert.ok([...conflicting.practice.answerResults.values()].every(result => result.bankId !== 'bank'), '判题记录随题库重映射');
await conflicting.acceptContinuation(received(payload), identityFiles, () => true);
assert.equal(conflicting.banks.length, 2, '重复接收复用冲突版本');
conflicting.practice.toggleAnswer('B', false);
await conflicting.acceptContinuation(received(payload), identityFiles, () => true);
assert.equal(conflicting.savedPractices.length, 2, '本地分歧另存');
assert.notEqual(conflicting.savedPractices[1].sessionId, payload.snapshot.sessionId);

const before = structuredClone(memory.get('target'));
const different = repo('otherSource', bank('another')).continuationPayload();
failSave = true;
await assert.rejects(target.acceptContinuation(received(different), identityFiles, () => true), /保存失败/);
assert.equal(target.practice.sessionId, payload.snapshot.sessionId);
assert.deepEqual(memory.get('target'), before);
assert.equal(target.banks.length, 2);
failSave = false;
await assert.rejects(target.acceptContinuation(received(different), identityFiles, () => false), /取消/);
assert.equal(target.practice.sessionId, payload.snapshot.sessionId);
await assert.rejects(target.acceptContinuation(received(different), { async portableBanks(banks) {
  target.persist(); return banks;
} }, () => true), /本机数据已改变/);
assert.equal(target.practice.sessionId, payload.snapshot.sessionId, '接收期间本机更新不能被覆盖');
const bad = structuredClone(payload); bad.snapshot.index = 999;
await assert.rejects(target.acceptContinuation(received(bad), identityFiles, () => true), /存档不完整/);
target.practice.endSession();
assert.equal(target.studyRecords.length, 1);
await assert.rejects(target.acceptContinuation(received(payload), identityFiles, () => true), /已在本机完成/);
assert.equal(target.studyRecords.length, 1);

assert.ok(source.markPracticeTransferred(source.practice.sessionId, source.practice.revision));
const transferredId = source.savedPractices.at(-1).sessionId;
assert.equal(source.practice.questions.length, 0);
assert.ok(source.switchSavedPractice(source.savedPractices.length - 1));
assert.ok(source.preparePracticeView());
assert.notEqual(source.practice.sessionId, transferredId, '旧端重新做题独立分支');
const legacy = structuredClone(payload.snapshot); delete legacy.sessionId; delete legacy.revision;
assert.ok(source.practice.restoreSnapshot(legacy), '旧存档兼容');

for (const edit of [p => p.protocol = 99, p => p.banks = [], p => p.snapshot.sessionId = '../x',
  p => p.assets = [{ name: '../x', size: 1 }], p => p.snapshot.questions[0].images = [{ localPath: '/private/file' }]]) {
  const invalid = structuredClone(payload); edit(invalid); assert.throws(() => codec.validatePayload(invalid));
}

// 实际文件编解码；只模拟平台文件和摘要 API，不模拟接续实现。
const handles = new Map();
const fileIo = {
  OpenMode: { READ_ONLY: 0, READ_WRITE: 2, CREATE: 64, TRUNC: 512 },
  async open(p, flags) { const h = await fsp.open(p, flags === 0 ? 'r' : 'w+'); handles.set(h.fd, h); return { fd: h.fd }; },
  async close(f) { const h = handles.get(f.fd); handles.delete(f.fd); await h.close(); },
  async stat(p) { const s = await fsp.stat(p); return { size: s.size, isFile: () => s.isFile(), ctime: s.ctimeMs, mtime: s.mtimeMs }; },
  async read(fd, b) { return (await handles.get(fd).read(new Uint8Array(b), 0, b.byteLength, null)).bytesRead; },
  async write(fd, b) { return (await handles.get(fd).write(new Uint8Array(b), 0, b.byteLength, null)).bytesWritten; },
  accessSync: fs.existsSync, mkdir: (p, recursive) => fsp.mkdir(p, { recursive }), rename: fsp.rename, unlink: fsp.unlink
};
const util = { TextEncoder: class { encodeInto(text) { return new TextEncoder().encode(text); } },
  TextDecoder: { create() { return { decodeWithStream: b => new TextDecoder('utf-8', { fatal: true }).decode(b) }; } } };
const cryptoFramework = { createMd() { const hash = createHash('sha256'); return {
  async update({ data }) { hash.update(data); }, async digest() { return { data: new Uint8Array(hash.digest()) }; }
}; } };
const { ContinuationFiles } = loadEts('ContinuationFiles.ets', { ...codec, fileIo, util, cryptoFramework,
  fileUri: { getUriFromPath: p => `file://${p}` } }, ['ContinuationFiles']);
const temp = await fsp.mkdtemp(path.resolve('apps/harmony/entry/build/misaka-continuation-'));
try {
  const root = temp.replaceAll('\\', '/');
  const context = { filesDir: root, distributedFilesDir: `${root}/distributed` };
  await fsp.mkdir(`${root}/question_assets`, { recursive: true }); await fsp.mkdir(context.distributedFilesDir);
  const image = `${root}/question_assets/picture.png`;
  await fsp.writeFile(image, Buffer.from([137, 80, 78, 71, 1, 2, 3]));
  const imageBank = bank(); imageBank.questions[0].images = [new models.QuestionImage('image', image, '图', 1)];
  const imageRepo = repo(root, imageBank);
  const files = new ContinuationFiles(context);
  const asset = await files.exportAsset(imageRepo.continuationPayload(), 'transfer1');
  const imported = await files.importAsset(asset);
  assert.equal(imported.paths.size, 1);
  assert.equal(imported.payload.assets.length, 1, '题库和练习共用同一图片');
  const installed = [...imported.paths.values()][0];
  assert.deepEqual(await fsp.readFile(installed), await fsp.readFile(image));
  const portable = await files.portableBanks([models.bankToJson(imageBank)], imported.payload, imported.paths);
  assert.equal(codec.mergeContinuationBanks(portable, imported.payload).banks.length, 1, '图片绝对路径不同仍复用题库');
  const imageTarget = repo(`${root}/target`, bank('targetOnly'));
  await imageTarget.acceptContinuation(imported, files, () => true);
  assert.equal(imageTarget.practice.questions[0].images[0].localPath, installed);
  const original = await fsp.readFile(asset.path);
  const corrupt = Buffer.from(original); corrupt[corrupt.length - 1] ^= 1;
  await fsp.writeFile(asset.path, corrupt); await assert.rejects(files.importAsset(asset), /校验失败/);
  await fsp.writeFile(asset.path, original.subarray(0, 8)); await assert.rejects(files.importAsset(asset), /清单不完整/);
  const huge = Buffer.from(original); huge.writeUInt32BE(0xffffffff, 0);
  await fsp.writeFile(asset.path, huge); await assert.rejects(files.importAsset(asset), /清单不完整/);
  await assert.rejects(files.importAsset({ ...asset, name: '../bad' }), /文件名不合法/);
  await files.cleanup('transfer1'); assert.ok(!fs.existsSync(asset.path));
} finally {
  for (const r of [source, target, restart, conflicting]) { if (r.practiceSaveTimer >= 0) clearTimeout(r.practiceSaveTimer); }
  await fsp.rm(temp, { recursive: true, force: true });
}
const deleteRepo = repo('deleteCheck');
deleteRepo.savedPractices = [structuredClone(payload.snapshot)];
deleteRepo.deleteBank('bank');
assert.equal(deleteRepo.savedPractices.length, 0, '删除题库清理关联暂存练习');
deleteRepo.savedPractices = [structuredClone(payload.snapshot)];
deleteRepo.completedPracticeIds = ['done'];
deleteRepo.clearAllLocalData();
assert.deepEqual(deleteRepo.savedPractices, []); assert.deepEqual(deleteRepo.completedPracticeIds, []);
console.log('continuation: 协议、题库冲突、多场练习、重复接收、分支、原子失败回滚、旧存档、图片迁移与损坏校验 ALL PASS');

// 生命周期使用可控的系统对象：验证回执顺序、超时和过期回调，不冒充真机网络测试。
const storage = new Map();
const timers = new Map(); let timerId = 0;
const calls = []; let objects = []; let throwCreate = false;
class MockObject {
  listeners = new Map();
  constructor(data) { Object.assign(this, data); objects.push(this); }
  on(event, callback) { this.listeners.set(event, callback); }
  off(event) { this.listeners.delete(event); }
  async setSessionId(id) { this.session = id; }
  async save() { calls.push('save'); }
  async revokeSave() { calls.push('revoke'); }
  emit(event, ...args) { this.listeners.get(event)?.(...args); }
}
let exportedPayload; let importGate = null;
class MockFiles {
  async exportAsset(p, token) { exportedPayload = p; return { name: `misaka_${token}.mqp` }; }
  async importAsset() { if (importGate) await importGate; return received(exportedPayload); }
  async portableBanks(b) { return b; }
  async cleanup() {}
}
let currentRepo = repo('controllerSource');
const context = { async setMissionContinueState(state) { calls.push(`available:${state}`); } };
const { PracticeContinuation } = loadEts('PracticeContinuation.ets', {
  CONTINUATION_VERSION: codec.CONTINUATION_VERSION, ContinuationFiles: MockFiles,
  QuizRepository: { getInstance() { return currentRepo; } },
  distributedDataObject: { genSessionId: () => `token${objects.length}`, create(_ctx, data) {
    if (throwCreate) throw Error('unsupported'); return new MockObject(data);
  } },
  AbilityConstant: { ContinueState: { ACTIVE: 1, INACTIVE: 0 }, OnContinueResult: { AGREE: 0, REJECT: 1, MISMATCH: 2 } },
  wantConstant: { Params: { SUPPORT_CONTINUE_PAGE_STACK_KEY: 'stack', SUPPORT_CONTINUE_SOURCE_EXIT_KEY: 'exit' } },
  router: { getState: () => ({ path: 'pages/PracticePage' }), async replaceUrl({ url }) { calls.push(url); },
    async pushUrl({ url }) { calls.push(url); }, clear() {} },
  promptAction: { showToast({ message }) { calls.push(message); } },
  AppStorage: { setOrCreate(k, v) { storage.set(k, v); } },
  setTimeout(callback) { const id = ++timerId; timers.set(id, callback); return id; },
  clearTimeout(id) { timers.delete(id); }
}, ['PracticeContinuation']);
const sending = new PracticeContinuation(context);
assert.equal(await sending.send({ version: 20, targetDevice: 'target' }), 2);
const params = { version: 21, targetDevice: 'target' };
assert.equal(await sending.send(params), 0);
assert.ok(currentRepo.continuationBusy);
assert.equal(params.stack, false); assert.equal(params.exit, false);
assert.ok(!JSON.stringify(params).includes('questions'), 'want 不包含大题库');
const sendObject = objects.at(-1);
assert.equal(currentRepo.practice.transferred, false, '系统保存不等于接收落盘');
sendObject.receipt = params.misakaSession;
sendObject.emit('change', params.misakaSession, ['receipt']);
assert.equal(currentRepo.practice.questions.length, 0);
assert.equal(currentRepo.savedPractices.at(-1).transferred, true);
assert.equal(currentRepo.continuationBusy, false);
assert.equal(sendObject.receipt, `confirmed_${params.misakaSession}`);
sending.cancel();

currentRepo = repo('controllerTarget', bank('own'));
const receivingController = new PracticeContinuation(context);
receivingController.stage({ parameters: params }); await receivingController.receive();
const receiveObject = objects.at(-1);
assert.equal(receiveObject.asset, undefined, '接收字段必须初始为空');
receiveObject.asset = { name: `misaka_${params.misakaSession}.mqp` };
await receivingController.finishReceive(receiveObject, params.misakaSession, receivingController.generation);
assert.equal(receiveObject.receipt, params.misakaSession);
assert.equal(currentRepo.savedPractices.length, 1);
assert.equal(calls.at(-1), 'pages/PracticePage');
receivingController.cancel();

currentRepo = repo('cancelTarget', bank('cancelOwn'));
const cancelId = currentRepo.practice.sessionId;
receivingController.stage({ parameters: params }); await receivingController.receive();
const staleObject = objects.at(-1); staleObject.asset = { name: `misaka_${params.misakaSession}.mqp` };
let releaseImport; importGate = new Promise(resolve => { releaseImport = resolve; });
const late = receivingController.finishReceive(staleObject, params.misakaSession, receivingController.generation);
receivingController.cancel(); releaseImport(); await late; importGate = null;
assert.equal(currentRepo.practice.sessionId, cancelId, '取消后的回调不能替换练习');
assert.equal(staleObject.receipt, undefined);

receivingController.stage({ parameters: params }); await receivingController.receive();
timers.get(receivingController.timer)();
assert.equal(storage.get('continuationFailed'), true);
assert.equal(currentRepo.practice.sessionId, cancelId);
assert.equal(currentRepo.continuationBusy, false);
await receivingController.receive(); assert.equal(currentRepo.continuationBusy, true, '超时后可重试');
receivingController.cancel();
throwCreate = true;
receivingController.stage({ parameters: params }); await receivingController.receive();
assert.equal(storage.get('continuationFailed'), true, '平台不支持时显示失败，不抛出未处理异常');
assert.equal(currentRepo.continuationBusy, false);
receivingController.cancel();
console.log('continuation lifecycle: 版本拒绝、回执后退出、恢复页面、超时重试、取消后回调、平台失败 ALL PASS');
