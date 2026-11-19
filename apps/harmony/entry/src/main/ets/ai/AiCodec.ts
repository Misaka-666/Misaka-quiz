/**
 * AI 编解码 — 1:1 移植 Android MisakaAiClient.kt 的纯逻辑段：
 * 配置校验/端点规整/HTTP 错误格式化、六类 userPayload 构建、
 * 非流式 choices 解析、五类结果解析（核对建议/补解析/单题分析/AI 重构/题库分析）。
 * 平台层（MisakaAiClient.ets）只做 http 收发；本文件 Node 可测。
 */
import { Question, QuestionType, Option } from '../domain/Models';
import { compatibilityAnswer } from '../importer/model/MultiBlankSupport';
import {
  AiReviewSuggestion, AiAnalysisSuggestion, AiSingleQuestionAnalysis, AiRefactorResult,
  AiBankAnalysis, AiBankCluster, AiConfusingPair, AiProgression, AiEntityKnowledge, AiEntityAppearance
} from './AiTypes';
import { AI_BANK_ANALYSIS_SYSTEM_PROMPT } from './AiPrompts';

export const AI_BANK_ANALYSIS_MAX_QUESTIONS = 200;

// ---------- JSON 宽松读取（对齐 org.json optXxx） ----------

type JsonValue = Object | null | undefined;

function isRecord(v: JsonValue): boolean {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asRecord(value: JsonValue): Record<string, Object> | null {
  return isRecord(value) ? value as Record<string, Object> : null;
}

function optStr(obj: Record<string, Object>, key: string, def: string = ''): string {
  const v: JsonValue = obj[key];
  if (v === undefined || v === null) {
    return def;
  }
  return typeof v === 'string' ? v : String(v);
}

function optBool(obj: Record<string, Object>, key: string, def: boolean): boolean {
  const v: JsonValue = obj[key];
  if (typeof v === 'boolean') {
    return v;
  }
  if (v === 'true') {
    return true;
  }
  if (v === 'false') {
    return false;
  }
  return def;
}

function optDouble(obj: Record<string, Object>, key: string): number {
  const v: JsonValue = obj[key];
  if (typeof v === 'number' && isFinite(v)) {
    return v;
  }
  return 0.0;
}

function optArray(obj: Record<string, Object>, key: string): Object[] | null {
  const v: JsonValue = obj[key];
  if (Array.isArray(v)) {
    const out: Object[] = [];
    for (let i = 0; i < v.length; i++) {
      out.push(v[i] as Object);
    }
    return out;
  }
  return null;
}

// ---------- 配置与端点 ----------

export function validateAiConfig(apiBaseUrl: string, apiKey: string, modelName: string): void {
  if (apiBaseUrl.trim().length === 0) {
    throw new Error('请先填写 API 地址。');
  }
  if (apiKey.trim().length === 0) {
    throw new Error('请先填写 API Key。');
  }
  if (modelName.trim().length === 0) {
    throw new Error('请先填写模型名称。');
  }
}

export function normalizeChatEndpoint(apiBaseUrl: string): string {
  let clean = apiBaseUrl.trim();
  while (clean.endsWith('/')) {
    clean = clean.substring(0, clean.length - 1);
  }
  if (!clean.startsWith('https://')) {
    throw new Error('API 地址必须以 https:// 开头，不支持明文 HTTP。');
  }
  return clean.endsWith('/chat/completions') ? clean : `${clean}/chat/completions`;
}

export function extractApiErrorMessage(responseText: string): string {
  if (responseText.trim().length === 0) {
    return '';
  }
  let parsed: Record<string, Object> | null = null;
  try {
    parsed = asRecord(JSON.parse(responseText) as Object);
  } catch (_err) {
    parsed = null;
  }
  if (parsed === null) {
    return responseText.substring(0, 160);
  }
  const error = asRecord(parsed['error']);
  const message = error !== null ? optStr(error, 'message') : '';
  const fromRoot = message.length > 0 ? message : optStr(parsed, 'message');
  return fromRoot.substring(0, 160);
}

export function formatAiHttpError(code: number, responseText: string): string {
  const apiMessage = extractApiErrorMessage(responseText);
  let hint: string;
  if (code === 400) {
    hint = '请求格式或模型参数不被接口接受';
  } else if (code === 401 || code === 403) {
    hint = 'API Key 无效、余额不足或无权限';
  } else if (code === 404) {
    hint = 'API 地址或模型路径不正确';
  } else if (code === 429) {
    hint = '请求过于频繁或额度受限';
  } else if (code >= 500 && code <= 599) {
    hint = '服务商接口暂时异常';
  } else {
    hint = '接口返回异常';
  }
  return `AI 接口请求失败：HTTP ${code}，${hint}${apiMessage.length > 0 ? `：${apiMessage}` : ''}`;
}

// ---------- 请求体构建 ----------

export function normalizeThinkingLevel(value: string): string {
  return ['none', 'low', 'high', 'max'].includes(value) ? value : 'default';
}

export function buildChatRequestBody(modelName: string, systemPrompt: string, userPayload: string,
  maxTokens: number | null, stream: boolean, thinkingLevel: string = 'default'): string {
  const messages: Object[] = [];
  const systemMsg: Record<string, Object> = {};
  systemMsg['role'] = 'system';
  systemMsg['content'] = systemPrompt.trim();
  const userMsg: Record<string, Object> = {};
  userMsg['role'] = 'user';
  userMsg['content'] = userPayload;
  messages.push(systemMsg);
  messages.push(userMsg);
  const body: Record<string, Object> = {};
  body['model'] = modelName.trim();
  const level = normalizeThinkingLevel(thinkingLevel);
  if (level === 'default' || level === 'none') {
    body['temperature'] = 0.1;
  }
  if (level !== 'default') {
    body['thinking'] = { 'type': level === 'none' ? 'disabled' : 'enabled' } as Record<string, Object>;
    body['reasoning_effort'] = level;
  }
  if (stream) {
    body['stream'] = true;
  }
  if (maxTokens !== null) {
    body['max_tokens'] = maxTokens;
  }
  body['messages'] = messages;
  return JSON.stringify(body);
}

/** 非流式响应 → choices[0].message.content（空内容/结构异常抛用户可读错误，对齐 Android） */
export function contentFromChatResponse(responseText: string): string {
  let parsed: Record<string, Object> | null = null;
  try {
    parsed = asRecord(JSON.parse(responseText) as Object);
  } catch (_err) {
    throw new Error('AI 接口返回格式无法解析，请确认接口是否兼容 OpenAI chat/completions。');
  }
  if (parsed === null) {
    throw new Error('AI 接口返回格式无法解析，请确认接口是否兼容 OpenAI chat/completions。');
  }
  const choices = optArray(parsed, 'choices');
  if (choices === null || choices.length === 0) {
    throw new Error('AI 接口没有返回 choices，请检查模型名称或接口兼容性。');
  }
  const first = asRecord(choices[0]);
  const message = first !== null ? asRecord(first['message']) : null;
  const content = message !== null ? optStr(message, 'content') : '';
  if (content.trim().length === 0) {
    throw new Error('AI 接口返回内容为空，请检查模型是否支持 chat/completions。');
  }
  return content;
}

export function questionsToJsonPayload(questions: Question[]): Object[] {
  const array: Object[] = [];
  for (let index = 0; index < questions.length; index++) {
    const question = questions[index];
    const options: Object[] = [];
    for (const option of question.options) {
      const o: Record<string, Object> = {};
      o['key'] = option.key;
      o['text'] = option.text;
      options.push(o);
    }
    const answers: Object[] = [];
    for (const value of question.answer) {
      answers.push(value);
    }
    const blankAnswers: Object[] = [];
    for (const group of question.blankAnswers) {
      const g: Object[] = [];
      for (const value of group) {
        g.push(value);
      }
      blankAnswers.push(g);
    }
    const item: Record<string, Object> = {};
    item['index'] = index;
    item['questionId'] = question.id;
    item['number'] = question.number;
    item['type'] = question.type.toLowerCase();
    item['question'] = question.question;
    item['options'] = options;
    item['answer'] = answers;
    item['blankAnswers'] = blankAnswers;
    item['analysis'] = question.analysis;
    item['category'] = question.category;
    array.push(item);
  }
  return array;
}

// ---------- 六类 userPayload ----------

export function reviewUserPayload(questions: Question[]): string {
  const payload: Record<string, Object> = {};
  payload['task'] = 'review_questions';
  payload['outputFormat'] = reviewOutputContract();
  payload['questions'] = questionsToJsonPayload(questions);
  return JSON.stringify(payload);
}

export function analysisUserPayload(questions: Question[]): string {
  const payload: Record<string, Object> = {};
  payload['task'] = 'generate_analysis';
  payload['outputFormat'] = analysisOutputContract();
  payload['questions'] = questionsToJsonPayload(questions);
  return JSON.stringify(payload);
}

export function singleQuestionUserPayload(question: Question, userAnswer: string[]): string {
  const payload: Record<string, Object> = {};
  payload['task'] = 'single_question_analysis';
  payload['outputFormat'] = singleQuestionAnalysisOutputContract();
  payload['question'] = questionsToJsonPayload([question])[0];
  const answers: Object[] = [];
  for (const value of userAnswer) {
    answers.push(value);
  }
  payload['userAnswer'] = answers;
  payload['note'] = 'AI 结果只用于练习复盘参考，不会自动修改题库答案或解析。';
  return JSON.stringify(payload);
}

function freeAskQuestionContext(question: Question): Record<string, Object> {
  const context: Record<string, Object> = {};
  context['type'] = question.type.toLowerCase();
  context['question'] = question.question;
  const options: Object[] = [];
  for (const option of question.options) {
    const o: Record<string, Object> = {};
    o['key'] = option.key;
    o['text'] = option.text;
    options.push(o);
  }
  context['options'] = options;
  const answers: Object[] = [];
  for (const value of question.answer) {
    answers.push(value);
  }
  context['answer'] = answers;
  context['analysis'] = question.analysis;
  return context;
}

export function freeAskUserPayload(question: Question, userQuestion: string): string {
  const payload: Record<string, Object> = {};
  payload['questionContext'] = freeAskQuestionContext(question);
  payload['userQuestion'] = userQuestion.trim();
  return JSON.stringify(payload);
}

export class BankAnalysisRequest {
  userPayload: string = '';
  sentCount: number = 0;
  truncated: boolean = false;
}

/** 题库分析载荷：按题号排序，超 200 题截断并在 note 说明（对齐 Android analyzeBank） */
export function bankAnalysisUserPayload(questions: Question[], bankName: string): BankAnalysisRequest {
  const sorted = questions.slice().sort((a: Question, b: Question): number =>
    a.number < b.number ? -1 : (a.number > b.number ? 1 : 0));
  const truncated = sorted.length > AI_BANK_ANALYSIS_MAX_QUESTIONS;
  const sent = truncated ? sorted.slice(0, AI_BANK_ANALYSIS_MAX_QUESTIONS) : sorted;
  const note = truncated ? `（题库共 ${questions.length} 题，已按题号排序取前 ${AI_BANK_ANALYSIS_MAX_QUESTIONS} 题供分析）` : '';
  const types: Record<string, Object> = {};
  types['single'] = questions.filter((q: Question): boolean => q.type === QuestionType.SINGLE).length;
  types['multiple'] = questions.filter((q: Question): boolean => q.type === QuestionType.MULTIPLE).length;
  types['judge'] = questions.filter((q: Question): boolean => q.type === QuestionType.JUDGE).length;
  types['blank'] = questions.filter((q: Question): boolean => q.type === QuestionType.BLANK).length;
  types['short'] = questions.filter((q: Question): boolean => q.type === QuestionType.SHORT).length;
  const payload: Record<string, Object> = {};
  payload['bankName'] = bankName;
  payload['totalCount'] = questions.length;
  payload['note'] = note;
  payload['questionTypes'] = types;
  payload['questions'] = questionsToJsonPayload(sent);
  const request = new BankAnalysisRequest();
  request.userPayload = JSON.stringify(payload);
  request.sentCount = sent.length;
  request.truncated = truncated;
  return request;
}

export function refactorUserPayload(rawText: string, answerText: string, currentQuestions: Question[],
  warnings: string[]): string {
  const payload: Record<string, Object> = {};
  payload['task'] = 'refactor_questions';
  payload['outputFormat'] = refactorOutputContract();
  payload['sourceText'] = rawText;
  payload['answerText'] = answerText;
  payload['currentQuestionCount'] = currentQuestions.length;
  payload['currentQuestions'] = questionsToJsonPayload(currentQuestions);
  const warningArray: Object[] = [];
  for (const warning of warnings) {
    warningArray.push(warning);
  }
  payload['warnings'] = warningArray;
  return JSON.stringify(payload);
}

// ---------- 输出契约（喂给模型的格式说明） ----------

function reviewOutputContract(): Object {
  const item: Record<string, Object> = {};
  item['questionId'] = '题目ID';
  item['status'] = 'ok / warning / error';
  item['issueTypes'] = ['answer_mismatch'];
  item['reason'] = '发现问题的原因';
  item['suggestion'] = '建议如何人工核对或修改';
  item['riskLevel'] = 'auto_safe / needs_confirm / hard_error';
  item['canApply'] = true;
  item['suggestedType'] = 'single / multiple / judge / blank / short / null';
  item['suggestedAnswer'] = ['A'];
  item['suggestedQuestion'] = '建议题干；无建议时返回 null';
  const suggestedOption: Record<string, Object> = {};
  suggestedOption['key'] = 'A';
  suggestedOption['text'] = '建议选项文本';
  item['suggestedOptions'] = [suggestedOption];
  item['suggestedAnalysis'] = '建议解析；无建议时返回 null';
  item['needHumanReview'] = true;
  item['confidence'] = 0.82;
  const contract: Record<string, Object> = {};
  contract['items'] = [item];
  return contract;
}

function analysisOutputContract(): Object {
  const item: Record<string, Object> = {};
  item['questionId'] = '题目ID';
  item['analysis'] = '生成的解析内容；简答/面试题可返回参考作答或答题思路';
  item['needHumanReview'] = false;
  item['confidence'] = 0.86;
  const contract: Record<string, Object> = {};
  contract['items'] = [item];
  return contract;
}

function singleQuestionAnalysisOutputContract(): Object {
  const item: Record<string, Object> = {};
  item['questionId'] = '题目ID';
  item['suggestedAnswer'] = 'AI 独立判断的参考答案';
  item['matchesLocalAnswer'] = true;
  item['analysis'] = 'AI 解析、排除依据或简答题参考要点';
  item['confidence'] = 'HIGH / MEDIUM / LOW';
  item['needsReview'] = false;
  item['warning'] = '不确定或疑似题库答案异常时填写；否则为空';
  return item;
}

function refactorOutputContract(): Object {
  const question: Record<string, Object> = {};
  question['number'] = '1';
  question['type'] = 'single / multiple / judge / blank / short';
  question['question'] = '题干';
  const option: Record<string, Object> = {};
  option['key'] = 'A';
  option['text'] = '选项文本';
  question['options'] = [option];
  question['answer'] = ['A'];
  question['blankAnswers'] = [['第1空主答案', '第1空备选答案']];
  question['analysis'] = '解析；没有可靠来源时可为空';
  question['category'] = '分区或来源；没有可为空';
  const contract: Record<string, Object> = {};
  contract['mode'] = 'clean_text / direct_questions';
  contract['cleanedText'] = '优先返回清洗后的标准题库文本；direct_questions 模式可为空';
  contract['cleanedAnswerText'] = '如仍需双文件解析，可返回清洗后的答案文本；否则为空';
  contract['questions'] = [question];
  contract['notes'] = ['重构说明和需要人工确认的点'];
  return contract;
}

// ---------- 内容提取与结果解析 ----------

function nullIfBlankOrLiteralNull(value: string): string | null {
  const clean = value.trim();
  return clean.length > 0 && clean.toLowerCase() !== 'null' ? clean : null;
}

export function extractJsonObject(content: string): string {
  let clean = content.trim();
  if (clean.startsWith('```json')) {
    clean = clean.substring('```json'.length);
  }
  if (clean.startsWith('```')) {
    clean = clean.substring(3);
  }
  if (clean.endsWith('```')) {
    clean = clean.substring(0, clean.length - 3);
  }
  clean = clean.trim();
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new Error('AI 返回内容不是有效 JSON。');
  }
  return clean.substring(start, end + 1);
}

function parseRootObject(content: string): Record<string, Object> {
  let root: Record<string, Object> | null = null;
  try {
    root = asRecord(JSON.parse(extractJsonObject(content)) as Object);
  } catch (_err) {
    throw new Error('AI 返回内容不是有效 JSON。');
  }
  if (root === null) {
    throw new Error('AI 返回内容不是有效 JSON。');
  }
  return root;
}

export function parseReviewSuggestions(content: string): AiReviewSuggestion[] {
  const root = parseRootObject(content);
  const items = optArray(root, 'items');
  const out: AiReviewSuggestion[] = [];
  if (items === null) {
    return out;
  }
  for (const raw of items) {
    const item = asRecord(raw);
    if (item === null) {
      continue;
    }
    const suggestedType = nullIfBlankOrLiteralNull(optStr(item, 'suggestedType'));
    const suggestedQuestion = nullIfBlankOrLiteralNull(optStr(item, 'suggestedQuestion'));
    const suggestedAnalysis = nullIfBlankOrLiteralNull(optStr(item, 'suggestedAnalysis'));
    const answerJson = optArray(item, 'suggestedAnswer');
    const suggestedAnswer: string[] = [];
    if (answerJson !== null) {
      for (const value of answerJson) {
        const text = String(value).trim().toUpperCase();
        if (text.length > 0) {
          suggestedAnswer.push(text);
        }
      }
    }
    const optionsJson = optArray(item, 'suggestedOptions');
    const suggestedOptions: Option[] = [];
    if (optionsJson !== null) {
      for (const optionRaw of optionsJson) {
        const option = asRecord(optionRaw);
        if (option === null) {
          continue;
        }
        const key = optStr(option, 'key').trim().toUpperCase();
        const text = optStr(option, 'text').trim();
        if (key.length > 0 || text.length > 0) {
          suggestedOptions.push(new Option(key, text));
        }
      }
    }
    const issueTypesJson = optArray(item, 'issueTypes');
    const issueTypes: string[] = [];
    if (issueTypesJson !== null) {
      for (const value of issueTypesJson) {
        const text = String(value);
        if (text.trim().length > 0) {
          issueTypes.push(text);
        }
      }
    }
    let status = optStr(item, 'status', 'warning');
    if (status.trim().length === 0) {
      status = 'warning';
    }
    let riskLevel = optStr(item, 'riskLevel', 'needs_confirm');
    if (riskLevel.trim().length === 0) {
      riskLevel = 'needs_confirm';
    }
    const hasStructuredSuggestion = suggestedType !== null || suggestedAnswer.length > 0 ||
      suggestedQuestion !== null || suggestedOptions.length > 0 || suggestedAnalysis !== null;
    const hardError = riskLevel.toLowerCase() === 'hard_error';
    const defaultCanApply = hasStructuredSuggestion && !hardError;
    const canApply = optBool(item, 'canApply', defaultCanApply) && !hardError;
    const defaultNeedHumanReview = status.toLowerCase() !== 'ok' || issueTypes.length > 0 ||
      hardError || hasStructuredSuggestion;
    const needHumanReview = optBool(item, 'needHumanReview', defaultNeedHumanReview);
    const questionId = optStr(item, 'questionId');
    if (questionId.trim().length === 0) {
      continue;
    }
    out.push(new AiReviewSuggestion(
      questionId, status, issueTypes, optStr(item, 'reason'), optStr(item, 'suggestion'),
      suggestedType, suggestedAnswer, suggestedQuestion, suggestedOptions, suggestedAnalysis,
      riskLevel, canApply, needHumanReview, optDouble(item, 'confidence')));
  }
  return out;
}

export function parseAnalysisSuggestions(content: string): AiAnalysisSuggestion[] {
  const root = parseRootObject(content);
  const items = optArray(root, 'items');
  const out: AiAnalysisSuggestion[] = [];
  if (items === null) {
    return out;
  }
  for (const raw of items) {
    const item = asRecord(raw);
    if (item === null) {
      continue;
    }
    const questionId = optStr(item, 'questionId');
    const analysis = optStr(item, 'analysis');
    if (questionId.trim().length > 0 && analysis.trim().length > 0) {
      out.push(new AiAnalysisSuggestion(questionId, analysis,
        optBool(item, 'needHumanReview', false), optDouble(item, 'confidence')));
    }
  }
  return out;
}

export function parseSingleQuestionAnalysis(content: string, fallbackQuestionId: string): AiSingleQuestionAnalysis {
  const root = parseRootObject(content);
  const answerJson = optArray(root, 'suggestedAnswer');
  let suggestedAnswer: string;
  if (answerJson !== null) {
    const parts: string[] = [];
    for (const value of answerJson) {
      const text = String(value).trim();
      if (text.length > 0) {
        parts.push(text);
      }
    }
    suggestedAnswer = parts.join(' / ');
  } else {
    suggestedAnswer = optStr(root, 'suggestedAnswer').trim();
  }
  let matchesLocalAnswer: boolean | null = null;
  if ('matchesLocalAnswer' in root && root['matchesLocalAnswer'] !== null) {
    matchesLocalAnswer = optBool(root, 'matchesLocalAnswer', false);
  }
  let confidence = optStr(root, 'confidence', 'MEDIUM').trim().toUpperCase();
  if (confidence.length === 0) {
    confidence = 'MEDIUM';
  }
  let questionId = optStr(root, 'questionId', fallbackQuestionId);
  if (questionId.trim().length === 0) {
    questionId = fallbackQuestionId;
  }
  const analysis = optStr(root, 'analysis').trim();
  return new AiSingleQuestionAnalysis(
    questionId,
    suggestedAnswer.trim().length > 0 ? suggestedAnswer.trim() : '无法判断',
    matchesLocalAnswer,
    analysis.length > 0 ? analysis : 'AI 未返回有效解析。',
    confidence,
    optBool(root, 'needsReview', confidence === 'LOW'),
    optStr(root, 'warning').trim());
}

function parseAiQuestionType(value: string): string {
  const clean = value.trim().toLowerCase();
  if (clean === 'single' || clean === 'single_choice' || clean === 'choice' || clean === '单选' || clean === '单选题') {
    return QuestionType.SINGLE;
  }
  if (clean === 'multiple' || clean === 'multiple_choice' || clean === 'multi' || clean === '多选' || clean === '多选题') {
    return QuestionType.MULTIPLE;
  }
  if (clean === 'judge' || clean === 'true_false' || clean === '判断' || clean === '判断题') {
    return QuestionType.JUDGE;
  }
  if (clean === 'blank' || clean === 'fill_blank' || clean === '填空' || clean === '填空题') {
    return QuestionType.BLANK;
  }
  return QuestionType.SHORT;
}

export function parseRefactorResult(content: string): AiRefactorResult {
  const root = parseRootObject(content);
  const questionsJson = optArray(root, 'questions');
  const questionsSource = questionsJson !== null ? questionsJson : optArray(root, 'items');
  const notesJson = optArray(root, 'notes');
  const notes: string[] = [];
  if (notesJson !== null) {
    for (const value of notesJson) {
      const text = String(value).trim();
      if (text.length > 0) {
        notes.push(text);
      }
    }
  }
  const questions: Question[] = [];
  if (questionsSource !== null) {
    for (let index = 0; index < questionsSource.length; index++) {
      const item = asRecord(questionsSource[index]);
      if (item === null) {
        continue;
      }
      const questionText = optStr(item, 'question').trim();
      if (questionText.length === 0) {
        continue;
      }
      const optionsJson = optArray(item, 'options');
      const options: Option[] = [];
      if (optionsJson !== null) {
        for (const optionRaw of optionsJson) {
          const option = asRecord(optionRaw);
          if (option === null) {
            continue;
          }
          const key = optStr(option, 'key').trim().toUpperCase();
          const text = optStr(option, 'text').trim();
          if (key.length > 0 || text.length > 0) {
            options.push(new Option(key, text));
          }
        }
      }
      const type = parseAiQuestionType(optStr(item, 'type'));
      const blankAnswersJson = optArray(item, 'blankAnswers');
      const blankAnswers: string[][] = [];
      if (blankAnswersJson !== null) {
        for (const groupRaw of blankAnswersJson) {
          if (Array.isArray(groupRaw)) {
            const seen = new Set<string>();
            const group: string[] = [];
            for (const value of groupRaw) {
              const text = String(value).trim();
              if (text.length > 0 && !seen.has(text) && group.length < 3) {
                seen.add(text);
                group.push(text);
              }
            }
            blankAnswers.push(group);
          } else {
            const text = String(groupRaw).trim();
            if (text.length > 0) {
              blankAnswers.push([text]);
            }
          }
        }
      }
      const answerJson = optArray(item, 'answer');
      let rawAnswers: string[];
      if (answerJson !== null) {
        rawAnswers = [];
        for (const value of answerJson) {
          const text = String(value).trim();
          if (text.length > 0) {
            rawAnswers.push(text);
          }
        }
      } else {
        const raw = optStr(item, 'answer').trim();
        rawAnswers = [];
        if (type === QuestionType.BLANK || type === QuestionType.SHORT) {
          if (raw.length > 0) {
            rawAnswers.push(raw);
          }
        } else {
          const parts = raw.split(/[,，、\s]+/);
          for (const part of parts) {
            const text = part.trim();
            if (text.length > 0) {
              rawAnswers.push(text);
            }
          }
        }
      }
      let answers: string[];
      if (type === QuestionType.BLANK && blankAnswers.length > 0) {
        answers = compatibilityAnswer(blankAnswers);
      } else if (type === QuestionType.BLANK || type === QuestionType.SHORT) {
        answers = rawAnswers;
      } else {
        answers = rawAnswers.map((value: string): string => value.toUpperCase());
      }
      const stamp = Date.now().toString(36);
      const question = new Question(`aiq_${stamp}_${index}`, type, questionText);
      let number = optStr(item, 'number', String(index + 1)).trim();
      if (number.length === 0) {
        number = String(index + 1);
      }
      question.number = number;
      question.options = options;
      question.answer = answers;
      question.blankAnswers = type === QuestionType.BLANK ? blankAnswers : [];
      question.analysis = optStr(item, 'analysis').trim();
      question.category = optStr(item, 'category').trim();
      questions.push(question);
    }
  }
  const cleanedText = nullIfBlankOrLiteralNull(optStr(root, 'cleanedText'));
  const cleanedAnswerText = nullIfBlankOrLiteralNull(optStr(root, 'cleanedAnswerText'));
  let mode = optStr(root, 'mode').trim();
  if (mode.length === 0) {
    mode = cleanedText !== null && cleanedText.trim().length > 0 ? 'clean_text' : 'direct_questions';
  }
  return new AiRefactorResult(mode, cleanedText, cleanedAnswerText, questions, notes);
}

export function parseBankAnalysis(content: string): AiBankAnalysis {
  const root = parseRootObject(content);
  const clustersJson = optArray(root, 'clusters');
  const clusters: AiBankCluster[] = [];
  if (clustersJson !== null) {
    for (const raw of clustersJson) {
      const item = asRecord(raw);
      if (item === null) {
        continue;
      }
      const numbersJson = optArray(item, 'questionNumbers');
      const numbers: string[] = [];
      if (numbersJson !== null) {
        for (const value of numbersJson) {
          const text = String(value).trim();
          if (text.length > 0) {
            numbers.push(text);
          }
        }
      }
      let topic = optStr(item, 'topic').trim();
      if (topic.length === 0) {
        topic = '未命名分组';
      }
      clusters.push(new AiBankCluster(topic, numbers, optStr(item, 'reason').trim()));
    }
  }
  const pairsJson = optArray(root, 'confusingPairs');
  const confusingPairs: AiConfusingPair[] = [];
  if (pairsJson !== null) {
    for (const raw of pairsJson) {
      const item = asRecord(raw);
      if (item === null) {
        continue;
      }
      confusingPairs.push(new AiConfusingPair(
        optStr(item, 'questionA').trim(), optStr(item, 'questionB').trim(), optStr(item, 'reason').trim()));
    }
  }
  const progressionsJson = optArray(root, 'progressions');
  const progressions: AiProgression[] = [];
  if (progressionsJson !== null) {
    for (const raw of progressionsJson) {
      const item = asRecord(raw);
      if (item === null) {
        continue;
      }
      const chainJson = optArray(item, 'chain');
      const chain: string[] = [];
      if (chainJson !== null) {
        for (const value of chainJson) {
          const text = String(value).trim();
          if (text.length > 0) {
            chain.push(text);
          }
        }
      }
      if (chain.length < 2) {
        continue;
      }
      progressions.push(new AiProgression(chain, optStr(item, 'description').trim()));
    }
  }
  const tipsJson = optArray(root, 'memoryTips');
  const memoryTips: string[] = [];
  if (tipsJson !== null) {
    for (const value of tipsJson) {
      const text = String(value).trim();
      if (text.length > 0) {
        memoryTips.push(text);
      }
    }
  }
  const entitiesJson = optArray(root, 'entityKnowledgeMap');
  const entityKnowledgeMap: AiEntityKnowledge[] = [];
  if (entitiesJson !== null) {
    for (const raw of entitiesJson) {
      const item = asRecord(raw);
      if (item === null) {
        continue;
      }
      const entity = optStr(item, 'entity').trim();
      if (entity.length === 0) {
        continue;
      }
      const appsJson = optArray(item, 'appearances');
      const appearances: AiEntityAppearance[] = [];
      if (appsJson !== null) {
        for (const appRaw of appsJson) {
          const app = asRecord(appRaw);
          if (app === null) {
            continue;
          }
          const qn = optStr(app, 'questionNumber').trim();
          if (qn.length === 0) {
            continue;
          }
          appearances.push(new AiEntityAppearance(qn, optStr(app, 'knowledgePoint').trim()));
        }
      }
      if (appearances.length < 2) {
        continue;
      }
      entityKnowledgeMap.push(new AiEntityKnowledge(entity, optStr(item, 'category').trim(), appearances));
    }
  }
  const overview = optStr(root, 'overview').trim();
  const reviewStrategy = optStr(root, 'reviewStrategy').trim();
  return new AiBankAnalysis(
    overview.length > 0 ? overview : 'AI 没有返回概述。',
    clusters, confusingPairs, progressions, memoryTips,
    reviewStrategy.length > 0 ? reviewStrategy : '暂无特别建议。',
    entityKnowledgeMap);
}

export function aiBankAnalysisSystemPrompt(): string {
  return AI_BANK_ANALYSIS_SYSTEM_PROMPT;
}
