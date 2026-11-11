import { describe, test, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

describe('BottleneckTab — tryb wg planu', () => {
  const seg = (day, h) => ({ segStart: new Date(`2026-08-${day}T06:00:00`), durH: h });
  const op = (wc, segments) => ({ workcenter: wc, zp_id: 'ZP1', segments });
  const wcSched = { A1: { '2026-08-17': 8, '2026-08-18': 8 }, A2: { '2026-08-17': 8, '2026-08-18': 8 }, B1: { '2026-08-17': 8, '2026-08-18': 8 } };
  const wcToBrygada = { A1: 'BrygA', A2: 'BrygA', B1: 'BrygB' };
  const props = (fwdZP) => ({ routing, zp: [mk('ZP1', 3, '2026-08-20')], globalLookups: gl(), wcSchedule: wcSched, wcToBrygada, fwdZP });

  test('domyślnie tryb wg planu: główne wąskie gardło z nadwyżką', () => {
    const fwdZP = [op('A1', [seg('17', 10)]), op('A2', [seg('17', 10)]), op('B1', [seg('17', 2)])];
    render(<BottleneckTab {...props(fwdZP)} />);
    expect(screen.getByText('Główne wąskie gardło')).toBeInTheDocument();
    expect(screen.getAllByText('BrygA').length).toBeGreaterThan(0);
    expect(screen.getByText('nadwyżka 4.0 h w 1 dniach')).toBeInTheDocument();
    expect(screen.getByText('Brygada')).toBeInTheDocument();
  });

  test('brak przeciążenia: "brak" i podpis o mieszczeniu się w dostępności', () => {
    render(<BottleneckTab {...props([op('A1', [seg('17', 2)])])} />);
    expect(screen.getByText('plan mieści się w dostępności')).toBeInTheDocument();
  });

  test('klik w wiersz brygady rozwija gniazda', () => {
    const fwdZP = [op('A1', [seg('17', 10)]), op('A2', [seg('17', 10)])];
    render(<BottleneckTab {...props(fwdZP)} />);
    expect(screen.queryByTestId('wc-A1')).toBeNull();
    fireEvent.click(screen.getByTestId('grp-BrygA'));
    expect(screen.getByTestId('wc-A1')).toBeInTheDocument();
  });

  test('przełącznik na tryb wg terminów pokazuje widok popytu z podpisem', () => {
    render(<BottleneckTab {...props([op('A1', [seg('17', 2)])])} />);
    fireEvent.click(screen.getByRole('button', { name: 'Wg terminów (popyt)' }));
    expect(screen.getByText(/prognoza popytu/i)).toBeInTheDocument();
    expect(screen.getByText(/brak wąskiego gardła/)).toBeInTheDocument();
  });

  test('puste fwdZP: komunikat i fallback na tryb wg terminów', () => {
    render(<BottleneckTab {...props([])} />);
    expect(screen.getByText(/Brak planu/)).toBeInTheDocument();
    expect(screen.getByText(/brak wąskiego gardła/)).toBeInTheDocument();
  });
});

