const MARKUP_TYPES = new Set(['application/xhtml+xml', 'image/svg+xml', 'text/html']);

export const STRICT_EPUB_CSP = [
  "default-src 'none'",
  'img-src blob: data:',
  'media-src blob: data:',
  "font-src 'self' blob: data:",
  "style-src 'unsafe-inline' blob:",
  "script-src 'none'",
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "worker-src 'none'",
].join('; ');

const BLOCKED_ELEMENTS = [
  'script',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'form',
  'base',
  'foreignObject',
].join(',');

const URL_ATTRIBUTES = new Set(['action', 'formaction', 'href', 'poster', 'src', 'xlink:href']);

const DANGEROUS_URL = /^(?:\s*)(?:https?:|wss?:|ftp:|file:|javascript:|vbscript:|\/\/)/i;

export function sanitizeStrictCss(css: string): string {
  return css
    .replace(/@import\s+(?:url\s*\()?[^;]+;?/gi, '')
    .replace(/url\s*\(\s*(['"]?)(.*?)\1\s*\)/gi, (match, _quote: string, url: string) =>
      DANGEROUS_URL.test(url) ? 'url("")' : match,
    )
    .replace(/(?:expression|behavior)\s*\([^)]*\)/gi, '')
    .replace(/-moz-binding\s*:[^;}]*/gi, '');
}

function insertStrictCsp(document: Document): void {
  if (document.contentType === 'image/svg+xml') return;
  const head = document.head ?? document.querySelector('head');
  if (!head) return;

  for (const meta of Array.from(head.querySelectorAll('meta[http-equiv]'))) {
    const directive = meta.getAttribute('http-equiv')?.toLocaleLowerCase();
    if (directive === 'content-security-policy' || directive === 'refresh') meta.remove();
  }

  const csp = document.createElement('meta');
  csp.setAttribute('http-equiv', 'Content-Security-Policy');
  csp.setAttribute('content', STRICT_EPUB_CSP);
  head.prepend(csp);
}

export function scrubStrictDocument(document: Document): void {
  document.querySelectorAll(BLOCKED_ELEMENTS).forEach((element) => element.remove());

  for (const meta of Array.from(document.querySelectorAll('meta[http-equiv]'))) {
    if (meta.getAttribute('http-equiv')?.toLocaleLowerCase() === 'refresh') meta.remove();
  }

  for (const element of Array.from(document.querySelectorAll('*'))) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLocaleLowerCase();
      if (name.startsWith('on') || name === 'srcdoc') {
        element.removeAttribute(attribute.name);
        continue;
      }
      if (name === 'style') {
        element.setAttribute(attribute.name, sanitizeStrictCss(attribute.value));
        continue;
      }
      if (URL_ATTRIBUTES.has(name) && DANGEROUS_URL.test(attribute.value)) {
        element.removeAttribute(attribute.name);
      }
    }
  }

  document.querySelectorAll('style').forEach((style) => {
    style.textContent = sanitizeStrictCss(style.textContent ?? '');
  });
  insertStrictCsp(document);
}

export function sanitizeStrictMarkup(markup: string, type: string, readingStyle?: string): string {
  const parser = new DOMParser();
  const parseType =
    type === 'text/html' ? 'text/html' : type === 'image/svg+xml' ? type : 'application/xhtml+xml';
  const document = parser.parseFromString(markup, parseType);
  if (document.querySelector('parsererror')) {
    throw new Error('The EPUB contains malformed chapter markup.');
  }
  scrubStrictDocument(document);
  if (readingStyle && document.head) {
    const style = document.createElement('style');
    style.dataset.novelReaper = 'reader-style';
    style.textContent = sanitizeStrictCss(readingStyle);
    document.head.append(style);
  }
  return new XMLSerializer().serializeToString(document);
}

async function sanitizeResourceData(data: unknown, type: string): Promise<unknown> {
  if (type === 'text/css') {
    if (data instanceof Blob) return sanitizeStrictCss(await data.text());
    return typeof data === 'string' ? sanitizeStrictCss(data) : data;
  }
  if (!MARKUP_TYPES.has(type)) return data;
  return data;
}

interface FoliateLoadDetail {
  isScript?: boolean;
  allow?: boolean | Promise<boolean>;
}

interface FoliateDataDetail {
  data: unknown;
  type?: unknown;
}

export function installStrictPublicationPolicy(target: EventTarget): () => void {
  const blockScripts = (event: Event): void => {
    const detail = (event as CustomEvent<FoliateLoadDetail>).detail;
    if (detail?.isScript) detail.allow = false;
  };
  const sanitizeData = (event: Event): void => {
    const detail = (event as CustomEvent<FoliateDataDetail>).detail;
    if (!detail) return;
    const type = typeof detail.type === 'string' ? detail.type : '';
    detail.data = Promise.resolve(detail.data).then((data) => sanitizeResourceData(data, type));
  };

  target.addEventListener('load', blockScripts);
  target.addEventListener('data', sanitizeData);
  return () => {
    target.removeEventListener('load', blockScripts);
    target.removeEventListener('data', sanitizeData);
  };
}
