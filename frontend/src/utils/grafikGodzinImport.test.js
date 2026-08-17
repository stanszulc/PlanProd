import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseGrafikGodzinXlsx, mergeGrafikGodzinIntoSchedule, buildWeeklyTemplateFromGrafik } from './grafikGodzinImport.js';

function loadFixtureArrayBuffer(name) {
  const buf = readFileSync(path.join(__dirname, '__fixtures__', name));
  return new Uint8Array(buf).buffer;
}

describe('parseGrafikGodzinXlsx — reads the real xlsx produced by loadplanner.export_grafik_godzin', () => {
  test('parses all 14 rows (2 brygady x 7 dni) with correct columns', async () => {
    const buf = loadFixtureArrayBuffer('grafik_godzin_test.xlsx');
    const rows = await parseGrafikGodzinXlsx(buf);

    expect(rows).toHaveLength(14);
    expect(rows[0]).toEqual({ brygada: 'Kanały', data: '2026-08-17', godziny: 16.9 });
    const kratkiWeekend = rows.find(r => r.brygada === 'Kratki Aluminium' && r.data === '2026-08-22');
    expect(kratkiWeekend.godziny).toBe(0);
  });
});

describe('mergeGrafikGodzinIntoSchedule — splits brigade hours evenly across its machines', () => {
  test('splits a brigade total evenly across its member machines for that date', () => {
    const rows = [
      { brygada: 'Kanały', data: '2026-08-17', godziny: 16.9 },
      { brygada: 'Kanały', data: '2026-08-18', godziny: 20.0 },
    ];
    const wcToBrygada = { '30022': 'Kanały', '30002': 'Kanały', '30099': 'Kratki Aluminium' };

    const { schedule, warnings } = mergeGrafikGodzinIntoSchedule(rows, wcToBrygada, {});

    expect(schedule['30022']['2026-08-17']).toBeCloseTo(8.45);
    expect(schedule['30002']['2026-08-17']).toBeCloseTo(8.45);
    expect(schedule['30022']['2026-08-18']).toBe(10.0);
    expect(schedule['30099']).toBeUndefined();
    expect(warnings).toHaveLength(0);
  });

  test('preserves existing per-date entries for machines/dates not covered by the import', () => {
    const rows = [{ brygada: 'Kanały', data: '2026-08-17', godziny: 16.9 }];
    const wcToBrygada = { '30022': 'Kanały' };
    const existing = { '30022': { '2026-08-16': 12.0 }, '30099': { '2026-08-17': 5.0 } };

    const { schedule } = mergeGrafikGodzinIntoSchedule(rows, wcToBrygada, existing);

    expect(schedule['30022']['2026-08-16']).toBe(12.0);
    expect(schedule['30099']['2026-08-17']).toBe(5.0);
    expect(schedule['30022']['2026-08-17']).toBe(16.9);
  });

  test('warns instead of throwing when a brigade in the file has no known machines', () => {
    const rows = [{ brygada: 'Nieznana Brygada', data: '2026-08-17', godziny: 10 }];
    const { schedule, warnings } = mergeGrafikGodzinIntoSchedule(rows, {}, {});

    expect(schedule).toEqual({});
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/Nieznana Brygada/);
  });
});

describe('buildWeeklyTemplateFromGrafik — derives a repeating weekday pattern per machine', () => {
  test('splits each weekday brigade total evenly across its machines, keyed by JS weekday index', () => {
    const rows = [
      { brygada: 'Kanały', data: '2026-08-16', godziny: 0 },    // niedziela (0)
      { brygada: 'Kanały', data: '2026-08-17', godziny: 100 },  // poniedziałek (1)
      { brygada: 'Kanały', data: '2026-08-18', godziny: 100 },  // wtorek (2)
      { brygada: 'Kanały', data: '2026-08-19', godziny: 100 },  // środa (3)
      { brygada: 'Kanały', data: '2026-08-20', godziny: 100 },  // czwartek (4)
      { brygada: 'Kanały', data: '2026-08-21', godziny: 100 },  // piątek (5)
      { brygada: 'Kanały', data: '2026-08-22', godziny: 60 },   // sobota (6)
    ];
    const wcToBrygada = { '30003': 'Kanały', '30099': 'Kanały' };

    const template = buildWeeklyTemplateFromGrafik(rows, wcToBrygada);

    expect(template['30003']).toEqual({ 0: 0, 1: 50, 2: 50, 3: 50, 4: 50, 5: 50, 6: 30 });
    expect(template['30099']).toEqual({ 0: 0, 1: 50, 2: 50, 3: 50, 4: 50, 5: 50, 6: 30 });
  });

  test('skips brigades with no known machines instead of throwing', () => {
    const rows = [{ brygada: 'Nieznana', data: '2026-08-17', godziny: 10 }];
    const template = buildWeeklyTemplateFromGrafik(rows, {});
    expect(template).toEqual({});
  });
});
