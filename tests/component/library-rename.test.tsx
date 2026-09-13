import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { PublicationDescriptor } from '../../src/platform/contracts';
import { LibraryScreen } from '../../src/renderer/app/LibraryScreen';

const entry: PublicationDescriptor = {
  id: 'f4cc55dc-c548-4780-b384-0c663bfdb14f',
  displayName: 'Volume.epub',
  fileSize: 123,
  lastModified: 0,
  mimeType: 'application/epub+zip',
  availability: 'stored',
  title: 'Shared title',
};

function showLibrary(onRenameEntry = vi.fn().mockResolvedValue(true)) {
  render(
    <LibraryScreen
      entries={[entry]}
      progressByBook={{}}
      isLoading={false}
      isSelecting={false}
      error={undefined}
      hasSessionFile={() => false}
      onOpenNew={vi.fn()}
      onOpenEntry={vi.fn()}
      onRemoveEntry={vi.fn().mockResolvedValue(true)}
      onRenameEntry={onRenameEntry}
      onDismissError={vi.fn()}
    />,
  );
  return onRenameEntry;
}

describe('Library Rename', () => {
  it('focuses the name, rejects whitespace, and cancels without saving', async () => {
    const user = userEvent.setup();
    const rename = showLibrary();
    await user.click(screen.getByRole('button', { name: 'Rename' }));
    const input = screen.getByRole('textbox', { name: 'Volume name' });
    expect(input).toHaveFocus();
    expect(input).toHaveValue('Shared title');
    expect(input).toHaveAttribute('maxlength', '300');
    await user.clear(input);
    await user.type(input, '   ');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rename' })).toHaveFocus();
    expect(rename).not.toHaveBeenCalled();
  });

  it('trims names and prevents duplicate saves while saving', async () => {
    const user = userEvent.setup();
    let finish!: (saved: boolean) => void;
    const rename = showLibrary(
      vi.fn(
        () =>
          new Promise<boolean>((resolve) => {
            finish = resolve;
          }),
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Rename' }));
    await user.clear(screen.getByRole('textbox'));
    await user.type(screen.getByRole('textbox'), '  Volume 2  {Enter}');
    expect(rename).toHaveBeenCalledWith(entry, 'Volume 2');
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Resume' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await user.keyboard('{Escape}{Enter}');
    expect(rename).toHaveBeenCalledTimes(1);
    await act(() => Promise.resolve(finish(true)));
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rename' })).toHaveFocus();
  });

  it('keeps the draft for retry after a failed save', async () => {
    const user = userEvent.setup();
    const rename = showLibrary(
      vi.fn().mockRejectedValueOnce(new Error('Storage unavailable')).mockResolvedValueOnce(true),
    );
    await user.click(screen.getByRole('button', { name: 'Rename' }));
    await user.clear(screen.getByRole('textbox'));
    await user.type(screen.getByRole('textbox'), 'Volume 3{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be saved');
    expect(screen.getByRole('textbox')).toHaveValue('Volume 3');
    expect(screen.getByRole('heading', { name: 'Shared title' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(rename).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
});
