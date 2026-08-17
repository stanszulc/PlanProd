import { describe, test, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ImportTab } from './ImportTab.jsx';

const noop = () => {};

describe('ImportTab — surfaces feedback when loading a file fails', () => {
  test('shows an error message when the onLoad parser throws, instead of failing silently', async () => {
    const onLoad = vi.fn((content, type) => {
      if (type === 'zp_status') throw new Error('boom parsing');
    });

    const { container, findByText } = render(
      <ImportTab
        erpZp={[]}
        zpStatusData={[]}
        parallelMachines={[]}
        fwdZP={[]}
        bomFormatki={[]}
        onLoad={onLoad}
        onExportZpStatus={noop}
        hybridMode={false}
        onHybridModeChange={noop}
        nestingBeta={false}
        onNestingBetaChange={noop}
      />
    );

    const input = container.querySelector('#file_zp_status');
    const file = new File(['garbage,data'], 'zp_status.csv', { type: 'text/csv' });
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new Event('change', { bubbles: true }));

    await waitFor(() => expect(onLoad).toHaveBeenCalled());

    expect(await findByText(/nie udało się wczytać/i)).toBeInTheDocument();
  });
});

describe('ImportTab — grafik godzin (xlsx z loadplanner)', () => {
  test('parses the dropped xlsx and calls onLoad with the parsed rows', async () => {
    const onLoad = vi.fn(() => ({ count: 14, warnings: [] }));

    const { container } = render(
      <ImportTab
        erpZp={[]}
        zpStatusData={[]}
        parallelMachines={[]}
        fwdZP={[]}
        bomFormatki={[]}
        onLoad={onLoad}
        onExportZpStatus={noop}
        hybridMode={false}
        onHybridModeChange={noop}
        nestingBeta={false}
        onNestingBetaChange={noop}
      />
    );

    const input = container.querySelector('#file_wc_schedule');
    expect(input).not.toBeNull();

    const bytes = readFileSync(
      path.join(__dirname, '..', '..', 'utils', '__fixtures__', 'grafik_godzin_test.xlsx')
    );
    const file = new File([new Uint8Array(bytes)], 'grafik_godzin.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new Event('change', { bubbles: true }));

    await waitFor(() => expect(onLoad).toHaveBeenCalled());

    const [rows, type] = onLoad.mock.calls[0];
    expect(type).toBe('wc_schedule');
    expect(rows).toHaveLength(14);
    expect(rows[0]).toEqual({ brygada: 'Kanały', data: '2026-08-17', godziny: 16.9 });
  });
});
