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

describe('mergeGrafikGodzinIntoSchedule — brygada mieszana (2xxxx + 3xxxx): maszyna dostaje własne zapotrzebowanie, nie równy udział', () => {
  test('gdy wcCapacity maszyny odpowiada temu, co dałby równy podział — wynik identyczny jak dawny równy podział', () => {
    const rows = [{ brygada: 'Gniazdo KTM/KTS', data: '2026-08-17', godziny: 16 }];
    const wcToBrygada = { '20074': 'Gniazdo KTM/KTS', '30042': 'Gniazdo KTM/KTS' };
    const wcCapacity = { '20074': 8, '30042': 8 };

    const { schedule } = mergeGrafikGodzinIntoSchedule(rows, wcToBrygada, {}, wcCapacity);

    expect(schedule['20074']['2026-08-17']).toBe(8);
    expect(schedule['30042']['2026-08-17']).toBe(8);
  });

  test('maszyna z ręcznie ustawioną capacity dostaje swoją wartość, reszta (nie udział) idzie do gniazd', () => {
    const rows = [{ brygada: 'Gniazdo KTM/KTS', data: '2026-08-17', godziny: 40 }];
    const wcToBrygada = {
      '20074': 'Gniazdo KTM/KTS', '30042': 'Gniazdo KTM/KTS', '30043': 'Gniazdo KTM/KTS',
    };
    const wcCapacity = { '20074': 8 }; // jedna zmiana, znacznie mniej niż "równy" udział z 40h/3

    const { schedule } = mergeGrafikGodzinIntoSchedule(rows, wcToBrygada, {}, wcCapacity);

    expect(schedule['20074']['2026-08-17']).toBe(8);
    expect(schedule['30042']['2026-08-17']).toBe(16); // (40-8)/2
    expect(schedule['30043']['2026-08-17']).toBe(16);
  });

  test('zapotrzebowania maszyn przekraczają zaimportowane godziny dnia (np. święto) — przycina proporcjonalnie, suma zachowana', () => {
    const rows = [{ brygada: 'Maszyny', data: '2026-08-17', godziny: 30 }];
    const wcToBrygada = { '20017': 'Maszyny', '20043': 'Maszyny', '30009': 'Maszyny' };
    const wcCapacity = { '20017': 20, '20043': 20 }; // suma 40h > 30h zaimportowanych tego dnia

    const { schedule } = mergeGrafikGodzinIntoSchedule(rows, wcToBrygada, {}, wcCapacity);

    expect(schedule['20017']['2026-08-17']).toBeCloseTo(15); // 20 * (30/40)
    expect(schedule['20043']['2026-08-17']).toBeCloseTo(15);
    expect(schedule['30009']['2026-08-17']).toBeCloseTo(0);  // nic nie zostało dla gniazda
    const total = schedule['20017']['2026-08-17'] + schedule['20043']['2026-08-17'] + schedule['30009']['2026-08-17'];
    expect(total).toBeCloseTo(30); // żadne godziny nie zostały stworzone/zgubione
  });

  test('sufit maszyny (24h/dobę) respektowany nawet gdy wcCapacity/brygada dają więcej', () => {
    const rows = [{ brygada: 'Gniazdo KTM/KTS', data: '2026-08-17', godziny: 60 }];
    const wcToBrygada = { '20074': 'Gniazdo KTM/KTS', '30099': 'Gniazdo KTM/KTS' };
    const wcCapacity = { '20074': 40 }; // ponad fizyczny sufit 24h — ma zostać przycięte do 24

    const { schedule } = mergeGrafikGodzinIntoSchedule(rows, wcToBrygada, {}, wcCapacity);

    expect(schedule['20074']['2026-08-17']).toBe(24);
    expect(schedule['30099']['2026-08-17']).toBe(36); // 60 - 24
  });

  test('kształt Maszyny (wiele maszyn + gniazda): reguła generalizuje się na >1 maszynę', () => {
    const rows = [{ brygada: 'Maszyny', data: '2026-08-17', godziny: 60 }];
    const wcToBrygada = {
      '20017': 'Maszyny', '20043': 'Maszyny', '20045': 'Maszyny',
      '30009': 'Maszyny', '30025': 'Maszyny',
    };
    const wcCapacity = { '20017': 8, '20043': 8, '20045': 8 };

    const { schedule } = mergeGrafikGodzinIntoSchedule(rows, wcToBrygada, {}, wcCapacity);

    expect(schedule['20017']['2026-08-17']).toBe(8);
    expect(schedule['20043']['2026-08-17']).toBe(8);
    expect(schedule['20045']['2026-08-17']).toBe(8);
    expect(schedule['30009']['2026-08-17']).toBe(18); // (60-24)/2
    expect(schedule['30025']['2026-08-17']).toBe(18);
  });

  test('pojedyncza maszyna bez gniazd (kształt Heager): degeneruje do pełnej wartości importu, nie do wcCapacity', () => {
    const rows = [{ brygada: 'Heager', data: '2026-08-17', godziny: 20 }];
    const wcToBrygada = { '20049': 'Heager' };
    const wcCapacity = { '20049': 8 }; // typowe zapotrzebowanie — nie ma gniazda, które wchłonie nadwyżkę

    const { schedule } = mergeGrafikGodzinIntoSchedule(rows, wcToBrygada, {}, wcCapacity);

    expect(schedule['20049']['2026-08-17']).toBe(20); // cała realna wartość, nic nie zgubione
  });

  test('brak wcCapacity (parametr domyślny) — nie wywala się, używa fallbacku', () => {
    const rows = [{ brygada: 'Gniazdo KTM/KTS', data: '2026-08-17', godziny: 40 }];
    const wcToBrygada = { '20074': 'Gniazdo KTM/KTS', '30042': 'Gniazdo KTM/KTS' };

    expect(() => mergeGrafikGodzinIntoSchedule(rows, wcToBrygada, {})).not.toThrow();
  });
});

describe('buildWeeklyTemplateFromGrafik — brygada mieszana', () => {
  test('maszyna z ręcznie ustawioną capacity dostaje swoją wartość w szablonie, nie równy udział', () => {
    const rows = [{ brygada: 'Gniazdo KTM/KTS', data: '2026-08-17', godziny: 40 }]; // poniedziałek (1)
    const wcToBrygada = {
      '20074': 'Gniazdo KTM/KTS', '30042': 'Gniazdo KTM/KTS', '30043': 'Gniazdo KTM/KTS',
    };
    const wcCapacity = { '20074': 8 };

    const template = buildWeeklyTemplateFromGrafik(rows, wcToBrygada, wcCapacity);

    expect(template['20074'][1]).toBe(8);
    expect(template['30042'][1]).toBe(16);
    expect(template['30043'][1]).toBe(16);
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
