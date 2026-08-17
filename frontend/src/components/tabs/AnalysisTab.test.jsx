import { describe, test, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AnalysisTab } from './AnalysisTab.jsx';

describe('AnalysisTab — Przepływ materiału (sankey historyczny)', () => {
  test('renders material flow without crashing when a product has a multi-step routing', () => {
    const historyData = [
      { workcenter: 'WC1', product: 'P1', start_ts: '2026-08-10T08:00:00', volume: 10, zp_id: 'ZP1', actual_ct_min: 5, wait_min: 0 },
      { workcenter: 'WC2', product: 'P1', start_ts: '2026-08-10T09:00:00', volume: 10, zp_id: 'ZP1', actual_ct_min: 5, wait_min: 0 },
    ];
    const routing = [
      { product: 'P1', workcenter: 'WC1', sequence: 1 },
      { product: 'P1', workcenter: 'WC2', sequence: 2 },
    ];

    render(<AnalysisTab historyData={historyData} routing={routing} wcSchedule={{}} />);

    fireEvent.click(screen.getByText('Przepływ materiału'));

    // The edge WC1 -> WC2 should render its volume label instead of crashing the whole tree.
    expect(screen.getByText('10 szt.')).toBeInTheDocument();
  });
});
