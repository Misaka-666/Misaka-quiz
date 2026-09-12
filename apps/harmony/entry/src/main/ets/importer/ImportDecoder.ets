/**
 * 导入文件解码平台层 — 对应 Android TextImportDecoder.kt / QuestionImportAssetExtractor.kt 的
 * 平台部分（ZIP 读取 / 字符集回退 / 图片提取降采样）。
 * 纯 XML/文本变换在 parser/XmlDecoders.ts（Node 可测）；本文件只做 IO 编排。
 * ZIP 安全：Android SafeZipReader 的防 zip-slip/限额由 zlib.decompressFile（系统 API 负责路径安全）
 * + 条目数/单条/总量限额（walk 时强制）等价替代。
 */
import { zlib } from '@kit.BasicServicesKit';
import { fileIo } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { image } from '@kit.ImageKit';
import { common } from '@kit.AbilityKit';
import { normalizeText } from './parser/QuestionTextNormalizer';
import {
  extractTextFromWordXml,
  extractDocxTextWithImageMarkers,
  extractSpreadsheetSharedStrings,
  extractSpreadsheetRows,
  sheetOrder
} from './parser/XmlDecoders';
import { QuestionImage } from '../domain/Models';
import { ExtractedImportImage } from './assets/QuestionImageBinder';

const MAX_ENTRIES = 500;
const MAX_ENTRY_SIZE = 10 * 1024 * 1024;
const MAX_TOTAL_SIZE = 50 * 1024 * 1024;

export class ImportedContent {
  text: string = '';
  images: ExtractedImportImage[] = [];
}

export class DecodeOutcome {
  ok: boolean = false;
  content: ImportedContent | null = null;
  userMessage: string = '';
  technicalMessage: string = '';
}

class ExtractedEntry {
  name: string;
  path: string;
  size: number;
  constructor(name: string, path: string, size: number) {
    this.name = name;
    this.path = path;
    this.size = size;
  }
}

function readBytes(path: string): ArrayBuffer {
  const stat: fileIo.Stat = fileIo.statSync(path);
  const buf: ArrayBuffer = new ArrayBuffer(stat.size);
  const file: fileIo.File = fileIo.openSync(path, fileIo.OpenMode.READ_ONLY);
  try {
    fileIo.readSync(file.fd, buf);
  } finally {
    fileIo.closeSync(file);
  }
  return buf;
}

function readTextFile(path: string): string {
  return util.TextDecoder.create('utf-8').decodeWithStream(new Uint8Array(readBytes(path)));
}

function writeBytes(path: string, data: ArrayBuffer): void {
  const file: fileIo.File = fileIo.openSync(path, fileIo.OpenMode.READ_WRITE | fileIo.OpenMode.CREATE | fileIo.OpenMode.TRUNC);
  try {
    fileIo.writeSync(file.fd, data);
  } finally {
    fileIo.closeSync(file);
  }
}

function looksLikeZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4B && bytes[2] === 3 && bytes[3] === 4;
}

function walkExtractedDir(root: string, dir: string, prefix: string, out: ExtractedEntry[]): string {
  const names: string[] = fileIo.listFileSync(dir);
  for (const name of names) {
    if (out.length >= MAX_ENTRIES) {
      return 'STOP';
    }
    const fullPath = `${dir}/${name}`;
    const stat: fileIo.Stat = fileIo.statSync(fullPath);
    if (stat.isDirectory()) {
      const signal = walkExtractedDir(root, fullPath, prefix.length > 0 ? `${prefix}/${name}` : name, out);
      if (signal === 'STOP') {
        return 'STOP';
      }
    } else {
      if (stat.size > MAX_ENTRY_SIZE) {
        return 'TOO_LARGE';
      }
      out.push(new ExtractedEntry(prefix.length > 0 ? `${prefix}/${name}` : name, fullPath, stat.size));
    }
  }
  return '';
}

function totalSizeOf(entries: ExtractedEntry[]): number {
  let total = 0;
  for (const entry of entries) {
    total += entry.size;
  }
  return total;
}

function cleanupDir(path: string): void {
  try {
    if (fileIo.accessSync(path)) {
      fileIo.rmdirSync(path);
    }
  } catch (_err) {
    // 清理失败不影响导入结果
  }
}

// 解码入口：bytes + 文件名 → 规范化文本（+ docx 内嵌图片）
export async function decodeImportFile(
  context: common.UIAbilityContext,
  bytes: ArrayBuffer,
  fileName: string
): Promise<DecodeOutcome> {
  if (bytes.byteLength === 0) {
    const empty = new DecodeOutcome();
    empty.ok = true;
    empty.content = new ImportedContent();
    return empty;
  }
  const lowerName = fileName.toLowerCase();
  const byteView = new Uint8Array(bytes);

  // 临时 zip/目录在全部解码（含异步图片处理）完成后统一清理
  let tmpZipToClean = '';
  let tmpDirToClean = '';
  try {
    let entries: ExtractedEntry[] | null = null;
    let zipFailed = false;
    let zipErrorDetail = '';
    if (looksLikeZip(byteView)) {
      const stamp = Date.now();
      const tmpRoot = `${context.filesDir}/misaka`;
      const tmpZip = `${tmpRoot}/tmp_import_${stamp}.zip`;
      const tmpDir = `${tmpRoot}/tmp_import_${stamp}`;
      tmpZipToClean = tmpZip;
      tmpDirToClean = tmpDir;
      try {
        if (!fileIo.accessSync(tmpRoot)) {
          fileIo.mkdirSync(tmpRoot, true);
        }
        writeBytes(tmpZip, bytes);
        fileIo.mkdirSync(tmpDir, true);
        await zlib.decompressFile(tmpZip, tmpDir, {});
        const walked: ExtractedEntry[] = [];
        const signal = walkExtractedDir(tmpDir, tmpDir, '', walked);
        if (signal === 'TOO_LARGE' || totalSizeOf(walked) > MAX_TOTAL_SIZE) {
          zipFailed = true;
          zipErrorDetail = signal === 'TOO_LARGE' ? 'entry too large' : 'total size exceeded';
        } else {
          entries = walked;
        }
      } catch (err) {
        zipFailed = true;
        zipErrorDetail = err instanceof Error ? err.message : String(err);
      }
    }

    const hasDocumentXml = entries !== null && entries.some((e: ExtractedEntry): boolean => e.name === 'word/document.xml');
    const hasWorksheets = entries !== null && entries.some((e: ExtractedEntry): boolean => e.name.startsWith('xl/worksheets/'));

    if (lowerName.endsWith('.docx') || hasDocumentXml) {
      return await decodeDocx(context, entries, zipFailed, zipErrorDetail, lowerName.endsWith('.docx') || hasDocumentXml);
    }
    if (lowerName.endsWith('.xlsx') || hasWorksheets) {
      return decodeXlsx(entries, zipFailed, zipErrorDetail);
    }
    if (zipFailed && (lowerName.endsWith('.docx') || lowerName.endsWith('.xlsx'))) {
      const failure = new DecodeOutcome();
      failure.userMessage = '文件无法读取，可能已损坏。请重新导出或另存为对应格式后再试。';
      failure.technicalMessage = zipErrorDetail;
      return failure;
    }

    const plain = new DecodeOutcome();
    plain.ok = true;
    plain.content = new ImportedContent();
    plain.content.text = normalizeText(decodePlainText(byteView));
    return plain;
  } finally {
    if (tmpZipToClean.length > 0) {
      try {
        if (fileIo.accessSync(tmpZipToClean)) {
          fileIo.unlinkSync(tmpZipToClean);
        }
      } catch (_err) {
        // best-effort
      }
    }
    if (tmpDirToClean.length > 0) {
      cleanupDir(tmpDirToClean);
    }
  }
}

function decodePlainText(bytes: Uint8Array): string {
  const utf8 = util.TextDecoder.create('utf-8').decodeWithStream(bytes);
  if (!utf8.includes('\uFFFD')) {
    return utf8;
  }
  try {
    return util.TextDecoder.create('gb18030').decodeWithStream(bytes);
  } catch (_err) {
    return utf8;
  }
}

function docxFailure(emptyMessage: string, technical: string): DecodeOutcome {
  // 与 Android 对齐：zip 结构读不出时的用户文案优先
  const outcome = new DecodeOutcome();
  outcome.userMessage = emptyMessage;
  outcome.technicalMessage = technical;
  return outcome;
}

async function decodeDocx(
  context: common.UIAbilityContext,
  entries: ExtractedEntry[] | null,
  zipFailed: boolean,
  zipErrorDetail: string,
  isDocxRoute: boolean
): Promise<DecodeOutcome> {
  if (entries === null) {
    return zipFailed
      ? docxFailure('文件无法读取，可能已损坏。请重新导出或另存为 docx 后再试。',
        zipErrorDetail.length > 0 ? zipErrorDetail : 'zip extract failed')
      : docxFailure('这个文件不是标准 docx 文档。请用 Word 或 WPS 另存为 docx 后再导入。', 'not a zip');
  }
  const documentEntry = entries.find((e: ExtractedEntry): boolean => e.name === 'word/document.xml');
  if (documentEntry === undefined) {
    return isDocxRoute
      ? docxFailure('这个 docx 结构不完整，缺少可读取的正文内容。', 'missing word/document.xml')
      : docxFailure('文件无法读取，可能已损坏。请重新导出或另存为 docx 后再试。', 'missing word/document.xml');
  }
  const documentXml = readTextFile(documentEntry.path);
  const relsEntry = entries.find((e: ExtractedEntry): boolean => e.name === 'word/_rels/document.xml.rels');
  const relationshipsXml = relsEntry !== undefined ? readTextFile(relsEntry.path) : '';
  const mediaNames: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('word/media/')) {
      mediaNames.push(entry.name);
    }
  }

  if (mediaNames.length === 0) {
    return textOutcome(extractTextFromWordXml(documentXml), '这个 docx 结构不完整，缺少可读取的正文内容。');
  }

  const marked = extractDocxTextWithImageMarkers(documentXml, relationshipsXml, mediaNames);
  if (normalizeText(marked.text).trim().length === 0) {
    return textOutcome(extractTextFromWordXml(documentXml), '这个 docx 结构不完整，缺少可读取的正文内容。');
  }

  const sessionDir = `${context.filesDir}/question_assets/import_${Date.now()}`;
  fileIo.mkdirSync(sessionDir, true);
  const pathByName = new Map<string, string>();
  for (const entry of entries) {
    pathByName.set(entry.name, entry.path);
  }
  const images: ExtractedImportImage[] = [];
  for (let index = 0; index < marked.imageMarkers.length; index++) {
    const markerEntry = marked.imageMarkers[index];
    const sourcePath = pathByName.get(markerEntry.mediaName);
    if (sourcePath === undefined) {
      continue;
    }
    const saved = await saveImportImage(sourcePath, sessionDir, markerEntry.mediaName.split('/').pop() ?? '', index + 1);
    if (saved !== null) {
      images.push(new ExtractedImportImage(markerEntry.marker, saved));
    }
  }

  const outcome = new DecodeOutcome();
  outcome.ok = true;
  outcome.content = new ImportedContent();
  outcome.content.text = normalizeText(marked.text);
  outcome.content.images = images;
  return outcome;
}

function decodeXlsx(entries: ExtractedEntry[] | null, zipFailed: boolean, zipErrorDetail: string): DecodeOutcome {
  if (entries === null) {
    return zipFailed
      ? docxFailure('文件无法读取，可能已损坏。请重新导出或另存为 xlsx 后再试。',
        zipErrorDetail.length > 0 ? zipErrorDetail : 'zip extract failed')
      : docxFailure('这个文件不是标准 xlsx 表格。请用 Excel 或 WPS 另存为 xlsx 后再导入。', 'not a zip');
  }
  const sharedEntry = entries.find((e: ExtractedEntry): boolean => e.name === 'xl/sharedStrings.xml');
  const sharedStrings = sharedEntry !== undefined
    ? extractSpreadsheetSharedStrings(readTextFile(sharedEntry.path))
    : [];
  const sheets = entries
    .filter((e: ExtractedEntry): boolean => e.name.startsWith('xl/worksheets/') && e.name.endsWith('.xml'))
    .slice()
    .sort((a: ExtractedEntry, b: ExtractedEntry): number => {
      const orderDiff = sheetOrder(a.name) - sheetOrder(b.name);
      return orderDiff !== 0 ? orderDiff : (a.name < b.name ? -1 : (a.name > b.name ? 1 : 0));
    });
  if (sheets.length === 0) {
    return docxFailure('这个 xlsx 没有可读取的工作表内容。', 'no worksheets');
  }
  const parts: string[] = [];
  for (const sheet of sheets) {
    const rows = extractSpreadsheetRows(readTextFile(sheet.path), sharedStrings);
    if (rows.trim().length > 0) {
      parts.push(rows);
    }
  }
  const text = parts.join('\n\n');
  return textOutcome(text, '这个 xlsx 没有可读取的工作表内容。');
}

function textOutcome(text: string, emptyMessage: string): DecodeOutcome {
  const normalized = text !== null ? normalizeText(text) : '';
  const outcome = new DecodeOutcome();
  if (normalized.trim().length === 0) {
    outcome.userMessage = emptyMessage;
    return outcome;
  }
  outcome.ok = true;
  outcome.content = new ImportedContent();
  outcome.content.text = normalized;
  return outcome;
}

// 图片处理：>800KB 或最长边 >1400px 时按 2 的幂采样 + 缩放到最长边 1200 再压缩
// ponytail: 不做 PNG alpha 判定（Android 无 alpha 的 png 会转 JPEG），png 恒 PNG，文件稍大；升级路径 = PixelMap alpha 通道检测
async function saveImportImage(
  sourcePath: string,
  sessionDir: string,
  sourceName: string,
  order: number
): Promise<QuestionImage | null> {
  const lower = sourceName.toLowerCase();
  let ext = 'png';
  if (lower.endsWith('.webp')) {
    ext = 'webp';
  } else if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
    ext = 'jpg';
  }
  const id = order.toString().padStart(4, '0');
  const destPath = `${sessionDir}/img_${id}.${ext}`;
  const sourceBytes = fileIo.statSync(sourcePath).size;

  try {
    const source = image.createImageSource(sourcePath);
    const info = await source.getImageInfo();
    const originalWidth = info.size.width > 0 ? info.size.width : null;
    const originalHeight = info.size.height > 0 ? info.size.height : null;
    const maxDimension = Math.max(originalWidth ?? 0, originalHeight ?? 0);
    const keepOriginal = sourceBytes <= 800000 && maxDimension <= 1400;
    if (keepOriginal || originalWidth === null || originalHeight === null) {
      fileIo.copyFileSync(sourcePath, destPath);
      await source.release();
      return new QuestionImage(util.generateRandomUUID(true), destPath, sourceName, order,
        originalWidth, originalHeight, fileIo.statSync(destPath).size);
    }

    let sampleSize = 1;
    while (maxDimension / sampleSize > 1200 * 2) {
      sampleSize *= 2;
    }
    const pixelMap = await source.createPixelMap({ sampleSize: sampleSize });
    const decodedInfo = await pixelMap.getImageInfo();
    const decodedMax = Math.max(decodedInfo.size.width, decodedInfo.size.height);
    const scale = decodedMax > 0 ? 1200 / decodedMax : 1;
    if (scale < 1) {
      await pixelMap.scale(scale, scale);
    }
    const finalInfo = await pixelMap.getImageInfo();
    const packer = image.createImagePacker();
    const format = ext === 'png' ? 'image/png' : 'image/jpeg';
    const quality = ext === 'png' ? 100 : 88;
    const packed = await packer.packing(pixelMap, { format: format, quality: quality });
    await packer.release();
    await pixelMap.release();
    await source.release();
    writeBytes(destPath, packed);
    return new QuestionImage(util.generateRandomUUID(true), destPath, sourceName, order,
      finalInfo.size.width, finalInfo.size.height, packed.byteLength);
  } catch (_err) {
    // 解码失败时退回原图拷贝，保证导入不因单张图片中断
    try {
      fileIo.copyFileSync(sourcePath, destPath);
      return new QuestionImage(util.generateRandomUUID(true), destPath, sourceName, order,
        null, null, fileIo.statSync(destPath).size);
    } catch (_copyErr) {
      return null;
    }
  }
}

// 供 UI 直接读取已选中的文档 uri 字节
export function readUriBytes(uri: string): ArrayBuffer | null {
  try {
    const file: fileIo.File = fileIo.openSync(uri, fileIo.OpenMode.READ_ONLY);
    try {
      const stat: fileIo.Stat = fileIo.statSync(file.fd);
      const buf: ArrayBuffer = new ArrayBuffer(stat.size);
      fileIo.readSync(file.fd, buf);
      return buf;
    } finally {
      fileIo.closeSync(file);
    }
  } catch (_err) {
    return null;
  }
}

// 供 UI 取文件名
export function baseNameOf(uri: string): string {
  const clean = uri.split('?')[0] ?? uri;
  const segments = clean.split('/');
  return segments.length > 0 ? segments[segments.length - 1] : uri;
}
