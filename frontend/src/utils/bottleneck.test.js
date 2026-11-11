import { describe, test, expect } from 'vitest';
import { calcBottlenecks } from './bottleneck.js';

// plan: poniedziałek 2026-08-17 … wtorek 2026-08-18
const seg = (day, from, h) => {
  const s = new Date(`2026-08-${day}T${String(from).padStart(2, '0')}:00:00`);
  return { segStart: s, segEnd: new Date(s.getTime() + h * 3600000), durH: h };
};
const op = (wc, segments) => ({ workcenter: wc, segments });
const full = (h) => [h, h, h, h, h, h, h];

describe('calcBottlenecks — jedna definicja z planu, per brygada', () => {
  test('sumuje obciążenie gniazd w brygadzie i porównuje z pulą brygady (nie z pojedynczym gniazdem)', () => {
    // 3 gniazda × 16h = pula 48h/dobę; obciążenie 40h w poniedziałek rozłożone nierówno
    const fwdZP = [
      op('30042', [seg('17', 6, 16)]),
      op('30043', [seg('17', 6, 16)]),
      op('30045', [seg('17', 6, 8)]),
    ];
    const wcSchedule = { 30042: full(16), 30043: full(16), 30045: full(16) };
    const wcToBrygada = { 30042: 'B1', 30043: 'B1', 30045: 'B1' };
    const r = calcBottlenecks({ fwdZP, wcSchedule, wcToBrygada });
    expect(r.groups).toHaveLength(1);
    const g = r.groups[0];
    expect(g.name).toBe('B1');
    expect(g.peakUtil).toBeCloseTo(40 / 48);
    expect(g.excessH).toBe(0);
    expect(g.status).toBe('OK'); // 83% <= U_OK (85%)
  });

  test('przeciążenie brygady: nadwyżka godzin, dni ponad 100% i główne wąskie gardło', () => {
    const fwdZP = [
      op('30042', [seg('17', 6, 16), seg('18', 6, 16)]),
      op('30043', [seg('17', 6, 16), seg('18', 6, 4)]),
      op('20001', [seg('17', 6, 10)]),
    ];
    const wcSchedule = { 30042: full(16), 30043: full(8), 20001: full(16) };
    const wcToBrygada = { 30042: 'B1', 30043: 'B1', 20001: 'B2' };
    const r = calcBottlenecks({ fwdZP, wcSchedule, wcToBrygada });
    const b1 = r.groups.find(g => g.name === 'B1');
    // pon: load 32, cap 24 -> nadwyżka 8; wt: load 20, cap 24 -> 0
    expect(b1.excessH).toBeCloseTo(8);
    expect(b1.overloadDays).toBe(1);
    expect(b1.peakDate).toBe('2026-08-17');
    expect(r.primary.name).toBe('B1');
    // B2 (10h na 16h) nie jest wąskim gardłem
    expect(r.groups.find(g => g.name === 'B2').excessH).toBe(0);
    expect(r.groups[0].name).toBe('B1'); // sortowanie wg nadwyżki
  });

  test('brak przeciążeń: primary = null (nie nazywamy wąskim gardłem czegoś, co się mieści)', () => {
    const fwdZP = [op('20001', [seg('17', 6, 8)])];
    const r = calcBottlenecks({ fwdZP, wcSchedule: { 20001: full(16) }, wcToBrygada: {} });
    expect(r.primary).toBeNull();
    expect(r.groups[0].status).toBe('OK');
  });

  test('dzień o zerowej zdolności z pracą: nadwyżka = cała praca, util bez Infinity w średniej', () => {
    // 2026-08-22 to sobota (cap 0)
    const fwdZP = [op('20001', [seg('22', 6, 5), seg('17', 6, 8)])];
    const r = calcBottlenecks({ fwdZP, wcSchedule: { 20001: [16, 16, 16, 16, 16, 0, 0] }, wcToBrygada: {} });
    const g = r.groups[0];
    expect(g.excessH).toBeCloseTo(5);
    expect(Number.isFinite(g.avgUtil)).toBe(true);
    expect(g.overloadDays).toBe(1);
    expect(r.primary.name).toBe('20001');
  });

  test('gniazdo spoza wcToBrygada tworzy własną grupę; segmenty jako liczby (ms) też działają', () => {
    const s = seg('17', 6, 4);
    const fwdZP = [op('20999', [{ segStart: s.segStart.getTime(), segEnd: s.segEnd.getTime(), durH: 4 }])];
    const r = calcBottlenecks({ fwdZP, wcSchedule: { 20999: full(16) }, wcToBrygada: {} });
    expect(r.groups[0].name).toBe('20999');
    expect(r.groups[0].totalLoad).toBeCloseTo(4);
  });

  test('puste wejście nie rzuca', () => {
    const r = calcBottlenecks({ fwdZP: [], wcSchedule: {}, wcToBrygada: {} });
    expect(r.groups).toEqual([]);
    expect(r.primary).toBeNull();
  });
});
