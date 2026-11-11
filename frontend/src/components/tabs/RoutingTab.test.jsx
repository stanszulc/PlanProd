import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RoutingTab } from './RoutingTab.jsx';
import { T } from '../../constants/theme.js';

describe('RoutingTab — bottleneck highlighting respects wcSchedule', () => {
  test('flags a workcenter as bottleneck when load exceeds its configured (non-default) capacity', () => {
    // WC1: 8h load (1 unit x 480 ct_min) against a configured 4h/day capacity -> 200% util (> 85% => bottleneck).
    // If wcSchedule is silently dropped, computeLoads falls back to the 16h default -> 50% util (not a bottleneck).
    const routing = [{ product: 'P1', workcenter: 'WC1', sequence: 1 }];
    const globalLookups = {
      routingByProduct: { P1: [{ workcenter: 'WC1', sequence: 1, ct_min: 480, operation: 'Op1' }] },
      productIndexMap: { P1: 0 },
    };
    const zp = [{ product: 'P1', volume: 1, due_date: '2026-08-17' }];
    const wcSchedule = { WC1: [4, 4, 4, 4, 4, 4, 4] };

    const { container } = render(
      <RoutingTab routing={routing} zp={zp} globalLookups={globalLookups} wcSchedule={wcSchedule} />
    );

    const bottleneckBox = container.querySelector(`rect[stroke="${T.bn}"]`);
    expect(bottleneckBox).not.toBeNull();
  });
});

describe('RoutingTab — pokazuje brygadę (WC3) i nazwę maszyny na boksie', () => {
  test('maszyny tej samej brygady dostają ten sam kolor paska, inna brygada = inny kolor', () => {
    const routing = [
      { product: 'P1', workcenter: 'WC1', wc_group: 'Kanały' },
      { product: 'P2', workcenter: 'WC2', wc_group: 'Kanały' },
      { product: 'P3', workcenter: 'WC3', wc_group: 'Kratki' },
    ];
    const globalLookups = {
      routingByProduct: {
        P1: [{ workcenter: 'WC1', sequence: 1, ct_min: 60, wc_group: 'Kanały', machine_name: 'Slusarnia' }],
        P2: [{ workcenter: 'WC2', sequence: 1, ct_min: 60, wc_group: 'Kanały', machine_name: 'Wykrawarka' }],
        P3: [{ workcenter: 'WC3', sequence: 1, ct_min: 60, wc_group: 'Kratki', machine_name: 'Pila' }],
      },
      productIndexMap: { P1: 0, P2: 1, P3: 2 },
    };

    const { container } = render(
      <RoutingTab routing={routing} zp={[]} globalLookups={globalLookups} wcSchedule={{}} />
    );

    expect(screen.getAllByText('Kanały')).toHaveLength(2);
    expect(screen.getAllByText('Kratki')).toHaveLength(1);
    expect(screen.getByText('Slusarnia')).toBeInTheDocument();
    expect(screen.getByText('Wykrawarka')).toBeInTheDocument();

    const bars = [...container.querySelectorAll('rect[width="4"]')].map(r => r.getAttribute('fill'));
    expect(bars).toHaveLength(3);
    expect(new Set(bars).size).toBe(2);
    const counts = bars.reduce((acc, c) => { acc[c] = (acc[c] || 0) + 1; return acc; }, {});
    expect(Object.values(counts).sort()).toEqual([1, 2]);
  });

  test('długa nazwa maszyny łamie się na dwie linijki, krótka zostaje w jednej', () => {
    const routing = [{ product: 'P1', workcenter: 'WC1', wc_group: 'Kanały' }];
    const globalLookups = {
      routingByProduct: {
        P1: [{ workcenter: 'WC1', sequence: 1, ct_min: 60, wc_group: 'Kanały', machine_name: 'Wykrawarko-gilotyna SG6' }],
      },
      productIndexMap: { P1: 0 },
    };

    render(<RoutingTab routing={routing} zp={[]} globalLookups={globalLookups} wcSchedule={{}} />);

    // Nazwa jest za długa na jedną linijkę — powinna się rozdzielić na dwa <text>.
    expect(screen.queryByText('Wykrawarko-gilotyna SG6')).not.toBeInTheDocument();
    expect(screen.getByText('Wykrawarko-')).toBeInTheDocument();
    expect(screen.getByText('gilotyna SG6')).toBeInTheDocument();
  });
});

describe('RoutingTab — wąskie gardło z planu (fwdZP, brygady)', () => {
  const routing = [
    { product: 'P1', workcenter: 'A1', sequence: 1, wc_group: 'Alfa' },
    { product: 'P2', workcenter: 'B1', sequence: 1, wc_group: 'Beta' },
  ];
  const globalLookups = {
    routingByProduct: {
      P1: [{ workcenter: 'A1', sequence: 1, ct_min: 1, wc_group: 'Alfa' }],
      P2: [{ workcenter: 'B1', sequence: 1, ct_min: 1, wc_group: 'Beta' }],
    },
    productIndexMap: { P1: 0, P2: 1 },
  };
  const seg = (h) => ({ segStart: new Date(2026, 7, 17, 6), durH: h });

  test('podświetla tylko gniazdo przeciążonej brygady', () => {
    const fwdZP = [
      { workcenter: 'A1', segments: [seg(40)] },
      { workcenter: 'B1', segments: [seg(2)] },
    ];
    const { container } = render(
      <RoutingTab routing={routing} zp={[]} globalLookups={globalLookups} wcSchedule={{}}
        fwdZP={fwdZP} wcToBrygada={{ A1: 'Alfa', B1: 'Beta' }} />
    );
    expect(container.querySelectorAll(`rect[stroke="${T.bn}"]`)).toHaveLength(1);
  });
});
