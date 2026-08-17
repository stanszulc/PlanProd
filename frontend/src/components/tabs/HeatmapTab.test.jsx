import { describe, test, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HeatmapTab } from './HeatmapTab.jsx';

const routing = [{ workcenter: 'WC1' }];
const globalLookups = { routingByProduct: { P1: [{ workcenter: 'WC1', ct_min: 60, sequence: 1 }] } };

describe('HeatmapTab — pełny zakres dat planowania (bez dziur)', () => {
  test('pokazuje kolumnę dla każdego dnia od planStart do horyzontu, nawet bez ZP na ten dzień', () => {
    // Tylko jedno ZP, due_date daleko w przyszłości — bez wypełniania powinna
    // istnieć tylko jedna kolumna; z pełnym zakresem powinno być wiele kolumn
    // między planStart (2026-08-17) a due_date (2026-08-24).
    const zp = [{ product: 'P1', volume: 1, due_date: '2026-08-24' }];

    render(
      <HeatmapTab
        routing={routing}
        zp={zp}
        globalLookups={globalLookups}
        wcSchedule={{ WC1: { '2026-08-20': 8 } }}
        fwdZP={[]}
        planStart="2026-08-17"
        horizonDays={14}
      />
    );

    // Dzień bez ZP, ale w zakresie planStart..due_date — musi być kolumną (nagłówek "08-20").
    expect(screen.getByText('08-20')).toBeInTheDocument();
    expect(screen.getByText('08-17')).toBeInTheDocument();
    expect(screen.getByText('08-24')).toBeInTheDocument();
  });
});

describe('HeatmapTab — przełącznik wg terminu / wg planu', () => {
  test('wg terminu (domyślnie): obciążenie liczone z ZP wg due_date', () => {
    const zp = [{ product: 'P1', volume: 8, due_date: '2026-08-20', zp_id: 'ZP1' }];
    render(
      <HeatmapTab
        routing={routing}
        zp={zp}
        globalLookups={globalLookups}
        wcSchedule={{ WC1: { '2026-08-20': 8 } }}
        fwdZP={[]}
        planStart="2026-08-17"
        horizonDays={7}
      />
    );
    // volume=8 x ct_min=60 => 8h load / 8h capacity = 100%
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  test('wg planu: obciążenie liczone z realnie zaplanowanych segmentów (fwdZP), nie z due_date', () => {
    const zp = [{ product: 'P1', volume: 8, due_date: '2026-08-24', zp_id: 'ZP1' }];
    const fwdZP = [{
      workcenter: 'WC1', parent_zp: 'ZP1', durH: 4,
      segments: [{ segStart: new Date('2026-08-18T08:00:00'), segEnd: new Date('2026-08-18T12:00:00'), durH: 4 }],
    }];

    render(
      <HeatmapTab
        routing={routing}
        zp={zp}
        globalLookups={globalLookups}
        wcSchedule={{ WC1: { '2026-08-18': 4 } }}
        fwdZP={fwdZP}
        planStart="2026-08-17"
        horizonDays={14}
      />
    );

    fireEvent.click(screen.getByText('wg planu'));

    // Segment zaplanowany na 08-18 (4h / 4h cap = 100%), NIE na due_date 08-24.
    const cellsWithHundred = screen.getAllByText('100%');
    expect(cellsWithHundred.length).toBeGreaterThan(0);
  });
});
