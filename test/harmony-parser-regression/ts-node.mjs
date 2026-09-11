// 注册解析钩子的入口：node --import test/harmony-parser-regression/ts-node.mjs xxx.ts
import { register } from 'node:module';
register('./hooks.mjs', import.meta.url);
