import type { FoliateBook } from 'foliate-js/view.js';

import {
  ReaderEngineError,
  type ReaderEngine,
  type ReaderEngineEvent,
  type ReaderEngineFactory,
  type ReaderNavigationTarget,
  type ReaderPublication,
  type ReaderRelocation,
} from './contracts';
import { activeTocId, metadataFromBook, tocFromBook } from './publication-model';
import { installStrictPublicationPolicy, sanitizeStrictMarkup } from './strict-policy';

const CHAPTER_LOAD_TIMEOUT_MS = 15_000;
const READING_STYLE = `
  :root { color-scheme: light; background: #fffdf7; }
  html { min-height: 100%; background: #fffdf7 !important; scroll-behavior: smooth; }
  body {
    max-width: 46rem !important;
    min-height: 100%;
    margin: 0 auto !important;
    padding: 4.5rem clamp(1.4rem, 5vw, 4rem) 6rem !important;
    color: #26302f !important;
    background: #fffdf7 !important;
    font-family: Literata, Georgia, serif !important;
    font-size: 20px !important;
    line-height: 1.72 !important;
  }
  h1, h2, h3, h4 { color: #1f2826 !important; line-height: 1.25 !important; }
  p { margin-block: 0 1.35em; }
  img, svg, video { max-width: 100% !important; height: auto !important; }
`;

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
  private displayGeneration = 0;
  private scrollFrame = 0;

  public subscribe(listener: (event: ReaderEngineEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public async open(source: File, container: HTMLElement): Promise<ReaderPublication> {
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
      this.publication = { metadata, toc, spineLength: book.sections.length };

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
      await this.displaySection(firstLinear);
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

  public async goTo(target: ReaderNavigationTarget): Promise<void> {
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
      if (index !== this.activeSectionIndex) await this.displaySection(index, target);
      else this.scrollToTarget(target);
    } catch {
      throw new ReaderEngineError(
        'NAVIGATION_FAILED',
        'That chapter could not be opened. The current chapter is still available.',
      );
    }
  }

  public destroy(): void {
    this.displayGeneration += 1;
    if (this.scrollFrame) cancelAnimationFrame(this.scrollFrame);
    this.scrollFrame = 0;
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
  }

  private async displaySection(index: number, target?: ReaderNavigationTarget): Promise<void> {
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
        READING_STYLE,
      );
      await this.loadFrameMarkup(frame, markup, generation);
      if (generation !== this.displayGeneration) return;

      const previousIndex = this.activeSectionIndex;
      this.activeSectionIndex = index;
      if (previousIndex !== undefined && previousIndex !== index)
        book.sections[previousIndex]?.unload();
      this.attachFrameDocument(index);
      this.scrollToTarget(target);
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
    document.documentElement.dataset.novelReaperSpineIndex = String(index);
  }

  private detachFrameDocument(): void {
    const document = this.frame?.contentDocument;
    document?.removeEventListener('click', this.onChapterClick, true);
    document?.defaultView?.removeEventListener('scroll', this.onChapterScroll);
  }

  private readonly onChapterClick = (event: MouseEvent): void => {
    const target = event.target;
    const anchor = target instanceof Element ? target.closest('a[href]') : null;
    if (!anchor) return;
    event.preventDefault();
    const href = anchor.getAttribute('href');
    if (!href || /^(?:https?:|mailto:|tel:|file:|javascript:|\/\/)/i.test(href)) return;
    const section =
      this.activeSectionIndex === undefined
        ? undefined
        : this.book?.sections[this.activeSectionIndex];
    const resolved = section?.resolveHref?.(href) ?? href;
    void this.goTo(resolved).catch(() => {
      this.emit({
        type: 'error',
        message: 'That internal book link could not be opened.',
        recoverable: true,
      });
    });
  };

  private readonly onChapterScroll = (): void => {
    if (this.scrollFrame || this.activeSectionIndex === undefined) return;
    this.scrollFrame = requestAnimationFrame(() => {
      this.scrollFrame = 0;
      if (this.activeSectionIndex !== undefined) this.emitRelocation(this.activeSectionIndex);
    });
  };

  private scrollToTarget(target?: ReaderNavigationTarget): void {
    const document = this.frame?.contentDocument;
    const view = document?.defaultView;
    if (!document || !view) return;
    const fragment = typeof target === 'string' ? target.split('#')[1] : undefined;
    if (fragment) document.getElementById(decodeURIComponent(fragment))?.scrollIntoView();
    else view.scrollTo({ top: 0, behavior: 'instant' });
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
    const location: ReaderRelocation = {
      spineIndex: index,
      fractionInChapter: fraction,
      ...(chapterLabel ? { chapterLabel } : {}),
      ...(currentTocId ? { activeTocId: currentTocId } : {}),
    };
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
