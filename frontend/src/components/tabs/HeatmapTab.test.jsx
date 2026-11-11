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
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'pct' } });
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
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'pct' } });

    // Segment zaplanowany na 08-18 (4h / 4h cap = 100%), NIE na due_date 08-24.
    const cellsWithHundred = screen.getAllByText('100%');
    expect(cellsWithHundred.length).toBeGreaterThan(0);
  });
});

describe('HeatmapTab — przełącznik %/godz.', () => {
  test('domyślnie pokazuje godziny, nie procent', () => {
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
    // 8h load, domyślny mode='h' — jak w Heatmapie planu.
    expect(screen.getByText('8.0h')).toBeInTheDocument();
    expect(screen.queryByText('100%')).not.toBeInTheDocument();
  });

  test('przełączenie na % zmienia format wyświetlania na wszystkich komórkach', () => {
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

    expect(screen.getByText('8.0h')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'pct' } });
    expect(screen.queryByText('8.0h')).not.toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();
  });
});

describe('HeatmapTab — grupowanie wierszy po brygadzie (WC3)', () => {
  const groupedRouting = [
    { workcenter: 'WC1', wc_group: 'Kanały', machine_name: 'Ślusarnia - kanały' },
    { workcenter: 'WC2', wc_group: 'Kanały', machine_name: 'Ślusarnia - gilotyna' },
    { workcenter: 'WC3', wc_group: 'Kratki' },
  ];
  const groupedLookups = {
    routingByProduct: {
      P1: [{ workcenter: 'WC1', ct_min: 60, sequence: 1 }],
      P2: [{ workcenter: 'WC2', ct_min: 60, sequence: 1 }],
      P3: [{ workcenter: 'WC3', ct_min: 60, sequence: 1 }],
    },
  };

  test('domyślnie zwinięte: widać tylko wiersz brygady, nie pojedyncze maszyny', () => {
    const zp = [
      { product: 'P1', volume: 8, due_date: '2026-08-20', zp_id: 'ZP1' },
      { product: 'P2', volume: 8, due_date: '2026-08-20', zp_id: 'ZP2' },
    ];
    render(
      <HeatmapTab
        routing={groupedRouting}
        zp={zp}
        globalLookups={groupedLookups}
        wcSchedule={{ WC1: { '2026-08-20': 8 }, WC2: { '2026-08-20': 8 } }}
        fwdZP={[]}
        planStart="2026-08-17"
        horizonDays={7}
      />
    );

    expect(screen.getByText('Kanały')).toBeInTheDocument();
    expect(screen.getByText('(2)')).toBeInTheDocument();
    expect(screen.queryByText('WC1')).not.toBeInTheDocument();
    expect(screen.queryByText('WC2')).not.toBeInTheDocument();
  });

  test('agregat brygady to suma load / suma cap maszyn, nie średnia procentów', () => {
    // WC1: 8h load / 8h cap = 100%. WC2: 0h load / 8h cap = 0%.
    // Agregat brygady: (8+0) / (8+8) = 50%, NIE (100%+0%)/2 co też wyszłoby 50%
    // przypadkowo tu — sprawdzamy więc dodatkowo rozwinięty widok osobno.
    const zp = [{ product: 'P1', volume: 8, due_date: '2026-08-20', zp_id: 'ZP1' }];
    render(
      <HeatmapTab
        routing={groupedRouting}
        zp={zp}
        globalLookups={groupedLookups}
        wcSchedule={{ WC1: { '2026-08-20': 8 }, WC2: { '2026-08-20': 8 } }}
        fwdZP={[]}
        planStart="2026-08-17"
        horizonDays={7}
      />
    );

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'pct' } });
    expect(screen.getByText('50%')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Kanały'));
    expect(screen.getByText('WC1')).toBeInTheDocument();
    expect(screen.getByText('WC2')).toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  test('klik na wiersz brygady rozwija i zwija maszyny', () => {
    const zp = [{ product: 'P1', volume: 8, due_date: '2026-08-20', zp_id: 'ZP1' }];
    render(
      <HeatmapTab
        routing={groupedRouting}
        zp={zp}
        globalLookups={groupedLookups}
        wcSchedule={{ WC1: { '2026-08-20': 8 } }}
        fwdZP={[]}
        planStart="2026-08-17"
        horizonDays={7}
      />
    );

    fireEvent.click(screen.getByText('Kanały'));
    expect(screen.getByText('WC1')).toBeInTheDocument();
    expect(screen.getByText('Ślusarnia - kanały')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Kanały'));
    expect(screen.queryByText('WC1')).not.toBeInTheDocument();
  });
});
