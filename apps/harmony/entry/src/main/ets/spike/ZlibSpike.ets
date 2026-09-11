import { zlib } from '@kit.BasicServicesKit';
import { fileIo } from '@kit.CoreFileKit';

// M0 spike①：@ohos.zlib 压缩/解压往返验证（跨端 ZIP 互通的前置检查）
// 产物 zip 由 hdc 拉回 PC 用通用解压工具复核。

function readText(path: string): string {
  const stat: fileIo.Stat = fileIo.statSync(path);
  const buf: ArrayBuffer = new ArrayBuffer(stat.size);
  const file: fileIo.File = fileIo.openSync(path, fileIo.OpenMode.READ_ONLY);
  try {
    fileIo.readSync(file.fd, buf);
  } finally {
    fileIo.closeSync(file);
  }
  // ponytail: spike 校验只需 ASCII 内容，逐字节转字符串够用
  const bytes: Uint8Array = new Uint8Array(buf);
  let out: string = '';
  for (let i = 0; i < bytes.length; i++) {
    out += String.fromCharCode(bytes[i]);
  }
  return out;
}

export function runZlibSpike(filesDir: string): Promise<string> {
  const base: string = `${filesDir}/zlib_spike`;
  const srcDir: string = `${base}/src`;
  const zipFile: string = `${base}/out.zip`;
  const unzipDir: string = `${base}/unzipped`;
  const prepare = (): void => {
    if (fileIo.accessSync(base)) {
      fileIo.rmdirSync(base);
    }
    // 源目录模拟备份布局：backup.json + question_assets/a/img.png
    fileIo.mkdirSync(srcDir, true);
    fileIo.mkdirSync(`${srcDir}/question_assets/a`, true);
    const json: fileIo.File = fileIo.openSync(`${srcDir}/backup.json`,
      fileIo.OpenMode.READ_WRITE | fileIo.OpenMode.CREATE);
    fileIo.writeSync(json.fd, '{"kind":"misaka_quiz_full_backup","version":1}');
    fileIo.closeSync(json);
    const img: fileIo.File = fileIo.openSync(`${srcDir}/question_assets/a/img.png`,
      fileIo.OpenMode.READ_WRITE | fileIo.OpenMode.CREATE);
    fileIo.writeSync(img.fd, 'PNGDATA-misaka-spike');
    fileIo.closeSync(img);
  };
  return new Promise<string>((resolve: (value: string) => void) => {
    try {
      prepare();
      // 压缩目录 → zip（level 9），随后解压回另一目录
      zlib.compressFile(srcDir, zipFile, { level: 9 }).then((): Promise<void> => {
        fileIo.mkdirSync(unzipDir, true);
        return zlib.decompressFile(zipFile, unzipDir, {});
      }).then((): void => {
        const jsonBack: string = readText(`${unzipDir}/backup.json`);
        const imgBack: string = readText(`${unzipDir}/question_assets/a/img.png`);
        const zipSize: number = fileIo.statSync(zipFile).size;
        const ok: boolean = jsonBack.includes('misaka_quiz_full_backup') && imgBack === 'PNGDATA-misaka-spike';
        resolve(`zip_size=${zipSize} roundtrip=${ok ? 'OK' : 'MISMATCH'}`);
      }).catch((err: Error) => {
        resolve(`SPIKE_FAIL: ${err.message}`);
      });
    } catch (e) {
      resolve(`SPIKE_FAIL: ${(e as Error).message}`);
    }
  });
}
