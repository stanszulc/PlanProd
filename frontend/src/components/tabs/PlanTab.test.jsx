import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PlanTab } from './PlanTab.jsx';
import { ScheduleDebugTab } from './ScheduleDebugTab.jsx';

vi.mock('./GanttTab.jsx', () => ({ GanttTab: () => <div>gantt</div> }));

const st = (id, extra = {}) => ({
  zp_id: id, zs_id: 'ZS1', pozycja: 1, product: 'P1', due_date: '2026-08-20',
  delayH: 0, delayDays: 0, toc: { zone: 'green', label: 'OK', consumed: 0.1 }, ...extra,
});
const gl = { zpColorMap: {} };
const base = { routing: [], zp: [], globalLookups: gl, wcSchedule: {}, subZP: [], fwdZP: [] };

describe('PlanTab ostrzeżenia planu', () => {
  test('bez ostrzeżeń brak odznak i podsumowania', () => {
    render(<PlanTab {...base} zpStatus={[st('ZP1')]} />);
    expect(screen.queryByText('⚠')).toBeNull();
    expect(screen.queryByText(/z ostrzeżeniami planu/)).toBeNull();
  });

  test('odznaka z title i podsumowanie liczby ZP', () => {
    render(<PlanTab {...base} zpStatus={[
      st('ZP1', { graphWarning: 'cykl OP' }),
      st('ZP2', { graphWarning: 'dubel OP', planWarning: 'brak zdolności' }),
      st('ZP3'),
    ]} />);
    expect(screen.getAllByText('⚠')).toHaveLength(2);
    expect(screen.getByTitle('cykl OP')).toBeInTheDocument();
    expect(screen.getByTitle('dubel OP; brak zdolności')).toBeInTheDocument();
    expect(screen.getByText('⚠ 2 ZP z ostrzeżeniami planu')).toBeInTheDocument();
  });
});

describe('ScheduleDebugTab ostrzeżenia planu', () => {
  const fwd = [{ parent_zp: 'ZP1', workcenter: 'WC1', segments: [] }];
  test('brak sekcji bez ostrzeżeń', () => {
    render(<ScheduleDebugTab fwdZP={fwd} zpStatus={[st('ZP1')]} />);
    expect(screen.queryByText('Ostrzeżenia planu')).toBeNull();
  });
  test('sekcja z wierszami Graf / Zdolność', () => {
    render(<ScheduleDebugTab fwdZP={fwd} zpStatus={[
      st('ZP1', { graphWarning: 'cykl OP' }), st('ZP2', { planWarning: 'brak zdolności' }), st('ZP3'),
    ]} />);
    expect(screen.getByText('Ostrzeżenia planu')).toBeInTheDocument();
    expect(screen.getByText('cykl OP')).toBeInTheDocument();
    expect(screen.getByText('brak zdolności')).toBeInTheDocument();
    expect(screen.getByText('Graf')).toBeInTheDocument();
    expect(screen.getByText('Zdolność')).toBeInTheDocument();
  });
});
