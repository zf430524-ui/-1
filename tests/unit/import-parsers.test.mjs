import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { parseImportSource } from '../../src/imports/parsers.mjs';
import { getImportTarget, suggestMapping } from '../../src/imports/targets.mjs';
import { buildDocxTableBuffer, buildExcelBuffer } from '../fixtures/import-files.mjs';

test('标准 Excel 和 Word 表格转换为保留原行号的临时行', async () => {
  const rows = [['学校名称', '联系人姓名', '联系人电话'], ['岳麓测试学校', '周老师', '13800000001']];
  const excel = await parseImportSource({ method: 'Excel', filename: 'schools.xlsx', buffer: await buildExcelBuffer(rows), targetType: 'schools' });
  const word = await parseImportSource({ method: 'Word', filename: 'schools.docx', buffer: await buildDocxTableBuffer(rows), targetType: 'schools' });
  assert.deepEqual(excel.headers, rows[0]);
  assert.equal(excel.rows[0].sourceRowNumber, 2);
  assert.equal(word.rows[0].raw['学校名称'], '岳麓测试学校');
});

test('非标准列保留给人工映射且标准别名可以自动建议', () => {
  const target = getImportTarget('schools');
  assert.deepEqual(suggestMapping(['单位名称', '校名', '联系电话'], target), { 单位名称: '', 校名: 'name', 联系电话: 'contactPhone' });
});

test('接龙文本保留原始序号、缺手机号和重复行信息', async () => {
  const parsed = await parseImportSource({ method: '粘贴文字', text: '1. 王晨 13800000001\n3、周妍\n3、周妍', targetType: 'guide_recruitment' });
  assert.deepEqual(parsed.rows.map((row) => row.raw.接龙序号), ['1', '3', '3']);
  assert.equal(parsed.rows[1].raw.导游手机号, '');
  assert.match(parsed.rows[0].raw.原始接龙, /^1/);
});

test('公式单元格不执行并生成可定位错误', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('导入资料');
  sheet.addRow(['学校名称']);
  sheet.getCell('A2').value = { formula: 'HYPERLINK("https://example.invalid")', result: '公式学校' };
  const parsed = await parseImportSource({ method: 'Excel', filename: 'formula.xlsx', buffer: Buffer.from(await workbook.xlsx.writeBuffer()), targetType: 'schools' });
  assert.equal(parsed.rows[0].cellErrors[0].code, 'FORMULA_NOT_ALLOWED');
  assert.equal(parsed.rows[0].raw['学校名称'], '公式学校');
});

test('坏格式和宏文件扩展名被明确拒绝', async () => {
  await assert.rejects(() => parseImportSource({ method: 'Word', filename: 'unsafe.docm', buffer: Buffer.from('bad'), targetType: 'schools' }), { code: 'UNSUPPORTED_FILE_TYPE' });
  await assert.rejects(() => parseImportSource({ method: 'Excel', filename: 'legacy.xls', buffer: Buffer.from('bad'), targetType: 'schools' }), { code: 'UNSUPPORTED_FILE_TYPE' });
});
