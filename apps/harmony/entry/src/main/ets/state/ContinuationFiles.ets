import { common } from '@kit.AbilityKit';
import { fileIo, fileUri } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { cryptoFramework } from '@kit.CryptoArchitectureKit';
import { commonType } from '@kit.ArkData';
import {
  ContinuationPayload, ContinuationAssetInfo, mapImagePaths, validatePayload,
  MAX_CONTINUATION_BYTES, MAX_MANIFEST_BYTES, MAX_ASSET_BYTES
} from './ContinuationCodec';

async function readBytes(path: string, limit: number): Promise<Uint8Array> {
  const stat = await fileIo.stat(path);
  if (!stat.isFile() || stat.size <= 0 || stat.size > limit) { throw new Error('接续文件不存在或过大'); }
  const file = await fileIo.open(path, fileIo.OpenMode.READ_ONLY);
  try {
    const buffer = new ArrayBuffer(stat.size);
    if (await fileIo.read(file.fd, buffer) !== stat.size) { throw new Error('接续文件读取不完整'); }
    return new Uint8Array(buffer);
  } finally { await fileIo.close(file); }
}

async function digest(bytes: Uint8Array): Promise<string> {
  const md = cryptoFramework.createMd('SHA256');
  await md.update({ data: bytes });
  const result = await md.digest();
  return Array.from(result.data).map((b: number): string => b.toString(16).padStart(2, '0')).join('');
}

async function writeBytes(fd: number, bytes: Uint8Array): Promise<void> {
  const buffer = bytes.slice().buffer as ArrayBuffer;
  if (await fileIo.write(fd, buffer) !== bytes.byteLength) { throw new Error('存储空间不足，接续文件未写完整'); }
}

export class ReceivedContinuation {
  payload: ContinuationPayload = new ContinuationPayload();
  paths: Map<string, string> = new Map<string, string>();
}

/** 单个文件资产：4 字节清单长度 + UTF-8 清单 + 顺序图片。先校验限额再分配，无解压放大风险。 */
export class ContinuationFiles {
  private context: common.UIAbilityContext;
  constructor(context: common.UIAbilityContext) { this.context = context; }

  async exportAsset(payload: ContinuationPayload, token: string): Promise<commonType.Asset> {
    const sources = new Map<string, string>();
    mapImagePaths(payload, (path: string): string => { sources.set(path, path); return path; });
    const names = new Map<string, string>();
    const uniqueSources = new Map<string, string>();
    let total = 0;
    for (const path of sources.keys()) {
      // 只允许应用私有目录中的题图，不接受接续内容指定任意系统路径。
      if (!path.startsWith(`${this.context.filesDir}/question_assets/`) || path.includes('\\') ||
        path.split('/').some((part: string): boolean => part === '..' || part === '.')) {
        throw new Error('题图路径无效，请重新导入题库');
      }
      const bytes = await readBytes(path, MAX_ASSET_BYTES);
      const name = await digest(bytes);
      names.set(path, name);
      if (!uniqueSources.has(name)) {
        const info = new ContinuationAssetInfo();
        info.name = name;
        info.size = bytes.byteLength;
        payload.assets.push(info);
        uniqueSources.set(name, path);
        total += info.size;
      }
      if (total > MAX_CONTINUATION_BYTES || payload.assets.length > 999) { throw new Error('题库图片过多，请缩小练习范围'); }
    }
    const portable = mapImagePaths(payload, (path: string): string => names.get(path) as string);
    validatePayload(portable);
    const manifest = new util.TextEncoder().encodeInto(JSON.stringify(portable));
    if (manifest.byteLength > MAX_MANIFEST_BYTES || total + manifest.byteLength + 4 > MAX_CONTINUATION_BYTES) {
      throw new Error('接续数据超过 100MB，请缩小练习范围');
    }
    const path = `${this.context.distributedFilesDir}/misaka_${token}.mqp`;
    const file = await fileIo.open(path, fileIo.OpenMode.CREATE | fileIo.OpenMode.READ_WRITE | fileIo.OpenMode.TRUNC);
    try {
      const header = new Uint8Array(4);
      new DataView(header.buffer).setUint32(0, manifest.byteLength);
      await writeBytes(file.fd, header);
      await writeBytes(file.fd, manifest);
      for (const info of payload.assets) {
        const bytes = await readBytes(uniqueSources.get(info.name) as string, MAX_ASSET_BYTES);
        if (bytes.byteLength !== info.size || await digest(bytes) !== info.name) { throw new Error('题图已改变，请重新接续'); }
        await writeBytes(file.fd, bytes);
      }
    } finally { await fileIo.close(file); }
    const stat = await fileIo.stat(path);
    const asset: commonType.Asset = {
      name: `misaka_${token}.mqp`, uri: fileUri.getUriFromPath(path), path: path,
      createTime: stat.ctime.toString(), modifyTime: stat.mtime.toString(), size: stat.size.toString()
    };
    return asset;
  }

  async importAsset(asset: commonType.Asset): Promise<ReceivedContinuation> {
    if (!/^misaka_[a-zA-Z0-9_]+\.mqp$/.test(asset.name)) { throw new Error('接续文件名不合法'); }
    // 使用本设备分布式目录，不信任源设备传来的绝对路径。
    const bytes = await readBytes(`${this.context.distributedFilesDir}/${asset.name}`, MAX_CONTINUATION_BYTES);
    if (bytes.byteLength < 4) { throw new Error('接续文件不完整'); }
    const length = new DataView(bytes.buffer).getUint32(0);
    if (length === 0 || length > MAX_MANIFEST_BYTES || length + 4 > bytes.byteLength) { throw new Error('接续清单不完整'); }
    const text = util.TextDecoder.create('utf-8').decodeWithStream(bytes.subarray(4, 4 + length));
    const received = new ReceivedContinuation();
    received.payload = validatePayload(JSON.parse(text) as Object);
    let offset = 4 + length;
    // 全部校验成功后才开始落盘。
    for (const info of received.payload.assets) {
      if (offset + info.size > bytes.byteLength || await digest(bytes.subarray(offset, offset + info.size)) !== info.name) {
        throw new Error('接续图片校验失败，请重试');
      }
      offset += info.size;
    }
    if (offset !== bytes.byteLength) { throw new Error('接续文件长度不正确'); }
    const dir = `${this.context.filesDir}/question_assets/continuation`;
    if (!fileIo.accessSync(dir)) { await fileIo.mkdir(dir, true); }
    offset = 4 + length;
    for (const info of received.payload.assets) {
      const path = `${dir}/${info.name}`;
      const file = await fileIo.open(`${path}.tmp`, fileIo.OpenMode.CREATE | fileIo.OpenMode.READ_WRITE | fileIo.OpenMode.TRUNC);
      try { await writeBytes(file.fd, bytes.subarray(offset, offset + info.size)); }
      finally { await fileIo.close(file); }
      await fileIo.rename(`${path}.tmp`, path);
      received.paths.set(info.name, path);
      offset += info.size;
    }
    return received;
  }

  /** 比较候选题库时将本地图像变为摘要，同时保留反向路径供合并后恢复。 */
  async portableBanks(banks: Record<string, Object>[], incoming: ContinuationPayload,
    paths: Map<string, string>): Promise<Record<string, Object>[]> {
    const result: Record<string, Object>[] = [];
    for (const bank of banks) {
      const id = bank['id'] as string;
      if (!incoming.banks.some((b: Record<string, Object>): boolean => id === b['id'] || id.startsWith(`${b['id']}_continued_`))) {
        result.push(bank);
        continue;
      }
      const sources = new Set<string>();
      mapImagePaths(bank, (path: string): string => { sources.add(path); return path; });
      const names = new Map<string, string>();
      for (const path of sources) {
        try {
          const name = await digest(await readBytes(path, MAX_ASSET_BYTES));
          names.set(path, name);
          if (!paths.has(name)) { paths.set(name, path); }
        } catch (_err) {
          // ponytail: 缺失的本地图不能证明内容相同，保留旧库并导入独立版本。
          names.set(path, path);
        }
      }
      result.push(mapImagePaths(bank, (path: string): string => names.get(path) as string) as Record<string, Object>);
    }
    return result;
  }

  async cleanup(token: string): Promise<void> {
    if (!/^[a-zA-Z0-9_]+$/.test(token)) { return; }
    try { await fileIo.unlink(`${this.context.distributedFilesDir}/misaka_${token}.mqp`); } catch (_err) { }
  }
}
