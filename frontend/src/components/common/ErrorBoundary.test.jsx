import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorBoundary } from './ErrorBoundary.jsx';

let shouldThrow = true;
function Bomb() {
  if (shouldThrow) throw new Error('boom-test');
  return <div>zakładka działa</div>;
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    shouldThrow = true;
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('pokazuje komunikat błędu, a rodzeństwo pozostaje widoczne', () => {
    render(
      <div>
        <nav>nawigacja</nav>
        <ErrorBoundary><Bomb /></ErrorBoundary>
      </div>
    );
    expect(screen.getByText('nawigacja')).toBeTruthy();
    expect(screen.getByText('Wystąpił błąd w tej zakładce')).toBeTruthy();
    expect(screen.getByText(/boom-test/)).toBeTruthy();
  });

  it('„Spróbuj ponownie” resetuje stan', () => {
    render(<ErrorBoundary><Bomb /></ErrorBoundary>);
    shouldThrow = false;
    fireEvent.click(screen.getByText('Spróbuj ponownie'));
    expect(screen.getByText('zakładka działa')).toBeTruthy();
  });

  it('resetuje się przy zmianie key', () => {
    const { rerender } = render(<ErrorBoundary key="a"><Bomb /></ErrorBoundary>);
    shouldThrow = false;
    rerender(<ErrorBoundary key="b"><Bomb /></ErrorBoundary>);
    expect(screen.getByText('zakładka działa')).toBeTruthy();
  });
});
