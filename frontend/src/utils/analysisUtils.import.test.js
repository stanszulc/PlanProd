import { describe, test, expect } from 'vitest';
import { parseZpStatus, parseDateFlexible, parseNum, calcZpHeaderStatus } from './analysisUtils.js';

const H = 'zp_id,parent_zp,zs_id,pozycja,klient,product,operation,workcenter,sequence,volume_plan,volume_actual,status,need_date,planned_start,planned_end,actual_start,actual_end,priority,reason_code';
const hs = H.replace(/,/g, ';');

describe('parseNum', () => {
  test('przecinek dziesiętny i spacje tysięcy', () => {
    expect(parseNum('12,5')).toBe(12.5);
    expect(parseNum('1 234,5')).toBe(1234.5);
    expect(parseNum('1 234,5')).toBe(1234.5);
    expect(parseNum('7')).toBe(7);
    expect(parseNum('abc')).toBeNaN();
  });
});

describe('parseDateFlexible', () => {
  test('formaty', () => {
    expect(parseDateFlexible('2026-05-25 07:30')).toEqual(new Date(2026, 4, 25, 7, 30));
    expect(parseDateFlexible('2026-05-25T07:30:15')).toEqual(new Date(2026, 4, 25, 7, 30, 15));
    expect(parseDateFlexible('25.05.2026 07:30')).toEqual(new Date(2026, 4, 25, 7, 30));
    expect(parseDateFlexible('25/05/2026')).toEqual(new Date(2026, 4, 25, 0, 0));
    expect(parseDateFlexible('25.05.2026', { endOfDay: true })).toEqual(new Date(2026, 4, 25, 23, 59, 59));
    expect(parseDateFlexible('25.05.2026 10:00', { endOfDay: true })).toEqual(new Date(2026, 4, 25, 10, 0));
  });
  test('nieparsowalne i nieistniejące -> null', () => {
    expect(parseDateFlexible('jutro')).toBeNull();
    expect(parseDateFlexible('31.02.2026')).toBeNull();
    expect(parseDateFlexible('')).toBeNull();
  });
});

describe('parseZpStatus', () => {
  const row = (extra = {}) => {
    const d = { zp_id: 'ZP-1/01/01', parent_zp: 'ZP-1/01', zs_id: 'ZS', pozycja: 1, klient: 'K', product: 'P', operation: 'O', workcenter: 'G-01', sequence: 1, volume_plan: '12,5', volume_actual: '3,5', status: 'WIP', need_date: '25.05.2026', planned_start: '', planned_end: '', actual_start: '20.05.2026 07:00', actual_end: '', priority: 1, reason_code: '', ...extra };
    return Object.values(d).join(';');
  };
  test('przecinek dziesiętny przy ; i daty DD.MM.YYYY', () => {
    const { records, rejected } = parseZpStatus([hs, row()].join('\r\n'));
    expect(rejected).toEqual([]);
    expect(records[0].volume_plan).toBe(12.5);
    expect(records[0].volume_actual).toBe(3.5);
    expect(records[0].need_date).toBe('2026-05-25');
    expect(records[0].actual_start).toEqual(new Date(2026, 4, 20, 7, 0));
  });
  test('NaN w ilościach i zła data -> odrzucone z powodem', () => {
    const { records, rejected } = parseZpStatus([hs, row({ volume_plan: 'abc' }), row({ need_date: 'jutro' }), row({ actual_end: '99.99.2026' })].join('\n'));
    expect(records).toHaveLength(0);
    expect(rejected).toHaveLength(3);
    expect(rejected[0].reason).toMatch(/volume_plan/);
    expect(rejected[1].reason).toMatch(/need_date/);
    expect(rejected[2].reason).toMatch(/actual_end/);
  });
  test('isLate/isAtRisk działają dla daty DD.MM.YYYY', () => {
    const { records } = parseZpStatus([hs, row({ status: 'WIP', need_date: '01.01.2020' })].join('\n'));
    const [h] = calcZpHeaderStatus(records);
    expect(h.is_at_risk).toBe(true);
  });
});
