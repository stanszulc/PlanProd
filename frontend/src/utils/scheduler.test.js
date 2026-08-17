import { describe, test, expect } from 'vitest';
import { getAvail, prevDayEnd, buildWcSchedule } from './scheduler.js';

describe('getAvail — workcenter missing entirely from wcSchedule', () => {
  test('treats Saturday as closed (0h), matching scheduler.worker.js and the backend', () => {
    const saturday = new Date('2026-08-15T12:00:00');
    expect(getAvail('WC_UNKNOWN', saturday, {})).toBe(0);
  });

  test('still grants the default availability on a weekday', () => {
    const monday = new Date('2026-08-17T12:00:00');
    expect(getAvail('WC_UNKNOWN', monday, {})).toBe(16);
  });
});

describe('prevDayEnd — fractional shift hours', () => {
  test('preserves a half-hour shift (7.5h) instead of truncating to whole hours', () => {
    const dt = new Date('2026-08-18T10:00:00'); // Tuesday
    const result = prevDayEnd(dt, 7.5);
    expect(result.getDate()).toBe(17);
    expect(result.getHours()).toBe(7);
    expect(result.getMinutes()).toBe(30);
  });
});

describe('buildWcSchedule — preserves prior per-date overrides on rebuild', () => {
  test('a manual/imported per-date override survives a rebuild when prev is passed through', () => {
    const wcs = ['30003'];
    const planStart = '2026-08-16';
    const zpList = [{ due_date: '2026-08-20' }];
    // Imituje wynik importu grafiku godzin: sobota (2026-08-22) ma realną wartość, nie domyślne 0h.
    const prevWithGrafik = { '30003': { '2026-08-22': 31 } };

    const rebuilt = buildWcSchedule(wcs, planStart, zpList, 14, prevWithGrafik, {});

    expect(rebuilt['30003']['2026-08-22']).toBe(31);
  });

  test('regression: rebuilding with prev={} (the pre-fix App.jsx bug) discards the override, reverting weekends to 0', () => {
    const wcs = ['30003'];
    const planStart = '2026-08-16';
    const zpList = [{ due_date: '2026-08-20' }];

    // To dokladnie to, co robil buggy handleLoad w App.jsx — {} zamiast aktualnego wcSchedule.
    const rebuiltWithEmptyPrev = buildWcSchedule(wcs, planStart, zpList, 14, {}, {});

    expect(rebuiltWithEmptyPrev['30003']['2026-08-22']).toBe(0);
  });

  test('a previously-set date survives even when the new planStart window moves past it', () => {
    // Dane wejsciowe (import grafiku godzin) sa trwale — "Planuj od" tylko okresla
    // od kiedy algorytm ma ukladac operacje, nie usuwa dostepnych godzin z przeszlosci
    // wzgledem nowej daty planowania.
    const wcs = ['30003'];
    const prevWithGrafik = { '30003': { '2026-08-22': 31 } };
    const zpList = [{ due_date: '2026-08-25' }];

    // Uzytkownik przesuwa "Planuj od" na date PO 2026-08-22
    const rebuilt = buildWcSchedule(wcs, '2026-08-24', zpList, 14, prevWithGrafik, {});

    expect(rebuilt['30003']['2026-08-22']).toBe(31);
  });

  test('fills any day without its own value from the weekly template instead of the flat default', () => {
    const wcs = ['30003'];
    const zpList = [{ due_date: '2026-08-20' }];
    // Szablon: 50h w tygodniu, 30h w sobote, 0h w niedziele (jak w realnym imporcie grafiku).
    const template = { '30003': { 0: 0, 1: 50, 2: 50, 3: 50, 4: 50, 5: 50, 6: 30 } };

    const rebuilt = buildWcSchedule(wcs, '2026-08-17', zpList, 7, {}, {}, template);

    expect(rebuilt['30003']['2026-08-17']).toBe(50); // pon
    expect(rebuilt['30003']['2026-08-22']).toBe(30); // sob
    expect(rebuilt['30003']['2026-08-23']).toBe(0);  // nd
  });

  test('an explicit per-date value (manual edit or literal import) still wins over the template', () => {
    const wcs = ['30003'];
    const zpList = [{ due_date: '2026-08-20' }];
    const prev = { '30003': { '2026-08-22': 999 } };
    const template = { '30003': { 6: 30 } };

    const rebuilt = buildWcSchedule(wcs, '2026-08-17', zpList, 7, prev, {}, template);

    expect(rebuilt['30003']['2026-08-22']).toBe(999);
  });

  test('the template keeps applying deep into a long horizon, not just the days adjacent to the import', () => {
    // Odtwarza realny scenariusz: import grafiku obejmuje tylko 7 dni, ale wcExplicit
    // (rzadkie, trwałe dane) NIE jest wcześniej "materializowane" na cały horyzont —
    // buildWcSchedule zawsze przelicza od zera z wcExplicit + template, więc sobota
    // 6 tygodni później dostaje ten sam wzorzec, a nie płaski default.
    const wcs = ['30003'];
    const zpList = [{ due_date: '2026-10-01' }];
    const wcExplicit = {}; // sparse — tylko to, co faktycznie zaimportowano/ustawiono
    const template = { '30003': { 0: 0, 1: 50, 2: 50, 3: 50, 4: 50, 5: 50, 6: 30 } };

    const rebuilt = buildWcSchedule(wcs, '2026-08-17', zpList, 60, wcExplicit, {}, template);

    expect(rebuilt['30003']['2026-09-26']).toBe(30); // sobota, 6 tygodni po imporcie
    expect(rebuilt['30003']['2026-09-01']).toBe(50); // wtorek, 2 tygodnie po imporcie
  });
});
