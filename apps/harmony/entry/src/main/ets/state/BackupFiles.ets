/**
 * 备份平台层 — ZIP 装包（zlib.compressFile 目录压缩）/备份 ZIP 解包/资产注册回调。
 * 对应 Android buildBackupZip（ZipOutputStream）/importBackupZip（SafeZipReader 限额：
 * 1000 条 / 单条 20MB / 总量 100MB）。纯映射逻辑在 BackupCodec.ts（Node 可测）。
 */
import { zlib } from '@kit.BasicServicesKit';
import { fileIo } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { common } from '@kit.AbilityKit';
import { QuestionImage, QuizBank, WrongQuestionEntry, FavoriteQuestionEntry, StudyRecord } from '../domain/Models';
import { buildBackupJson, BACKUP_KIND_FULL } from './BackupCodec';

const MAX_BACKUP_ENTRIES = 1000;
const MAX_BACKUP_ENTRY_SIZE = 20 * 1024 * 1024;
const MAX_BACKUP_TOTAL_SIZE = 100 * 1024 * 1024;

export class BackupBuildRequest {
  kind: string = BACKUP_KIND_FULL;
  banks: QuizBank[] = [];
  activeBankId: string = '';
  wrongBook: WrongQuestionEntry[] = [];
  favorites: FavoriteQuestionEntry[] = [];
  records: StudyRecord[] = [];
  includeWrongBook: boolean = true;
  includeFavorites: boolean = true;
  includeStudyRecords: boolean = true;
}

export class BackupZipContent {
  jsonText: string = '';
  assets: Map<string, Uint8Array> = new Map<string, Uint8Array>();
}

function readBytes(path: string): Uint8Array {
  const stat: fileIo.Stat = fileIo.statSync(path);
  const buf: ArrayBuffer = new ArrayBuffer(stat.size);
  const file: fileIo.File = fileIo.openSync(path, fileIo.OpenMode.READ_ONLY);
  try {
    fileIo.readSync(file.fd, buf);
  } finally {
    fileIo.closeSync(file);
  }
  return new Uint8Array(buf);
}

// 只收 ArrayBuffer（writeSync 不认 Uint8Array 视图；唯一调用方 openBackupZip 传入的正是整段 buffer）
function writeBytes(path: string, data: ArrayBuffer): void {
  const file: fileIo.File = fileIo.openSync(path, fileIo.OpenMode.READ_WRITE | fileIo.OpenMode.CREATE | fileIo.OpenMode.TRUNC);
  try {
    fileIo.writeSync(file.fd, data);
  } finally {
    fileIo.closeSync(file);
  }
}

function removeDir(path: string): void {
  try {
    if (fileIo.accessSync(path)) {
      fileIo.rmdirSync(path);
    }
  } catch (_err) {
    // 清理失败不影响主流程，遗留 tmp 目录可被下次覆盖
  }
}

function writeText(path: string, text: string): void {
  const file: fileIo.File = fileIo.openSync(path, fileIo.OpenMode.READ_WRITE | fileIo.OpenMode.CREATE | fileIo.OpenMode.TRUNC);
  try {
    fileIo.writeSync(file.fd, text);
  } finally {
    fileIo.closeSync(file);
  }
}

function extensionOf(path: string): string {
  const base = path.split('/').pop() ?? path;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.substring(dot + 1) : '';
}

function sanitizeAssetToken(raw: string, fallback: string): string {
  const safe = raw.replace(/[^A-Za-z0-9_.-]/g, '_').substring(0, 80);
  return safe.length > 0 ? safe : fallback;
}

/** 完整备份 ZIP → 字节（backup.json + assets/，zip 根即内容，M0 已验证跨端可读） */
export async function buildBackupZipBytes(context: common.UIAbilityContext, req: BackupBuildRequest): Promise<ArrayBuffer | null> {
  const stamp = Date.now();
  const tmpRoot = `${context.filesDir}/misaka/tmp_export_${stamp}`;
  const assetsDir = `${tmpRoot}/assets`;
  const zipPath = `${context.filesDir}/misaka/tmp_export_${stamp}.zip`;
  try {
    fileIo.mkdirSync(assetsDir, true);
    const assetSources = new Map<string, string>();
    const registerAsset = (image: QuestionImage): string | null => {
      if (image.localPath.length === 0) {
        return null;
      }
      let isFile = false;
      try {
        isFile = fileIo.accessSync(image.localPath) && fileIo.statSync(image.localPath).isFile();
      } catch (_err) {
        isFile = false;
      }
      if (!isFile) {
        return null;
      }
      let ext = extensionOf(image.localPath);
      if (ext.length === 0) {
        ext = extensionOf(image.sourceName);
      }
      if (ext.length === 0) {
        ext = 'bin';
      }
      const base = image.localPath.split('/').pop() ?? image.localPath;
      const rawId = image.id.length > 0 ? image.id : base.replace(/\.[^.]*$/, '');
      const backupPath = `assets/${sanitizeAssetToken(rawId, 'asset')}.${ext}`;
      // 对齐 Android distinctBy：同一 backupPath 首个来源生效
      if (!assetSources.has(backupPath)) {
        assetSources.set(backupPath, image.localPath);
      }
      return backupPath;
    };
    const root = buildBackupJson(req.kind, req.banks, req.activeBankId, req.wrongBook, req.favorites,
      req.records, req.includeWrongBook, req.includeFavorites, req.includeStudyRecords, registerAsset, stamp);
    writeText(`${tmpRoot}/backup.json`, JSON.stringify(root, null, 2));
    const assetNames = Array.from(assetSources.keys());
    for (const backupPath of assetNames) {
      const source = assetSources.get(backupPath) as string;
      fileIo.copyFileSync(source, `${tmpRoot}/${backupPath}`);
    }
    await zlib.compressFile(tmpRoot, zipPath, { level: 9 });
    // readBytes 自建等长 buffer、视图永远对齐，.buffer 即精确 ZIP 内容（若改 readBytes 需保持该不变量）
    return readBytes(zipPath).buffer as ArrayBuffer;
  } catch (_err) {
    return null;
  } finally {
    removeDir(tmpRoot);
    try {
      if (fileIo.accessSync(zipPath)) {
        fileIo.unlinkSync(zipPath);
      }
    } catch (_err) {
      // best-effort
    }
  }
}

class WalkedEntry {
  name: string = '';
  path: string = '';
  size: number = 0;
}

function walkBackupDir(dir: string, prefix: string, out: WalkedEntry[]): boolean {
  const names: string[] = fileIo.listFileSync(dir);
  for (const name of names) {
    if (out.length >= MAX_BACKUP_ENTRIES) {
      return false;
    }
    const fullPath = `${dir}/${name}`;
    const stat: fileIo.Stat = fileIo.statSync(fullPath);
    if (stat.isDirectory()) {
      if (!walkBackupDir(fullPath, prefix.length > 0 ? `${prefix}/${name}` : name, out)) {
        return false;
      }
    } else if (stat.size <= MAX_BACKUP_ENTRY_SIZE) {
      const entry = new WalkedEntry();
      entry.name = prefix.length > 0 ? `${prefix}/${name}` : name;
      entry.path = fullPath;
      entry.size = stat.size;
      out.push(entry);
    } else {
      return false;
    }
  }
  return true;
}

/** 备份 ZIP → backup.json 文本 + assets/ 条目字节；损坏/超限/缺 json 返回 null */
export async function openBackupZip(context: common.UIAbilityContext, bytes: ArrayBuffer): Promise<BackupZipContent | null> {
  const stamp = Date.now();
  const tmpRoot = `${context.filesDir}/misaka`;
  const tmpZip = `${tmpRoot}/tmp_backup_${stamp}.zip`;
  const tmpDir = `${tmpRoot}/tmp_backup_${stamp}`;
  try {
    if (!fileIo.accessSync(tmpRoot)) {
      fileIo.mkdirSync(tmpRoot, true);
    }
    writeBytes(tmpZip, bytes);
    fileIo.mkdirSync(tmpDir, true);
    await zlib.decompressFile(tmpZip, tmpDir, {});
    const walked: WalkedEntry[] = [];
    if (!walkBackupDir(tmpDir, '', walked)) {
      return null;
    }
    let total = 0;
    for (const entry of walked) {
      total += entry.size;
    }
    if (total > MAX_BACKUP_TOTAL_SIZE) {
      return null;
    }
    let jsonEntry = walked.find((e: WalkedEntry): boolean => e.name === 'backup.json');
    if (jsonEntry === undefined) {
      jsonEntry = walked.find((e: WalkedEntry): boolean => e.name.toLowerCase().endsWith('.json'));
    }
    if (jsonEntry === undefined) {
      return null;
    }
    const content = new BackupZipContent();
    content.jsonText = util.TextDecoder.create('utf-8').decodeWithStream(readBytes(jsonEntry.path));
    for (const entry of walked) {
      if (entry.name.startsWith('assets/')) {
        content.assets.set(entry.name, readBytes(entry.path));
      }
    }
    return content;
  } catch (_err) {
    return null;
  } finally {
    try {
      if (fileIo.accessSync(tmpZip)) {
        fileIo.unlinkSync(tmpZip);
      }
    } catch (_err) {
      // best-effort
    }
    removeDir(tmpDir);
  }
}
