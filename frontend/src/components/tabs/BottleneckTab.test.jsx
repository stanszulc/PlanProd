import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BottleneckTab } from './BottleneckTab.jsx';

const routing = [{ product: 'P1', workcenter: 'WC1' }];
const gl = (ct = 60) => ({ routingByProduct: { P1: [{ workcenter: 'WC1', ct_min: ct, sequence: 1 }] }, zpColorMap: {} });
const sched = { WC1: { '2026-08-20': 8, '2026-08-21': 8 } };
const mk = (id, vol, due) => ({ zp_id: id, product: 'P1', volume: vol, due_date: due, priority: 1 });

describe('BottleneckTab', () => {
  test('KPI: przy obciążeniu <= 85% brak wąskiego gardła', () => {
    render(<BottleneckTab routing={routing} zp={[mk('ZP1', 3, '2026-08-20')]} globalLookups={gl()} wcSchedule={sched} />);
    expect(screen.getByText(/brak wąskiego gardła/)).toBeInTheDocument();
  });

  test('KPI: przy > 85% pokazuje gniazdo', () => {
    render(<BottleneckTab routing={routing} zp={[mk('ZP1', 9, '2026-08-20')]} globalLookups={gl()} wcSchedule={sched} />);
    expect(screen.queryByText(/brak wąskiego gardła/)).toBeNull();
    expect(screen.getByText('113% obciążenia')).toBeInTheDocument();
  });

  test('zmiana zp o tej samej liczbie elementów odświeża dane', () => {
    const { rerender } = render(<BottleneckTab routing={routing} zp={[mk('ZP1', 4, '2026-08-20')]} globalLookups={gl()} wcSchedule={sched} />);
    expect(screen.getByText(/max 50%/)).toBeInTheDocument();
    rerender(<BottleneckTab routing={routing} zp={[mk('ZP1', 9, '2026-08-20')]} globalLookups={gl()} wcSchedule={sched} />);
    expect(screen.getByText('113% obciążenia')).toBeInTheDocument();
  });

  test('zmiana routingu (ct_min) odświeża dane', () => {
    const zp = [mk('ZP1', 4, '2026-08-20')];
    const { rerender } = render(<BottleneckTab routing={routing} zp={zp} globalLookups={gl(60)} wcSchedule={sched} />);
    expect(screen.getByText(/max 50%/)).toBeInTheDocument();
    rerender(<BottleneckTab routing={routing} zp={zp} globalLookups={gl(120)} wcSchedule={sched} />);
    expect(screen.getByText('100% obciążenia')).toBeInTheDocument();
  });
});
