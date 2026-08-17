import { describe, test, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { HeatmapPlanTab } from './HeatmapPlanTab.jsx';

const noop = () => {};

describe('HeatmapPlanTab — hover tooltip does not execute HTML from imported ERP data', () => {
  test('renders a crafted "klient" value as literal text, not as markup', () => {
    const maliciousKlient = '<img src=x onerror="window.__xss_fired = true">';
    const fwdZP = [{
      workcenter: 'WC1',
      parent_zp: 'ZP1',
      zp_id: 'ZP1/001',
      klient: maliciousKlient,
      durH: 4,
      due_date: '2026-08-20',
      segments: [{ segStart: new Date('2026-08-17T08:00:00'), segEnd: new Date('2026-08-17T12:00:00'), durH: 4 }],
    }];
    const routing = [{ workcenter: 'WC1', wc_group: 'BrygadaA', machine_name: 'WC1' }];

    const { container } = render(
      <HeatmapPlanTab
        fwdZP={fwdZP}
        routing={routing}
        wcSchedule={{}}
        onScheduleChange={noop}
        onRecalc={noop}
        onOptimize={noop}
        isOptimizing={false}
        ganttDirty={false}
        isScheduling={false}
        planStart="2026-08-17"
        onPlanStartChange={noop}
        schedulingMode="asap"
        onSchedulingModeChange={noop}
        heatmapFilter={null}
        onHeatmapFilterChange={noop}
      />
    );

    const groupRow = container.querySelectorAll('tbody tr')[0];
    const cellDiv = groupRow.querySelectorAll('td')[2].querySelector('div');

    fireEvent.mouseEnter(cellDiv);

    const listEl = container.querySelector('[data-tt="list"]');
    expect(listEl.querySelector('img')).toBeNull();
    expect(listEl.textContent).toContain(maliciousKlient);
    expect(window.__xss_fired).toBeUndefined();
  });
});

describe('HeatmapPlanTab — onScheduleChange sends a patch, not the whole reconstructed schedule', () => {
  test('+8h on a brigade cell reports only that brigade\'s machine/date, not the full wcSchedule', () => {
    const onScheduleChange = vi.fn();
    const routing = [{ workcenter: 'WC1', wc_group: 'BrygadaA', machine_name: 'WC1' }];
    const wcSchedule = { WC1: { '2026-08-17': 16 }, OTHER: { '2026-08-17': 99 } };
    const fwdZP = [{
      workcenter: 'WC1',
      parent_zp: 'ZP1',
      zp_id: 'ZP1/001',
      durH: 4,
      due_date: '2026-08-20',
      segments: [{ segStart: new Date('2026-08-17T08:00:00'), segEnd: new Date('2026-08-17T12:00:00'), durH: 4 }],
    }];

    const { container } = render(
      <HeatmapPlanTab
        fwdZP={fwdZP}
        routing={routing}
        wcSchedule={wcSchedule}
        onScheduleChange={onScheduleChange}
        onRecalc={() => {}}
        onOptimize={() => {}}
        isOptimizing={false}
        ganttDirty={false}
        isScheduling={false}
        planStart="2026-08-17"
        onPlanStartChange={() => {}}
        schedulingMode="asap"
        onSchedulingModeChange={() => {}}
        heatmapFilter={null}
        onHeatmapFilterChange={() => {}}
      />
    );

    const plusBtn = [...container.querySelectorAll('button')].find(b => b.textContent.trim() === '+8');
    fireEvent.click(plusBtn);

    expect(onScheduleChange).toHaveBeenCalledTimes(1);
    const patch = onScheduleChange.mock.calls[0][0];
    expect(patch).toEqual({ WC1: { '2026-08-17': 24 } });
    expect(patch.OTHER).toBeUndefined();
  });
});
