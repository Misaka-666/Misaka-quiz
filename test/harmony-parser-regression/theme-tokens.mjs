// M7 主题 Token 自检（纯 Node，无依赖）：
// 1) base 与 dark color.json 的 token 名集合完全一致（漏配 dark 值会静默退回浅色）
// 2) QuizWidgets 引用的每个 app.color.* 资源在两份 color.json 中都存在
// 3) pages/state 下不允许再出现未经许可的内联十六进制色（守卫暗色适配回归）
// 4) APP_VERSION_LABEL 与 AppScope/app.json5 versionName 一致
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const entry = join(root, 'apps', 'harmony', 'entry');
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const colorNames = (p) => new Set(readJson(p).color.map((c) => c.name));

const baseNames = colorNames(join(entry, 'src', 'main', 'resources', 'base', 'element', 'color.json'));
const darkNames = colorNames(join(entry, 'src', 'main', 'resources', 'dark', 'element', 'color.json'));
assert.equal(darkNames.size, baseNames.size, 'dark token 数量应与 base 一致');
for (const name of baseNames) {
  assert.ok(darkNames.has(name), `dark/color.json 缺少 base token: ${name}`);
}

const widgets = readFileSync(join(entry, 'src', 'main', 'ets', 'pages', 'common', 'QuizWidgets.ets'), 'utf8');
const referenced = [...widgets.matchAll(/\$r\('app\.color\.([a-z_]+)'\)/g)].map((m) => m[1]);
assert.ok(referenced.length >= 20, `MisakaColors getter 应引用全部 token，实际 ${referenced.length}`);
for (const name of referenced) {
  assert.ok(baseNames.has(name), `QuizWidgets 引用的资源未定义: ${name}`);
  assert.ok(darkNames.has(name), `QuizWidgets 引用的资源缺 dark 值: ${name}`);
}

// 开屏浮层复用 Android 品牌美术字固定色（作品的一部分，不随主题切换）——唯一允许的内联色
const ALLOWED_INLINE = new Set(['#1F5EA8', '#FF78AD', '#7C9ED6', '#FF6EA7', '#FFFFFF76']);
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      walk(p);
    } else if (p.endsWith('.ets')) {
      const text = readFileSync(p, 'utf8');
      const hits = [...text.matchAll(/'#[0-9A-Fa-f]{3,8}'/g)].map((m) => m[0].slice(1, -1));
      for (const hex of hits) {
        assert.ok(ALLOWED_INLINE.has(hex.toUpperCase()) && p.endsWith('Index.ets'),
          `${p} 存在未 token 化的内联色 '#${hex}'（应使用 MisakaColors 资源 Token）`);
      }
    }
  }
};
walk(join(entry, 'src', 'main', 'ets', 'pages'));
walk(join(entry, 'src', 'main', 'ets', 'state'));

const appJson5 = readFileSync(join(root, 'apps', 'harmony', 'AppScope', 'app.json5'), 'utf8');
const versionName = appJson5.match(/"versionName":\s*"([^"]+)"/)[1];
assert.ok(widgets.includes(`APP_VERSION_LABEL = 'v${versionName}'`),
  `APP_VERSION_LABEL 应与 app.json5 versionName(${versionName}) 一致`);

console.log(`theme-tokens ALL PASS（${baseNames.size} tokens 双份齐备 · ${referenced.length} 处引用 · 内联色守卫通过 · 版本一致）`);
