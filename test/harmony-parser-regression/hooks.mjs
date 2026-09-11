// Node 解析钩子：让 ESM 的无扩展名相对导入回落到 .ts。
// ArkTS(hvigor) 要求 import 不带扩展名，Node ESM 要求带扩展名，
// 解析器源码保持 ArkTS 风格（无扩展名），由本钩子在 Node 侧补 .ts。
import { pathToFileURL, fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import path from 'node:path';

export async function resolve(specifier, context, nextResolve) {
  if ((specifier.startsWith('.') || specifier.startsWith('file:')) && !specifier.endsWith('.ts')) {
    try {
      return await nextResolve(specifier, context);
    } catch (err) {
      if (context.parentURL) {
        const target = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
        if (existsSync(`${target}.ts`)) {
          return { url: pathToFileURL(`${target}.ts`).href, shortCircuit: true };
        }
      }
      throw err;
    }
  }
  return nextResolve(specifier, context);
}
