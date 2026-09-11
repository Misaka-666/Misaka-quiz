// M2：HarmonyOS 解析器移植回归 runner
// 复用 test/native-parser-regression 的 samples/ + expected/（40 用例），
// 判定口径 1:1 对齐 tools/compare_regression.py（摘要级 + 逐题断言）。
// 运行：node --import ./test/harmony-parser-regression/ts-node.mjs test/harmony-parser-regression/run-regression.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const nativeRoot = path.resolve(here, '../../test/native-parser-regression');
const actualDir = path.join(here, 'actual');

const parserMod = await import(
  pathToFileURL(path.resolve(here, '../../apps/harmony/entry/src/main/ets/importer/parser/QuizImportParser.ts')).href
);
const { parseStandardText, parseDualText } = parserMod;

class CaseResult {
  constructor(caseId) {
    this.caseId = caseId;
    this.passed = true;
    this.messages = [];
  }
  fail(message) {
    this.passed = false;
    this.messages.push(message);
  }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function sortedTypeCounts(counts) {
  const out = {};
  for (const key of Object.keys(counts).sort()) {
    out[key] = counts[key];
  }
  return out;
}

function buildActual(id, mode, result) {
  const typeCounts = {};
  for (const q of result.questions) {
    typeCounts[q.type] = (typeCounts[q.type] ?? 0) + 1;
  }
  return {
    id,
    mode,
    strategyName: result.strategyName,
    questionCount: result.questions.length,
    answeredCount: result.questions.filter(q => q.answer.length > 0).length,
    typeCounts: sortedTypeCounts(typeCounts),
    warnings: result.warnings.map(w => ({
      level: w.level,
      number: w.questionNumber ?? '',
      message: w.message
    })),
    diagnostics: {
      normalizedLength: result.diagnostics.normalizedLength,
      blockCount: result.diagnostics.blockCount,
      candidateCount: result.diagnostics.candidateCount,
      errorCount: result.warnings.filter(w => w.level === 'ERROR').length,
      warningCount: result.warnings.filter(w => w.level === 'WARNING').length
    },
    questions: result.questions.map(q => ({
      number: q.number,
      type: q.type,
      question: q.question,
      optionCount: q.options.length,
      options: Object.fromEntries(q.options.map(o => [o.key, o.text])),
      answer: q.answer.slice(),
      blankAnswers: q.blankAnswers.map(g => g.slice()),
      analysis: q.analysis,
      category: q.category
    }))
  };
}

// 键序无关的规范化序列化（对齐 Python dict 相等语义）
function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map(k => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function assertEqual(result, label, actual, expected) {
  if (expected === undefined || expected === null) {
    return; // 对齐 compare_regression.py：期望缺失则跳过
  }
  const a = canonicalJson(actual);
  const e = canonicalJson(expected);
  if (a !== e) {
    result.fail(`${label}不匹配：实际 ${a}，期望 ${e}`);
  }
}

function findQuestion(questions, number) {
  if (number === undefined || number === null) return undefined;
  const target = String(number);
  return questions.find(q => String(q.number) === target);
}

function compareQuestion(result, expected, actual) {
  const number = expected.number ?? '?';
  if ('type' in expected) {
    assertEqual(result, `第 ${number} 题题型`, actual.type, expected.type);
  }
  if ('optionCount' in expected) {
    assertEqual(result, `第 ${number} 题选项数`, actual.optionCount, expected.optionCount);
  }
  if ('mustNotType' in expected && actual.type === expected.mustNotType) {
    result.fail(`第 ${number} 题不应识别为 ${expected.mustNotType}`);
  }
  if ('answer' in expected) {
    assertEqual(result, `第 ${number} 题答案`, actual.answer ?? [], expected.answer);
  }
  if ('blankAnswers' in expected) {
    assertEqual(result, `第 ${number} 题逐空答案`, actual.blankAnswers ?? [], expected.blankAnswers);
  }
  if ('stemContains' in expected && !actual.question.includes(expected.stemContains)) {
    result.fail(`第 ${number} 题题干缺少：${expected.stemContains}`);
  }
  for (const forbidden of expected.stemNotContains ?? []) {
    if (actual.question.includes(forbidden)) {
      result.fail(`第 ${number} 题题干不应包含：${forbidden}`);
    }
  }
  if ('analysisContains' in expected && !actual.analysis.includes(expected.analysisContains)) {
    result.fail(`第 ${number} 题解析缺少：${expected.analysisContains}`);
  }
  if ('answerTextContains' in expected) {
    const answerText = actual.answer.join('\n');
    if (!answerText.includes(expected.answerTextContains)) {
      result.fail(`第 ${number} 题文本答案缺少：${expected.answerTextContains}`);
    }
  }
  for (const forbidden of expected.mustNotAnswer ?? []) {
    if (actual.answer.includes(forbidden)) {
      result.fail(`第 ${number} 题答案不应被拆成：${forbidden}`);
    }
  }
  for (const [key, value] of Object.entries(expected.options ?? {})) {
    if ((actual.options ?? {})[key] !== value) {
      result.fail(`第 ${number} 题选项 ${key} 不匹配：实际 ${JSON.stringify((actual.options ?? {})[key])}，期望 ${JSON.stringify(value)}`);
    }
  }
}

function compareCase(caseId, actual, expectedDoc) {
  const result = new CaseResult(caseId);
  // 部分旧用例（如 21）的 expected 为平铺结构（Kotlin 最小 runner 语义），无 expected 包装
  const expected = expectedDoc.expected ?? expectedDoc;
  const questions = actual.questions;
  const warnings = actual.warnings;

  assertEqual(result, '题目数量', actual.questionCount, expected.questionCount);
  assertEqual(result, '已识别答案数量', actual.answeredCount, expected.answeredCount);
  if ('typeCounts' in expected) {
    assertEqual(result, '题型分布', actual.typeCounts ?? {}, expected.typeCounts);
  }
  if ('warningsMax' in expected && warnings.length > expected.warningsMax) {
    result.fail(`警告数量过多：实际 ${warnings.length}，期望不超过 ${expected.warningsMax}`);
  }
  if ('strategyNameContains' in expected && !actual.strategyName.includes(expected.strategyNameContains)) {
    result.fail(`策略名缺少：${expected.strategyNameContains}；实际 ${JSON.stringify(actual.strategyName)}`);
  }
  if ('candidateCountMin' in expected && (actual.diagnostics?.candidateCount ?? 0) < expected.candidateCountMin) {
    result.fail(`候选数量不足：实际 ${actual.diagnostics.candidateCount}，期望至少 ${expected.candidateCountMin}`);
  }
  if ('errorCountMax' in expected && (actual.diagnostics?.errorCount ?? 0) > expected.errorCountMax) {
    result.fail(`错误数量过多：实际 ${actual.diagnostics.errorCount}，期望不超过 ${expected.errorCountMax}`);
  }

  const warningText = warnings.map(w => w.message ?? '').join('\n');
  for (const expectedWarning of expected.warningContains ?? []) {
    if (!warningText.includes(expectedWarning)) {
      result.fail(`警告信息缺少：${expectedWarning}`);
    }
  }
  for (const forbidden of expected.warningNotContains ?? []) {
    if (warningText.includes(forbidden)) {
      result.fail(`警告信息不应包含：${forbidden}`);
    }
  }
  for (const forbidden of expected.mustNotCreateQuestionFrom ?? []) {
    if (questions.some(q => q.question.includes(forbidden))) {
      result.fail(`不应把“${forbidden}”解析成题干`);
    }
  }
  for (const forbidden of expected.stemMustNotContain ?? []) {
    if (questions.some(q => q.question.includes(forbidden))) {
      result.fail(`题干不应包含分区标题“${forbidden}”`);
    }
  }
  for (const forbidden of expected.optionMustNotContain ?? []) {
    if (questions.some(q => Object.values(q.options ?? {}).some(t => t.includes(forbidden)))) {
      result.fail(`选项不应包含：${forbidden}`);
    }
  }
  for (const forbidden of expected.analysisMustNotContain ?? []) {
    if (questions.some(q => q.analysis.includes(forbidden))) {
      result.fail(`解析不应包含：${forbidden}`);
    }
  }
  for (const expectedQuestion of expected.questions ?? []) {
    const actualQuestion = findQuestion(questions, expectedQuestion.number);
    if (actualQuestion === undefined) {
      result.fail(`缺少第 ${expectedQuestion.number} 题`);
      continue;
    }
    compareQuestion(result, expectedQuestion, actualQuestion);
  }
  return result;
}

function resolveUnderRoot(relativePath) {
  const p = path.resolve(nativeRoot, relativePath);
  if (!p.startsWith(nativeRoot)) {
    throw new Error(`路径不能越过回归目录：${relativePath}`);
  }
  return p;
}

function main() {
  fs.mkdirSync(actualDir, { recursive: true });
  const manifest = readJson(path.join(nativeRoot, 'manifest.json'));
  const cases = manifest.cases;
  if (!Array.isArray(cases) || cases.length === 0) {
    throw new Error('manifest.json 中没有 cases 用例');
  }

  const results = [];
  for (const testCase of cases) {
    const id = testCase.id;
    let actual;
    try {
      if (testCase.mode === 'dual') {
        const questionText = fs.readFileSync(resolveUnderRoot(testCase.questionSample), 'utf8');
        const answerText = fs.readFileSync(resolveUnderRoot(testCase.answerSample), 'utf8');
        actual = buildActual(id, 'dual-file', parseDualText(questionText, answerText));
      } else {
        const text = fs.readFileSync(resolveUnderRoot(testCase.sample), 'utf8');
        actual = buildActual(id, 'single-file', parseStandardText(text));
      }
    } catch (err) {
      const result = new CaseResult(id);
      result.fail(`解析抛出异常：${err && err.stack ? err.stack.split('\n').slice(0, 3).join(' | ') : String(err)}`);
      results.push(result);
      continue;
    }
    fs.writeFileSync(path.join(actualDir, `${id}.json`), JSON.stringify(actual, null, 2), 'utf8');
    const expectedDoc = readJson(resolveUnderRoot(testCase.expected));
    if (expectedDoc.id !== undefined && expectedDoc.id !== id) {
      const result = new CaseResult(id);
      result.fail(`expected 文件 id 不匹配：实际 ${expectedDoc.id}，manifest 为 ${id}`);
      results.push(result);
      continue;
    }
    results.push(compareCase(id, actual, expectedDoc));
  }

  const failed = results.filter(r => !r.passed);
  console.log(`runner cases=${results.length} passed=${results.length - failed.length} failed=${failed.length}`);
  for (const result of failed) {
    console.log(`HARMONY_RUNNER_FAIL ${result.caseId}`);
    for (const message of result.messages) {
      console.log(`  - ${message}`);
    }
  }
  fs.writeFileSync(
    path.join(actualDir, 'runner-summary.json'),
    JSON.stringify({
      total: results.length,
      passed: results.length - failed.length,
      failed: failed.length,
      cases: results.map(r => ({ id: r.caseId, passed: r.passed, messages: r.messages }))
    }, null, 2),
    'utf8'
  );
  if (failed.length > 0) {
    process.exit(1);
  }
  console.log('HARMONY_PARSER_REGRESSION_ALL_PASS');
}

main();
