// M3：生成设备验证用的 docx/xlsx 测试文件（复用 decoder.mjs 的最小 ZIP 写入器）
// 运行：node --import ./test/harmony-parser-regression/ts-node.mjs test/harmony-parser-regression/gen-import-samples.mjs <输出目录>
// 输出：m3-test.docx（含 OMML 公式/上下标/图片引用）、m3-test.xlsx（sharedStrings 表格）
import fs from 'node:fs';
import path from 'node:path';
import { makeZip } from './decoder.mjs';

const outDir = process.argv[2] ?? '.hvigor-shots';
fs.mkdirSync(outDir, { recursive: true });

const esc = (s) => s.split('&').join('&amp;').split('<').join('&lt;').split('>').join('&gt;');

// 1 字节黑色 PNG（IHDR+IDAT+IEND），供 ImageKit 解码成功
const minimalPng = Buffer.from(
  '89504e470d0a1a0a0000000d494844520000000100000001080200000090775' +
  '3de0000000c4944415408d763f8cfc000000301010018dd8db00000000049454e44ae426082',
  'hex'
);

const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>
<w:p><w:r><w:t>一、单选题</w:t></w:r></w:p>
<w:p><w:r><w:t>1.水的化学式为 H</w:t></w:r><w:r><w:rPr><w:vertAlign w:val="subscript"/></w:rPr><w:t>2</w:t></w:r><w:r><w:t>O，下列说法正确的是？</w:t></w:r></w:p>
<w:p><w:r><w:t>A.水是由氢和氧组成的</w:t></w:r></w:p>
<w:p><w:r><w:t>B.水是由氢和氮组成的</w:t></w:r></w:p>
<w:p><w:r><w:t>答案：A</w:t></w:r></w:p>
<w:p><w:r><w:t>2.一元二次方程求根公式中的判别式为 b的平方减4ac，即根号</w:t></w:r><m:oMath><m:rad><m:degHidden/><m:e><m:r><m:t>b</m:t></m:r><m:sSup><m:e><m:r><m:t>2</m:t></m:r></m:e><m:sup><m:r><m:t>−4ac</m:t></m:r></m:sup></m:sSup></m:e></m:rad></m:oMath><w:r><w:t>，其符号决定根的个数。该说法？</w:t></w:r></w:p>
<w:p><w:r><w:t>A.正确</w:t></w:r><w:r><w:t xml:space="preserve"> B.错误</w:t></w:r></w:p>
<w:p><w:r><w:t>答案：A</w:t></w:r></w:p>
<w:p><w:r><w:t>3.看图回答：下图图标表示什么？</w:t></w:r></w:p>
<w:p><w:r><w:drawing><a:blip r:embed="rId10"/></w:drawing></w:r></w:p>
<w:p><w:r><w:t>A.前进</w:t></w:r><w:r><w:t xml:space="preserve"> B.后退</w:t></w:r><w:r><w:t xml:space="preserve"> C.停止</w:t></w:r></w:p>
<w:p><w:r><w:t>答案：B</w:t></w:r></w:p>
<w:p><w:r><w:t>二、多选题</w:t></w:r></w:p>
<w:p><w:r><w:t>4.下列哪些是中国的直辖市？</w:t></w:r></w:p>
<w:p><w:r><w:t>A.北京</w:t></w:r><w:r><w:t xml:space="preserve"> B.上海</w:t></w:r><w:r><w:t xml:space="preserve"> C.广州</w:t></w:r><w:r><w:t xml:space="preserve"> D.重庆</w:t></w:r></w:p>
<w:p><w:r><w:t>答案：ABD</w:t></w:r></w:p>
</w:body></w:document>`;

const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId10" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/></Relationships>`;

const docx = makeZip([
  { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/></Types>' },
  { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>' },
  { name: 'word/document.xml', data: documentXml },
  { name: 'word/_rels/document.xml.rels', data: relsXml },
  { name: 'word/media/image1.png', data: minimalPng }
]);
fs.writeFileSync(path.join(outDir, 'm3-test.docx'), docx);

// xlsx：sharedStrings + 两行题
const shared = ['题号', '题干', '选项A', '选项B', '选项C', '答案', '解析', '下列哪项是 HTML 的作用？', '结构标记', '样式渲染', '交互逻辑', 'A', 'HTML 负责页面结构', 'CSS 的 display:none 与 visibility:hidden 的区别是？', '占位保留', '不占位', '都一样', 'B', 'visibility 保留布局空间'];
const si = shared.map((s) => `<si><t>${esc(s)}</t></si>`).join('');
const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c><c r="E1" t="s"><v>4</v></c><c r="F1" t="s"><v>5</v></c><c r="G1" t="s"><v>6</v></c></row>
<row r="2"><c r="A2"><v>1</v></c><c r="B2" t="s"><v>7</v></c><c r="C2" t="s"><v>8</v></c><c r="D2" t="s"><v>9</v></c><c r="E2" t="s"><v>10</v></c><c r="F2" t="s"><v>11</v></c><c r="G2" t="s"><v>12</v></c></row>
<row r="3"><c r="A3"><v>2</v></c><c r="B3" t="s"><v>13</v></c><c r="C3" t="s"><v>14</v></c><c r="D3" t="s"><v>15</v></c><c r="E3" t="s"><v>16</v></c><c r="F3" t="s"><v>17</v></c><c r="G3" t="s"><v>18</v></c></row>
</sheetData></worksheet>`;
const xlsx = makeZip([
  { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>' },
  { name: 'xl/sharedStrings.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${si}</sst>` },
  { name: 'xl/worksheets/sheet1.xml', data: sheet }
]);
fs.writeFileSync(path.join(outDir, 'm3-test.xlsx'), xlsx);

// Node 侧预检：docx → 纯层解码 → 解析器
const xml2 = await import(new URL('../../apps/harmony/entry/src/main/ets/importer/parser/XmlDecoders.ts', import.meta.url));
const parser2 = await import(new URL('../../apps/harmony/entry/src/main/ets/importer/parser/QuizImportParser.ts', import.meta.xml ? 'file:///unused' : import.meta.url));
const relsForCheck = await import(new URL('../../apps/harmony/entry/src/main/ets/importer/parser/XmlDecoders.ts', import.meta.url));
const marked = relsForCheck.extractDocxTextWithImageMarkers(documentXml, relsXml, ['word/media/image1.png']);
const parsedDocx = parser2.parseStandardText(marked.text);
console.log(`docx 预检：${parsedDocx.questions.length} 题，` +
  parsedDocx.questions.map((q) => `${q.number}/${q.type}/${q.answer.join('')}`).join(' ') +
  ` 图片标记 ${marked.imageMarkers.length}`);

const sharedStrings = xml2.extractSpreadsheetSharedStrings(`<?xml version="1.0"?><sst>${si}</sst>`);
const rowsText = xml2.extractSpreadsheetRows(sheet, sharedStrings);
const parsedXlsx = parser2.parseStandardText(rowsText);
console.log(`xlsx 预检：${parsedXlsx.questions.length} 题，` +
  parsedXlsx.questions.map((q) => `${q.number}/${q.type}/${q.answer.join('')}`).join(' '));

console.log(`已生成：${path.join(outDir, 'm3-test.docx')}(${docx.length}B) ${path.join(outDir, 'm3-test.xlsx')}(${xlsx.length}B)`);
