import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AppErrorBoundary } from '../../src/renderer/app/AppErrorBoundary';

function ThrowingChild(): React.JSX.Element {
  throw new Error('Synthetic component failure');
}

describe('AppErrorBoundary', () => {
  it('keeps a recoverable local shell when a child render fails', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <AppErrorBoundary>
        <ThrowingChild />
      </AppErrorBoundary>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('unexpected error');
    expect(screen.getByRole('button', { name: 'Reload interface' })).toBeEnabled();
  });
});
