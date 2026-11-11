import { describe, test, expect, vi, beforeEach } from 'vitest';

// Etap 3 audytu silnika: #6 flaga planWarning, #7 spójna definicja puli,
// #8 Insert LS honoruje graf, transfer i operacje 0h.

beforeEach(() => { vi.resetModules(); });

async function run(type, payload) {
  const postMessage = vi.fn();
  vi.stubGlobal('postMessage', postMessage);
  await import('./scheduler.worker.js');
  self.onmessage({ data: { type, payload } });
  const done = postMessage.mock.calls.find(([m]) => m.type === 'DONE');
  if (!done) {
    const err = postMessage.mock.calls.find(([m]) => m.type === 'ERROR');
    throw new Error('worker ERROR: ' + (err ? err[0].payload.message : 'brak DONE'));
  }
  return done[0].payload;
}

const ms = (iso) => new Date(iso).getTime();
const overlap = (a, b) => a.segStart < b.segEnd && b.segStart < a.segEnd;
const asDates = (g) => ({ segStart: new Date(g.segStart), segEnd: new Date(g.segEnd) });

describe('#6 planWarning', () => {
  test('grafik z samymi zerami: ZP dostaje planWarning zamiast cichego "zielonego"', async () => {
    const routingByProduct = {
      P1: [{ workcenter: '20999', sequence: 1, ct_min: 0, _durH: 5, predecessors: [] }],
    };
    const zpList = [{ zp_id: 'A', product: 'P1', volume: 1, due_date: '2026-09-01', priority: 2 }];
    const { zpStatus } = await run('SCHEDULE', {
      zpList, routingByProduct, wcSchedule: { '20999': [0, 0, 0, 0, 0, 0, 0] },
      planStart: '2026-08-17', config: { schedulingMode: 'asap' }, wcToBrygada: {},
    });
    expect(zpStatus[0].planWarning).toBeTruthy();
  });

  test('normalny plan nie ma planWarning', async () => {
    const routingByProduct = {
      P1: [{ workcenter: '20999', sequence: 1, ct_min: 0, _durH: 5, predecessors: [] }],
    };
    const zpList = [{ zp_id: 'A', product: 'P1', volume: 1, due_date: '2026-09-01', priority: 2 }];
    const { zpStatus } = await run('SCHEDULE', {
      zpList, routingByProduct, wcSchedule: { '20999': [16, 16, 16, 16, 16, 16, 16] },
      planStart: '2026-08-17', config: { schedulingMode: 'asap' }, wcToBrygada: {},
    });
    expect(zpStatus[0].planWarning).toBeUndefined();
  });
});

describe('#7 spójna definicja puli', () => {
  test('numeryczny kod maszyny nie jest traktowany jak pool: dwa ZP nie nakładają się w czasie', async () => {
    const routingByProduct = {
      P1: [{ workcenter: 20999, sequence: 1, ct_min: 0, _durH: 10, predecessors: [] }],
    };
    const zpList = [
      { zp_id: 'A', product: 'P1', volume: 1, due_date: '2026-09-01', priority: 2 },
      { zp_id: 'B', product: 'P1', volume: 1, due_date: '2026-09-02', priority: 2 },
    ];
    const { fwdZP } = await run('SCHEDULE', {
      zpList, routingByProduct, wcSchedule: { 20999: [16, 16, 16, 16, 16, 16, 16] },
      planStart: '2026-08-17', config: { schedulingMode: 'asap', shiftStart: 6 }, wcToBrygada: {},
    });
    const segs = fwdZP.flatMap(o => o.segments);
    expect(segs.length).toBeGreaterThan(1);
    for (let i = 0; i < segs.length; i++)
      for (let j = i + 1; j < segs.length; j++)
        expect(overlap(segs[i], segs[j])).toBe(false);
  });

  test('Insert LS: gniazdo 3xxxx bez brygady (maszyna w SCHEDULE) respektuje istniejące rezerwacje', async () => {
    const wc = '30099';
    const op = (id, h, from, to) => ({
      zp_id: `${id}/001`, parent_zp: id, workcenter: wc, sequence: 1, durH: h,
      segments: [{ segStart: ms(from), segEnd: ms(to), durH: h }],
      start_dt: new Date(from), end_dt: new Date(to),
    });
    const Y = op('Y', 10, '2026-08-17T06:00:00', '2026-08-17T16:00:00');
    const X = op('X', 10, '2026-08-19T06:00:00', '2026-08-19T16:00:00');
    const zpStatus = [
      { zp_id: 'Y', due_date: '2026-09-30', backStart: new Date(Y.start_dt), realEnd: new Date(Y.end_dt),
        delayH: 0, late: false, toc: { zone: 'green', consumed: 0, label: 'OK' } },
      { zp_id: 'X', due_date: '2026-08-16', backStart: new Date(X.start_dt), realEnd: new Date(X.end_dt),
        delayH: 90, late: true, toc: { zone: 'black', consumed: 1, label: 'SPOZNIONE' } },
    ];
    const { fwdZP } = await run('OPTIMIZE_INSERT', {
      wcSchedule: { [wc]: [16, 16, 16, 16, 16, 16, 16] }, planStart: '2026-08-17',
      fwdZP: [Y, X], zpStatus, wcToBrygada: {}, config: { shiftStart: 6 },
    });
    const y = fwdZP.find(o => o.parent_zp === 'Y').segments;
    const x = fwdZP.find(o => o.parent_zp === 'X').segments;
    for (const a of y) for (const b of x) expect(overlap(asDates(a), asDates(b))).toBe(false);
    // i faktycznie został przesunięty wcześniej niż 19.08
    expect(new Date(x[0].segStart).getDate()).toBeLessThan(19);
  });
});

describe('#8 Insert LS honoruje graf, transfer i operacje 0h', () => {
  const sched = {
    M1: [16, 16, 16, 16, 16, 16, 16],
    M2: [16, 16, 16, 16, 16, 16, 16],
    M3: [16, 16, 16, 16, 16, 16, 16],
  };
  const hh = (h) => String(h).padStart(2, '0');
  const mkOp = (n, wc, h, preds, day) => ({
    zp_id: `Z/00${n}`, parent_zp: 'Z', workcenter: wc, sequence: n * 10, _opUid: n * 10, durH: h,
    predecessors: preds,
    segments: h > 0
      ? [{ segStart: ms(`2026-08-${day}T06:00:00`), segEnd: ms(`2026-08-${day}T${hh(6 + h)}:00:00`), durH: h }]
      : [],
    start_dt: new Date(`2026-08-${day}T06:00:00`),
    end_dt: new Date(`2026-08-${day}T${hh(6 + h)}:00:00`),
  });
  const status = (end) => ({
    zp_id: 'Z', due_date: '2026-08-16', backStart: new Date(end - 3600000), realEnd: new Date(end),
    delayH: 200, late: true, toc: { zone: 'black', consumed: 1, label: 'SPOZNIONE' },
  });

  test('operacje równoległe (fan-out) startują razem, fan-in czeka na obie + transfer 2h', async () => {
    const ops = [mkOp(1, 'M1', 5, [], 24), mkOp(2, 'M2', 5, [], 24), mkOp(3, 'M3', 3, [10, 20], 25)];
    const { fwdZP, zpStatus } = await run('OPTIMIZE_INSERT', {
      wcSchedule: sched, planStart: '2026-08-17', fwdZP: ops,
      zpStatus: [status(ops[2].end_dt.getTime())], wcToBrygada: {},
      config: { shiftStart: 6, schedulingGraphMode: 'graph' },
    });
    const o = (n) => fwdZP.find(x => x.zp_id === `Z/00${n}`);
    expect(new Date(o(1).start_dt).getTime()).toBe(new Date(o(2).start_dt).getTime());
    const joinMin = Math.max(new Date(o(1).end_dt).getTime(), new Date(o(2).end_dt).getTime()) + 2 * 3600000;
    expect(new Date(o(3).start_dt).getTime()).toBeGreaterThanOrEqual(joinMin);
    expect(new Date(zpStatus[0].realEnd).getTime()).toBe(new Date(o(3).end_dt).getTime());
  });

  test('ZP z operacją 0h da się przesunąć (wcześniej findEarliestSlot zwracał null)', async () => {
    const ops = [mkOp(1, 'M1', 4, [], 24), mkOp(2, 'M2', 0, [10], 24), mkOp(3, 'M3', 3, [20], 25)];
    const { fwdZP } = await run('OPTIMIZE_INSERT', {
      wcSchedule: sched, planStart: '2026-08-17', fwdZP: ops,
      zpStatus: [status(ops[2].end_dt.getTime())], wcToBrygada: {},
      config: { shiftStart: 6, schedulingGraphMode: 'graph' },
    });
    expect(new Date(fwdZP.find(x => x.zp_id === 'Z/001').start_dt).getDate()).toBeLessThan(24);
  });
});
