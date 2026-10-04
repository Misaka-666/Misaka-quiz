/**
 * 题库 AI 分析缓存 — 对应 Android MisakaAiClient 的 bankAnalysisCache +
 * SharedPreferences("misaka_ai_cache")。鸿蒙端整表存 filesDir/misaka/ai_cache.json
 * （FileStore 原子写；分析原文可能数十 KB，不进 preferences）。
 * 结构：{ "<bankId>": <AI 原始 JSON 字符串> }；内存 Map 一级缓存。
 */
import { common } from '@kit.AbilityKit';
import { FileStore } from '../state/FileStore';
import { parseBankAnalysis } from './AiCodec';
import { AiBankAnalysis } from './AiTypes';

const AI_CACHE_FILE = 'misaka/ai_cache.json';

export class AiBankAnalysisCache {
  private static parsedByBankId: Map<string, AiBankAnalysis> = new Map<string, AiBankAnalysis>();

  private static readRawTable(context: common.UIAbilityContext): Record<string, Object> {
    const state = FileStore.readJson(context.filesDir, AI_CACHE_FILE);
    return state !== null ? state : {};
  }

  static loadBankAnalysis(context: common.UIAbilityContext, bankId: string): AiBankAnalysis | null {
    const cached = AiBankAnalysisCache.parsedByBankId.get(bankId);
    if (cached !== undefined) {
      return cached;
    }
    const table = AiBankAnalysisCache.readRawTable(context);
    const raw = table[bankId];
    if (typeof raw !== 'string') {
      return null;
    }
    try {
      const parsed = parseBankAnalysis(raw as string);
      AiBankAnalysisCache.parsedByBankId.set(bankId, parsed);
      return parsed;
    } catch (_err) {
      return null;
    }
  }

  static saveBankAnalysis(context: common.UIAbilityContext, bankId: string, rawJson: string): AiBankAnalysis | null {
    let parsed: AiBankAnalysis;
    try {
      parsed = parseBankAnalysis(rawJson);
    } catch (_err) {
      return null;
    }
    AiBankAnalysisCache.parsedByBankId.set(bankId, parsed);
    const table = AiBankAnalysisCache.readRawTable(context);
    table[bankId] = rawJson;
    FileStore.writeTextAtomic(context.filesDir, AI_CACHE_FILE, JSON.stringify(table));
    return parsed;
  }

  static clearBankAnalysis(context: common.UIAbilityContext, bankId: string): void {
    AiBankAnalysisCache.parsedByBankId.delete(bankId);
    const table = AiBankAnalysisCache.readRawTable(context);
    if (typeof table[bankId] === 'string') {
      // ArkTS 禁 delete：重建不含该键的表（键少，代价可忽略）
      const next: Record<string, Object> = {};
      for (const key of Object.keys(table)) {
        if (key !== bankId) {
          next[key] = table[key];
        }
      }
      FileStore.writeTextAtomic(context.filesDir, AI_CACHE_FILE, JSON.stringify(next));
    }
  }
}
