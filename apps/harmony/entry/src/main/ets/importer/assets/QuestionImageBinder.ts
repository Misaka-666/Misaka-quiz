/**
 * 图片-题目绑定 — 1:1 移植自 Android QuestionImageBinder.kt。
 * 解析后文本中的图片标记被移除，对应图片文件挂到 Question.images。
 */
import { Question, QuestionImage, Option } from '../../domain/Models';
import { ImportResult, ImportWarning, WarningLevel, ImportDiagnostics } from '../model/ImportModels';
import { markerId, markerIdsIn, removeAllMarkers } from './QuestionImageMarker';
import { cloneQuestion } from '../model/MultiBlankSupport';

const MATERIAL_RANGE_REGEX = /回答\s*(\d+)\s*[~～\-—至到]\s*(\d+)\s*题/;

export class ExtractedImportImage {
  marker: string;
  image: QuestionImage;
  constructor(marker: string, image: QuestionImage) {
    this.marker = marker;
    this.image = image;
  }
}

function toIntOrNull(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  return parseInt(raw, 10);
}

export function attachImages(
  result: ImportResult,
  images: ExtractedImportImage[]
): ImportResult {
  if (images.length === 0) return result;
  const markerToImage = new Map<string, QuestionImage>();
  for (const item of images) {
    const key = markerId(item.marker) ?? item.marker;
    if (!markerToImage.has(key)) {
      markerToImage.set(key, item.image);
    }
  }
  const usedMarkers = new Set<string>();
  const attached: Question[] = [];
  for (const question of result.questions) {
    const markers = markersInQuestion(question);
    for (const marker of markers) usedMarkers.add(marker);
    const questionImages: QuestionImage[] = [];
    for (const marker of markers) {
      const img = markerToImage.get(marker);
      if (img !== undefined) questionImages.push(img);
    }
    const cleaned = cleanQuestionMarkers(question);
    if (questionImages.length === 0) {
      attached.push(cleaned);
    } else {
      const copy = cloneQuestion(cleaned);
      copy.images = mergeImages(cleaned.images, questionImages);
      attached.push(copy);
    }
  }

  applyMaterialImageSharing(attached);

  let boundCount = 0;
  for (const q of attached) boundCount += q.images.length;
  const allPaths: string[] = [];
  for (const q of attached) {
    for (const img of q.images) allPaths.push(img.localPath);
  }
  const uniqueBound = new Set(allPaths).size;
  let unboundCount = 0;
  for (const item of images) {
    if (!usedMarkers.has(markerId(item.marker) ?? item.marker)) unboundCount += 1;
  }
  const imageWarnings: ImportWarning[] = [
    new ImportWarning(
      unboundCount > 0 ? WarningLevel.WARNING : WarningLevel.NORMAL,
      null,
      `检测到 ${images.length} 张图片，已绑定 ${uniqueBound} 张。建议在沉浸核对中筛选图片题检查。`
    )
  ];
  if (unboundCount > 0) {
    imageWarnings.push(new ImportWarning(
      WarningLevel.WARNING,
      null,
      `有 ${unboundCount} 张图片未能明确绑定到题目，可能来自封面、说明页、答案解析区或复杂图表。`
    ));
  }

  const diagnostics = new ImportDiagnostics();
  diagnostics.normalizedLength = result.diagnostics.normalizedLength;
  diagnostics.blockCount = result.diagnostics.blockCount;
  diagnostics.answeredCount = result.diagnostics.answeredCount;
  diagnostics.candidateCount = result.diagnostics.candidateCount;
  diagnostics.notes = result.diagnostics.notes.concat(
    [`图片导入：检测 ${images.length} 张，题目引用 ${boundCount} 次，唯一绑定 ${uniqueBound} 张。`]
  );
  return new ImportResult(attached, result.strategyName, result.warnings.concat(imageWarnings), diagnostics);
}

function markersInQuestion(question: Question): string[] {
  const out: string[] = [];
  const addAll = (text: string): void => {
    for (const id of markerIdsIn(text)) {
      if (!out.includes(id)) out.push(id);
    }
  };
  addAll(question.question);
  for (const option of question.options) {
    addAll(option.text);
  }
  addAll(question.analysis);
  return out;
}

function cleanQuestionMarkers(question: Question): Question {
  const copy = cloneQuestion(question);
  copy.question = cleanText(question.question);
  copy.options = question.options.map((o: Option): Option => new Option(o.key, cleanText(o.text)));
  copy.analysis = cleanText(question.analysis);
  return copy;
}

function cleanText(text: string): string {
  return removeAllMarkers(text)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function mergeImages(existing: QuestionImage[], incoming: QuestionImage[]): QuestionImage[] {
  const seen = new Set<string>();
  const out: QuestionImage[] = [];
  for (const img of existing.concat(incoming)) {
    if (!seen.has(img.localPath)) {
      seen.add(img.localPath);
      out.push(img);
    }
  }
  return out;
}

function applyMaterialImageSharing(questions: Question[]): void {
  for (let index = 0; index < questions.length; index++) {
    const question = questions[index];
    if (question.images.length === 0) continue;
    const match = MATERIAL_RANGE_REGEX.exec(question.question);
    if (match === null) continue;
    const start = toIntOrNull(match[1] ?? '');
    const end = toIntOrNull(match[2] ?? '');
    if (start === null || end === null) continue;
    if (end < start || end - start > 20) continue;
    const count = end - start + 1;
    for (let offset = 1; offset < count; offset++) {
      const targetIndex = index + offset;
      if (targetIndex >= questions.length) break;
      const target = questions[targetIndex];
      const copy = cloneQuestion(target);
      copy.images = mergeImages(target.images, question.images);
      questions[targetIndex] = copy;
    }
  }
}
