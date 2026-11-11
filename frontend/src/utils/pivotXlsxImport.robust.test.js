import { describe, test, expect } from 'vitest';
import JSZip from 'jszip';
import { xlsxPivotCacheToZpTsv } from './pivotXlsxImport.js';

const def = (fields) => `<?xml version="1.0"?><pivotCacheDefinition><cacheFields>${fields}</cacheFields></pivotCacheDefinition>`;

async function zipWith(files) {
  const zip = new JSZip();
  for (const [k, v] of Object.entries(files)) zip.file(k, v);
  return zip.generateAsync({ type: 'arraybuffer' });
}

describe('xlsxPivotCacheToZpTsv — odporność', () => {
  test('zły XML definicji -> czytelny błąd po polsku', async () => {
    const buf = await zipWith({ 'xl/pivotCache/pivotCacheDefinition1.xml': '<a><b></a>' });
    await expect(xlsxPivotCacheToZpTsv(buf)).rejects.toThrow(/XML/);
  });

  test('zły XML rekordów -> czytelny błąd po polsku', async () => {
    const buf = await zipWith({
      'xl/pivotCache/pivotCacheDefinition1.xml': def('<cacheField name="Numer ZP"/><cacheField name="CzasPozost"/>'),
      'xl/pivotCache/pivotCacheRecords1.xml': '<pivotCacheRecords><r></pivotCacheRecords>',
    });
    await expect(xlsxPivotCacheToZpTsv(buf)).rejects.toThrow(/XML/);
  });

  test('<x> w polu bez słownika nie rzuca TypeError (pusta wartość)', async () => {
    const buf = await zipWith({
      'xl/pivotCache/pivotCacheDefinition1.xml': def('<cacheField name="Numer ZP"/><cacheField name="CzasPozost"/>'),
      'xl/pivotCache/pivotCacheRecords1.xml': '<pivotCacheRecords><r><x v="0"/><n v="1.5"/></r></pivotCacheRecords>',
    });
    const { tsv, rowCount } = await xlsxPivotCacheToZpTsv(buf);
    expect(rowCount).toBe(1);
    expect(tsv.split('\n')[1]).toBe('\t1.5');
  });

  test('wpis większy niż limit po rozpakowaniu jest odrzucany', async () => {
    const big = 'x'.repeat(60 * 1024 * 1024);
    const buf = await zipWith({
      'xl/pivotCache/pivotCacheDefinition1.xml': def('<cacheField name="Numer ZP"/><cacheField name="CzasPozost"/>'),
      'xl/pivotCache/pivotCacheRecords1.xml': `<pivotCacheRecords><!--${big}--></pivotCacheRecords>`,
    });
    await expect(xlsxPivotCacheToZpTsv(buf)).rejects.toThrow(/zbyt duż|limit/i);
  });
});
