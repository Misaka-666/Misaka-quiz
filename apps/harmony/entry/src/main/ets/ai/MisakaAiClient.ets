/**
 * MisakaAiClient — 平台层移植 Android ai/MisakaAiClient.kt 的网络段。
 * 收发用 @ohos.net.http：非流式 request（expectDataType STRING）+
 * 流式 requestInStream + on('dataReceive')（TextDecoder stream 模式跨块解码 → AiSse 累积器）。
 * 纯逻辑（载荷/解析/错误文案）全部在 AiCodec.ts/AiSse.ts/AiSuggestions.ts，Node 可测。
 * 流式错误体：dataReceive 期间保留前 8KB 原文（SSE 累积器会忽略非 data 行，不冲突）。
 */
import { SettingsStore } from '../state/SettingsStore';
import { KEY_AI_THINKING_LEVEL } from '../state/AppSettings';
import { http } from '@kit.NetworkKit';
import { util } from '@kit.ArkTS';
import { BusinessError } from '@kit.BasicServicesKit';
import { Question } from '../domain/Models';
import {
  AiStreamCallback, AiReviewSuggestion, AiAnalysisSuggestion, AiSingleQuestionAnalysis,
  AiRefactorResult, AiBankAnalysis
} from './AiTypes';
import {
  validateAiConfig, normalizeChatEndpoint, formatAiHttpError, buildChatRequestBody,
  contentFromChatResponse, reviewUserPayload, analysisUserPayload, singleQuestionUserPayload,
  freeAskUserPayload, bankAnalysisUserPayload, refactorUserPayload,
  parseReviewSuggestions, parseAnalysisSuggestions, parseSingleQuestionAnalysis,
  parseRefactorResult, parseBankAnalysis
} from './AiCodec';
import { AiSseAccumulator } from './AiSse';
import {
  AI_REVIEW_SYSTEM_PROMPT, AI_ANALYSIS_SYSTEM_PROMPT, AI_SINGLE_QUESTION_ANALYSIS_SYSTEM_PROMPT,
  AI_REFACTOR_SYSTEM_PROMPT, AI_FREE_ASK_SYSTEM_PROMPT, AI_BANK_ANALYSIS_SYSTEM_PROMPT
} from './AiPrompts';

const DEFAULT_AI_TIMEOUT_SECONDS = 60;
const AI_TIMEOUT_MESSAGE = 'AI 请求超时，请检查网络或适当调大超时秒数。';

function clampInt(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function describeNetworkError(err: Object): string {
  const be = err as BusinessError;
  const code = typeof be.code === 'number' ? be.code : 0;
  const message = typeof be.message === 'string' ? be.message : String(err);
  if (code === 2300028) {
    return AI_TIMEOUT_MESSAGE;
  }
  if (code === 2300006 || code === 2300007) {
    return '无法连接 AI 接口域名，请检查 API 地址或网络。';
  }
  // ponytail: 只映射 curl 系 23000xx 常见码，其余带原始 message 抛出
  return `AI 网络请求失败：${message.length > 0 ? message : '请检查接口地址和网络'}`;
}

function isPlainError(err: Object): boolean {
  return err instanceof Error;
}

export class MisakaAiClient {
  static async testConnection(apiBaseUrl: string, apiKey: string, modelName: string,
    timeoutSeconds: number, thinkingLevel: string = SettingsStore.getString(KEY_AI_THINKING_LEVEL, 'default')): Promise<string> {
    validateAiConfig(apiBaseUrl, apiKey, modelName);
    const content = await MisakaAiClient.requestOnce(apiBaseUrl, apiKey, modelName,
      '你是 Misaka Quiz 的接口连通性测试助手，只返回简短确认。',
      '请只回复 JSON：{"ok":true,"message":"connected"}',
      timeoutSeconds, null, thinkingLevel);
    return content.trim().length === 0 ? '连接成功。' : `连接成功：${content.substring(0, 40)}`;
  }

  static async reviewQuestions(apiBaseUrl: string, apiKey: string, modelName: string,
    questions: Question[], timeoutSeconds: number): Promise<AiReviewSuggestion[]> {
    validateAiConfig(apiBaseUrl, apiKey, modelName);
    if (questions.length === 0) {
      return [];
    }
    const content = await MisakaAiClient.requestOnce(apiBaseUrl, apiKey, modelName,
      AI_REVIEW_SYSTEM_PROMPT, reviewUserPayload(questions), timeoutSeconds, null);
    return parseReviewSuggestions(content);
  }

  static async generateAnalysis(apiBaseUrl: string, apiKey: string, modelName: string,
    questions: Question[], timeoutSeconds: number): Promise<AiAnalysisSuggestion[]> {
    validateAiConfig(apiBaseUrl, apiKey, modelName);
    if (questions.length === 0) {
      return [];
    }
    const content = await MisakaAiClient.requestOnce(apiBaseUrl, apiKey, modelName,
      AI_ANALYSIS_SYSTEM_PROMPT, analysisUserPayload(questions), timeoutSeconds, null);
    return parseAnalysisSuggestions(content);
  }

  /** 流式补解析：resolve 于 onDone（fullContent），reject 于错误 */
  static generateAnalysisStreaming(apiBaseUrl: string, apiKey: string, modelName: string,
    questions: Question[], callback: AiStreamCallback, timeoutSeconds: number): Promise<string> {
    validateAiConfig(apiBaseUrl, apiKey, modelName);
    if (questions.length === 0) {
      callback.onDone('');
      return Promise.resolve('');
    }
    return MisakaAiClient.requestStream(apiBaseUrl, apiKey, modelName,
      AI_ANALYSIS_SYSTEM_PROMPT, analysisUserPayload(questions), callback, timeoutSeconds);
  }

  static async analyzeSingleQuestion(apiBaseUrl: string, apiKey: string, modelName: string,
    question: Question, userAnswer: string[], onReasoning: (chunk: string) => void,
    timeoutSeconds: number): Promise<AiSingleQuestionAnalysis> {
    validateAiConfig(apiBaseUrl, apiKey, modelName);
    const content = await MisakaAiClient.requestStream(apiBaseUrl, apiKey, modelName,
      AI_SINGLE_QUESTION_ANALYSIS_SYSTEM_PROMPT, singleQuestionUserPayload(question, userAnswer),
      new AiStreamCallback(onReasoning, (): void => {}, (): void => {}), timeoutSeconds, 15);
    return parseSingleQuestionAnalysis(content, question.id);
  }

  static async freeAsk(apiBaseUrl: string, apiKey: string, modelName: string, question: Question,
    userQuestion: string, timeoutSeconds: number): Promise<string> {
    validateAiConfig(apiBaseUrl, apiKey, modelName);
    MisakaAiClient.requireAskText(userQuestion);
    return MisakaAiClient.requestOnce(apiBaseUrl, apiKey, modelName,
      AI_FREE_ASK_SYSTEM_PROMPT, freeAskUserPayload(question, userQuestion), timeoutSeconds, null);
  }

  static freeAskStreaming(apiBaseUrl: string, apiKey: string, modelName: string, question: Question,
    userQuestion: string, callback: AiStreamCallback, timeoutSeconds: number): Promise<string> {
    validateAiConfig(apiBaseUrl, apiKey, modelName);
    MisakaAiClient.requireAskText(userQuestion);
    return MisakaAiClient.requestStream(apiBaseUrl, apiKey, modelName,
      AI_FREE_ASK_SYSTEM_PROMPT, freeAskUserPayload(question, userQuestion), callback, timeoutSeconds);
  }

  static async analyzeBank(apiBaseUrl: string, apiKey: string, modelName: string,
    questions: Question[], bankName: string, timeoutSeconds: number): Promise<AiBankAnalysis> {
    validateAiConfig(apiBaseUrl, apiKey, modelName);
    if (questions.length === 0) {
      throw new Error('题库为空');
    }
    const request = bankAnalysisUserPayload(questions, bankName);
    const content = await MisakaAiClient.requestOnce(apiBaseUrl, apiKey, modelName,
      AI_BANK_ANALYSIS_SYSTEM_PROMPT, request.userPayload, timeoutSeconds, null);
    return parseBankAnalysis(content);
  }

  /** 流式题库分析：resolve 流式全文（调用方负责 parseBankAnalysis 与缓存，对齐 Android launchBankAnalysis 分工） */
  static analyzeBankStreaming(apiBaseUrl: string, apiKey: string, modelName: string,
    questions: Question[], bankName: string, callback: AiStreamCallback,
    timeoutSeconds: number): Promise<string> {
    validateAiConfig(apiBaseUrl, apiKey, modelName);
    if (questions.length === 0) {
      return Promise.reject(new Error('题库为空'));
    }
    const request = bankAnalysisUserPayload(questions, bankName);
    return MisakaAiClient.requestStream(apiBaseUrl, apiKey, modelName,
      AI_BANK_ANALYSIS_SYSTEM_PROMPT, request.userPayload, callback, timeoutSeconds);
  }

  static async refactorQuestions(apiBaseUrl: string, apiKey: string, modelName: string,
    rawText: string, answerText: string, currentQuestions: Question[], warnings: string[],
    timeoutSeconds: number): Promise<AiRefactorResult> {
    validateAiConfig(apiBaseUrl, apiKey, modelName);
    if (rawText.trim().length === 0) {
      throw new Error('AI 重构需要原始文本。');
    }
    const content = await MisakaAiClient.requestOnce(apiBaseUrl, apiKey, modelName,
      AI_REFACTOR_SYSTEM_PROMPT,
      refactorUserPayload(rawText, answerText, currentQuestions, warnings), timeoutSeconds, null);
    return parseRefactorResult(content);
  }

  private static requireAskText(userQuestion: string): void {
    if (userQuestion.trim().length === 0) {
      throw new Error('提问内容不能为空。');
    }
  }

  private static async requestOnce(apiBaseUrl: string, apiKey: string, modelName: string,
    systemPrompt: string, userPayload: string, timeoutSeconds: number,
    maxTokens: number | null, thinkingLevel: string = SettingsStore.getString(KEY_AI_THINKING_LEVEL, 'default')): Promise<string> {
    const endpoint = normalizeChatEndpoint(apiBaseUrl);
    const timeoutMillis = clampInt(timeoutSeconds, 15, 180) * 1000;
    const client: http.HttpRequest = http.createHttp();
    try {
      const response: http.HttpResponse = await client.request(endpoint, {
        method: http.RequestMethod.POST,
        header: {
          'Content-Type': 'application/json; charset=utf-8',
          'Accept': 'application/json',
          'Authorization': `Bearer ${apiKey.trim()}`
        },
        extraData: buildChatRequestBody(modelName, systemPrompt, userPayload, maxTokens, false, thinkingLevel),
        expectDataType: http.HttpDataType.STRING,
        usingCache: false,
        connectTimeout: Math.min(timeoutMillis, 30000),
        readTimeout: timeoutMillis
      });
      if (response.responseCode < 200 || response.responseCode >= 300) {
        const body = typeof response.result === 'string' ? response.result : '';
        throw new Error(formatAiHttpError(response.responseCode, body));
      }
      return contentFromChatResponse(response.result as string);
    } catch (err) {
      if (isPlainError(err)) {
        throw err as Error;
      }
      throw new Error(describeNetworkError(err));
    } finally {
      client.destroy();
    }
  }

  private static requestStream(apiBaseUrl: string, apiKey: string, modelName: string,
    systemPrompt: string, userPayload: string, callback: AiStreamCallback,
    timeoutSeconds: number, minTimeoutSeconds: number = 30): Promise<string> {
    const endpoint = normalizeChatEndpoint(apiBaseUrl);
    const timeoutMillis = clampInt(timeoutSeconds, minTimeoutSeconds, 300) * 1000;
    return new Promise<string>((resolve: (v: string) => void, reject: (e: Error) => void) => {
      const client: http.HttpRequest = http.createHttp();
      const decoder = util.TextDecoder.create('utf-8');
      const accumulator = new AiSseAccumulator(callback);
      let responseCode = 0;
      let rawErrorBody = '';
      let settled = false;
      let watchdogId = -1;
      // 停滞看门狗：requestInStream 收到响应头即 resolve，此后连接停滞（无数据也无 dataEnd）
      // 时没有任何回调会触发，Promise 永久挂起。收到数据即重置 —— 对齐非流式路径
      // readTimeout 的不活动语义，不误杀耗时超过超时秒数但仍在正常出字的长流式生成。
      const armWatchdog = (): void => {
        if (watchdogId >= 0) {
          clearTimeout(watchdogId);
        }
        watchdogId = setTimeout((): void => {
          fail(AI_TIMEOUT_MESSAGE);
        }, timeoutMillis);
      };
      const cleanup = (): void => {
        if (watchdogId >= 0) {
          clearTimeout(watchdogId);
          watchdogId = -1;
        }
        try {
          client.off('dataReceive');
          client.off('dataEnd');
          client.destroy();
        } catch (_err) {
          // ponytail: destroy 失败不影响结果交付
        }
      };
      const fail = (message: string): void => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        reject(new Error(message));
      };
      const finalize = (): void => {
        if (settled) {
          return;
        }
        if (responseCode >= 300) {
          fail(formatAiHttpError(responseCode, rawErrorBody));
          return;
        }
        const full = accumulator.finish();
        if (full.length === 0) {
          fail('AI 流式返回内容为空，请检查模型名称或接口兼容性。');
          return;
        }
        settled = true;
        cleanup();
        resolve(full);
      };
      client.on('dataReceive', (chunk: ArrayBuffer): void => {
        armWatchdog();
        const text: string = decoder.decodeWithStream(new Uint8Array(chunk), { stream: true });
        if (rawErrorBody.length < 8192) {
          rawErrorBody += text;
        }
        accumulator.push(text);
      });
      client.on('dataEnd', (): void => {
        if (responseCode === 0) {
          // 头事件 Promise 可能晚于 dataEnd 一个微任务（极端调度），推迟一轮再定稿
          setTimeout((): void => {
            finalize();
          }, 0);
        } else {
          finalize();
        }
      });
      armWatchdog();
      client.requestInStream(endpoint, {
        method: http.RequestMethod.POST,
        header: {
          'Content-Type': 'application/json; charset=utf-8',
          'Accept': 'text/event-stream',
          'Authorization': `Bearer ${apiKey.trim()}`
        },
        extraData: buildChatRequestBody(modelName, systemPrompt, userPayload, null, true, SettingsStore.getString(KEY_AI_THINKING_LEVEL, 'default')),
        usingCache: false,
        connectTimeout: Math.min(timeoutMillis, 30000),
        readTimeout: timeoutMillis
      }).then((code: number): void => {
        responseCode = code;
      }).catch((err: BusinessError): void => {
        fail(describeNetworkError(err));
      });
    });
  }
}

export const AI_DEFAULT_TIMEOUT_SECONDS = DEFAULT_AI_TIMEOUT_SECONDS;
