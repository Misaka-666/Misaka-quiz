/**
 * SSE 流式事件累积器 — 纯逻辑移植 Android requestStreamCompletion 的行解析段。
 * 平台层把 dataReceive 的 ArrayBuffer 解码成文本块后 push 进来；
 * 行缓冲/「data: 」行提取/[DONE]/delta(reasoning_content+content) 解析全部在这里，
 * Node 可直接注入切块边界做回归。
 * 对齐 Android 语义：onContent 收到的是累计全文；解析失败的单行静默跳过。
 */
import { AiStreamCallback } from './AiTypes';

/** 保留最新的非空行。末尾换行单独保留，等下一段文字到达时再替换当前行。 */
export function appendAiReasoningPreview(previous: string, chunk: string): string {
  const text = (previous + chunk).replace(/[\r\u2028\u2029]/g, '\n');
  const visible = text.trimEnd();
  const line = visible.slice(visible.lastIndexOf('\n') + 1).trimStart();
  if (line.length === 0) {
    return '';
  }
  const trailing = text.slice(visible.length);
  const separator = trailing.includes('\n') ? '\n' : trailing.slice(0, 1);
  // ponytail: 只保留单行尾部。若要展示思考全文，需要独立的历史记录。
  return Array.from(line).slice(-160).join('') + separator;
}

export class AiSseAccumulator {
  private buffer: string = '';
  private content: string = '';
  private sawDoneMarker: boolean = false;
  private cb: AiStreamCallback;

  constructor(cb: AiStreamCallback) {
    this.cb = cb;
  }

  push(chunk: string): void {
    this.buffer += chunk;
    while (true) {
      const nl = this.buffer.indexOf('\n');
      if (nl < 0) {
        break;
      }
      const line = this.buffer.substring(0, nl);
      this.buffer = this.buffer.substring(nl + 1);
      this.handleLine(line.endsWith('\r') ? line.substring(0, line.length - 1) : line);
    }
  }

  /** 流结束后调用：冲刷无尾换行的残行，返回 trim 后的全文（空串表示无内容） */
  finish(): string {
    if (this.buffer.length > 0) {
      const rest = this.buffer;
      this.buffer = '';
      this.handleLine(rest);
    }
    return this.content.trim();
  }

  private handleLine(line: string): void {
    if (this.sawDoneMarker) {
      return;
    }
    if (line.trim().length === 0) {
      return;
    }
    if (!line.startsWith('data:')) {
      return;
    }
    const data = line.substring(5).trim();
    if (data === '[DONE]') {
      this.sawDoneMarker = true;
      return;
    }
    let parsed: Record<string, Object> | null = null;
    try {
      const value: object = JSON.parse(data);
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        parsed = value as Record<string, Object>;
      }
    } catch (_err) {
      parsed = null;
    }
    if (parsed === null) {
      return;
    }
    const choices = optArray(parsed, 'choices');
    if (choices === null || choices.length === 0) {
      return;
    }
    const first = asRecord(choices[0]);
    if (first === null) {
      return;
    }
    const delta = asRecord(first['delta']);
    if (delta === null) {
      return;
    }
    const reasoning = optStr(delta, 'reasoning_content');
    const contentChunk = optStr(delta, 'content');
    if (reasoning.length > 0) {
      this.cb.onReasoning(reasoning);
    }
    if (contentChunk.length > 0) {
      this.content += contentChunk;
      this.cb.onContent(this.content);
    }
  }
}

// ---------- 极简 JSON 读取（对齐 org.json optXxx 的宽松语义） ----------

function asRecord(value: Object | undefined): Record<string, Object> | null {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, Object>;
  }
  return null;
}

function optStr(obj: Record<string, Object>, key: string): string {
  const v: Object | undefined = obj[key];
  if (v === undefined || v === null) {
    return '';
  }
  return typeof v === 'string' ? v : String(v);
}

function optArray(obj: Record<string, Object>, key: string): Object[] | null {
  const v: Object | undefined = obj[key];
  if (Array.isArray(v)) {
    const out: Object[] = [];
    for (let i = 0; i < v.length; i++) {
      out.push(v[i] as Object);
    }
    return out;
  }
  return null;
}
