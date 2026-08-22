declare module 'foliate-js/view.js' {
  export interface FoliateTocEntry {
    label?: unknown;
    href?: unknown;
    subitems?: unknown;
  }

  export interface FoliateBook {
    metadata?: Record<string, unknown>;
    rendition?: { layout?: unknown };
    sections: FoliateSection[];
    toc?: unknown;
    transformTarget?: EventTarget;
    resolveHref?: (
      href: string,
    ) => { index?: number; anchor?: (document: Document) => unknown } | null;
    getCover?: () => Promise<Blob | null>;
    destroy?: () => void;
  }

  export interface FoliateSection {
    id?: string;
    linear?: string;
    load: () => Promise<string | null>;
    unload: () => void;
    resolveHref?: (href: string) => string;
  }

  export interface FoliateRendererElement extends HTMLElement {
    setAttribute(name: string, value: string): void;
  }

  export interface FoliateViewElement extends HTMLElement {
    book?: FoliateBook;
    renderer?: FoliateRendererElement;
    lastLocation?: unknown;
    open: (book: FoliateBook) => Promise<void>;
    init: (options: { lastLocation?: unknown; showTextStart?: boolean }) => Promise<void>;
    goTo: (target: string | number) => Promise<void>;
    close: () => void;
  }

  export function makeBook(file: File | Blob | string): Promise<FoliateBook>;
}
