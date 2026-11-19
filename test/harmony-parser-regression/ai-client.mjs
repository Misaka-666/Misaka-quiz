// M8：AI 客户端纯逻辑自检 — SSE 累积器 / 端点与错误格式化 / 请求体与载荷构建 /
// 五类结果解析（核对/补解析/单题分析/AI 重构/题库分析）/ 建议应用规则与练习页乱序映射
// 运行：node --import ./test/harmony-parser-regression/ts-node.mjs test/harmony-parser-regression/ai-client.mjs
import assert from 'node:assert/strict';

const base = '../../apps/harmony/entry/src/main/ets';
const { Question, QuestionType, Option } = await import(new URL(`${base}/domain/Models.ts`, import.meta.url));
const { AiStreamCallback, AiReviewSuggestion } = await import(new URL(`${base}/ai/AiTypes.ts`, import.meta.url));
const { AiSseAccumulator, appendAiReasoningPreview } = await import(new URL(`${base}/ai/AiSse.ts`, import.meta.url));
const {
  validateAiConfig, normalizeChatEndpoint, formatAiHttpError, extractApiErrorMessage,
  buildChatRequestBody, contentFromChatResponse, reviewUserPayload, analysisUserPayload,
  singleQuestionUserPayload, freeAskUserPayload, bankAnalysisUserPayload, refactorUserPayload,
  parseReviewSuggestions, parseAnalysisSuggestions, parseSingleQuestionAnalysis,
  parseRefactorResult, parseBankAnalysis
} = await import(new URL(`${base}/ai/AiCodec.ts`, import.meta.url));
const {
  canApplyAiSuggestion, isActionableAiSuggestion, mergeAiReviewSuggestions, aiSuggestionsForQuestion,
  shouldApplyAiAnalysis, applyAiAnalysisSuggestion, applyAiReviewSuggestion, aiConfidenceLabel,
  aiSuggestionApplySummary, aiDisplayQuestionWithAnswer
} = await import(new URL(`${base}/ai/AiSuggestions.ts`, import.meta.url));
const prompts = await import(new URL(`${base}/ai/AiPrompts.ts`, import.meta.url));
const { practiceDisplayOptions } = await import(new URL(`${base}/state/OptionShuffle.ts`, import.meta.url));

function makeQ(id, stem, type = QuestionType.SINGLE, answer = ['A'], analysis = '') {
  const q = new Question(id, type, stem);
  q.options = [new Option('A', '甲'), new Option('B', '乙'), new Option('C', '丙'), new Option('D', '丁')];
  q.answer = answer;
  q.number = id.replace('q', '');
  q.analysis = analysis;
  return q;
}

// ---------- SSE 累积器 ----------

function runSse(chunks) {
  let reasoning = '';
  let contentSnapshots = [];
  let doneWith = '';
  const acc = new AiSseAccumulator(new AiStreamCallback(
    (r) => { reasoning += r; },
    (c) => { contentSnapshots.push(c); },
    (f) => { doneWith = f; }));
  for (const chunk of chunks) {
    acc.push(chunk);
  }
  const full = acc.finish();
  return { reasoning, contentSnapshots, full, doneWith };
}

{
  const r = runSse([
    'data: {"choices":[{"delta":{"reasoning_content":"先想"}}]}\r\n\r',
    '\ndata: {"choices":[{"delta":{"reasoning_content":"再想"}}]}\n',
    'data: {"choices":[{"delta":{"content":"你好"}}]}\nda',
    'ta: {"choices":[{"delta":{"content":"，世界"}}]}\ndata: [DONE]\ndata: {"choices":[{"delta":{"content":"DONE后应忽略"}}]}\n'
  ]);
  assert.equal(r.reasoning, '先想再想', 'reasoning 两个增量拼接（含 \\r\\n 与块边界）');
  assert.deepEqual(r.contentSnapshots, ['你好', '你好，世界'], 'content 收到的是累计全文');
  assert.equal(r.full, '你好，世界', 'finish 返回 trim 后全文');
}

{
  const r = runSse([': keep-alive 注释行\n', 'event: x\n', 'data: not-json\n', 'data: {"no":"choices"}\n']);
  assert.equal(r.full, '', '非 data 行/坏 JSON/无 choices 全部静默跳过');
}

{
  // 无尾换行的残行由 finish() 冲刷
  const r = runSse(['data: {"choices":[{"delta":{"content":"tail"}}]}']);
  assert.equal(r.full, 'tail', 'finish 冲刷无换行残行');
}

{
  let preview = '';
  const acc = new AiSseAccumulator(new AiStreamCallback(
    (chunk) => { preview = appendAiReasoningPreview(preview, chunk); }, () => {}, () => {}));
  const push = (delta) => acc.push(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`);
  push({ reasoning_content: '第一段\r' });
  assert.equal(preview.trimEnd(), '第一段');
  push({ reasoning_content: '\n\n  ' });
  assert.equal(preview.trimEnd(), '第一段', '空行不清空预览，跨块换行保留边界');
  push({ reasoning_content: '第二段 ' });
  push({ reasoning_content: '接着写\n第三段' });
  push({ reasoning_content: '继续' });
  assert.equal(preview, '第三段继续', '预览只保留最新的非空行');
  push({ reasoning_content: '\n' + '🧠'.repeat(200) + '末尾' + ' '.repeat(200) });
  assert.equal(preview.trimEnd(), '🧠'.repeat(158) + '末尾', '长行保留尾部和完整字符');
  push({ content: '{"analysis":' });
  push({ content: '"正式分析"}' });
  assert.equal(acc.finish(), '{"analysis":"正式分析"}');
  assert.ok(preview.trimEnd().endsWith('末尾'), '正式结果不会进入思考预览');
}

// ---------- 端点与错误格式化 ----------

assert.equal(normalizeChatEndpoint('https://api.deepseek.com'), 'https://api.deepseek.com/chat/completions');
assert.equal(normalizeChatEndpoint('https://api.deepseek.com/'), 'https://api.deepseek.com/chat/completions');
assert.equal(normalizeChatEndpoint('https://x/v1/chat/completions'), 'https://x/v1/chat/completions', '已带后缀不重复拼');
assert.throws(() => normalizeChatEndpoint('http://api.deepseek.com'), /https/, '明文 HTTP 拒绝');
assert.throws(() => normalizeChatEndpoint(''), /https/);

assert.throws(() => validateAiConfig('', 'k', 'm'), /API 地址/);
assert.throws(() => validateAiConfig('u', '', 'm'), /API Key/);
assert.throws(() => validateAiConfig('u', 'k', ''), /模型名称/);

assert.equal(extractApiErrorMessage('{"error":{"message":"Authentication Fails, key bad"}}'), 'Authentication Fails, key bad');
assert.equal(extractApiErrorMessage('{"message":"root msg"}'), 'root msg');
assert.equal(extractApiErrorMessage('plain text body'), 'plain text body');
assert.equal(extractApiErrorMessage(''), '');

assert.match(formatAiHttpError(401, '{"error":{"message":"Auth Fails"}}'), /HTTP 401，API Key 无效、余额不足或无权限：Auth Fails/);
assert.match(formatAiHttpError(500, ''), /HTTP 500，服务商接口暂时异常$/);
assert.match(formatAiHttpError(404, ''), /API 地址或模型路径不正确/);
assert.match(formatAiHttpError(429, ''), /请求过于频繁或额度受限/);
assert.match(formatAiHttpError(400, ''), /请求格式或模型参数不被接口接受/);
assert.match(formatAiHttpError(322, ''), /接口返回异常/);

// ---------- 请求体 / 载荷构建 ----------

{
  const body = JSON.parse(buildChatRequestBody('deepseek-chat', ' sys ', 'user-payload', 64, false));
  assert.equal(body.model, 'deepseek-chat');
  assert.equal(body.temperature, 0.1);
  assert.equal(body.messages[0].role, 'system');
  assert.equal(body.messages[0].content, 'sys', 'system prompt trim');
  assert.equal(body.messages[1].content, 'user-payload');
  assert.equal(body.max_tokens, 64);
  assert.equal(body.stream, undefined);
  const streamBody = JSON.parse(buildChatRequestBody('m', 's', 'u', null, true));
  assert.equal(streamBody.stream, true);
  assert.equal(streamBody.max_tokens, undefined);
}

{
  const q = makeQ('q1', '题干一', QuestionType.SINGLE, ['A'], '已有解析');
  const q2 = new Question('q2', QuestionType.BLANK, '多空题');
  q2.number = '2';
  q2.blankAnswers = [['甲', '甲备'], ['乙']];
  const payload = JSON.parse(reviewUserPayload([q, q2]));
  assert.equal(payload.task, 'review_questions');
  assert.ok(payload.outputFormat.items[0].questionId === '题目ID', '输出契约存在');
  assert.equal(payload.questions.length, 2);
  assert.equal(payload.questions[0].type, 'single', '题型小写');
  assert.equal(payload.questions[0].questionId, 'q1');
  assert.equal(payload.questions[0].index, 0);
  assert.deepEqual(payload.questions[1].blankAnswers, [['甲', '甲备'], ['乙']], '多空嵌套数组');
}

{
  const payload = JSON.parse(singleQuestionUserPayload(makeQ('q1', '题'), ['B']));
  assert.equal(payload.task, 'single_question_analysis');
  assert.equal(payload.question.questionId, 'q1');
  assert.deepEqual(payload.userAnswer, ['B']);
  assert.match(payload.note, /不会自动修改题库/);
}

{
  const q = makeQ('q1', '判断题干', QuestionType.JUDGE, ['A'], '解析内容');
  const payload = JSON.parse(freeAskUserPayload(q, '  为什么选A？ '));
  assert.equal(payload.questionContext.type, 'judge');
  assert.deepEqual(payload.questionContext.answer, ['A']);
  assert.equal(payload.questionContext.options.length, 4);
  assert.equal(payload.userQuestion, '为什么选A？', 'userQuestion trim');
}

{
  const questions = [];
  for (let i = 0; i < 205; i++) {
    const q = makeQ(`q${i}`, `题${i}`);
    q.number = String(205 - i); // 逆序题号，验证按题号排序截断
    questions.push(q);
  }
  const req = bankAnalysisUserPayload(questions, '大库');
  assert.equal(req.truncated, true);
  assert.equal(req.sentCount, 200, '超 200 截断');
  const payload = JSON.parse(req.userPayload);
  assert.equal(payload.totalCount, 205);
  assert.match(payload.note, /题库共 205 题，已按题号排序取前 200 题/);
  assert.equal(payload.questions[0].number, '1', '按题号升序取前 200');
  assert.equal(payload.questions.length, 200);
  assert.equal(payload.questionTypes.single, 205);
  const small = bankAnalysisUserPayload([makeQ('q1', 'x')], '小库');
  assert.equal(small.truncated, false);
  assert.equal(JSON.parse(small.userPayload).note, '');
}

{
  const payload = JSON.parse(refactorUserPayload('原始文本', '答案文本', [makeQ('q1', 'x')], ['警告一']));
  assert.equal(payload.task, 'refactor_questions');
  assert.equal(payload.sourceText, '原始文本');
  assert.equal(payload.currentQuestionCount, 1);
  assert.deepEqual(payload.warnings, ['警告一']);
  assert.ok(payload.outputFormat.mode.includes('clean_text'));
}

// ---------- 非流式响应解析 ----------

assert.equal(contentFromChatResponse('{"choices":[{"message":{"content":"答案内容"}}]}'), '答案内容');
assert.throws(() => contentFromChatResponse('{"choices":[]}'), /没有返回 choices/);
assert.throws(() => contentFromChatResponse('{"choices":[{"message":{"content":""}}]}'), /返回内容为空/);
assert.throws(() => contentFromChatResponse('not json'), /无法解析/);

// ---------- 核对建议解析 + 应用规则 ----------

const reviewContent = JSON.stringify({ items: [
  { questionId: 'q1', status: 'warning', issueTypes: ['answer_mismatch'], reason: '答案与选项不符',
    suggestion: '请人工核对', riskLevel: 'needs_confirm', suggestedType: 'multiple',
    suggestedAnswer: ['a', 'c'], suggestedQuestion: 'null', suggestedOptions: [], suggestedAnalysis: null, confidence: 0.82 },
  { questionId: 'q2', status: 'ok', issueTypes: [], reason: '', suggestion: '', riskLevel: 'auto_safe',
    canApply: false, needHumanReview: false, suggestedType: null, suggestedAnswer: [], suggestedQuestion: null,
    suggestedOptions: [], suggestedAnalysis: null },
  { questionId: 'q3', status: 'error', reason: '缺选项', riskLevel: 'hard_error', canApply: true,
    suggestedType: 'single', suggestedAnswer: ['B'], confidence: 0.4 },
  { questionId: '', status: 'warning' }
]});
const suggestions = parseReviewSuggestions('```json\n' + reviewContent + '\n```');
assert.equal(suggestions.length, 3, '空 questionId 丢弃；代码块围栏剥离');
const s1 = suggestions[0];
assert.deepEqual(s1.suggestedAnswer, ['A', 'C'], '答案大写');
assert.equal(s1.suggestedQuestion, null, '字面量 "null" 视为 null');
assert.equal(s1.canApply, true, 'needs_confirm + 有结构化建议 → 默认可采纳');
assert.equal(s1.needHumanReview, true);
const s2 = suggestions[1];
assert.equal(isActionableAiSuggestion(s2), false, '纯 ok 项不可操作');
const s3 = suggestions[2];
assert.equal(canApplyAiSuggestion(s3), false, 'hard_error 即便模型给 canApply=true 也不可采纳');

assert.equal(aiSuggestionsForQuestion('q1', suggestions).length, 1);
assert.match(aiSuggestionApplySummary(s1), /题型→多选题、答案→AC/);

{
  const merged = mergeAiReviewSuggestions([s1, s2], [s3], ['q1']);
  assert.equal(merged.length, 2, '已处理的 q1 被替换；纯 ok 的 incoming 被过滤');
  assert.equal(merged[0].questionId, 'q2');
  assert.equal(merged[1].questionId, 'q3');
}

{
  // 采纳：题型改多选 + 选项替换 + 答案归一
  const q = makeQ('q1', '单选改多选', QuestionType.SINGLE, ['A'], '');
  const sugg = new AiReviewSuggestion('q1', 'warning', [], 'r', 's', 'multiple', ['c', 'a', 'c'],
    null, [new Option('A', '新甲'), new Option('C', '新丙')], null, 'needs_confirm', true, true, 0.9);
  const applied = applyAiReviewSuggestion(q, sugg);
  assert.equal(applied.type, QuestionType.MULTIPLE);
  assert.deepEqual(applied.answer, ['A', 'C'], '多选答案去重排序');
  assert.equal(applied.options.length, 2);
  assert.equal(q.type, QuestionType.SINGLE, '原题不被改动');

  const judge = applyAiReviewSuggestion(makeQ('q2', '判断', QuestionType.JUDGE, ['B']),
    new AiReviewSuggestion('q2', 'warning', [], '', '', 'judge', ['正确'], null, [], null, 'needs_confirm', true, true, 0.9));
  assert.deepEqual(judge.answer, ['A'], '判断题 正确→A');

  const noOptionsJudge = applyAiReviewSuggestion(
    (() => { const q = makeQ('q3', '无选项判断', QuestionType.JUDGE, []); q.options = []; return q; })(),
    new AiReviewSuggestion('q3', 'warning', [], '', '', null, [], null, [], null, 'needs_confirm', true, true, 0.9));
  assert.equal(noOptionsJudge.options.length, 2, '判断题无选项时补默认选项');
}

// ---------- 补解析判定与写入 ----------

assert.equal(shouldApplyAiAnalysis(makeQ('q1', 'x', QuestionType.SINGLE, ['A'], '')), true);
assert.equal(shouldApplyAiAnalysis(makeQ('q1', 'x', QuestionType.SINGLE, ['A'], '短')), true, '<20 字算缺');
assert.equal(shouldApplyAiAnalysis(makeQ('q1', 'x', QuestionType.SINGLE, ['A'], '无')), true);
assert.equal(shouldApplyAiAnalysis(makeQ('q1', 'x', QuestionType.SINGLE, ['A'], '这是一条足够长的解析内容超过了二十个字符')), false);
{
  const subjective = makeQ('q1', '简答', QuestionType.SHORT, [], '');
  subjective.options = [];
  assert.equal(shouldApplyAiAnalysis(subjective), true, '简答无答案无选项也补');
  const applied = applyAiAnalysisSuggestion(subjective, ' 参考作答内容 ');
  assert.deepEqual(applied.answer, ['参考作答内容'], '简答无答案 → 参考作答进 answer');
  assert.equal(applied.analysis, '参考作答内容');
  const objective = applyAiAnalysisSuggestion(makeQ('q2', 'x', QuestionType.SINGLE, ['A'], ''), '解析 X');
  assert.deepEqual(objective.answer, ['A'], '客观题答案不动');
}

// ---------- 单题分析解析 ----------

{
  const r = parseSingleQuestionAnalysis(JSON.stringify(
    { questionId: 'q1', suggestedAnswer: ['A', 'B'], matchesLocalAnswer: true, analysis: '排除法', confidence: 'high', needsReview: false, warning: '' }), 'fallback');
  assert.equal(r.suggestedAnswer, 'A / B', '数组答案 join');
  assert.equal(r.matchesLocalAnswer, true);
  assert.equal(r.confidence, 'HIGH');
  assert.equal(aiConfidenceLabel(r.confidence), '可信度 高');

  const r2 = parseSingleQuestionAnalysis(JSON.stringify({ suggestedAnswer: '正确', confidence: 'LOW' }), 'fb');
  assert.equal(r2.questionId, 'fb', '缺 id 回退');
  assert.equal(r2.matchesLocalAnswer, null, '缺字段为 null');
  assert.equal(r2.needsReview, true, 'LOW 置信度默认需复核');
  assert.equal(r2.analysis, 'AI 未返回有效解析。');
  assert.equal(r2.suggestedAnswer, '正确');
  const r2b = parseSingleQuestionAnalysis(JSON.stringify({ suggestedAnswer: '正确' }), 'fb');
  assert.equal(r2b.needsReview, false, '无置信度默认 MEDIUM 不复核');

  const r3 = parseSingleQuestionAnalysis('{"matchesLocalAnswer":null,"suggestedAnswer":"","confidence":""}', 'fb');
  assert.equal(r3.suggestedAnswer, '无法判断');
  assert.equal(r3.confidence, 'MEDIUM');
}

// ---------- AI 重构解析 ----------

{
  const cleaned = parseRefactorResult(JSON.stringify(
    { mode: '', cleanedText: '1.题干\n答案：A', cleanedAnswerText: '', questions: [], notes: ['n1'] }));
  assert.equal(cleaned.mode, 'clean_text', '无 mode 有 cleanedText → clean_text');
  assert.equal(cleaned.cleanedText, '1.题干\n答案：A');
  assert.deepEqual(cleaned.notes, ['n1']);

  const direct = parseRefactorResult(JSON.stringify({ mode: 'direct_questions', questions: [
    { number: '1', type: '判断题', question: '判断一', answer: '正确' },
    { number: '', type: '多选题', question: '多选一', options: [{ key: 'a', text: '甲' }, { key: '', text: '' }], answer: ['C', 'A'] },
    { type: 'blank', question: '多空一', blankAnswers: [['主1', '备1', '备2', '备3'], ['第二空']], answer: [] },
    { question: '  ', type: 'single' },
    { number: '5', type: '填空', question: '单空', answer: '文本答案' }
  ]}));
  assert.equal(direct.questions.length, 4, '空题干丢弃');
  const [judge, multi, blank, single] = direct.questions;
  assert.equal(judge.type, QuestionType.JUDGE);
  assert.deepEqual(judge.answer, ['正确'], '判断题答案保留原文（uppercase 不改中文，对齐 Android）');
  assert.equal(multi.number, '2', '缺号回退 index+1');
  assert.equal(multi.options.length, 1, 'key/text 全空选项丢弃');
  assert.deepEqual(multi.answer, ['C', 'A'], '多选答案大写保序不排序（排序只在核对采纳路径，对齐 Android）');
  assert.equal(blank.type, QuestionType.BLANK);
  assert.deepEqual(blank.blankAnswers[0], ['主1', '备1', '备2'], '每空备选最多 3 个去重');
  assert.deepEqual(blank.answer, ['主1；第二空'], '多空兼容答案（首答案；连接）');
  assert.equal(single.type, QuestionType.BLANK);
  assert.deepEqual(single.answer, ['文本答案'], '填空答案不拆字母');
}

// ---------- 题库分析解析 ----------

{
  const raw = JSON.stringify({
    clusters: [{ topic: '  ', questionNumbers: ['1', ' ', '3'], reason: '同知识点' }, { topic: 'T2', questionNumbers: [] }],
    confusingPairs: [{ questionA: '1', questionB: '2', reason: 'r' }],
    progressions: [{ chain: ['1'], description: '链太短丢弃' }, { chain: ['1', '2', '3'], description: '递进' }],
    memoryTips: ['tip1', ' ', 'tip2'],
    entityKnowledgeMap: [
      { entity: '华法林', category: '药物类', appearances: [{ questionNumber: '5', knowledgePoint: '抗凝' }, { questionNumber: '12', knowledgePoint: '相互作用' }] },
      { entity: '孤儿', category: 'x', appearances: [{ questionNumber: '9', knowledgePoint: '仅一次丢弃' }] },
      { entity: '', category: 'y', appearances: [] }
    ]
  });
  const a = parseBankAnalysis('```json\n' + raw + '\n```');
  assert.equal(a.overview, 'AI 没有返回概述。', '空概述默认文案');
  assert.equal(a.clusters[0].topic, '未命名分组');
  assert.deepEqual(a.clusters[0].questionNumbers, ['1', '3']);
  assert.equal(a.clusters.length, 2);
  assert.equal(a.progressions.length, 1, '链长<2 丢弃');
  assert.deepEqual(a.memoryTips, ['tip1', 'tip2']);
  assert.equal(a.entityKnowledgeMap.length, 1, '出现<2 次实体丢弃');
  assert.equal(a.entityKnowledgeMap[0].entity, '华法林');
  assert.equal(a.reviewStrategy, '暂无特别建议。');
}

// ---------- 练习页乱序映射 ----------

{
  const q = makeQ('q1', '乱序题', QuestionType.MULTIPLE, ['A', 'C'], '解析');
  const display = practiceDisplayOptions(q, true, 42, 'session-key');
  if (display.some((o) => o.displayKey !== o.originalKey)) {
    const view = aiDisplayQuestionWithAnswer(q, display, ['A', 'B']);
    for (let i = 0; i < display.length; i++) {
      assert.equal(view.question.options[i].key, display[i].displayKey, '选项字母=展示字母');
      assert.equal(view.question.options[i].text, display[i].text);
    }
    const remap = (k) => display.find((o) => o.originalKey === k).displayKey;
    assert.deepEqual(view.question.answer, ['A', 'C'].map(remap), '答案跟随重映射（保持原顺序）');
    assert.deepEqual(view.userAnswer, ['A', 'B'].map(remap), '用户答案跟随重映射');
  } else {
    // ponytail: 种子 42 恰好未乱序时退化为恒等断言（OptionShuffle 行为另由 M4 回归覆盖）
    const view = aiDisplayQuestionWithAnswer(q, display, ['A']);
    assert.deepEqual(view.question.answer, ['A', 'C']);
    assert.deepEqual(view.userAnswer, ['A']);
  }
  const identity = aiDisplayQuestionWithAnswer(q, q.options.map((o, i) =>
    ({ displayKey: o.key, originalKey: o.key, text: o.text })), ['B']);
  assert.deepEqual(identity.question.answer, ['A', 'C'], '未乱序时恒等');
}

// ---------- 提示词契约 ----------

for (const key of ['AI_REVIEW_SYSTEM_PROMPT', 'AI_ANALYSIS_SYSTEM_PROMPT', 'AI_SINGLE_QUESTION_ANALYSIS_SYSTEM_PROMPT',
  'AI_REFACTOR_SYSTEM_PROMPT', 'AI_FREE_ASK_SYSTEM_PROMPT', 'AI_BANK_ANALYSIS_SYSTEM_PROMPT']) {
  assert.ok(typeof prompts[key] === 'string' && prompts[key].length > 200, `${key} 非空`);
}
assert.match(prompts.AI_REVIEW_SYSTEM_PROMPT, /hard_error/);
assert.match(prompts.AI_BANK_ANALYSIS_SYSTEM_PROMPT, /entityKnowledgeMap/);

console.log('ai-client ALL PASS');

// DeepSeek 思考档位在流式和非流式载荷中一致；默认不干扰兼容接口。
for (const stream of [false, true]) {
  for (const level of ['none', 'low', 'high', 'max']) {
    const body = JSON.parse(buildChatRequestBody('model', 'system', 'user', null, stream, level));
    assert.equal(body.reasoning_effort, level);
    assert.equal(body.thinking.type, level === 'none' ? 'disabled' : 'enabled');
    if (level !== 'none') assert.equal(body.temperature, undefined);
  }
  const defaults = JSON.parse(buildChatRequestBody('model', 'system', 'user', null, stream, 'default'));
  assert.equal(defaults.reasoning_effort, undefined);
  assert.equal(defaults.thinking, undefined);
}
console.log('AI thinking levels: ALL PASS');
