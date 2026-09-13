import { PlatformOperationError, type PublicationDescriptor } from './contracts';

export const MAX_CUSTOM_TITLE_LENGTH = 300;

export function validateCustomTitle(value: string): string {
  const title = value.trim();
  if (!title || title.length > MAX_CUSTOM_TITLE_LENGTH) {
    throw new PlatformOperationError(
      'INVALID_TITLE',
      'Enter a title between 1 and 300 characters.',
    );
  }
  return title;
}

export function publicationTitle(publication: PublicationDescriptor): string {
  return (
    publication.customTitle ?? publication.title ?? publication.displayName.replace(/\.epub$/i, '')
  );
}
