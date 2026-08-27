import { describe, expect, it } from 'vitest';

import {
  installPublicationPolicy,
  installStrictPublicationPolicy,
  sanitizeBalancedMarkup,
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

  it('allows only passive HTTPS resources in Balanced markup while scripts stay blocked', () => {
    const result = sanitizeBalancedMarkup(
      `<!doctype html><html><head>
        <link rel="stylesheet" href="https://cdn.example.test/book.css">
        <script src="https://cdn.example.test/book.js"></script>
        <style>p{background:url(https://cdn.example.test/paper.png)} i{background:url(http://bad.test/x)}</style>
      </head><body onload="steal()">
        <a href="https://example.test/leave">External link</a>
        <img src="https://cdn.example.test/illustration.jpg" srcset="https://cdn.example.test/a.jpg 1x, http://bad.test/b.jpg 2x">
        <video poster="https://cdn.example.test/poster.jpg"></video>
      </body></html>`,
      'text/html',
    );
    const document = new DOMParser().parseFromString(result, 'text/html');

    expect(document.querySelector('script')).toBeNull();
    expect(document.body.hasAttribute('onload')).toBe(false);
    expect(document.querySelector('a')?.hasAttribute('href')).toBe(false);
    expect(document.querySelector('link')?.getAttribute('href')).toBe(
      'https://cdn.example.test/book.css',
    );
    expect(document.querySelector('img')?.getAttribute('src')).toBe(
      'https://cdn.example.test/illustration.jpg',
    );
    expect(document.querySelector('img')?.getAttribute('srcset')).toBe(
      'https://cdn.example.test/a.jpg 1x',
    );
    expect(document.querySelector('video')?.getAttribute('poster')).toBe(
      'https://cdn.example.test/poster.jpg',
    );
    expect(document.querySelector('style')?.textContent).toContain(
      'https://cdn.example.test/paper.png',
    );
    expect(document.querySelector('style')?.textContent).not.toContain('http://bad.test');
    expect(result).toContain("script-src 'none'");
    expect(result).toContain('img-src blob: data: https:');
  });

  it('keeps script loads blocked when the transform policy is Balanced', async () => {
    const target = new EventTarget();
    const remove = installPublicationPolicy(target, 'balanced');
    const loadDetail = { isScript: true, allow: true as boolean | Promise<boolean> };
    target.dispatchEvent(new CustomEvent('load', { detail: loadDetail }));
    expect(await loadDetail.allow).toBe(false);

    const dataDetail: { data: unknown; type: string } = {
      data: 'p{background:url(https://cdn.example.test/paper.png)}',
      type: 'text/css',
    };
    target.dispatchEvent(new CustomEvent('data', { detail: dataDetail }));
    expect(await dataDetail.data).toContain('https://cdn.example.test/paper.png');
    remove();
  });
});
