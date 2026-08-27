const MARKUP_TYPES = new Set(['application/xhtml+xml', 'image/svg+xml', 'text/html']);

export type BrowserSafetyLevel = 'balanced' | 'strict';

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

export const BALANCED_EPUB_CSP = [
  "default-src 'none'",
  'img-src blob: data: https:',
  'media-src blob: data: https:',
  "font-src 'self' blob: data: https:",
  "style-src 'unsafe-inline' blob: https:",
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
const HTTPS_URL = /^\s*https:/i;

const PASSIVE_HTTPS_ATTRIBUTES: Record<string, ReadonlySet<string>> = {
  audio: new Set(['src']),
  image: new Set(['href', 'xlink:href']),
  img: new Set(['src']),
  link: new Set(['href']),
  source: new Set(['src']),
  track: new Set(['src']),
  video: new Set(['poster', 'src']),
};

function passiveHttpsAllowed(element: Element, attribute: string, value: string): boolean {
  if (!HTTPS_URL.test(value)) return false;
  const tag = element.localName.toLocaleLowerCase();
  if (!PASSIVE_HTTPS_ATTRIBUTES[tag]?.has(attribute)) return false;
  if (tag !== 'link') return true;
  return element.getAttribute('rel')?.split(/\s+/).includes('stylesheet') ?? false;
}

function cssUrlAllowed(url: string, level: BrowserSafetyLevel): boolean {
  if (!DANGEROUS_URL.test(url)) return true;
  return level === 'balanced' && HTTPS_URL.test(url);
}

function sanitizeCss(css: string, level: BrowserSafetyLevel): string {
  return css
    .replace(
      /@import\s+(?:url\s*\(\s*)?(['"]?)([^'"\s);]+)\1\s*\)?[^;]*;?/gi,
      (match, _quote: string, url: string) =>
        level === 'balanced' && cssUrlAllowed(url, level) ? match : '',
    )
    .replace(/url\s*\(\s*(['"]?)(.*?)\1\s*\)/gi, (match, _quote: string, url: string) =>
      cssUrlAllowed(url, level) ? match : 'url("")',
    )
    .replace(/(?:expression|behavior)\s*\([^)]*\)/gi, '')
    .replace(/-moz-binding\s*:[^;}]*/gi, '');
}

export function sanitizePublicationCss(css: string, level: BrowserSafetyLevel): string {
  return sanitizeCss(css, level);
}

export function sanitizeStrictCss(css: string): string {
  return sanitizeCss(css, 'strict');
}

export function sanitizeBalancedCss(css: string): string {
  return sanitizeCss(css, 'balanced');
}

function insertCsp(document: Document, level: BrowserSafetyLevel): void {
  if (document.contentType === 'image/svg+xml') return;
  const head = document.head ?? document.querySelector('head');
  if (!head) return;

  for (const meta of Array.from(head.querySelectorAll('meta[http-equiv]'))) {
    const directive = meta.getAttribute('http-equiv')?.toLocaleLowerCase();
    if (directive === 'content-security-policy' || directive === 'refresh') meta.remove();
  }

  const csp = document.createElement('meta');
  csp.setAttribute('http-equiv', 'Content-Security-Policy');
  csp.setAttribute('content', level === 'balanced' ? BALANCED_EPUB_CSP : STRICT_EPUB_CSP);
  head.prepend(csp);
}

export function scrubPublicationDocument(document: Document, level: BrowserSafetyLevel): void {
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
        element.setAttribute(attribute.name, sanitizeCss(attribute.value, level));
        continue;
      }
      if (URL_ATTRIBUTES.has(name) && DANGEROUS_URL.test(attribute.value)) {
        if (level !== 'balanced' || !passiveHttpsAllowed(element, name, attribute.value)) {
          element.removeAttribute(attribute.name);
        }
        continue;
      }
      if (name === 'srcset') {
        const safeCandidates = attribute.value
          .split(',')
          .map((candidate) => candidate.trim())
          .filter((candidate) => {
            const [url] = candidate.split(/\s+/, 1);
            if (!url || !DANGEROUS_URL.test(url)) return true;
            return level === 'balanced' && element.localName === 'img' && HTTPS_URL.test(url);
          });
        if (safeCandidates.length) element.setAttribute(attribute.name, safeCandidates.join(', '));
        else element.removeAttribute(attribute.name);
      }
    }
  }

  document.querySelectorAll('style').forEach((style) => {
    style.textContent = sanitizeCss(style.textContent ?? '', level);
  });
  insertCsp(document, level);
}

export function scrubStrictDocument(document: Document): void {
  scrubPublicationDocument(document, 'strict');
}

export function sanitizePublicationMarkup(
  markup: string,
  type: string,
  readingStyle: string | undefined,
  level: BrowserSafetyLevel,
): string {
  const parser = new DOMParser();
  const parseType =
    type === 'text/html' ? 'text/html' : type === 'image/svg+xml' ? type : 'application/xhtml+xml';
  const document = parser.parseFromString(markup, parseType);
  if (document.querySelector('parsererror')) {
    throw new Error('The EPUB contains malformed chapter markup.');
  }
  scrubPublicationDocument(document, level);
  if (readingStyle && document.head) {
    const style = document.createElement('style');
    style.dataset.novelReaper = 'reader-style';
    style.textContent = sanitizeCss(readingStyle, level);
    document.head.append(style);
  }
  return new XMLSerializer().serializeToString(document);
}

export function sanitizeStrictMarkup(markup: string, type: string, readingStyle?: string): string {
  return sanitizePublicationMarkup(markup, type, readingStyle, 'strict');
}

export function sanitizeBalancedMarkup(
  markup: string,
  type: string,
  readingStyle?: string,
): string {
  return sanitizePublicationMarkup(markup, type, readingStyle, 'balanced');
}

async function sanitizeResourceData(
  data: unknown,
  type: string,
  level: BrowserSafetyLevel,
): Promise<unknown> {
  if (type === 'text/css') {
    if (data instanceof Blob) return sanitizeCss(await data.text(), level);
    return typeof data === 'string' ? sanitizeCss(data, level) : data;
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

export function installPublicationPolicy(
  target: EventTarget,
  level: BrowserSafetyLevel,
): () => void {
  const blockScripts = (event: Event): void => {
    const detail = (event as CustomEvent<FoliateLoadDetail>).detail;
    if (detail?.isScript) detail.allow = false;
  };
  const sanitizeData = (event: Event): void => {
    const detail = (event as CustomEvent<FoliateDataDetail>).detail;
    if (!detail) return;
    const type = typeof detail.type === 'string' ? detail.type : '';
    detail.data = Promise.resolve(detail.data).then((data) =>
      sanitizeResourceData(data, type, level),
    );
  };

  target.addEventListener('load', blockScripts);
  target.addEventListener('data', sanitizeData);
  return () => {
    target.removeEventListener('load', blockScripts);
    target.removeEventListener('data', sanitizeData);
  };
}

export function installStrictPublicationPolicy(target: EventTarget): () => void {
  return installPublicationPolicy(target, 'strict');
}
