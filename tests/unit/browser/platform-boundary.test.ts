// @vitest-environment node

import { readFileSync, readdirSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return ['.ts', '.tsx'].includes(extname(entry.name)) ? [path] : [];
  });
}

describe('shared renderer platform boundary', () => {
  it('does not import Electron or reach for preload globals', () => {
    const sharedRendererRoots = [
      resolve(process.cwd(), 'src/renderer/app'),
      resolve(process.cwd(), 'src/renderer/render-app.tsx'),
    ];
    const rendererSource = sharedRendererRoots
      .flatMap((path) => (extname(path) ? [path] : sourceFiles(path)))
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n');

    expect(rendererSource).not.toMatch(/from\s+['"]electron['"]/);
    expect(rendererSource).not.toContain('window.novelReaperShell');
    expect(rendererSource).not.toContain('window.novelReaperReader');
  });
});
