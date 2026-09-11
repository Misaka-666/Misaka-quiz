import { fileIo } from '@kit.CoreFileKit';

/**
 * JSON 文件状态仓 — 替代 Android 的 SharedPreferences 大 JSON 方案。
 * 题库等大对象存 filesDir/misaka/state.json，临时文件 + rename 原子写防半写损坏。
 */
export class FileStore {
  static readText(filesDir: string, relPath: string): string | null {
    const path = `${filesDir}/${relPath}`;
    if (!fileIo.accessSync(path)) {
      return null;
    }
    try {
      const file = fileIo.openSync(path, fileIo.OpenMode.READ_ONLY);
      try {
        const stat = fileIo.statSync(path);
        const buf = new ArrayBuffer(stat.size);
        fileIo.readSync(file.fd, buf);
        return String.fromCharCode(...new Uint8Array(buf));
      } finally {
        fileIo.closeSync(file);
      }
    } catch (e) {
      return null;
    }
  }

  static writeTextAtomic(filesDir: string, relPath: string, text: string): boolean {
    const path = `${filesDir}/${relPath}`;
    const tmpPath = `${path}.tmp`;
    try {
      const dir = path.substring(0, path.lastIndexOf('/'));
      if (!fileIo.accessSync(dir)) {
        fileIo.mkdirSync(dir, true);
      }
      const file = fileIo.openSync(tmpPath, fileIo.OpenMode.READ_WRITE | fileIo.OpenMode.CREATE | fileIo.OpenMode.TRUNC);
      try {
        fileIo.writeSync(file.fd, text);
      } finally {
        fileIo.closeSync(file);
      }
      fileIo.renameSync(tmpPath, path);
      return true;
    } catch (e) {
      return false;
    }
  }

  static readJson(filesDir: string, relPath: string): Record<string, Object> | null {
    const text = FileStore.readText(filesDir, relPath);
    if (text === null || text.trim().length === 0) {
      return null;
    }
    try {
      const parsed: object = JSON.parse(text);
      return parsed as Record<string, Object>;
    } catch (e) {
      return null;
    }
  }
}
