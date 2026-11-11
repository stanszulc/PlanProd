import { describe, it, expect } from 'vitest';
import { parseDt, parseDueDate, calcOtif, aggregateZsOtif, fmtIsoDate } from './otif.js';

const op = (o) => ({ status: 'CNF', sequence: 1, volume_plan: 10, volume_actual: 10, need_date: '2026-05-10', ...o });

describe('parseDueDate / parseDt', () => {
  it('data bez godziny = lokalny koniec dnia', () => {
    const d = parseDueDate('2026-05-10');
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2026, 4, 10, 23, 59]);
  });
  it('data z godzina parsowana lokalnie', () => {
    const d = parseDt('2026-05-10 08:30:00');
    expect([d.getDate(), d.getHours(), d.getMinutes()]).toEqual([10, 8, 30]);
    expect(parseDueDate('2026-05-10T08:30:00').getHours()).toBe(8);
  });
  it('null / niepoprawne', () => {
    expect(parseDt(null)).toBeNull();
    expect(parseDt('xx')).toBeNull();
    expect(parseDueDate('')).toBeNull();
  });
  it('fmtIsoDate lokalnie', () => {
    expect(fmtIsoDate(parseDueDate('2026-05-10'))).toBe('2026-05-10');
  });
});

describe('calcOtif', () => {
  const now = new Date('2026-05-05T12:00:00');
  it('koniec dnia terminu nie jest spoznieniem, nastepny dzien tak', () => {
    const a = calcOtif([op({ actual_end: '2026-05-10 22:00:00' })], now);
    expect(a.onTime).toBe(true); expect(a.otif).toBe(true);
    const b = calcOtif([op({ actual_end: '2026-05-11 00:30:00' })], now);
    expect(b.onTime).toBe(false); expect(b.otif).toBe(false);
  });
  it('ZP w toku przed terminem: otif null, inFull null', () => {
    const r = calcOtif([op({ status: 'WIP', volume_actual: 3, actual_end: null })], now);
    expect(r.inFull).toBeNull(); expect(r.onTime).toBeNull(); expect(r.otif).toBeNull();
  });
  it('ZP w toku po terminie: onTime false, otif false, inFull null', () => {
    const r = calcOtif([op({ status: 'PLAN', volume_actual: 0, actual_end: null })], new Date('2026-05-12T10:00:00'));
    expect(r.onTime).toBe(false); expect(r.inFull).toBeNull(); expect(r.otif).toBe(false);
  });
  it('zakonczone, niepelna ilosc: inFull false', () => {
    const r = calcOtif([op({ volume_actual: 5, actual_end: '2026-05-09 10:00:00' })], now);
    expect(r.inFull).toBe(false); expect(r.otif).toBe(false);
  });
  it('ilosc oceniana po operacji koncowej, nie sumie operacji', () => {
    const r = calcOtif([
      op({ sequence: 1, volume_plan: 10, volume_actual: 20, actual_end: '2026-05-08 10:00:00' }),
      op({ sequence: 2, volume_plan: 10, volume_actual: 5, actual_end: '2026-05-09 10:00:00' }),
    ], now);
    expect(r.volPlan).toBe(10); expect(r.volActual).toBe(5); expect(r.inFull).toBe(false);
  });
  it('w calosci anulowana: otif null', () => {
    const r = calcOtif([op({ status: 'CNC' })], now);
    expect(r.allCnc).toBe(true); expect(r.otif).toBeNull(); expect(r.onTime).toBeNull(); expect(r.inFull).toBeNull();
  });
});

describe('aggregateZsOtif', () => {
  it('anulowana pozycja nie psuje ZS', () => {
    expect(aggregateZsOtif([{ allCnc: true, otif: null }, { allCnc: false, otif: true }])).toBe(true);
  });
  it('porazka pozycji = porazka ZS', () => {
    expect(aggregateZsOtif([{ allCnc: false, otif: true }, { allCnc: false, otif: false }])).toBe(false);
  });
  it('w toku = null; same anulowane = null', () => {
    expect(aggregateZsOtif([{ allCnc: false, otif: null }, { allCnc: false, otif: true }])).toBeNull();
    expect(aggregateZsOtif([{ allCnc: true, otif: null }])).toBeNull();
  });
});
