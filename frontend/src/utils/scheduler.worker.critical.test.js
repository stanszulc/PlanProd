import { describe, test, expect, vi, beforeEach } from 'vitest';

// Regresje dla krytycznych ustaleń audytu silnika (2026-11-11):
//  #1 sufit maszyny w brygadzie mieszanej liczony podwójnie
//  #2 domyślny shiftStart=6 obcinał dobę maszyny do 18h
//  #3 ZP znikał po cichu w trybie graph (duplikat OP / cykl / brak poprzednika)
//  #4 Insert LS nie wycofywał rezerwacji odrzuconej próby
//  #5 strefy TOC yellow/red były nieosiągalne

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

const BRYGADA = {
  '20074': 'Gniazdo KTM/KTS', '30042': 'Gniazdo KTM/KTS',
  '30043': 'Gniazdo KTM/KTS', '30045': 'Gniazdo KTM/KTS',
};
const BIG_SCHEDULE = {
  '20074': [8, 8, 8, 8, 8, 8, 8],
  '30042': [100, 100, 100, 100, 100, 100, 100],
  '30043': [100, 100, 100, 100, 100, 100, 100],
  '30045': [100, 100, 100, 100, 100, 100, 100],
};
const hours = (d) => d.getHours() + d.getMinutes() / 60;

describe('#1 sufit maszyny w brygadzie mieszanej', () => {
  test('dwa ZP po 10h na jednej maszynie mieszczą się w jednej dobie (20h z 24h)', async () => {
    const routingByProduct = {
      P1: [{ workcenter: '20074', sequence: 1, ct_min: 0, _durH: 10, predecessors: [] }],
    };
    const zpList = [
      { zp_id: 'A', product: 'P1', volume: 1, due_date: '2026-09-01', priority: 2 },
      { zp_id: 'B', product: 'P1', volume: 1, due_date: '2026-09-02', priority: 2 },
    ];
    const { fwdZP } = await run('SCHEDULE', {
      zpList, routingByProduct, wcSchedule: BIG_SCHEDULE, planStart: '2026-08-17',
      config: { schedulingMode: 'asap', shiftStart: 0 }, wcToBrygada: BRYGADA,
    });
    const all = fwdZP.flatMap(o => o.segments);
    expect(all).toHaveLength(2); // żaden ZP nie jest dzielony na dwie doby
    const total = all.reduce((s, g) => s + g.durH, 0);
    expect(total).toBeCloseTo(20);
    const days = new Set(all.map(g => g.segStart.getDate()));
    expect(days.size).toBe(1);
  });
});

describe('#2 domyślny shiftStart=6', () => {
  test('maszyna z pulą 100h dostaje pełne 24h pierwszej doby, nie 18h', async () => {
    const routingByProduct = {
      P1: [{ workcenter: '20074', sequence: 1, ct_min: 0, _durH: 30, predecessors: [] }],
    };
    const zpList = [{ zp_id: 'A', product: 'P1', volume: 1, due_date: '2026-09-01', priority: 2 }];
    const { fwdZP } = await run('SCHEDULE', {
      zpList, routingByProduct, wcSchedule: BIG_SCHEDULE, planStart: '2026-08-17',
      config: { schedulingMode: 'asap' }, wcToBrygada: BRYGADA, // shiftStart domyślny = 6
    });
    const segs = fwdZP[0].segments;
    expect(segs[0].durH).toBeCloseTo(24);
    expect(segs[1].durH).toBeCloseTo(6);
  });

  test('maszyna 16h/dobę nadal startuje o godzinie startu zmiany', async () => {
    const routingByProduct = {
      P1: [{ workcenter: '20999', sequence: 1, ct_min: 0, _durH: 20, predecessors: [] }],
    };
    const zpList = [{ zp_id: 'A', product: 'P1', volume: 1, due_date: '2026-09-01', priority: 2 }];
    const { fwdZP } = await run('SCHEDULE', {
      zpList, routingByProduct, wcSchedule: { '20999': [16, 16, 16, 16, 16, 16, 16] },
      planStart: '2026-08-17', config: { schedulingMode: 'asap', shiftStart: 6 }, wcToBrygada: {},
    });
    const segs = fwdZP[0].segments;
    expect(hours(segs[0].segStart)).toBeCloseTo(6);
    expect(segs[0].durH).toBeCloseTo(16);
    expect(segs[1].durH).toBeCloseTo(4);
  });
});

describe('#3 tryb graph: ZP nie znika po cichu', () => {
  test('duplikat numeru OP + poprzednik wskazujący na ten numer: obie operacje zaplanowane i ostrzeżenie', async () => {
    const routingByProduct = {
      P1: [
        { workcenter: '20001', sequence: 10, ct_min: 0, _durH: 2, predecessors: [] },
        { workcenter: '20002', sequence: 10, ct_min: 0, _durH: 3, predecessors: [10] },
      ],
    };
    const zpList = [{ zp_id: 'A', product: 'P1', volume: 1, due_date: '2026-09-01', priority: 2 }];
    const { fwdZP, zpStatus } = await run('SCHEDULE', {
      zpList, routingByProduct,
      wcSchedule: { '20001': [16, 16, 16, 16, 16, 16, 16], '20002': [16, 16, 16, 16, 16, 16, 16] },
      planStart: '2026-08-17', config: { schedulingMode: 'asap', schedulingGraphMode: 'graph' },
      wcToBrygada: {},
    });
    expect(fwdZP).toHaveLength(2);
    expect(zpStatus).toHaveLength(1);
    expect(zpStatus[0].graphWarning).toBeTruthy();
  });

  test('cykl w poprzednikach: ZP nadal dostaje plan i ostrzeżenie', async () => {
    const routingByProduct = {
      P1: [
        { workcenter: '20001', sequence: 10, ct_min: 0, _durH: 2, predecessors: [20] },
        { workcenter: '20002', sequence: 20, ct_min: 0, _durH: 3, predecessors: [10] },
      ],
    };
    const zpList = [{ zp_id: 'A', product: 'P1', volume: 1, due_date: '2026-09-01', priority: 2 }];
    const { fwdZP, zpStatus } = await run('SCHEDULE', {
      zpList, routingByProduct,
      wcSchedule: { '20001': [16, 16, 16, 16, 16, 16, 16], '20002': [16, 16, 16, 16, 16, 16, 16] },
      planStart: '2026-08-17', config: { schedulingMode: 'asap', schedulingGraphMode: 'graph' },
      wcToBrygada: {},
    });
    expect(fwdZP).toHaveLength(2);
    expect(zpStatus[0].graphWarning).toBeTruthy();
  });

  test('poprawny graf nie dostaje ostrzeżenia', async () => {
    const routingByProduct = {
      P1: [
        { workcenter: '20001', sequence: 10, ct_min: 0, _durH: 2, predecessors: [] },
        { workcenter: '20002', sequence: 20, ct_min: 0, _durH: 3, predecessors: [10] },
      ],
    };
    const zpList = [{ zp_id: 'A', product: 'P1', volume: 1, due_date: '2026-09-01', priority: 2 }];
    const { zpStatus } = await run('SCHEDULE', {
      zpList, routingByProduct,
      wcSchedule: { '20001': [16, 16, 16, 16, 16, 16, 16], '20002': [16, 16, 16, 16, 16, 16, 16] },
      planStart: '2026-08-17', config: { schedulingMode: 'asap', schedulingGraphMode: 'graph' },
      wcToBrygada: {},
    });
    expect(zpStatus[0].graphWarning).toBeUndefined();
  });
});

describe('#5 strefy TOC', () => {
  async function zoneFor(dueDate) {
    const routingByProduct = {
      P1: [{ workcenter: '20999', sequence: 1, ct_min: 0, _durH: 20, predecessors: [] }],
    };
    const zpList = [{ zp_id: 'A', product: 'P1', volume: 1, due_date: dueDate, priority: 2 }];
    const { zpStatus } = await run('SCHEDULE', {
      zpList, routingByProduct, wcSchedule: { '20999': [16, 16, 16, 16, 16, 16, 16] },
      planStart: '2026-08-17', config: { schedulingMode: 'asap', shiftStart: 6 }, wcToBrygada: {},
    });
    return zpStatus[0].toc;
  }

  // plan: pon 06:00 → wt 10:00 (34h od planStart 00:00 poniedziałku)
  test('termin daleko: zielona', async () => {
    expect((await zoneFor('2026-08-31')).zone).toBe('green');
  });
  test('zużyte ~47% okna: żółta', async () => {
    expect((await zoneFor('2026-08-19')).zone).toBe('yellow');
  });
  test('zużyte ~71% okna: czerwona', async () => {
    expect((await zoneFor('2026-08-18')).zone).toBe('red');
  });
});

describe('#4 Insert LS: odrzucona próba nie zostawia rezerwacji', () => {
  const seg = (day, from, to) => ({
    segStart: new Date(`2026-08-${day}T${from}:00:00`).getTime(),
    segEnd:   new Date(`2026-08-${day}T${to}:00:00`).getTime(),
    durH: Number(to) - Number(from),
  });
  const op = (id, h, s) => ({
    zp_id: `${id}/001`, parent_zp: id, workcenter: '30042', sequence: 1, durH: h,
    segments: [s], start_dt: new Date(s.segStart), end_dt: new Date(s.segEnd),
  });
  const st = (id, delayH, end) => ({
    zp_id: id, due_date: '2026-08-16', backStart: new Date(end - 3600000), realEnd: new Date(end),
    delayH, late: delayH > 0, toc: { zone: 'black', consumed: 1, label: 'SPÓŹNIONE' },
  });

  test('po nieudanej próbie Q pula dnia nie jest zawyżona, więc W może się przesunąć do tego dnia', async () => {
    // pula 10h/dobę. D17: Y (10h, pełna doba). D18: Q (6h, nie da się poprawić). D19: W (4h).
    const Y = op('Y', 10, seg('17', '00', '10'));
    const Q = op('Q', 6,  seg('18', '00', '06'));
    const W = op('W', 4,  seg('19', '00', '04'));
    const zpStatus = [
      { ...st('Y', 0, Y.segments[0].segEnd), due_date: '2026-09-30', late: false },
      st('Q', 100, Q.segments[0].segEnd),
      st('W', 50,  W.segments[0].segEnd),
    ];
    const { fwdZP } = await run('OPTIMIZE_INSERT', {
      wcSchedule: { '30042': [10, 10, 10, 10, 10, 10, 10] },
      planStart: '2026-08-17',
      fwdZP: [Y, Q, W], zpStatus,
      wcToBrygada: { '30042': 'B' },
      config: { shiftStart: 0 },
    });
    const w = fwdZP.find(o => o.parent_zp === 'W');
    expect(new Date(w.segments[0].segStart).getDate()).toBe(18);
  });
});
