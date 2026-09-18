import ExcelJS from 'exceljs';
import mammoth from 'mammoth';
import { Readable } from 'node:stream';
import { extname } from 'node:path';

const MAX_ROWS = 5000;
const MAX_COLUMNS = 80;

function decodeHtml(value) {
  return String(value || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .trim();
}

function excelCellValue(cell, address, cellErrors) {
  const value = cell?.value;
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== 'object') return String(value).trim();
  if ('formula' in value || 'sharedFormula' in value) {
    cellErrors.push({ sourceColumn: address, code: 'FORMULA_NOT_ALLOWED', message: '导入资料不能包含公式，请先粘贴为值' });
    return value.result === null || value.result === undefined ? '' : String(value.result).trim();
  }
  if (Array.isArray(value.richText)) return value.richText.map((item) => item.text || '').join('').trim();
  if ('text' in value) return String(value.text || '').trim();
  if ('result' in value) return String(value.result || '').trim();
  return String(cell.text || '').trim();
}

function uniqueHeaders(values) {
  const seen = new Map();
  return values.map((value, index) => {
    const base = String(value || '').trim() || `未命名列${index + 1}`;
    const count = (seen.get(base) || 0) + 1;
    seen.set(base, count);
    return count === 1 ? base : `${base}（第${count}列）`;
  });
}

function worksheetToRows(worksheet) {
  const populated = [];
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const cellErrors = [];
    const values = [];
    const columnCount = Math.min(Math.max(row.cellCount, worksheet.columnCount), MAX_COLUMNS + 1);
    for (let column = 1; column <= columnCount; column += 1) values.push(excelCellValue(row.getCell(column), `${rowNumber}:${column}`, cellErrors));
    if (values.some((value) => String(value).trim())) populated.push({ rowNumber, values, cellErrors });
  });
  if (!populated.length) throw Object.assign(new Error('文件中没有可识别的数据'), { code: 'EMPTY_SOURCE' });
  if (populated[0].values.length > MAX_COLUMNS) throw Object.assign(new Error(`文件列数不能超过 ${MAX_COLUMNS} 列`), { code: 'TOO_MANY_COLUMNS' });
  const headers = uniqueHeaders(populated[0].values.slice(0, MAX_COLUMNS));
  const rows = populated.slice(1).filter((row) => row.values.some((value) => String(value).trim())).map((row) => ({
    sourceRowNumber: row.rowNumber,
    raw: Object.fromEntries(headers.map((header, index) => [header, row.values[index] ?? ''])),
    cellErrors: row.cellErrors
  }));
  if (rows.length > MAX_ROWS) throw Object.assign(new Error(`单次导入不能超过 ${MAX_ROWS} 行`), { code: 'TOO_MANY_ROWS' });
  return { headers, rows };
}

async function parseExcel(buffer, extension) {
  const workbook = new ExcelJS.Workbook();
  if (extension === '.csv') await workbook.csv.read(Readable.from(buffer));
  else await workbook.xlsx.load(buffer);
  const worksheet = workbook.worksheets.find((sheet) => sheet.state !== 'veryHidden') || workbook.worksheets[0];
  if (!worksheet) throw Object.assign(new Error('文件中没有工作表'), { code: 'EMPTY_WORKBOOK' });
  return { ...worksheetToRows(worksheet), sourceLabel: worksheet.name || 'Sheet1' };
}

function extractTableRows(html) {
  const tables = [...String(html || '').matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)];
  for (const table of tables) {
    const rows = [...table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((row) =>
      [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) => decodeHtml(cell[1]))
    ).filter((row) => row.some(Boolean));
    if (rows.length >= 2) return rows;
  }
  return [];
}

function matrixToRows(matrix) {
  if (!matrix.length) throw Object.assign(new Error('没有识别到明确表格或分隔文本'), { code: 'UNRECOGNIZED_STRUCTURE' });
  if (matrix[0].length > MAX_COLUMNS) throw Object.assign(new Error(`资料列数不能超过 ${MAX_COLUMNS} 列`), { code: 'TOO_MANY_COLUMNS' });
  const headers = uniqueHeaders(matrix[0].slice(0, MAX_COLUMNS));
  const rows = matrix.slice(1).filter((values) => values.some((value) => String(value).trim())).map((values, index) => ({
    sourceRowNumber: index + 2,
    raw: Object.fromEntries(headers.map((header, column) => [header, String(values[column] ?? '').trim()])),
    cellErrors: []
  }));
  if (rows.length > MAX_ROWS) throw Object.assign(new Error(`单次导入不能超过 ${MAX_ROWS} 行`), { code: 'TOO_MANY_ROWS' });
  return { headers, rows };
}

function splitDelimitedLine(line, delimiter) {
  if (delimiter !== ',') return line.split(delimiter).map((value) => value.trim());
  const cells = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && quoted && line[index + 1] === '"') { current += '"'; index += 1; }
    else if (character === '"') quoted = !quoted;
    else if (character === ',' && !quoted) { cells.push(current.trim()); current = ''; }
    else current += character;
  }
  cells.push(current.trim());
  return cells;
}

function parseDelimitedText(text) {
  const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) throw Object.assign(new Error('分隔文本至少需要表头和一行数据'), { code: 'UNRECOGNIZED_STRUCTURE' });
  const delimiter = lines[0].includes('\t') ? '\t' : lines[0].includes(',') ? ',' : lines[0].includes('，') ? '，' : '';
  if (!delimiter) throw Object.assign(new Error('自由文本需要使用制表符或逗号分隔列'), { code: 'UNRECOGNIZED_STRUCTURE' });
  return matrixToRows(lines.map((line) => splitDelimitedLine(line, delimiter)));
}

export function parseGuideSignupText(text) {
  const lines = String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const rows = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = line.match(/^\s*(\d+)\s*[.、）)\-:]?\s*([^\d\s，,]+)(?:\s*[，,\s]+\s*(1\d{10}|[0-9+()\-\s]{6,24}))?\s*$/);
    if (!match) continue;
    rows.push({ sourceRowNumber: index + 1, raw: { 接龙序号: match[1], 导游姓名: match[2], 导游手机号: String(match[3] || '').trim(), 原始接龙: line }, cellErrors: [] });
  }
  if (!rows.length) throw Object.assign(new Error('没有识别到“序号 姓名 手机号”的接龙行'), { code: 'UNRECOGNIZED_SIGNUP' });
  return { headers: ['接龙序号', '导游姓名', '导游手机号', '原始接龙'], rows, sourceLabel: '接龙文本' };
}

async function parseWord(buffer, targetType) {
  const converted = await mammoth.convertToHtml({ buffer });
  const table = extractTableRows(converted.value);
  if (table.length) return { ...matrixToRows(table), sourceLabel: 'Word 表格', messages: converted.messages };
  const raw = await mammoth.extractRawText({ buffer });
  if (targetType === 'guide_recruitment') return { ...parseGuideSignupText(raw.value), messages: [...converted.messages, ...raw.messages] };
  return { ...parseDelimitedText(raw.value), sourceLabel: 'Word 分隔文本', messages: [...converted.messages, ...raw.messages] };
}

export async function parseImportSource({ method, filename = '', buffer = null, text = '', targetType }) {
  if (method === '粘贴文字') {
    return targetType === 'guide_recruitment' ? parseGuideSignupText(text) : { ...parseDelimitedText(text), sourceLabel: '粘贴文字' };
  }
  const extension = extname(filename).toLowerCase();
  if (method === 'Excel' || method === 'CSV') {
    if (!['.xlsx', '.csv'].includes(extension)) throw Object.assign(new Error('Excel 导入仅支持 .xlsx 或 .csv；旧版 .xls 请另存为 .xlsx'), { code: 'UNSUPPORTED_FILE_TYPE' });
    return parseExcel(buffer, extension);
  }
  if (method === 'Word') {
    if (extension !== '.docx') throw Object.assign(new Error('Word 导入仅支持不含宏的 .docx 文件'), { code: 'UNSUPPORTED_FILE_TYPE' });
    return parseWord(buffer, targetType);
  }
  throw Object.assign(new Error('请选择 Excel、Word 或粘贴文字'), { code: 'UNSUPPORTED_IMPORT_METHOD' });
}

export const parserLimits = Object.freeze({ maxRows: MAX_ROWS, maxColumns: MAX_COLUMNS });
