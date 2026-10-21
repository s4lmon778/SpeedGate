import { rmSync } from 'node:fs';

// Resolve from this script so cleanup always stays inside the project.
for (const path of [
  'dist',
  'test-results',
  'playwright-report',
  'coverage',
  '.codegraph',
  '.cache',
  '.vite',
]) {
  rmSync(new URL(`../${path}`, import.meta.url), {
    recursive: true,
    force: true,
  });
}
