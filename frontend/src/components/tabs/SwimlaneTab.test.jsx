import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SwimlaneTab } from './SwimlaneTab.jsx';

const routing = [{ workcenter: 'WC1' }];
const gl = { routingByProduct: { P1: [{ workcenter: 'WC1', ct_min: 60, sequence: 1 }] }, zpColorMap: {} };

describe('SwimlaneTab', () => {
  test('cap=0 (weekend) z obciążeniem: bez NaN/Infinity, pokazuje "!"', () => {
    // 2026-08-22 to sobota
    const zp = [{ zp_id: 'ZP1', product: 'P1', volume: 2, due_date: '2026-08-22' }];
    const { container } = render(<SwimlaneTab routing={routing} zp={zp} globalLookups={gl} wcSchedule={{}} />);
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
    expect(screen.getByText('!')).toBeInTheDocument();
  });

  test('synchronizuje datę po wczytaniu danych', () => {
    const { rerender, container } = render(<SwimlaneTab routing={routing} zp={[]} globalLookups={gl} wcSchedule={{}} />);
    const zp = [{ zp_id: 'ZP1', product: 'P1', volume: 8, due_date: '2026-08-20' }];
    rerender(<SwimlaneTab routing={routing} zp={zp} globalLookups={gl} wcSchedule={{ WC1: { '2026-08-20': 8 } }} />);
    expect(container.textContent).toContain('100%');
  });
});
