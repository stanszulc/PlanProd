import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DashboardTab } from './DashboardTab.jsx';

describe('DashboardTab — Alert Center delay label', () => {
  test('shows "po term." for a black-zone ZP whose buffer is fully consumed but delayDays is 0', () => {
    const zpStatus = [{
      zp_id: 'ZP1',
      zs_id: 'ZS1',
      klient: 'Klient A',
      due_date: '2026-08-20',
      delayDays: 0,
      toc: { zone: 'black', consumed: 1, label: 'PRZEKROCZONY' },
      bottleneck: null,
    }];

    render(
      <DashboardTab
        routing={[]}
        zp={[{ due_date: '2026-08-20' }]}
        zpStatus={zpStatus}
        wcSchedule={{}}
        historyData={[]}
        globalLookups={{}}
        onTabChange={() => {}}
        hybridMode={false}
      />
    );

    expect(screen.getByText('po term.')).toBeInTheDocument();
  });

  test('Capacity Watch utilization respects the configured wcSchedule capacity, not a flat 16h default', () => {
    // WC1 has an 8h load (1 unit x 480 ct_min) against a configured 4h/day capacity -> 200% util.
    // If wcSchedule is silently dropped, computeLoads falls back to the 16h default -> 50% util.
    render(
      <DashboardTab
        routing={[{ product: 'P1', workcenter: 'WC1', sequence: 1 }]}
        zp={[{ product: 'P1', volume: 1, due_date: '2026-08-17' }]}
        zpStatus={[]}
        wcSchedule={{ WC1: [4, 4, 4, 4, 4, 4, 4] }}
        historyData={[]}
        globalLookups={{ routingByProduct: { P1: [{ workcenter: 'WC1', ct_min: 480, sequence: 1 }] } }}
        onTabChange={() => {}}
        hybridMode={false}
      />
    );

    expect(screen.getAllByText('200%').length).toBeGreaterThan(0);
  });
});

describe('DashboardTab — utilizacja z dniem bez capa', () => {
  test('termin w weekend (cap=0) nie zawyża Avg utilization', () => {
    // WC1: pn 2026-08-17 load 4h/cap 8h = 50%; sobota 2026-08-22 load 4h/cap 0 -> pomijane w średniej.
    render(
      <DashboardTab
        routing={[{ product: 'P1', workcenter: 'WC1', sequence: 1 }]}
        zp={[
          { product: 'P1', volume: 1, due_date: '2026-08-17' },
          { product: 'P1', volume: 1, due_date: '2026-08-22' },
        ]}
        zpStatus={[]}
        wcSchedule={{}}
        historyData={[]}
        globalLookups={{ routingByProduct: { P1: [{ workcenter: 'WC1', ct_min: 240, sequence: 1 }] } }}
        onTabChange={() => {}}
        hybridMode={false}
      />
    );
    expect(screen.queryByText(/99900/)).toBeNull();
    expect(screen.getAllByText(/^25%/).length).toBeGreaterThan(0);
  });
});
