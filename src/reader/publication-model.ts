import type { ReaderMetadata, ReaderTocItem } from './contracts';

const MAX_TEXT = 300;
const MAX_TOC_ITEMS = 5_000;
const MAX_TOC_DEPTH = 20;

interface FoliateBookModel {
  metadata?: Record<string, unknown>;
  sections: Array<unknown>;
  toc?: unknown;
  resolveHref?: (href: string) => { index?: number } | null;
}

function boundedText(value: unknown, fallback = ''): string {
  const text = typeof value === 'string' ? value : '';
  return [...text.replace(/\s+/g, ' ').trim()].slice(0, MAX_TEXT).join('') || fallback;
}

function localizedText(value: unknown): string {
  if (typeof value === 'string') return boundedText(value);
  if (Array.isArray(value)) {
    for (const entry of value) {
      const text = localizedText(entry);
      if (text) return text;
    }
    return '';
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if ('name' in record) return localizedText(record.name);
    const preferred = record[''] ?? record.en ?? Object.values(record)[0];
    return localizedText(preferred);
  }
  return '';
}

export function metadataFromBook(
  metadata: Record<string, unknown> | undefined,
  fallbackTitle: string,
): ReaderMetadata {
  const title =
    localizedText(metadata?.title) || boundedText(fallbackTitle, 'Untitled publication');
  const author = localizedText(metadata?.author);
  const language = localizedText(metadata?.language);
  const description = boundedText(metadata?.description);
  return {
    title,
    ...(author ? { author } : {}),
    ...(language ? { language } : {}),
    ...(description ? { description } : {}),
  };
}

function tocChildren(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function tocFromBook(book: FoliateBookModel): ReaderTocItem[] {
  const result: ReaderTocItem[] = [];
  let sequence = 0;

  const visit = (items: unknown[], depth: number): void => {
    if (depth > MAX_TOC_DEPTH || result.length >= MAX_TOC_ITEMS) return;
    for (const value of items) {
      if (!value || typeof value !== 'object' || result.length >= MAX_TOC_ITEMS) continue;
      const entry = value as Record<string, unknown>;
      const href = typeof entry.href === 'string' ? entry.href : undefined;
      const label = boundedText(entry.label, `Chapter ${sequence + 1}`);
      if (href) {
        const resolved = book.resolveHref?.(href);
        const spineIndex = Number.isInteger(resolved?.index) ? resolved?.index : undefined;
        result.push({
          id: `toc-${sequence}`,
          label,
          target: href,
          depth,
          ...(spineIndex === undefined ? {} : { spineIndex }),
        });
        sequence += 1;
      }
      visit(tocChildren(entry.subitems), depth + 1);
    }
  };

  visit(tocChildren(book.toc), 0);
  if (result.length) return result;

  return book.sections.slice(0, MAX_TOC_ITEMS).map((_section, index) => ({
    id: `spine-${index}`,
    label: `Chapter ${index + 1}`,
    target: index,
    depth: 0,
    spineIndex: index,
  }));
}

export function activeTocId(
  toc: ReaderTocItem[],
  spineIndex: number,
  tocHref?: string,
): string | undefined {
  if (tocHref) {
    const exact = toc.find((item) => item.target === tocHref);
    if (exact) return exact.id;
  }
  return [...toc]
    .reverse()
    .find((item) => item.spineIndex !== undefined && item.spineIndex <= spineIndex)?.id;
}
