import { describe, expect, it } from 'vitest';

import { closestFrameElement } from '../../../src/reader/frame-events';

describe('chapter-frame event targets', () => {
  it('accepts DOM elements from a different iframe realm without outer instanceof checks', () => {
    const frame = document.createElement('iframe');
    document.body.append(frame);
    const frameDocument = frame.contentDocument;
    if (!frameDocument) throw new Error('The test iframe did not create a document.');
    const button = frameDocument.createElement('button');
    button.dataset.novelreaperAction = 'next';
    const label = frameDocument.createElement('span');
    button.append(label);
    frameDocument.body.append(button);

    expect(closestFrameElement<HTMLButtonElement>(label, 'button[data-novelreaper-action]')).toBe(
      button,
    );
    frame.remove();
  });

  it('ignores non-element event targets', () => {
    expect(closestFrameElement(document.createTextNode('Next'), 'button')).toBeNull();
    expect(closestFrameElement(null, 'button')).toBeNull();
  });
});
