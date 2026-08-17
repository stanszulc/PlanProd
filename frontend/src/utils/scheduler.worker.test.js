import { describe, test, expect, vi, beforeEach } from 'vitest';

describe('scheduler.worker OPTIMIZE_INSERT — toc recompute after moving a ZP', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  test('recomputes toc.zone instead of leaving the pre-move value stale', async () => {
    const postMessage = vi.fn();
    vi.stubGlobal('postMessage', postMessage);

    await import('./scheduler.worker.js');

    const zpStatus = [{
      zp_id: 'ZP1',
      due_date: '2026-08-25',
      backStart: new Date('2026-08-18T06:00:00'),
      realEnd: new Date('2026-08-20T00:00:00'),
      delayH: 240,
      delayDays: 30,
      toc: { zone: 'black', consumed: 1, label: 'SPÓŹNIONE' },
      late: true,
    }];
    const fwdZP = [{
      zp_id: 'ZP1/001', parent_zp: 'ZP1', workcenter: 'WC1',
      sequence: 1, durH: 2, segments: [],
    }];

    self.onmessage({
      data: {
        type: 'OPTIMIZE_INSERT',
        payload: {
          wcSchedule: { WC1: [16, 16, 16, 16, 16, 16, 16] },
          planStart: '2026-08-10',
          fwdZP,
          zpStatus,
          wcToBrygada: {},
          config: { shiftStart: 6 },
        },
      },
    });

    const doneCall = postMessage.mock.calls.find(([msg]) => msg.type === 'DONE');
    expect(doneCall).toBeTruthy();
    const resultZp = doneCall[0].payload.zpStatus.find(z => z.zp_id === 'ZP1');

    // The move brought realEnd (2026-08-10 08:00) far ahead of due_date (2026-08-25) —
    // it should no longer be reported as black/late, but the bug leaves toc.zone stale.
    expect(resultZp.toc.zone).not.toBe('black');
  });

  test('Etap 3: re-insercja respektuje sufit 24h/dobę i brak nakładania się na maszynie w brygadzie mieszanej', async () => {
    const postMessage = vi.fn();
    vi.stubGlobal('postMessage', postMessage);
    await import('./scheduler.worker.js');

    const zpStatus = [
      { zp_id: 'ZP1', due_date: '2026-08-20', backStart: new Date('2026-09-05T00:00:00'),
        realEnd: new Date('2026-09-10T00:00:00'), delayH: 480, delayDays: 60,
        toc: { zone: 'black', consumed: 1, label: 'SPÓŹNIONE' }, late: true },
      { zp_id: 'ZP2', due_date: '2026-08-20', backStart: new Date('2026-09-06T00:00:00'),
        realEnd: new Date('2026-09-11T00:00:00'), delayH: 500, delayDays: 62,
        toc: { zone: 'black', consumed: 1, label: 'SPÓŹNIONE' }, late: true },
    ];
    const fwdZP = [
      { zp_id: 'ZP1/001', parent_zp: 'ZP1', workcenter: '20074', sequence: 1, durH: 15,
        segments: [{ segStart: new Date('2026-09-05T00:00:00').getTime(), segEnd: new Date('2026-09-05T15:00:00').getTime(), durH: 15 }] },
      { zp_id: 'ZP2/001', parent_zp: 'ZP2', workcenter: '20074', sequence: 1, durH: 15,
        segments: [{ segStart: new Date('2026-09-06T00:00:00').getTime(), segEnd: new Date('2026-09-06T15:00:00').getTime(), durH: 15 }] },
    ];

    self.onmessage({
      data: {
        type: 'OPTIMIZE_INSERT',
        payload: {
          // Własny wiersz maszyny zerowy — cała jej realna zdolność pochodzi z poola gniazda.
          wcSchedule: { '20074': [0, 0, 0, 0, 0, 0, 0], '30042': [100, 100, 100, 100, 100, 0, 0] },
          planStart: '2026-08-10',
          fwdZP, zpStatus,
          wcToBrygada: { '20074': 'BrygadaY', '30042': 'BrygadaY' },
          config: { shiftStart: 0 },
        },
      },
    });

    const doneCall = postMessage.mock.calls.find(([msg]) => msg.type === 'DONE');
    const { fwdZP: resultOps, optimizeStats } = doneCall[0].payload;

    expect(optimizeStats.moved).toBeGreaterThan(0);

    const machineSegs = resultOps
      .filter(op => op.workcenter === '20074')
      .flatMap(op => op.segments)
      .map(s => ({
        start: s.segStart instanceof Date ? s.segStart.getTime() : s.segStart,
        end:   s.segEnd   instanceof Date ? s.segEnd.getTime()   : s.segEnd,
      }))
      .sort((a, b) => a.start - b.start);

    // Brak nakładania się w czasie na tej samej maszynie.
    for (let i = 1; i < machineSegs.length; i++) {
      expect(machineSegs[i].start).toBeGreaterThanOrEqual(machineSegs[i - 1].end);
    }

    // Sufit 24h/dobę respektowany, mimo że pool (gniazdo 30042) ma 100h/dzień.
    const byDate = {};
    for (const seg of machineSegs) {
      const d = new Date(seg.start);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      byDate[key] = (byDate[key] || 0) + (seg.end - seg.start) / 3_600_000;
    }
    for (const totalH of Object.values(byDate)) {
      expect(totalH).toBeLessThanOrEqual(24 + 1e-6);
    }
  });
});

// Testy bazowe przed Etapem 3 (pool brygady: maszyna 2xxxx + gniazda 3xxxx, patrz
// POOL_BRYGADY_2xxxx_3xxxx.md). Chronią zachowanie brygad czysto-3xxxx i pojedynczych
// maszyn 2xxxx podczas refaktoru (Etap 1) i naprawy poola (Etap 3).
describe('scheduler.worker SCHEDULE — pool brygady, stan bazowy', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  async function runSchedule(payload) {
    const postMessage = vi.fn();
    vi.stubGlobal('postMessage', postMessage);
    await import('./scheduler.worker.js');
    self.onmessage({ data: { type: 'SCHEDULE', payload } });
    const doneCall = postMessage.mock.calls.find(([msg]) => msg.type === 'DONE');
    return doneCall[0].payload;
  }

  test('brygada czysto-3xxxx (kształt Kanały): pool sumuje dostępność gniazd-sąsiadów', async () => {
    // 30003 i 30031 mają po 4h/dzień własnego wiersza — 6h operacji NIE zmieściłoby się
    // w jeden dzień na samym 30003 (4h), ale mieści się gdy pool sumuje 30003+30031=8h.
    const routingByProduct = {
      P1: [{ workcenter: '30003', sequence: 1, ct_min: 0, _durH: 6, predecessors: [] }],
    };
    const zpList = [{ zp_id: 'ZP1', product: 'P1', volume: 1, due_date: '2026-09-01', priority: 2 }];

    const { fwdZP } = await runSchedule({
      zpList, routingByProduct,
      wcSchedule: { '30003': [4, 4, 4, 4, 4, 0, 0], '30031': [4, 4, 4, 4, 4, 0, 0] },
      planStart: '2026-08-17',
      config: { schedulingMode: 'asap' },
      wcToBrygada: { '30003': 'Kanały', '30031': 'Kanały' },
    });

    expect(fwdZP[0].segments).toHaveLength(1);
    expect(fwdZP[0].segments[0].durH).toBeCloseTo(6);
  });

  test('pojedyncza maszyna 2xxxx bez sąsiadów (kształt Heager): tylko własny wiersz, brak poola', async () => {
    const routingByProduct = {
      P1: [{ workcenter: '20049', sequence: 1, ct_min: 0, _durH: 20, predecessors: [] }],
    };
    const zpList = [{ zp_id: 'ZP1', product: 'P1', volume: 1, due_date: '2026-09-01', priority: 2 }];

    const { fwdZP } = await runSchedule({
      zpList, routingByProduct,
      wcSchedule: { '20049': [8, 8, 8, 8, 8, 0, 0] },
      planStart: '2026-08-17', // poniedziałek
      config: { schedulingMode: 'asap' },
      wcToBrygada: { '20049': 'Heager' },
    });

    // 20h / 8h dziennie = 3 dni (pon 8h, wt 8h, śr 4h) — bez poola, bo brak gniazd 3xxxx w brygadzie.
    expect(fwdZP[0].segments).toHaveLength(3);
    const totalH = fwdZP[0].segments.reduce((s, seg) => s + seg.durH, 0);
    expect(totalH).toBeCloseTo(20);
  });
});

// Etap 3: maszyna (2xxxx) w brygadzie mieszanej korzysta ze wspólnej puli brygady
// (nie tylko własnego wiersza), z sufitem 24h/dobę. Zastępuje test "stan PRZED
// Etapem 3" powyżej — to jest już nowe, poprawne zachowanie.
describe('scheduler.worker SCHEDULE — Etap 3: wspólna pula z sufitem per-zasób', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  async function runSchedule(payload) {
    const postMessage = vi.fn();
    vi.stubGlobal('postMessage', postMessage);
    await import('./scheduler.worker.js');
    self.onmessage({ data: { type: 'SCHEDULE', payload } });
    const doneCall = postMessage.mock.calls.find(([msg]) => msg.type === 'DONE');
    return doneCall[0].payload;
  }

  const KTM_KTS_BRYGADA = {
    '20074': 'Gniazdo KTM/KTS', '30042': 'Gniazdo KTM/KTS',
    '30043': 'Gniazdo KTM/KTS', '30045': 'Gniazdo KTM/KTS',
  };
  // shiftStart:0 dla czystej matematyki sufitu (bez przycinania okna przez godzinę
  // startu zmiany) — własny wiersz maszyny (8h) jest tu celowo mały, żeby czysto
  // pokazać że realnie wykorzystana zdolność pochodzi z sumy brygady, nie z niego.
  const KTM_KTS_SCHEDULE = {
    '20074': [8, 8, 8, 8, 8, 0, 0],
    '30042': [100, 100, 100, 100, 100, 0, 0],
    '30043': [100, 100, 100, 100, 100, 0, 0],
    '30045': [100, 100, 100, 100, 100, 0, 0],
  };

  test('maszyna w brygadzie mieszanej korzysta z sumy brygady, nie tylko własnego wiersza (8h)', async () => {
    const routingByProduct = {
      P1: [{ workcenter: '20074', sequence: 1, ct_min: 0, _durH: 20, predecessors: [] }],
    };
    const zpList = [{ zp_id: 'ZP1', product: 'P1', volume: 1, due_date: '2026-09-01', priority: 2 }];

    const { fwdZP } = await runSchedule({
      zpList, routingByProduct,
      wcSchedule: KTM_KTS_SCHEDULE,
      planStart: '2026-08-17',
      config: { schedulingMode: 'asap', shiftStart: 0 },
      wcToBrygada: KTM_KTS_BRYGADA,
    });

    // 20h < sufit 24h/dobę — mieści się w JEDNYM dniu, mimo że własny wiersz to tylko 8h.
    expect(fwdZP[0].segments).toHaveLength(1);
    expect(fwdZP[0].segments[0].durH).toBeCloseTo(20);
  });

  test('sufit 24h/dobę respektowany nawet gdy brygada ma ogromny zapas', async () => {
    const routingByProduct = {
      P1: [{ workcenter: '20074', sequence: 1, ct_min: 0, _durH: 50, predecessors: [] }],
    };
    const zpList = [{ zp_id: 'ZP1', product: 'P1', volume: 1, due_date: '2026-09-01', priority: 2 }];

    const { fwdZP } = await runSchedule({
      zpList, routingByProduct,
      wcSchedule: KTM_KTS_SCHEDULE,
      planStart: '2026-08-17',
      config: { schedulingMode: 'asap', shiftStart: 0 },
      wcToBrygada: KTM_KTS_BRYGADA,
    });

    // 50h / sufit 24h/dobę = 3 dni (24 + 24 + 2), NIE jeden dzień, mimo że pool ma setki godzin.
    const segs = fwdZP[0].segments;
    expect(segs).toHaveLength(3);
    expect(segs[0].durH).toBeCloseTo(24);
    expect(segs[1].durH).toBeCloseTo(24);
    expect(segs[2].durH).toBeCloseTo(2);
  });

  test('gniazdo widzi mniej wolnych godzin po tym jak maszyna zużyła część wspólnej puli tego dnia', async () => {
    const wcToBrygada = { '20074': 'BrygadaX', '30042': 'BrygadaX' };
    const wcSchedule = {
      '20074': [0, 0, 0, 0, 0, 0, 0], // własny wiersz maszyny celowo zerowy — cała pula to gniazdo
      '30042': [10, 10, 10, 10, 10, 0, 0],
    };
    const routingByProduct = {
      PM: [{ workcenter: '20074', sequence: 1, ct_min: 0, _durH: 6, predecessors: [] }],
      PG: [{ workcenter: '30042', sequence: 1, ct_min: 0, _durH: 8, predecessors: [] }],
    };
    // due_date wcześniejszy dla ZP_M — zawsze przetwarzane pierwsze, niezależnie od metody,
    // z urgencyMethod:'due_date' dla pełnego determinizmu kolejności.
    const zpList = [
      { zp_id: 'ZP_M', product: 'PM', volume: 1, due_date: '2026-08-18', priority: 2 },
      { zp_id: 'ZP_G', product: 'PG', volume: 1, due_date: '2026-09-15', priority: 2 },
    ];

    const { fwdZP } = await runSchedule({
      zpList, routingByProduct, wcSchedule,
      planStart: '2026-08-17',
      config: { schedulingMode: 'asap', shiftStart: 0, urgencyMethod: 'due_date' },
      wcToBrygada,
    });

    // Pool dnia = 0 (maszyna) + 10 (gniazdo) = 10h. Maszyna zużywa 6h najpierw (wcześniejszy
    // due_date) — gniazdu zostaje tylko 4h tego dnia z potrzebnych 8h, reszta na kolejny dzień.
    const gOp = fwdZP.find(o => o.parent_zp === 'ZP_G');
    expect(gOp.segments).toHaveLength(2);
    expect(gOp.segments[0].durH).toBeCloseTo(4);
    expect(gOp.segments[1].durH).toBeCloseTo(4);
  });

  test('kształt Maszyny (10 maszyn + 2 gniazda): każda maszyna ma niezależny sufit 24h w jednej wspólnej sumie 12 zasobów', async () => {
    const machineWcs = Array.from({ length: 10 }, (_, i) => `2${String(i + 1).padStart(4, '0')}`);
    const gniazdoWcs  = ['30009', '30025'];
    const wcToBrygada = {};
    const wcSchedule  = {};
    machineWcs.forEach(wc => { wcToBrygada[wc] = 'Maszyny'; wcSchedule[wc] = [8, 8, 8, 8, 8, 0, 0]; });
    gniazdoWcs.forEach(wc => { wcToBrygada[wc] = 'Maszyny'; wcSchedule[wc] = [50, 50, 50, 50, 50, 0, 0]; });

    const routingByProduct = {
      P1: [{ workcenter: machineWcs[0], sequence: 1, ct_min: 0, _durH: 30, predecessors: [] }],
    };
    const zpList = [{ zp_id: 'ZP1', product: 'P1', volume: 1, due_date: '2026-09-01', priority: 2 }];

    const { fwdZP } = await runSchedule({
      zpList, routingByProduct, wcSchedule,
      planStart: '2026-08-17',
      config: { schedulingMode: 'asap', shiftStart: 0 },
      wcToBrygada,
    });

    // 30h > sufit 24h/dobę tej JEDNEJ maszyny — capowane na 24h, mimo że suma 12 zasobów
    // brygady jest ogromna (10×8 + 2×50 = 180h/dzień).
    const segs = fwdZP[0].segments;
    expect(segs).toHaveLength(2);
    expect(segs[0].durH).toBeCloseTo(24);
    expect(segs[1].durH).toBeCloseTo(6);
  });

  test('żadne dwa segmenty na tej samej maszynie nigdy się nie nakładają w czasie, nawet z ogromnym zapasem w puli', async () => {
    const routingByProduct = {
      P1: [{ workcenter: '20074', sequence: 1, ct_min: 0, _durH: 10, predecessors: [] }],
      P2: [{ workcenter: '20074', sequence: 1, ct_min: 0, _durH: 10, predecessors: [] }],
    };
    const zpList = [
      { zp_id: 'ZP1', product: 'P1', volume: 1, due_date: '2026-09-01', priority: 2 },
      { zp_id: 'ZP2', product: 'P2', volume: 1, due_date: '2026-09-01', priority: 2 },
    ];

    const { fwdZP } = await runSchedule({
      zpList, routingByProduct,
      wcSchedule: KTM_KTS_SCHEDULE,
      planStart: '2026-08-17',
      config: { schedulingMode: 'asap', shiftStart: 0 },
      wcToBrygada: KTM_KTS_BRYGADA,
    });

    const allSegs = fwdZP.flatMap(op => op.segments).sort((a, b) => a.segStart - b.segStart);
    for (let i = 1; i < allSegs.length; i++) {
      expect(allSegs[i].segStart.getTime()).toBeGreaterThanOrEqual(allSegs[i - 1].segEnd.getTime());
    }
  });
});

// Etap 4: maszyna ma domyślny priorytet do wspólnej puli brygady, przełamywalny
// pilnością (VIP/bliski termin) konkurencyjnego ZP na gnieździe. Głębokie pokrycie na
// urgencyMethod:'atc' (realny domyślny tryb App.jsx) — pozostałe metody dostają tylko
// test dymny niżej.
describe('scheduler.worker SCHEDULE — Etap 4: domyślny priorytet maszyny (machineBiasH)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  async function runSchedule(payload) {
    const postMessage = vi.fn();
    vi.stubGlobal('postMessage', postMessage);
    await import('./scheduler.worker.js');
    self.onmessage({ data: { type: 'SCHEDULE', payload } });
    const doneCall = postMessage.mock.calls.find(([msg]) => msg.type === 'DONE');
    return doneCall[0].payload;
  }

  const BRYGADA_Z = { '20074': 'BrygadaZ', '30042': 'BrygadaZ' };
  // Pool = 0 (maszyna) + 10 (gniazdo) = 10h/dzień — mniej niż suma potrzeb obu ZP (12h),
  // więc kto pójdzie pierwszy naprawdę decyduje o wyniku (prawdziwa konkurencja o pulę).
  const SCHEDULE_Z = { '20074': [0, 0, 0, 0, 0, 0, 0], '30042': [10, 10, 10, 10, 10, 0, 0] };
  const ROUTING_Z = {
    PM: [{ workcenter: '20074', sequence: 1, ct_min: 0, _durH: 6, predecessors: [] }],
    PG: [{ workcenter: '30042', sequence: 1, ct_min: 0, _durH: 6, predecessors: [] }],
  };

  // Gniazdo ma 1h WIĘCEJ pracy niż maszyna (7h vs 6h), ten sam due_date — pod metodą
  // 'slack' (czysto liniowa w godzinach, bez tłumienia wykładniczego jak w ATC) to
  // daje mu DOKŁADNIE 1h mniejszy slack (naturalnie odczuwalną, ale mniejszą przewagę
  // pilności NIŻ domyślny 8h bias maszyny). Dzięki tej policzalnej asymetrii oba testy
  // niżej naprawdę izolują efekt samego biasu, a nie przypadkowy tie-break kolejki.
  const ROUTING_Z_ASYM = {
    PM: [{ workcenter: '20074', sequence: 1, ct_min: 0, _durH: 6, predecessors: [] }],
    PG: [{ workcenter: '30042', sequence: 1, ct_min: 0, _durH: 7, predecessors: [] }],
  };

  test('domyślny bias (8h, metoda slack) pozwala maszynie wygrać mimo lekkiej naturalnej przewagi gniazda (1h)', async () => {
    const zpList = [
      { zp_id: 'ZP_M', product: 'PM', volume: 1, due_date: '2026-08-25', priority: 2 },
      { zp_id: 'ZP_G', product: 'PG', volume: 1, due_date: '2026-08-25', priority: 2 },
    ];

    const { fwdZP } = await runSchedule({
      zpList, routingByProduct: ROUTING_Z_ASYM, wcSchedule: SCHEDULE_Z,
      planStart: '2026-08-17',
      config: { schedulingMode: 'asap', shiftStart: 0, urgencyMethod: 'slack' },
      wcToBrygada: BRYGADA_Z,
    });

    const mOp = fwdZP.find(o => o.parent_zp === 'ZP_M');
    const gOp = fwdZP.find(o => o.parent_zp === 'ZP_G');

    // Kto idzie PIERWSZY dostaje swoje godziny w jednym, nieprzerwanym segmencie;
    // kto idzie drugi trafia na już częściowo zużytą pulę i rozjeżdża się na 2 dni.
    // Maszyna wygrywa dzięki 8h biasowi, mimo że gniazdo ma naturalnie mniejszy slack (1h).
    expect(mOp.segments).toHaveLength(1);
    expect(gOp.segments).toHaveLength(2);
  });

  test('bez biasu (machineBiasH=0, metoda slack) niewielka naturalna przewaga gniazda (1h) decyduje — maszyna PRZESTAJE wygrywać', async () => {
    // Kontrola z identycznym setupem jak wyżej, tylko machineBiasH:0 — dowodzi, że
    // w teście powyżej to naprawdę mechanizm biasu (nie coś innego) dawał maszynie
    // pierwszeństwo, bo tu, bez niego, wynik się odwraca.
    const zpList = [
      { zp_id: 'ZP_M', product: 'PM', volume: 1, due_date: '2026-08-25', priority: 2 },
      { zp_id: 'ZP_G', product: 'PG', volume: 1, due_date: '2026-08-25', priority: 2 },
    ];

    const { fwdZP } = await runSchedule({
      zpList, routingByProduct: ROUTING_Z_ASYM, wcSchedule: SCHEDULE_Z,
      planStart: '2026-08-17',
      config: { schedulingMode: 'asap', shiftStart: 0, urgencyMethod: 'slack', machineBiasH: 0 },
      wcToBrygada: BRYGADA_Z,
    });

    const mOp = fwdZP.find(o => o.parent_zp === 'ZP_M');
    const gOp = fwdZP.find(o => o.parent_zp === 'ZP_G');

    expect(gOp.segments).toHaveLength(1);
    expect(mOp.segments).toHaveLength(2);
  });

  test('VIP na gnieździe przebija domyślny priorytet maszyny (ATC)', async () => {
    const zpList = [
      { zp_id: 'ZP_M', product: 'PM', volume: 1, due_date: '2026-08-25', priority: 2 },
      { zp_id: 'ZP_G', product: 'PG', volume: 1, due_date: '2026-08-25', priority: 1 }, // VIP
    ];

    const { fwdZP } = await runSchedule({
      zpList, routingByProduct: ROUTING_Z, wcSchedule: SCHEDULE_Z,
      planStart: '2026-08-17',
      config: { schedulingMode: 'asap', shiftStart: 0, urgencyMethod: 'atc' },
      wcToBrygada: BRYGADA_Z,
    });

    const mOp = fwdZP.find(o => o.parent_zp === 'ZP_M');
    const gOp = fwdZP.find(o => o.parent_zp === 'ZP_G');

    // VIP na gnieździe przebija 8h domyślnego handicapu maszyny — gniazdo idzie pierwsze.
    expect(gOp.segments).toHaveLength(1);
    expect(mOp.segments).toHaveLength(2);
  });

  test('brygady niepowiązane nie wpływają na siebie wzajemnie', async () => {
    // Brygada B (czysto-3xxxx, '30099') nie ma nic wspólnego z BrygadaZ — jej ZP musi
    // wylądować w IDENTYCZNYM miejscu niezależnie od tego, czy machineBiasH jest
    // domyślny czy wyłączony, bo bias dotyczy tylko operacji na maszynie w SWOJEJ brygadzie.
    const routingByProduct = {
      ...ROUTING_Z,
      PB: [{ workcenter: '30099', sequence: 1, ct_min: 0, _durH: 5, predecessors: [] }],
    };
    const wcToBrygada = { ...BRYGADA_Z, '30099': 'BrygadaB' };
    const wcSchedule = { ...SCHEDULE_Z, '30099': [8, 8, 8, 8, 8, 0, 0] };
    const zpList = [
      { zp_id: 'ZP_M', product: 'PM', volume: 1, due_date: '2026-08-25', priority: 2 },
      { zp_id: 'ZP_B', product: 'PB', volume: 1, due_date: '2026-08-25', priority: 2 },
    ];

    const withBias = await runSchedule({
      zpList, routingByProduct, wcSchedule,
      planStart: '2026-08-17',
      config: { schedulingMode: 'asap', shiftStart: 0, urgencyMethod: 'atc' },
      wcToBrygada,
    });
    const withoutBias = await runSchedule({
      zpList, routingByProduct, wcSchedule,
      planStart: '2026-08-17',
      config: { schedulingMode: 'asap', shiftStart: 0, urgencyMethod: 'atc', machineBiasH: 0 },
      wcToBrygada,
    });

    const bOpWith    = withBias.fwdZP.find(o => o.parent_zp === 'ZP_B');
    const bOpWithout = withoutBias.fwdZP.find(o => o.parent_zp === 'ZP_B');
    expect(bOpWith.start_dt).toEqual(bOpWithout.start_dt);
    expect(bOpWith.end_dt).toEqual(bOpWithout.end_dt);
  });

  test('test dymny: due_date/slack/cr nie wybuchają i biasują w poprawnym kierunku (maszyna pierwsza przy remis)', async () => {
    // Sekwencyjnie, nie Promise.all — każda iteracja robi własny vi.stubGlobal na
    // WSPÓLNYM globalu; równolegle raciłyby się o ten sam postMessage.
    for (const urgencyMethod of ['due_date', 'slack', 'cr']) {
      const zpList = [
        { zp_id: 'ZP_M', product: 'PM', volume: 1, due_date: '2026-08-25', priority: 2 },
        { zp_id: 'ZP_G', product: 'PG', volume: 1, due_date: '2026-08-25', priority: 2 },
      ];

      const { fwdZP } = await runSchedule({
        zpList, routingByProduct: ROUTING_Z, wcSchedule: SCHEDULE_Z,
        planStart: '2026-08-17',
        config: { schedulingMode: 'asap', shiftStart: 0, urgencyMethod },
        wcToBrygada: BRYGADA_Z,
      });

      const mOp = fwdZP.find(o => o.parent_zp === 'ZP_M');
      expect(mOp.segments.length).toBeGreaterThan(0);
      expect(mOp.segments[0].durH).toBeCloseTo(6); // maszyna dostała pełne 6h bez przerwy
    }
  });
});
