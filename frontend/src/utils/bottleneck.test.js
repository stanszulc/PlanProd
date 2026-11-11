import { describe, test, expect } from 'vitest';
import { calcBottlenecks } from './bottleneck.js';

// Kalendarz testowy: 2026-08-17 to poniedziałek.
const seg = (day, from, h) => {
  const s = new Date(`2026-08-${day}T${String(from).padStart(2, '0')}:00:00`);
  return { segStart: s, segEnd: new Date(s.getTime() + h * 3600000), durH: h };
};
// operacja planu: workcenter, godziny, termin ZP, segmenty
const op = (wc, durH, due, segments = []) => ({ workcenter: wc, durH, due_date: due, segments });
const full = (h) => [h, h, h, h, h, h, h];
const weekdays = (h) => [h, h, h, h, h, 0, 0];
const START = '2026-08-17';

describe('calcBottlenecks — obciążenie narastające do terminów (RCCP) per brygada', () => {
  test('popyt do terminu > dostępność do terminu: brakujące godziny i główne wąskie gardło', () => {
    // 30 h do końca poniedziałku, a brygada ma 16 h/dobę
    const fwdZP = [op('20001', 30, '2026-08-17', [seg('17', 6, 16), seg('18', 6, 14)])];
    const r = calcBottlenecks({ fwdZP, wcSchedule: { 20001: weekdays(16) }, wcToBrygada: {}, startDate: START });
    const g = r.groups[0];
    expect(g.due.shortfallH).toBeCloseTo(14);
    expect(g.due.worstRatio).toBeCloseTo(30 / 16);
    expect(g.due.worstDate).toBe('2026-08-17');
    expect(g.excessH).toBeCloseTo(14);
    expect(g.status).toBe('KRYT'); // 188% > 130%
    expect(r.primary.name).toBe('20001');
  });

  test('ten sam popyt, ale termin 2 dni później: mieści się', () => {
    const fwdZP = [op('20001', 30, '2026-08-18', [seg('17', 6, 16), seg('18', 6, 14)])];
    const r = calcBottlenecks({ fwdZP, wcSchedule: { 20001: weekdays(16) }, wcToBrygada: {}, startDate: START });
    const g = r.groups[0];
    expect(g.due.shortfallH).toBe(0);
    expect(g.due.worstRatio).toBeCloseTo(30 / 32);
    expect(g.status).toBe('UWAGA'); // 94%
    expect(r.primary).toBeNull();
  });

  test('narastająco: wcześniejszy termin przeciążony nawet gdy suma całkowita się mieści', () => {
    const fwdZP = [
      op('20001', 20, '2026-08-17'), // do pon. dostępne 16 h -> brakuje 4
      op('20001', 4, '2026-08-21'),  // do pt. dostępne 80 h
    ];
    const r = calcBottlenecks({ fwdZP, wcSchedule: { 20001: weekdays(16) }, wcToBrygada: {}, startDate: START });
    expect(r.groups[0].due.shortfallH).toBeCloseTo(4);
    expect(r.groups[0].due.worstDate).toBe('2026-08-17');
    expect(r.groups[0].due.overDates).toBe(1);
  });

  test('termin przeterminowany (przed startem) liczy się od pierwszego dnia planu', () => {
    const fwdZP = [op('20001', 24, '2026-08-10')];
    const r = calcBottlenecks({ fwdZP, wcSchedule: { 20001: weekdays(16) }, wcToBrygada: {}, startDate: START });
    expect(r.groups[0].due.shortfallH).toBeCloseTo(8);
    expect(r.groups[0].due.worstDate).toBe(START);
  });

  test('pula brygady: pojemność to suma maszyn i gniazd, nie pojedyncze gniazdo', () => {
    // 3 gniazda × 16 h = 48 h/dobę; popyt 40 h do poniedziałku rozłożony nierówno
    const fwdZP = [op('30042', 16, START), op('30043', 16, START), op('30045', 8, START)];
    const wcSchedule = { 30042: weekdays(16), 30043: weekdays(16), 30045: weekdays(16) };
    const wcToBrygada = { 30042: 'B1', 30043: 'B1', 30045: 'B1' };
    const r = calcBottlenecks({ fwdZP, wcSchedule, wcToBrygada, startDate: START });
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0].due.worstRatio).toBeCloseTo(40 / 48);
    expect(r.groups[0].status).toBe('OK'); // 83% <= 85%
    expect(r.primary).toBeNull();
  });

  test('weekend ma zerową dostępność: termin w sobotę liczy narastającą pojemność z pt.', () => {
    const fwdZP = [op('20001', 100, '2026-08-22')]; // sobota; dostępne pon-pt = 80 h
    const r = calcBottlenecks({ fwdZP, wcSchedule: { 20001: weekdays(16) }, wcToBrygada: {}, startDate: START });
    expect(r.groups[0].due.shortfallH).toBeCloseTo(20);
  });

  test('szum zmiennoprzecinkowy nie robi z brygady wąskiego gardła ani statusu BN', () => {
    // plan wypełnia dobę co do ułamka (16.0000001 h w dniu z dostępnością 16 h)
    const fwdZP = [op('20001', 16.0000001, '2026-08-17', [seg('17', 6, 16.0000001)])];
    const r = calcBottlenecks({ fwdZP, wcSchedule: { 20001: weekdays(16) }, wcToBrygada: {}, startDate: START });
    expect(r.primary).toBeNull();
    expect(r.groups[0].status).not.toBe('BN');
    expect(r.groups[0].status).not.toBe('KRYT');
    expect(r.groups[0].overloadDays).toBe(0);
  });

  test('brygada z dużym zapasem (jak Laser) nie jest wąskim gardłem, a duży backlog tak (jak Linia Tłumików)', () => {
    // termin za 12 dni kalendarzowych = 10 dni roboczych, dostępność 80 h/dobę
    const due = '2026-08-28';
    const fwdZP = [
      op('20100', 2042, due),   // Linia: 2042 h, dostępne 10 × 80 = 800 h
      op('20200', 125, due),    // Laser: 125 h, dostępne 10 × 16 = 160 h
    ];
    const wcSchedule = { 20100: weekdays(80), 20200: weekdays(16) };
    const wcToBrygada = { 20100: 'Linia', 20200: 'Laser' };
    const r = calcBottlenecks({ fwdZP, wcSchedule, wcToBrygada, startDate: START });
    expect(r.primary.name).toBe('Linia');
    expect(r.groups[0].name).toBe('Linia');
    expect(r.groups[0].due.shortfallH).toBeCloseTo(2042 - 800);
    expect(r.groups.find(g => g.name === 'Laser').excessH).toBe(0);
    expect(r.groups.find(g => g.name === 'Laser').status).not.toBe('BN');
  });

  test('dzienne obciążenie z segmentów planu zostaje dostępne (pasek dni), ze średnią i szczytem', () => {
    const fwdZP = [op('20001', 24, '2026-08-21', [seg('17', 6, 16), seg('18', 6, 8)])];
    const r = calcBottlenecks({ fwdZP, wcSchedule: { 20001: weekdays(16) }, wcToBrygada: {}, startDate: START });
    const g = r.groups[0];
    expect(g.days.find(d => d.date === '2026-08-17').load).toBeCloseTo(16);
    expect(g.peakUtil).toBeCloseTo(1);
    expect(g.peakDate).toBe('2026-08-17');
    expect(g.totalLoad).toBeCloseTo(24);
  });

  test('gniazdo spoza wcToBrygada tworzy własną grupę; segmenty jako liczby (ms) też działają', () => {
    const s = seg('17', 6, 4);
    const fwdZP = [op('20999', 4, START, [{ segStart: s.segStart.getTime(), segEnd: s.segEnd.getTime(), durH: 4 }])];
    const r = calcBottlenecks({ fwdZP, wcSchedule: { 20999: full(16) }, wcToBrygada: {}, startDate: START });
    expect(r.groups[0].name).toBe('20999');
    expect(r.groups[0].totalLoad).toBeCloseTo(4);
  });

  test('puste wejście nie rzuca', () => {
    const r = calcBottlenecks({ fwdZP: [], wcSchedule: {}, wcToBrygada: {} });
    expect(r.groups).toEqual([]);
    expect(r.primary).toBeNull();
  });
});
