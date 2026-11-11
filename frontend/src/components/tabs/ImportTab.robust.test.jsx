import { describe, test, expect, vi } from 'vitest';
import { render, waitFor, screen } from '@testing-library/react';
import { ImportTab } from './ImportTab.jsx';

const noop = () => {};

function setup(onLoad) {
  const utils = render(
    <ImportTab
      erpZp={[]} zpStatusData={[]} parallelMachines={[]} fwdZP={[]} bomFormatki={[]}
      onLoad={onLoad} onExportZpStatus={noop}
      hybridMode={false} onHybridModeChange={noop}
      nestingBeta={false} onNestingBetaChange={noop}
    />
  );
  return utils;
}

function pick(container, type, file) {
  const input = container.querySelector(`#file_${type}`);
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return input;
}

function drop(container, type, file) {
  const input = container.querySelector(`#file_${type}`);
  const box = input.parentElement;
  const ev = new Event('drop', { bubbles: true, cancelable: true });
  ev.dataTransfer = { files: [file] };
  box.dispatchEvent(ev);
}


describe('ImportTab — kodowanie', () => {
  test('plik CSV w windows-1250 jest dekodowany poprawnie (po wykryciu U+FFFD w UTF-8)', async () => {
    const onLoad = vi.fn(() => ({ count: 1 }));
    const { container } = setup(onLoad);
    // "WC\n" + "Śląsk" w cp1250 (Ś=0x8C, ą=0xB9)
    const bytes = new Uint8Array([0x57, 0x43, 0x0a, 0x8c, 0xb9, 0x73, 0x6b]);
    pick(container, 'parallel_machines', new File([bytes], 'm.csv'));
    await waitFor(() => expect(onLoad).toHaveBeenCalled());
    expect(onLoad.mock.calls[0][0]).toBe('WC\nŚąsk');
  });

  test('poprawny UTF-8 zostaje UTF-8', async () => {
    const onLoad = vi.fn(() => ({ count: 1 }));
    const { container } = setup(onLoad);
    pick(container, 'parallel_machines', new File(['WC\nŚląsk'], 'm.csv'));
    await waitFor(() => expect(onLoad).toHaveBeenCalled());
    expect(onLoad.mock.calls[0][0]).toBe('WC\nŚląsk');
  });
});

describe('ImportTab — pusty wynik', () => {
  test('0 rekordów -> ostrzeżenie zamiast "Załadowano"', async () => {
    const onLoad = vi.fn(() => ({ count: 0 }));
    const { container, findByText, queryByText } = setup(onLoad);
    pick(container, 'parallel_machines', new File(['WC\n'], 'm.csv'));
    expect(await findByText(/Nie znaleziono rekordów/)).toBeInTheDocument();
    expect(queryByText('✓ Załadowano')).toBeNull();
  });

  test('ERP: pusta zpList -> ostrzeżenie', async () => {
    const onLoad = vi.fn(() => ({ zpList: [] }));
    const { container, findByText, queryByText } = setup(onLoad);
    pick(container, 'erp_zp', new File(['abc\n'], 'e.tsv'));
    expect(await findByText(/Nie znaleziono rekordów/)).toBeInTheDocument();
    expect(queryByText('✓ Załadowano')).toBeNull();
  });

  test('zp_status: wszystkie linie odrzucone -> ostrzeżenie', async () => {
    const onLoad = vi.fn(() => ({ rejected: [{ line: 2, data: {}, reason: 'x' }] }));
    const { container, findByText } = setup(onLoad);
    pick(container, 'zp_status', new File(['zp_id,status\nA,PLAN\n'], 'z.csv'));
    expect(await findByText(/Nie znaleziono rekordów/)).toBeInTheDocument();
  });
});

describe('ImportTab — rozszerzenie przy drop i reset inputa', () => {
  test('drop xlsx na zp_status jest odrzucany z ostrzeżeniem', async () => {
    const onLoad = vi.fn();
    const { container, findByText } = setup(onLoad);
    drop(container, 'zp_status', new File([new Uint8Array([1])], 'x.xlsx'));
    expect(await findByText(/Nieobsługiwany typ pliku/)).toBeInTheDocument();
    expect(onLoad).not.toHaveBeenCalled();
  });

  test('po wyborze pliku input.value jest czyszczone (ponowny wybór odpala onChange)', async () => {
    const onLoad = vi.fn(() => ({ count: 1 }));
    const { container } = setup(onLoad);
    const input = container.querySelector('#file_parallel_machines');
    const setter = vi.fn();
    Object.defineProperty(input, 'value', { set: setter, get: () => 'C:\\fakepath\\m.csv', configurable: true });
    pick(container, 'parallel_machines', new File(['WC\n20005'], 'm.csv'));
    await waitFor(() => expect(onLoad).toHaveBeenCalled());
    expect(setter).toHaveBeenCalledWith('');
    expect(screen.queryByText(/Nieobsługiwany/)).toBeNull();
  });
});
