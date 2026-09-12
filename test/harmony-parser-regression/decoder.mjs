// M3：导入解码器（XmlDecoders + QuestionImageBinder）Node 自检
// 内含最小 ZIP 写/读器（stored 条目），用于构造真实 docx/xlsx 字节流。
// 运行：node --import ./test/harmony-parser-regression/ts-node.mjs test/harmony-parser-regression/decoder.mjs
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';

const xml = await import(new URL('../../apps/harmony/entry/src/main/ets/importer/parser/XmlDecoders.ts', import.meta.url));
const {
  extractTextFromWordXml, extractTextFromWordParagraphXml,
  extractSpreadsheetSharedStrings, extractSpreadsheetRows,
  extractDocxTextWithImageMarkers, decodeXmlEntities
} = xml;
const parser = await import(new URL('../../apps/harmony/entry/src/main/ets/importer/parser/QuizImportParser.ts', import.meta.url));
const binder = await import(new URL('../../apps/harmony/entry/src/main/ets/importer/assets/QuestionImageBinder.ts', import.meta.url));
const models = await import(new URL('../../apps/harmony/entry/src/main/ets/domain/Models.ts', import.meta.url));
const importModels = await import(new URL('../../apps/harmony/entry/src/main/ets/importer/model/ImportModels.ts', import.meta.url));
const marker = await import(new URL('../../apps/harmony/entry/src/main/ets/importer/assets/QuestionImageMarker.ts', import.meta.url));

// ---------- 最小 ZIP（stored + deflate，够构造 docx/xlsx 与回读） ----------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

export function makeZip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const dataBuf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
    const crc = crc32(dataBuf);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(dataBuf.length, 18);
    local.writeUInt32LE(dataBuf.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, dataBuf);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(0, 10);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(dataBuf.length, 20);
    cd.writeUInt32LE(dataBuf.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([cd, nameBuf]));
    offset += 30 + nameBuf.length + dataBuf.length;
  }
  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, centralBuf, eocd]);
}

export function readZipStored(buf) {
  const entries = [];
  let pos = 0;
  while (pos + 4 <= buf.length && buf.readUInt32LE(pos) === 0x04034b50) {
    const nameLen = buf.readUInt16LE(pos + 26);
    const extraLen = buf.readUInt16LE(pos + 28);
    const size = buf.readUInt32LE(pos + 22);
    const name = buf.slice(pos + 30, pos + 30 + nameLen).toString('utf8');
    const data = buf.slice(pos + 30 + nameLen + extraLen, pos + 30 + nameLen + extraLen + size);
    entries.push({ name, data });
    pos += 30 + nameLen + extraLen + size;
  }
  return entries;
}

// ---------- 1. Word 段落/公式/上下标 ----------

const docXml = `<?xml version="1.0"?>
<w:document xmlns:w="http://x" xmlns:m="http://y">
<w:body>
<w:p><w:r><w:t>1.水的化学式是</w:t></w:r><m:oMath><m:f><m:num><m:r><m:t>H</m:t></m:r></m:num><m:den><m:r><m:t>2</m:t></m:r></m:den></m:f><m:r><w:t>O</w:t></m:r><m:sSub><m:e><m:r><m:t>x</m:t></m:r></m:e><m:sub><m:r><m:t>n</m:t></m:r></m:sub></m:sSub></m:oMath><w:r><w:t>，下列正确的是？</w:t></w:r></w:p>
<w:p><w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:t>2</w:t></w:r><w:r><w:t> A.正确 B.错误</w:t></w:r></w:p>
<w:p><w:r><w:t>答案：A</w:t></w:r></w:p>
<w:p><w:r><w:t>解析：H</w:t></w:r><w:r><w:rPr><w:vertAlign w:val="subscript"/></w:rPr><w:t>2</w:t></w:r><w:r><w:t>O 构成水。</w:t></w:r></w:p>
</w:body>
</w:document>`;

const wordText = extractTextFromWordXml(docXml);
assert.ok(wordText.includes('1.水的化学式是'), 'stem extracted: ' + wordText);
assert.ok(wordText.includes('(H)/(2)'), 'fraction: ' + wordText);
assert.ok(wordText.includes('x' + '\u2099'), 'subscript n: ' + wordText);
assert.ok(wordText.includes('\u00B2'), 'superscript 2: ' + wordText);
assert.ok(wordText.includes('解析：H'), 'analysis paragraph');
assert.ok(wordText.includes('\u2082O'), 'subscript 2 in analysis: ' + wordText);
assert.ok(wordText.includes('答案：A'));

// 平方根
const sqrtXml = `<w:p><m:oMath><m:rad><m:degHidden/><m:e><m:r><m:t>16</m:t></m:r></m:e></m:rad></m:oMath></w:p>`;
assert.ok(extractTextFromWordXml(sqrtXml).includes('\u221A(16)'), 'sqrt');

// ---------- 2. XLSX ----------

const sharedXml = `<?xml version="1.0"?><sst xmlns="http://x"><si><r><t>题干</t></r></si><si><t>答案</t></si></sst>`;
const shared = extractSpreadsheetSharedStrings(sharedXml);
assert.deepEqual(shared, ['题干', '答案']);

const sheetXml = `<?xml version="1.0"?><worksheet xmlns="http://x"><sheetData>
<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
<row r="2"><c r="A2"><v>3.14</v></c><c r="B2" t="inlineStr"><is><t>内联</t></is></c><c r="C2" t="b"><v>1</v></c></row>
<row r="3"><c r="B3"><v>偏移列</v></c></row>
</sheetData></worksheet>`;
const rows = extractSpreadsheetRows(sheetXml, shared);
const lines = rows.split('\n');
assert.equal(lines[0], '题干\t答案', 'row1: ' + lines[0]);
assert.equal(lines[1], '3.14\t内联\tTRUE', 'row2: ' + lines[1]);
assert.equal(lines[2], '\t偏移列', 'row3 col offset: ' + lines[2]);

// ---------- 3. XML 实体 ----------

assert.equal(decodeXmlEntities('a&amp;b&lt;c&gt;d&quot;e&apos;f'), 'a&b<c>d"e\'f');
assert.equal(decodeXmlEntities('&#x4e2d;&#25991;'), '中文');

// ---------- 4. DOCX 带图段落 + ZIP 构造回读 ----------

const docWithImageXml = `<?xml version="1.0"?><w:document xmlns:w="http://x" xmlns:r="http://r"><w:body>
<w:p><w:r><w:t>1.看图回答：图中所示是？</w:t></w:r></w:p>
<w:p><w:r><w:drawing><a:blip r:embed="rId7"/></w:drawing></w:r></w:p>
<w:p><w:r><w:t>A.图形甲 B.图形乙</w:t></w:r></w:p>
<w:p><w:r><w:t>答案：A</w:t></w:r></w:p>
</w:body></w:document>`;
const relsXml = `<?xml version="1.0"?><Relationships xmlns="http://x"><Relationship Id="rId7" Type="image" Target="media/image1.png"/></Relationships>`;
const marked = extractDocxTextWithImageMarkers(docWithImageXml, relsXml, ['word/media/image1.png']);
assert.ok(marked.text.includes('[[MISAKA_IMAGE:img_0001]]'), 'marker injected: ' + marked.text);
assert.equal(marked.imageMarkers.length, 1);
assert.equal(marked.imageMarkers[0].mediaName, 'word/media/image1.png');
const markedText = marked.text;

const docxBytes = makeZip([
  { name: '[Content_Types].xml', data: '<?xml version="1.0"?><Types/>' },
  { name: '_rels/.rels', data: '<?xml version="1.0"?><Relationships/>' },
  { name: 'word/document.xml', data: docWithImageXml },
  { name: 'word/_rels/document.xml.rels', data: relsXml },
  { name: 'word/media/image1.png', data: Buffer.from([0x89, 0x50, 0x4E, 0x47, 1, 2, 3, 4]) }
]);
const reread = readZipStored(docxBytes);
assert.equal(reread.length, 5);
assert.deepEqual(reread.map(e => e.name).sort().slice(0, 2), ['[Content_Types].xml', '_rels/.rels']);
const docEntry = reread.find(e => e.name === 'word/document.xml');
assert.ok(docEntry.data.toString('utf8').includes('看图回答'));

// zip 头校验（平台层 looksLikeZip 的判断依据）
assert.equal(docxBytes[0], 0x50);
assert.equal(docxBytes[1], 0x4B);
assert.equal(docxBytes[2], 3);
assert.equal(docxBytes[3], 4);

// ---------- 5. 端到端：docx 文本 → 解析器 ----------

const e2eResult = parser.parseStandardText(markedText);
assert.equal(e2eResult.questions.length, 1, 'e2e: ' + JSON.stringify(e2eResult.questions.map(q => q.question)));
assert.equal(e2eResult.questions[0].type, 'SINGLE');
assert.deepEqual(e2eResult.questions[0].answer, ['A']);

// ---------- 6. QuestionImageBinder ----------

const { Question, QuestionImage, QuestionType } = models;
const { ImportResult, ImportDiagnostics, WarningLevel } = importModels;
const q = new Question('q1', QuestionType.SINGLE, '1.看图回答：图中所示是？[[MISAKA_IMAGE:img_0001]]');
q.options = [new models.Option('A', '图形甲'), new models.Option('B', '图形乙')];
q.answer = ['A'];
const unbound = new ImportResult([q], '测试', [], new ImportDiagnostics());
const img = new QuestionImage('img-id-1', '/data/files/question_assets/import_1/img_0001.png', 'image1.png', 1, 100, 100, 8);
const bound = binder.attachImages(unbound, [new binder.ExtractedImportImage('[[MISAKA_IMAGE:img_0001]]', img)]);
assert.equal(bound.questions[0].images.length, 1, 'image attached');
assert.equal(bound.questions[0].images[0].localPath, img.localPath);
assert.ok(!bound.questions[0].question.includes('MISAKA_IMAGE'), 'marker removed: ' + bound.questions[0].question);
assert.ok(bound.warnings.some(w => w.message.includes('检测到 1 张图片')), 'image summary warning');

// 材料题图片共享：题干含“回答 1-2 题”且带图 → 第 2 题也获得图片
const mq1 = new Question('m1', QuestionType.SINGLE, '根据以下材料回答 1-2 题，如图所示');
mq1.images = [img];
const mq2 = new Question('m2', QuestionType.SINGLE, '第2题题干');
const shareResult = binder.attachImages(new ImportResult([mq1, mq2], '测试', [], new ImportDiagnostics()), []);
// images 为空时 attach 直接返回，改走内部共享逻辑验证：直接构造后调 attach 不可行，断言改用带标记路径
const sharedQ1 = new Question('s1', QuestionType.SINGLE, '根据以下材料回答 1-2 题 [[MISAKA_IMAGE:img_0001]]');
const sharedQ2 = new Question('s2', QuestionType.SINGLE, '第二小题问什么？');
const sharedResult = binder.attachImages(
  new ImportResult([sharedQ1, sharedQ2], '测试', [], new ImportDiagnostics()),
  [new binder.ExtractedImportImage('[[MISAKA_IMAGE:img_0001]]', img)]
);
assert.equal(sharedResult.questions[0].images.length, 1);
assert.equal(sharedResult.questions[1].images.length, 1, '材料题图片共享到第 2 题');
assert.ok(!sharedResult.questions[0].question.includes('MISAKA_IMAGE'));

console.log('DECODER_PASS');
