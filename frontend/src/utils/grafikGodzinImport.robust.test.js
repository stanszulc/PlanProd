import { describe, test, expect } from 'vitest';
import JSZip from 'jszip';
import { parseGrafikGodzinXlsx, parseExcelDateToIso } from './grafikGodzinImport.js';

// Buduje minimalny xlsx: rows = tablica tablic komórek; komórka = string (inlineStr) | number | null
async function makeXlsx(rows, { noRefOnRow } = {}) {
  const colL = i => String.fromCharCode(65 + i);
  const sheetRows = rows.map((r, ri) => {
    const cells = r.map((v, ci) => {
      if (v === null || v === undefined) return '';
      const refAttr = noRefOnRow === ri ? '' : ` r="${colL(ci)}${ri + 1}"`;
      return typeof v === 'number'
        ? `<c${refAttr}><v>${v}</v></c>`
        : `<c${refAttr} t="inlineStr"><is><t>${v}</t></is></c>`;
    }).join('');
    return `<row r="${ri + 1}">${cells}</row>`;
  }).join('');
  const zip = new JSZip();
  zip.file('xl/worksheets/sheet1.xml', `<?xml version="1.0"?><worksheet><sheetData>${sheetRows}</sheetData></worksheet>`);
  return zip.generateAsync({ type: 'arraybuffer' });
}
const HDR = ['Brygada', 'Data', 'GodzinyDostepne'];

describe('parseExcelDateToIso', () => {
  test('ISO, DD.MM.YYYY, serial Excela', () => {
    expect(parseExcelDateToIso('2026-08-17')).toBe('2026-08-17');
    expect(parseExcelDateToIso('2026-08-17T00:00:00')).toBe('2026-08-17');
    expect(parseExcelDateToIso('17.08.2026')).toBe('2026-08-17');
    expect(parseExcelDateToIso('46251')).toBe('2026-08-17');
    expect(parseExcelDateToIso('nie data')).toBeNull();
    expect(parseExcelDateToIso('31.02.2026')).toBeNull();
  });
});

describe('parseGrafikGodzinXlsx — odporność', () => {
  test('puste/błędne/ujemne godziny są pomijane z ostrzeżeniem, nie zamieniane w 0', async () => {
    const buf = await makeXlsx([HDR, ['A', '2026-08-17', 8], ['A', '2026-08-18', null], ['A', '2026-08-19', 'abc'], ['A', '2026-08-20', -1], ['A', '2026-08-21', 5000], ['A', '2026-08-22', 0], ['A', '2026-08-23', 107.25]]);
    const rows = await parseGrafikGodzinXlsx(buf);
    expect(rows.map(r => r.data)).toEqual(['2026-08-17', '2026-08-22', '2026-08-23']); // 107,25 h = pula brygady, poprawne
    expect(rows[1].godziny).toBe(0);
    expect(rows.warnings).toHaveLength(4);
  });

  test('serial Excela i DD.MM.YYYY w kolumnie Data są normalizowane do ISO', async () => {
    const buf = await makeXlsx([HDR, ['A', 46251, 8], ['A', '18.08.2026', '7,5']]);
    const rows = await parseGrafikGodzinXlsx(buf);
    expect([...rows]).toEqual([
      { brygada: 'A', data: '2026-08-17', godziny: 8 },
      { brygada: 'A', data: '2026-08-18', godziny: 7.5 },
    ]);
  });

  test('nieparsowalna data -> ostrzeżenie', async () => {
    const buf = await makeXlsx([HDR, ['A', 'jutro', 8]]);
    const rows = await parseGrafikGodzinXlsx(buf);
    expect(rows).toHaveLength(0);
    expect(rows.warnings[0]).toMatch(/data/i);
  });

  test('duplikat brygada+data: wygrywa ostatni wiersz + ostrzeżenie', async () => {
    const buf = await makeXlsx([HDR, ['A', '2026-08-17', 8], ['A', '2026-08-17', 6]]);
    const rows = await parseGrafikGodzinXlsx(buf);
    expect([...rows]).toEqual([{ brygada: 'A', data: '2026-08-17', godziny: 6 }]);
    expect(rows.warnings).toHaveLength(1);
    expect(rows.warnings[0]).toMatch(/duplikat/i);
  });

  test('komórka bez atrybutu r nie rzuca TypeError', async () => {
    const buf = await makeXlsx([HDR, ['A', '2026-08-17', 8]], { noRefOnRow: 1 });
    await expect(parseGrafikGodzinXlsx(buf)).resolves.toBeDefined();
  });

  test('zły XML -> czytelny błąd po polsku', async () => {
    const zip = new JSZip();
    zip.file('xl/worksheets/sheet1.xml', '<worksheet><sheetData><row></sheetData>');
    const buf = await zip.generateAsync({ type: 'arraybuffer' });
    await expect(parseGrafikGodzinXlsx(buf)).rejects.toThrow(/XML/);
  });
});
