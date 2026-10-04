/**
 * AI 结果模型 — 1:1 移植自 Android ai/MisakaAiClient.kt 顶部 data class 组。
 * 约束：TS/ArkTS 公共子集（Node 可测 + hvigor 可编译）。
 */
import { Option, Question } from '../domain/Models';

export class AiReviewSuggestion {
  questionId: string;
  status: string;
  issueTypes: string[];
  reason: string;
  suggestion: string;
  suggestedType: string | null;
  suggestedAnswer: string[];
  suggestedQuestion: string | null;
  suggestedOptions: Option[];
  suggestedAnalysis: string | null;
  riskLevel: string;
  canApply: boolean;
  needHumanReview: boolean;
  confidence: number;
  constructor(questionId: string, status: string, issueTypes: string[], reason: string, suggestion: string,
    suggestedType: string | null, suggestedAnswer: string[], suggestedQuestion: string | null,
    suggestedOptions: Option[], suggestedAnalysis: string | null, riskLevel: string, canApply: boolean,
    needHumanReview: boolean, confidence: number) {
    this.questionId = questionId;
    this.status = status;
    this.issueTypes = issueTypes;
    this.reason = reason;
    this.suggestion = suggestion;
    this.suggestedType = suggestedType;
    this.suggestedAnswer = suggestedAnswer;
    this.suggestedQuestion = suggestedQuestion;
    this.suggestedOptions = suggestedOptions;
    this.suggestedAnalysis = suggestedAnalysis;
    this.riskLevel = riskLevel;
    this.canApply = canApply;
    this.needHumanReview = needHumanReview;
    this.confidence = confidence;
  }
}

export class AiAnalysisSuggestion {
  questionId: string;
  analysis: string;
  needHumanReview: boolean;
  confidence: number;
  constructor(questionId: string, analysis: string, needHumanReview: boolean, confidence: number) {
    this.questionId = questionId;
    this.analysis = analysis;
    this.needHumanReview = needHumanReview;
    this.confidence = confidence;
  }
}

export class AiSingleQuestionAnalysis {
  questionId: string;
  suggestedAnswer: string;
  matchesLocalAnswer: boolean | null;
  analysis: string;
  confidence: string;
  needsReview: boolean;
  warning: string;
  constructor(questionId: string, suggestedAnswer: string, matchesLocalAnswer: boolean | null,
    analysis: string, confidence: string, needsReview: boolean, warning: string) {
    this.questionId = questionId;
    this.suggestedAnswer = suggestedAnswer;
    this.matchesLocalAnswer = matchesLocalAnswer;
    this.analysis = analysis;
    this.confidence = confidence;
    this.needsReview = needsReview;
    this.warning = warning;
  }
}

export class AiRefactorResult {
  mode: string;
  cleanedText: string | null;
  cleanedAnswerText: string | null;
  questions: Question[];
  notes: string[];
  constructor(mode: string, cleanedText: string | null, cleanedAnswerText: string | null,
    questions: Question[], notes: string[]) {
    this.mode = mode;
    this.cleanedText = cleanedText;
    this.cleanedAnswerText = cleanedAnswerText;
    this.questions = questions;
    this.notes = notes;
  }
}

export class AiBankCluster {
  topic: string;
  questionNumbers: string[];
  reason: string;
  constructor(topic: string, questionNumbers: string[], reason: string) {
    this.topic = topic;
    this.questionNumbers = questionNumbers;
    this.reason = reason;
  }
}

export class AiConfusingPair {
  questionA: string;
  questionB: string;
  reason: string;
  constructor(questionA: string, questionB: string, reason: string) {
    this.questionA = questionA;
    this.questionB = questionB;
    this.reason = reason;
  }
}

export class AiProgression {
  chain: string[];
  description: string;
  constructor(chain: string[], description: string) {
    this.chain = chain;
    this.description = description;
  }
}

export class AiEntityAppearance {
  questionNumber: string;
  knowledgePoint: string;
  constructor(questionNumber: string, knowledgePoint: string) {
    this.questionNumber = questionNumber;
    this.knowledgePoint = knowledgePoint;
  }
}

export class AiEntityKnowledge {
  entity: string;
  category: string;
  appearances: AiEntityAppearance[];
  constructor(entity: string, category: string, appearances: AiEntityAppearance[]) {
    this.entity = entity;
    this.category = category;
    this.appearances = appearances;
  }
}

export class AiBankAnalysis {
  overview: string;
  clusters: AiBankCluster[];
  confusingPairs: AiConfusingPair[];
  progressions: AiProgression[];
  memoryTips: string[];
  reviewStrategy: string;
  entityKnowledgeMap: AiEntityKnowledge[];
  constructor(overview: string, clusters: AiBankCluster[], confusingPairs: AiConfusingPair[],
    progressions: AiProgression[], memoryTips: string[], reviewStrategy: string,
    entityKnowledgeMap: AiEntityKnowledge[]) {
    this.overview = overview;
    this.clusters = clusters;
    this.confusingPairs = confusingPairs;
    this.progressions = progressions;
    this.memoryTips = memoryTips;
    this.reviewStrategy = reviewStrategy;
    this.entityKnowledgeMap = entityKnowledgeMap;
  }
}

/**
 * 流式回调 — 对齐 Android AiStreamCallback 三方法。
 * 注意：onContent 收到的是「累计全文」（Android 端传 contentBuilder.toString()）。
 */
export class AiStreamCallback {
  onReasoning: (chunk: string) => void;
  onContent: (cumulative: string) => void;
  onDone: (fullContent: string) => void;
  constructor(onReasoning: (chunk: string) => void, onContent: (cumulative: string) => void,
    onDone: (fullContent: string) => void) {
    this.onReasoning = onReasoning;
    this.onContent = onContent;
    this.onDone = onDone;
  }
}
