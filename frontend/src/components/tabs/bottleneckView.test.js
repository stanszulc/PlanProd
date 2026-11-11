import { describe, test, expect } from 'vitest';
import { planBottleneckView } from './bottleneckView.js';

const seg = (h) => ({ segStart: new Date(2026, 7, 17, 6), durH: h });

describe('planBottleneckView', () => {
  test('wyróżnia gniazda tylko przeciążonej brygady', () => {
    const fwdZP = [
      { workcenter: 'A1', segments: [seg(40)] },
      { workcenter: 'A2', segments: [seg(2)] },
      { workcenter: 'B1', segments: [seg(2)] },
    ];
    const wcToBrygada = { A1: 'Alfa', A2: 'Alfa', B1: 'Beta' };
    const v = planBottleneckView({ fwdZP, wcSchedule: {}, wcToBrygada });
    expect(v.primaryName).toBe('Alfa');
    expect(v.primaryMembers.has('A1')).toBe(true);
    expect(v.primaryMembers.has('A2')).toBe(true);
    expect(v.primaryMembers.has('B1')).toBe(false);
  });

  test('brak przeciążenia → brak primary; pusty plan → hasPlan=false', () => {
    const fwdZP = [{ workcenter: 'A1', segments: [seg(2)] }];
    const v = planBottleneckView({ fwdZP, wcSchedule: {}, wcToBrygada: { A1: 'Alfa' } });
    expect(v.primaryName).toBeNull();
    expect(v.primaryMembers.size).toBe(0);
    expect(planBottleneckView({ fwdZP: [], wcSchedule: {}, wcToBrygada: {} }).hasPlan).toBe(false);
  });
});
