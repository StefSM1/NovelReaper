import type { FoliateBook } from 'foliate-js/view.js';
import * as CFI from 'foliate-js/epubcfi.js';
import atkinsonUrl from '@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-latin-400-normal.woff2';
import literataUrl from '@fontsource/literata/files/literata-latin-400-normal.woff2';
import loraUrl from '@fontsource/lora/files/lora-latin-400-normal.woff2';
import merriweatherUrl from '@fontsource/merriweather/files/merriweather-latin-400-normal.woff2';
import sourceSerifUrl from '@fontsource/source-serif-4/files/source-serif-4-latin-400-normal.woff2';

import {
  DEFAULT_READER_APPEARANCE,
  normalizeReaderAppearance,
  READER_FONT_CSS,
  type ReaderAppearanceSettings,
} from './appearance';
import {
  ReaderEngineError,
  type ReaderEngine,
  type ReaderEngineEvent,
  type ReaderEngineFactory,
  type ReaderLocator,
  type ReaderNavigationState,
  type ReaderNavigationTarget,
  type ReaderPublication,
  type ReaderRelocation,
} from './contracts';
import { closestFrameElement } from './frame-events';
import { activeTocId, metadataFromBook, tocFromBook } from './publication-model';
import {
  installStrictPublicationPolicy,
  sanitizeStrictCss,
  sanitizeStrictMarkup,
} from './strict-policy';

const CHAPTER_LOAD_TIMEOUT_MS = 15_000;
const FONT_FACE_STYLE = `
  @font-face { font-family: 'Literata'; src: url('${literataUrl}') format('woff2'); font-display: swap; }
  @font-face { font-family: 'Lora'; src: url('${loraUrl}') format('woff2'); font-display: swap; }
  @font-face { font-family: 'Merriweather'; src: url('${merriweatherUrl}') format('woff2'); font-display: swap; }
  @font-face { font-family: 'Source Serif 4'; src: url('${sourceSerifUrl}') format('woff2'); font-display: swap; }
  @font-face { font-family: 'Atkinson Hyperlegible'; src: url('${atkinsonUrl}') format('woff2'); font-display: swap; }
`;

function readingStyle(settings: ReaderAppearanceSettings): string {
  const dark = settings.theme === 'dark';
  const paper = dark ? '#2c302e' : '#fffdf7';
  const text = dark ? '#d8dad5' : '#26302f';
  const heading = dark ? '#ffffff' : '#1f2826';
  const neutral = dark ? '#a3a7a2' : '#8f918d';
  const divider = dark ? '#555b57' : '#d9cdbf';
  return `
  ${FONT_FACE_STYLE}
  :root { color-scheme: ${dark ? 'dark' : 'light'}; background: ${paper}; }
  html { min-height: 100%; background: ${paper} !important; scroll-behavior: smooth; }
  body {
    max-width: ${settings.pageWidthCh}ch !important;
    min-height: 100%;
    margin: 0 auto !important;
    padding: 4.5rem clamp(1.4rem, 5vw, 4rem) 6rem !important;
    color: ${text} !important;
    background: ${paper} !important;
    font-family: ${READER_FONT_CSS[settings.fontFamily]} !important;
    font-size: ${settings.fontSizePx}px !important;
    line-height: ${settings.lineHeight} !important;
  }
  h1, h2, h3, h4 { color: ${heading} !important; line-height: 1.25 !important; }
  p { margin-block: 0 1.35em; }
  img, svg, video { max-width: 100% !important; height: auto !important; }
  .novelreaper-chapter-navigation {
    display: flex;
    gap: 1rem;
    align-items: center;
    justify-content: space-between;
    margin-top: 4.5rem;
    padding-top: 2rem;
    border-top: 1px solid ${divider};
  }
  .novelreaper-chapter-navigation button {
    min-width: 12rem;
    min-height: 3rem;
    padding: 0.75rem 1.15rem;
    color: ${dark ? '#ffffff' : '#202725'};
    background: ${paper};
    border: 1.5px solid ${neutral};
    border-radius: 6px;
    font: 600 0.9rem/1.2 system-ui, sans-serif;
    cursor: pointer;
  }
  .novelreaper-chapter-navigation button:last-child {
    color: #ffffff;
    background: #1f5b49;
    border-color: #1f5b49;
  }
  .novelreaper-chapter-navigation button:disabled {
    cursor: default;
    opacity: 0.48;
  }
  @media (max-width: 34rem) {
    .novelreaper-chapter-navigation { align-items: stretch; flex-direction: column; }
    .novelreaper-chapter-navigation button { width: 100%; }
  }
`;
}

function boundedLabel(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const label = [...value.replace(/\s+/g, ' ').trim()].slice(0, 300).join('');
  return label || undefined;
}

function mapOpenError(error: unknown): ReaderEngineError {
  if (error instanceof ReaderEngineError) return error;
  const detail = error instanceof Error ? error.message.toLocaleLowerCase() : '';
  if (/encrypt|drm|license|rights/.test(detail)) {
    return new ReaderEngineError(
      'ENCRYPTED_EPUB',
      'This EPUB appears to use DRM or unsupported encryption. NovelReaper v1 reads non-DRM books.',
    );
  }
  if (/container|package|opf|xml|zip|central directory|entry/.test(detail)) {
    return new ReaderEngineError(
      'MALFORMED_EPUB',
      'This file is not a readable EPUB package or contains malformed book data.',
    );
  }
  return new ReaderEngineError(
    'OPEN_FAILED',
    'NovelReaper could not open this EPUB. The selected source file was left untouched.',
  );
}

function chapterType(response: Response): string {
  return response.headers.get('content-type')?.split(';')[0]?.trim() || 'application/xhtml+xml';
}

export class FoliateReaderEngine implements ReaderEngine {
  private readonly listeners = new Set<(event: ReaderEngineEvent) => void>();
  private book: FoliateBook | undefined;
  private frame: HTMLIFrameElement | undefined;
  private container: HTMLElement | undefined;
  private removeStrictPolicy: (() => void) | undefined;
  private publication: ReaderPublication | undefined;
  private coverUrl: string | undefined;
  private activeSectionIndex: number | undefined;
  private navigationState: ReaderNavigationState = { busy: false, finished: false };
  private appearance: ReaderAppearanceSettings = DEFAULT_READER_APPEARANCE;
  private lastLocation: ReaderLocator | undefined;
  private layoutObserver: ResizeObserver | undefined;
  private displayGeneration = 0;
  private scrollFrame = 0;
  private resizeTimer = 0;

  public subscribe(listener: (event: ReaderEngineEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public async open(
    source: File,
    container: HTMLElement,
    initialLocator?: ReaderLocator,
  ): Promise<ReaderPublication> {
    this.destroy();
    this.container = container;
    let packageParsed = false;

    try {
      const { makeBook } = await import('foliate-js/view.js');
      const book = await makeBook(source);
      packageParsed = true;
      if (book.rendition?.layout === 'pre-paginated') {
        book.destroy?.();
        throw new ReaderEngineError(
          'UNSUPPORTED_LAYOUT',
          'Fixed-layout EPUBs and comics are outside NovelReaper v1. Choose a reflowable EPUB novel.',
        );
      }
      if (!book.sections.length) {
        book.destroy?.();
        throw new ReaderEngineError(
          'MALFORMED_EPUB',
          'This EPUB does not contain readable chapters.',
        );
      }

      this.book = book;
      if (book.transformTarget) {
        this.removeStrictPolicy = installStrictPublicationPolicy(book.transformTarget);
      }

      const metadata = metadataFromBook(book.metadata, source.name.replace(/\.epub$/i, ''));
      const cover = await this.createCoverUrl(book);
      if (cover) metadata.coverUrl = cover;
      const toc = tocFromBook(book);
      const declaredLinearSpineIndices = book.sections
        .map((section, index) => (section.linear === 'no' ? undefined : index))
        .filter((index): index is number => index !== undefined);
      const linearSpineIndices = declaredLinearSpineIndices.length
        ? declaredLinearSpineIndices
        : book.sections.map((_section, index) => index);
      this.publication = {
        metadata,
        toc,
        spineLength: book.sections.length,
        linearSpineIndices,
      };

      const frame = document.createElement('iframe');
      frame.className = 'strict-reader-frame';
      frame.title = `${metadata.title} reading area`;
      frame.setAttribute('sandbox', 'allow-same-origin');
      frame.setAttribute('referrerpolicy', 'no-referrer');
      this.frame = frame;
      container.replaceChildren(frame);

      const firstLinear = Math.max(
        0,
        toc.find((item) => item.spineIndex !== undefined)?.spineIndex ??
          book.sections.findIndex((section) => section.linear !== 'no'),
      );
      const initialIndex =
        initialLocator && linearSpineIndices.includes(initialLocator.spineIndex)
          ? initialLocator.spineIndex
          : firstLinear;
      await this.displaySection(initialIndex, undefined, initialLocator);
      return this.publication;
    } catch (error) {
      const mappedError = mapOpenError(error);
      this.destroy();
      if (!packageParsed && mappedError.code === 'OPEN_FAILED') {
        throw new ReaderEngineError(
          'MALFORMED_EPUB',
          'This file is not a readable EPUB package or contains malformed book data.',
        );
      }
      throw mappedError;
    }
  }

  public async goTo(target: ReaderNavigationTarget, locator?: ReaderLocator): Promise<void> {
    if (!this.book || !this.publication) {
      throw new ReaderEngineError('NAVIGATION_FAILED', 'Open an EPUB before choosing a chapter.');
    }

    const resolved =
      typeof target === 'number'
        ? { index: target }
        : (this.book.resolveHref?.(target) ?? { index: Number.NaN });
    const index = resolved.index;
    if (
      !Number.isInteger(index) ||
      index === undefined ||
      index < 0 ||
      index >= this.book.sections.length
    ) {
      throw new ReaderEngineError(
        'NAVIGATION_FAILED',
        'That contents entry does not point to a readable chapter.',
      );
    }

    try {
      if (index !== this.activeSectionIndex) await this.displaySection(index, target, locator);
      else {
        await this.settleFrameLayout();
        if (locator) this.scrollToLocator(locator);
        else this.scrollToTarget(target);
        this.emitRelocation(index);
      }
    } catch {
      throw new ReaderEngineError(
        'NAVIGATION_FAILED',
        'That chapter could not be opened. The current chapter is still available.',
      );
    }
  }

  public async applyAppearance(settings: ReaderAppearanceSettings): Promise<void> {
    this.appearance = normalizeReaderAppearance(settings);
    const document = this.frame?.contentDocument;
    const activeIndex = this.activeSectionIndex;
    if (!document || activeIndex === undefined) return;
    const locator = this.lastLocation;
    const style = document.head?.querySelector<HTMLStyleElement>('style[data-novel-reaper]');
    if (style) style.textContent = sanitizeStrictCss(readingStyle(this.appearance));
    await this.settleFrameLayout();
    if (locator?.spineIndex === activeIndex) this.scrollToLocator(locator);
    this.emitRelocation(activeIndex);
  }

  public setNavigationState(state: ReaderNavigationState): void {
    this.navigationState = state;
    if (this.activeSectionIndex !== undefined) this.installChapterNavigation();
  }

  public destroy(): void {
    this.displayGeneration += 1;
    if (this.scrollFrame) cancelAnimationFrame(this.scrollFrame);
    this.scrollFrame = 0;
    if (this.resizeTimer) window.clearTimeout(this.resizeTimer);
    this.resizeTimer = 0;
    this.detachFrameDocument();
    this.frame?.remove();
    this.frame = undefined;
    if (this.activeSectionIndex !== undefined)
      this.book?.sections[this.activeSectionIndex]?.unload();
    this.activeSectionIndex = undefined;
    this.removeStrictPolicy?.();
    this.removeStrictPolicy = undefined;
    this.book?.destroy?.();
    this.book = undefined;
    if (this.coverUrl) URL.revokeObjectURL(this.coverUrl);
    this.coverUrl = undefined;
    this.container?.replaceChildren();
    this.container = undefined;
    this.publication = undefined;
    this.navigationState = { busy: false, finished: false };
    this.lastLocation = undefined;
  }

  private async displaySection(
    index: number,
    target?: ReaderNavigationTarget,
    locator?: ReaderLocator,
  ): Promise<void> {
    const book = this.book;
    const frame = this.frame;
    const section = book?.sections[index];
    if (!book || !frame || !section) throw new Error('Chapter section is unavailable.');
    const generation = ++this.displayGeneration;
    const sourceUrl = await section.load();
    if (!sourceUrl) throw new Error('Chapter content is unavailable.');

    try {
      const response = await fetch(sourceUrl, { cache: 'no-store', credentials: 'omit' });
      if (!response.ok) throw new Error('Chapter content could not be loaded.');
      const markup = sanitizeStrictMarkup(
        await response.text(),
        chapterType(response),
        readingStyle(this.appearance),
      );
      await this.loadFrameMarkup(frame, markup, generation);
      if (generation !== this.displayGeneration) return;

      const previousIndex = this.activeSectionIndex;
      this.activeSectionIndex = index;
      this.lastLocation = undefined;
      if (previousIndex !== undefined && previousIndex !== index)
        book.sections[previousIndex]?.unload();
      this.attachFrameDocument(index);
      this.installChapterNavigation();
      await this.settleFrameLayout();
      if (locator?.spineIndex === index) this.scrollToLocator(locator);
      else this.scrollToTarget(target);
      this.emitRelocation(index);
    } catch (error) {
      section.unload();
      throw error;
    }
  }

  private loadFrameMarkup(
    frame: HTMLIFrameElement,
    markup: string,
    generation: number,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        cleanup();
        reject(new Error('Chapter rendering timed out.'));
      }, CHAPTER_LOAD_TIMEOUT_MS);
      const cleanup = (): void => {
        window.clearTimeout(timeout);
        frame.removeEventListener('load', loaded);
      };
      const loaded = (): void => {
        cleanup();
        if (generation !== this.displayGeneration) {
          reject(new Error('Chapter opening was superseded.'));
        } else resolve();
      };
      frame.addEventListener('load', loaded, { once: true });
      frame.srcdoc = markup;
    });
  }

  private attachFrameDocument(index: number): void {
    const document = this.frame?.contentDocument;
    if (!document) throw new Error('Chapter document is unavailable.');
    document.addEventListener('click', this.onChapterClick, true);
    document.defaultView?.addEventListener('scroll', this.onChapterScroll, { passive: true });
    document.defaultView?.addEventListener('resize', this.onChapterResize, { passive: true });
    this.layoutObserver = new ResizeObserver(this.onChapterResize);
    this.layoutObserver.observe(document.body);
    document.documentElement.dataset.novelReaperSpineIndex = String(index);
  }

  private detachFrameDocument(): void {
    const document = this.frame?.contentDocument;
    document?.removeEventListener('click', this.onChapterClick, true);
    document?.defaultView?.removeEventListener('scroll', this.onChapterScroll);
    document?.defaultView?.removeEventListener('resize', this.onChapterResize);
    this.layoutObserver?.disconnect();
    this.layoutObserver = undefined;
  }

  private readonly onChapterClick = (event: MouseEvent): void => {
    const target = event.target;
    const navigationButton = closestFrameElement<HTMLButtonElement>(
      target,
      'button[data-novelreaper-action]',
    );
    if (navigationButton) {
      event.preventDefault();
      if (navigationButton.disabled || this.navigationState.busy) return;
      const action = navigationButton.dataset.novelreaperAction;
      if (action === 'previous' || action === 'next' || action === 'finish') {
        this.emit({ type: 'navigation-request', request: { source: action } });
      }
      return;
    }
    const anchor = closestFrameElement<HTMLAnchorElement>(target, 'a[href]');
    if (!anchor) return;
    event.preventDefault();
    const href = anchor.getAttribute('href');
    if (!href || /^(?:https?:|mailto:|tel:|file:|javascript:|\/\/)/i.test(href)) return;
    const section =
      this.activeSectionIndex === undefined
        ? undefined
        : this.book?.sections[this.activeSectionIndex];
    const resolved = section?.resolveHref?.(href) ?? href;
    this.emit({
      type: 'navigation-request',
      request: { source: 'internal', target: resolved },
    });
  };

  private readonly onChapterScroll = (): void => {
    if (this.scrollFrame || this.activeSectionIndex === undefined) return;
    this.scrollFrame = requestAnimationFrame(() => {
      this.scrollFrame = 0;
      if (this.activeSectionIndex !== undefined) this.emitRelocation(this.activeSectionIndex);
    });
  };

  private readonly onChapterResize = (): void => {
    if (!this.lastLocation || this.lastLocation.spineIndex !== this.activeSectionIndex) return;
    if (this.resizeTimer) window.clearTimeout(this.resizeTimer);
    this.resizeTimer = window.setTimeout(() => {
      this.resizeTimer = 0;
      const location = this.lastLocation;
      if (!location || location.spineIndex !== this.activeSectionIndex) return;
      this.scrollToLocator(location);
      this.emitRelocation(location.spineIndex);
    }, 120);
  };

  private scrollToTarget(target?: ReaderNavigationTarget): void {
    const document = this.frame?.contentDocument;
    const view = document?.defaultView;
    if (!document || !view) return;
    const fragment = typeof target === 'string' ? target.split('#')[1] : undefined;
    if (fragment) document.getElementById(decodeURIComponent(fragment))?.scrollIntoView();
    else view.scrollTo({ top: 0, behavior: 'instant' });
  }

  private scrollToLocator(locator: ReaderLocator): void {
    const document = this.frame?.contentDocument;
    const view = document?.defaultView;
    const root = document?.scrollingElement;
    if (!document || !view || !root) return;
    if (locator.cfi && this.restoreCfi(document, locator.cfi)) return;
    if (locator.textQuote && this.restoreTextQuote(document, locator.textQuote)) return;
    const distance = Math.max(0, root.scrollHeight - root.clientHeight);
    view.scrollTo({
      top: Math.round(distance * Math.min(1, Math.max(0, locator.fractionInChapter))),
      behavior: 'instant',
    });
  }

  private restoreCfi(document: Document, cfi: string): boolean {
    try {
      const view = document.defaultView;
      if (!view) return false;
      const resolved = this.book?.resolveCFI?.(cfi);
      if (!resolved || resolved.index !== this.activeSectionIndex || !resolved.anchor) return false;
      const anchor = resolved.anchor(document);
      if (anchor instanceof view.Element) {
        anchor.scrollIntoView({ block: 'start', behavior: 'instant' });
        return true;
      }
      if (anchor instanceof view.Range) {
        const element =
          anchor.startContainer.nodeType === Node.ELEMENT_NODE
            ? (anchor.startContainer as Element)
            : anchor.startContainer.parentElement;
        element?.scrollIntoView({ block: 'start', behavior: 'instant' });
        return Boolean(element);
      }
      return false;
    } catch {
      return false;
    }
  }

  private restoreTextQuote(document: Document, textQuote: string): boolean {
    const quote = textQuote.replace(/\s+/g, ' ').trim();
    if (!quote) return false;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const normalized = node.textContent?.replace(/\s+/g, ' ').trim() ?? '';
      if (!normalized.includes(quote)) continue;
      node.parentElement?.scrollIntoView({ block: 'start', behavior: 'instant' });
      return true;
    }
    return false;
  }

  private captureTextQuote(document: Document): string | undefined {
    const view = document.defaultView;
    if (!view) return undefined;
    const caretDocument = document as Document & {
      caretPositionFromPoint?: (
        x: number,
        y: number,
      ) => { offsetNode: Node; offset: number } | null;
    };
    const position = caretDocument.caretPositionFromPoint?.(
      Math.max(8, view.innerWidth / 2),
      Math.max(24, view.innerHeight * 0.28),
    );
    if (position?.offsetNode.nodeType === Node.TEXT_NODE) {
      const text = position.offsetNode.textContent ?? '';
      const start = Math.max(0, position.offset - 60);
      const quote = text
        .slice(start, start + 180)
        .replace(/\s+/g, ' ')
        .trim();
      if (quote) return [...quote].slice(0, 180).join('');
    }

    const visible = [...document.body.querySelectorAll('p, li, blockquote, h1, h2, h3')].find(
      (element) => {
        const rect = element.getBoundingClientRect();
        return rect.bottom >= 0 && rect.top <= view.innerHeight;
      },
    );
    const quote = visible?.textContent?.replace(/\s+/g, ' ').trim();
    return quote ? [...quote].slice(0, 180).join('') : undefined;
  }

  private captureCfi(document: Document, index: number): string | undefined {
    const view = document.defaultView;
    const base = this.book?.sections[index]?.cfi;
    if (!view || !base) return undefined;
    const caretDocument = document as Document & {
      caretPositionFromPoint?: (
        x: number,
        y: number,
      ) => { offsetNode: Node; offset: number } | null;
    };
    const position = caretDocument.caretPositionFromPoint?.(
      Math.max(8, view.innerWidth / 2),
      Math.max(24, view.innerHeight * 0.28),
    );
    if (!position?.offsetNode) return base;
    try {
      const range = document.createRange();
      const maximum = position.offsetNode.textContent?.length ?? 0;
      range.setStart(position.offsetNode, Math.min(maximum, Math.max(0, position.offset)));
      range.collapse(true);
      return CFI.joinIndir(base, CFI.fromRange(range));
    } catch {
      return base;
    }
  }

  private settleFrameLayout(): Promise<void> {
    const view = this.frame?.contentWindow;
    if (!view) return Promise.resolve();
    return new Promise((resolve) => {
      view.requestAnimationFrame(() => view.requestAnimationFrame(() => resolve()));
    });
  }

  private installChapterNavigation(): void {
    const document = this.frame?.contentDocument;
    const publication = this.publication;
    const activeIndex = this.activeSectionIndex;
    if (!document?.body || !publication || activeIndex === undefined) return;
    document.querySelector('.novelreaper-chapter-navigation')?.remove();

    const position = publication.linearSpineIndices.indexOf(activeIndex);
    if (position < 0) return;
    const footer = document.createElement('nav');
    footer.className = 'novelreaper-chapter-navigation';
    footer.setAttribute('aria-label', 'Chapter navigation');

    const previous = document.createElement('button');
    previous.type = 'button';
    previous.dataset.novelreaperAction = 'previous';
    previous.textContent = '< Previous Chapter';
    previous.disabled = this.navigationState.busy || position === 0;

    const next = document.createElement('button');
    next.type = 'button';
    const isFinal = position === publication.linearSpineIndices.length - 1;
    next.dataset.novelreaperAction = isFinal ? 'finish' : 'next';
    next.textContent = isFinal
      ? this.navigationState.finished
        ? 'Book Finished'
        : 'Finish Book'
      : 'Next Chapter >';
    next.disabled = this.navigationState.busy || (isFinal && this.navigationState.finished);

    footer.append(previous, next);
    document.body.append(footer);
  }

  private emitRelocation(index: number): void {
    const document = this.frame?.contentDocument;
    const root = document?.scrollingElement;
    if (!root || !this.publication) return;
    const distance = Math.max(0, root.scrollHeight - root.clientHeight);
    const fraction = distance === 0 ? 1 : Math.min(1, Math.max(0, root.scrollTop / distance));
    const currentTocId = activeTocId(this.publication.toc, index);
    const chapterLabel = boundedLabel(
      this.publication.toc.find((item) => item.id === currentTocId)?.label,
    );
    const textQuote = this.captureTextQuote(document);
    const cfi = this.captureCfi(document, index);
    const location: ReaderRelocation = {
      spineIndex: index,
      href: this.book?.sections[index]?.id ?? `spine:${index}`,
      fractionInChapter: fraction,
      ...(cfi ? { cfi } : {}),
      ...(textQuote ? { textQuote } : {}),
      ...(chapterLabel ? { chapterLabel } : {}),
      ...(currentTocId ? { activeTocId: currentTocId } : {}),
    };
    this.lastLocation = location;
    this.emit({ type: 'relocation', location });
  }

  private emit(event: ReaderEngineEvent): void {
    this.listeners.forEach((listener) => listener(event));
  }

  private async createCoverUrl(book: FoliateBook): Promise<string | undefined> {
    if (!book.getCover) return undefined;
    try {
      const cover = await book.getCover();
      if (
        !cover ||
        cover.size > 8 * 1024 * 1024 ||
        !/^image\/(?:avif|gif|jpeg|png|webp)$/i.test(cover.type)
      ) {
        return undefined;
      }
      this.coverUrl = URL.createObjectURL(cover);
      return this.coverUrl;
    } catch {
      return undefined;
    }
  }
}

export const createFoliateReaderEngine: ReaderEngineFactory = () => new FoliateReaderEngine();
