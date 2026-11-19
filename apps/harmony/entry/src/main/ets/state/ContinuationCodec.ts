/** 接续专用协议。与跨平台备份分开，不包含设置、凭据或无关历史。 */
export const CONTINUATION_VERSION = 1;
export const MAX_CONTINUATION_BYTES = 100 * 1024 * 1024;
export const MAX_MANIFEST_BYTES = 20 * 1024 * 1024;
export const MAX_ASSET_BYTES = 20 * 1024 * 1024;

export function newPracticeId(): string {
  return `practice_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
}

export function jsonRecord(value: Object | undefined): Record<string, Object> {
  if (value === null || value === undefined || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('接续数据格式不正确');
  }
  return value as Record<string, Object>;
}

export function jsonArray(value: Object | undefined): Object[] {
  if (!Array.isArray(value)) { throw new Error('接续列表格式不正确'); }
  return value as Object[];
}

export function copyJson(value: Record<string, Object>): Record<string, Object> {
  return JSON.parse(JSON.stringify(value)) as Record<string, Object>;
}

/** 只替换图片路径。其余文本（包括题干中出现的路径）原样保留。 */
export function mapImagePaths(value: Object, map: (path: string) => string, depth: number = 0): Object {
  if (depth > 40) { throw new Error('接续数据层级过深'); }
  if (value === null || typeof value !== 'object') { return value; }
  if (Array.isArray(value)) {
    return (value as Object[]).map((item: Object): Object => mapImagePaths(item, map, depth + 1));
  }
  const input = value as Record<string, Object>;
  const result: Record<string, Object> = {};
  for (const key of Object.keys(input)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      throw new Error('接续字段不合法');
    }
    result[key] = key === 'localPath' && typeof input[key] === 'string' && (input[key] as string).length > 0
      ? map(input[key] as string) : mapImagePaths(input[key], map, depth + 1);
  }
  return result;
}

export function canonicalJson(value: Object): string {
  if (value === null || typeof value !== 'object') { return JSON.stringify(value); }
  if (Array.isArray(value)) { return `[${(value as Object[]).map((v: Object): string => canonicalJson(v)).join(',')}]`; }
  const record = value as Record<string, Object>;
  return `{${Object.keys(record).sort().map((key: string): string => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

export class ContinuationAssetInfo {
  name: string = '';
  size: number = 0;
}

export class ContinuationPayload {
  protocol: number = CONTINUATION_VERSION;
  snapshot: Record<string, Object> = {};
  banks: Record<string, Object>[] = [];
  wrongBook: Record<string, Object>[] = [];
  assets: ContinuationAssetInfo[] = [];
}

export function validatePayload(raw: Object): ContinuationPayload {
  const root = jsonRecord(raw);
  if (root['protocol'] !== CONTINUATION_VERSION) { throw new Error('两台设备的接续版本不兼容，请更新应用'); }
  const result = new ContinuationPayload();
  result.snapshot = jsonRecord(root['snapshot']);
  for (const key of ['index', 'batchGroupSize', 'batchGroupStartIndex', 'optionShuffleSeed', 'elapsedMs']) {
    const value = result.snapshot[key];
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
      throw new Error('练习进度不合法');
    }
  }
  if (typeof result.snapshot['reciteMode'] !== 'boolean' || typeof result.snapshot['shuffleEnabled'] !== 'boolean') {
    throw new Error('练习模式不完整');
  }
  const id = result.snapshot['sessionId'];
  const revision = result.snapshot['revision'];
  if (typeof id !== 'string' || !/^practice_[a-zA-Z0-9_]{1,180}$/.test(id) ||
    typeof revision !== 'string' || revision.length === 0 || revision.length > 200) {
    throw new Error('练习标识不合法');
  }
  const ids = new Set<string>();
  for (const item of jsonArray(root['banks'])) {
    const bank = jsonRecord(item);
    if (typeof bank['id'] !== 'string' || (bank['id'] as string).length === 0 || ids.has(bank['id'] as string) ||
      typeof bank['name'] !== 'string' || jsonArray(bank['questions']).length === 0) {
      throw new Error('题库数据不完整');
    }
    ids.add(bank['id'] as string);
    result.banks.push(bank);
  }
  const refs = jsonRecord(result.snapshot['banks']);
  for (const key of Object.keys(refs)) {
    if (typeof refs[key] !== 'string' || !ids.has(refs[key] as string)) { throw new Error('练习缺少对应题库'); }
  }
  for (const item of jsonArray(root['wrongBook'])) {
    const entry = jsonRecord(item);
    if (typeof entry['bankId'] !== 'string' || !ids.has(entry['bankId'] as string)) { throw new Error('错题引用不正确'); }
    result.wrongBook.push(entry);
  }
  const names = new Set<string>();
  let total = 0;
  for (const item of jsonArray(root['assets'])) {
    const asset = jsonRecord(item);
    const info = new ContinuationAssetInfo();
    if (typeof asset['name'] !== 'string' || !/^[a-f0-9]{64}$/.test(asset['name'] as string) ||
      typeof asset['size'] !== 'number' || !Number.isSafeInteger(asset['size']) ||
      (asset['size'] as number) <= 0 || (asset['size'] as number) > MAX_ASSET_BYTES || names.has(asset['name'] as string)) {
      throw new Error('图片信息不合法或过大');
    }
    info.name = asset['name'] as string;
    info.size = asset['size'] as number;
    names.add(info.name);
    total += info.size;
    result.assets.push(info);
  }
  if (names.size > 999 || total > MAX_CONTINUATION_BYTES) { throw new Error('接续文件过大'); }
  mapImagePaths(root, (path: string): string => {
    if (!names.has(path)) { throw new Error('接续图片不完整'); }
    return path;
  });
  return result;
}

export class ContinuationBankMerge {
  banks: Record<string, Object>[] = [];
  snapshot: Record<string, Object> = {};
  wrongBook: Record<string, Object>[] = [];
}

function remapBankReferences(value: Object, mapping: Map<string, string>): Object {
  if (value === null || typeof value !== 'object') { return value; }
  if (Array.isArray(value)) {
    return (value as Object[]).map((v: Object): Object => remapBankReferences(v, mapping));
  }
  const input = value as Record<string, Object>;
  const result: Record<string, Object> = {};
  for (const key of Object.keys(input)) {
    result[key] = key === 'bankId' && typeof input[key] === 'string' && mapping.has(input[key] as string)
      ? mapping.get(input[key] as string) as string : remapBankReferences(input[key], mapping);
  }
  return result;
}

/** 调用前两侧图片路径均已化为内容摘要；比较完整内容，不只比较短 hash。 */
export function mergeContinuationBanks(local: Record<string, Object>[], payload: ContinuationPayload): ContinuationBankMerge {
  const result = new ContinuationBankMerge();
  result.banks = local.map((bank: Record<string, Object>): Record<string, Object> => copyJson(bank));
  const mapping = new Map<string, string>();
  for (const incoming of payload.banks) {
    const originalId = incoming['id'] as string;
    const matching = result.banks.find((bank: Record<string, Object>): boolean => {
      const candidate = copyJson(bank);
      candidate['id'] = originalId;
      return (bank['id'] === originalId || (bank['id'] as string).startsWith(`${originalId}_continued_`)) &&
        canonicalJson(candidate) === canonicalJson(incoming);
    });
    if (matching !== undefined) { mapping.set(originalId, matching['id'] as string); continue; }
    const added = copyJson(incoming);
    if (result.banks.some((bank: Record<string, Object>): boolean => bank['id'] === originalId)) {
      added['id'] = `${originalId}_continued_${newPracticeId()}`;
    }
    mapping.set(originalId, added['id'] as string);
    result.banks.push(added);
  }
  result.snapshot = remapBankReferences(copyJson(payload.snapshot), mapping) as Record<string, Object>;
  const refs = jsonRecord(result.snapshot['banks']);
  for (const key of Object.keys(refs)) { refs[key] = mapping.get(refs[key] as string) as string; }
  const seq = result.snapshot['sequentialBankId'];
  if (typeof seq === 'string' && mapping.has(seq)) { result.snapshot['sequentialBankId'] = mapping.get(seq) as string; }
  if (typeof seq === 'string' && seq.startsWith('BANK:') && mapping.has(seq.substring(5))) {
    result.snapshot['sequentialBankId'] = `BANK:${mapping.get(seq.substring(5))}`;
  }
  result.wrongBook = payload.wrongBook.map((entry: Record<string, Object>): Record<string, Object> => {
    const copy = copyJson(entry);
    copy['bankId'] = mapping.get(copy['bankId'] as string) as string;
    return copy;
  });
  return result;
}

export function samePracticeRevision(a: Record<string, Object>, b: Record<string, Object>): boolean {
  return a['sessionId'] === b['sessionId'] && a['revision'] === b['revision'];
}

/** 同一练习的重复包丢弃；本地分歧保留为独立分支，已接走的旧副本可由新版本替代。 */
export function retainLocalPractices(local: Record<string, Object>[], incoming: Record<string, Object>): Record<string, Object>[] {
  const retained: Record<string, Object>[] = [];
  for (const item of local) {
    if (Object.keys(item).length === 0 || samePracticeRevision(item, incoming)) { continue; }
    if (item['sessionId'] === incoming['sessionId'] && item['transferred'] === true) { continue; }
    const copy = copyJson(item);
    if (copy['sessionId'] === incoming['sessionId']) { copy['sessionId'] = newPracticeId(); }
    retained.push(copy);
  }
  return retained;
}
