import { describe, expect, it } from 'vitest';

import {
  installStrictPublicationPolicy,
  sanitizeStrictCss,
  sanitizeStrictMarkup,
} from '../../../src/reader/strict-policy';

describe('Strict EPUB content policy', () => {
  it('removes executable and outbound markup while retaining local reading content', () => {
    const result = sanitizeStrictMarkup(
      `<!doctype html><html><head><title>Chapter</title></head><body onload="steal()">
        <script src="evil.js"></script><form action="https://example.test"><button>Send</button></form>
        <a href="javascript:steal()">Bad</a><img src="images/cover.jpg" onerror="steal()">
        <p style="background:url(https://example.test/tracker.png)">Safe text</p>
      </body></html>`,
      'text/html',
    );

    expect(result).not.toMatch(/<script|<form|onload|onerror|javascript:|https:\/\//i);
    expect(result).toContain('Safe text');
    expect(result).toContain('images/cover.jpg');
    expect(result).toContain("script-src 'none'");
  });

  it('blocks script resources and sanitizes transformed CSS independently', async () => {
    const target = new EventTarget();
    const remove = installStrictPublicationPolicy(target);
    const loadDetail = { isScript: true, allow: true as boolean | Promise<boolean> };
    target.dispatchEvent(new CustomEvent('load', { detail: loadDetail }));
    expect(await loadDetail.allow).toBe(false);

    const dataDetail: { data: unknown; type: string } = {
      data: '@import "https://example.test/style.css"; p{background:url(https://example.test/x)}',
      type: 'text/css',
    };
    target.dispatchEvent(new CustomEvent('data', { detail: dataDetail }));
    expect(await dataDetail.data).not.toMatch(/example\.test/);
    remove();
  });

  it('keeps internal and data resources when sanitizing CSS', () => {
    const css = sanitizeStrictCss(
      'p{background:url(images/paper.png)} img{src:url(data:image/png;base64,AA)}',
    );
    expect(css).toContain('images/paper.png');
    expect(css).toContain('data:image/png');
  });
});
