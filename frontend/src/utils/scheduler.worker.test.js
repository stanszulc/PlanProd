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
});
