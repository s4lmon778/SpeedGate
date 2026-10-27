import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

test('sender retains repeated same-name same-size selections', async ({
  page,
}, testInfo) => {
  await page.goto('./');
  const original = {
    name: 'IMG_0001.JPG',
    mimeType: 'image/jpeg',
    buffer: Buffer.from('original'),
  };
  await page
    .getByLabel('Choose files', { exact: true })
    .setInputFiles([original, original, original]);
  await expect(page.getByText(original.name, { exact: true })).toHaveCount(3);
  await page
    .getByLabel('Choose files', { exact: true })
    .setInputFiles(original);
  await expect(page.getByText(original.name, { exact: true })).toHaveCount(4);
  await page.evaluate(() => {
    document.addEventListener(
      'change',
      () => {
        performance.mark('picker-returned');
        const observer = new MutationObserver(() => {
          if (
            !document
              .querySelector('.file-selection-bar')
              ?.textContent?.includes('504')
          )
            return;
          performance.measure('selection-ready', 'picker-returned');
          observer.disconnect();
        });
        observer.observe(document.body, {
          childList: true,
          subtree: true,
          characterData: true,
        });
      },
      { capture: true, once: true },
    );
  });
  await page
    .getByLabel('Choose files', { exact: true })
    .setInputFiles(Array.from({ length: 500 }, () => original));
  await expect(page.locator('.file-selection-bar')).toContainText(
    '504 selected to send',
  );
  await expect(
    page.getByRole('region', { name: 'Files to send' }).locator('.file-row'),
  ).toHaveCount(50);
  const measurements = await page.evaluate(() =>
    performance
      .getEntriesByName('selection-ready')
      .map((entry) => entry.duration),
  );
  expect(measurements).toHaveLength(1);
  await testInfo.attach('500-file-selection-ready.json', {
    body: JSON.stringify({
      milliseconds: measurements[0],
      scope:
        'synthetic desktop browser after picker returns; excludes native picker and phone performance',
    }),
    contentType: 'application/json',
  });
});

test('504 repeated photo/video names download separately across batches and reloads', async ({
  page,
  browserName,
}) => {
  test.setTimeout(180000);
  test.skip(
    browserName === 'webkit',
    'Nonpersistent WebKit cannot retain the Blob staging fixture.',
  );
  await page.setViewportSize({ width: 360, height: 740 });
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'share', {
      configurable: true,
      value: undefined,
    });
  });
  await page.goto('./');
  await expect(
    page.getByRole('button', { name: 'Receive files', exact: true }),
  ).toBeVisible();
  await page.evaluate(async () => {
    const connect = (name: string, version: number) =>
      new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(name, version);
        request.onupgradeneeded = () => {
          request.result.createObjectStore('files', { keyPath: 'id' });
          request.result.createObjectStore('chunks', {
            keyPath: ['fileId', 'offset'],
          });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    const sources = await Promise.all(
      Array.from({ length: 7 }, async (_, i) => {
        const bytes = new TextEncoder().encode(`Untouched original group ${i}`);
        const sha256 = Array.from(
          new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
          (byte) => byte.toString(16).padStart(2, '0'),
        ).join('');
        return { bytes, sha256 };
      }),
    );
    const records = Array.from({ length: 504 }, (_, i) => ({
      id: (i + 1).toString(16).padStart(64, '0'),
      sessionId: '504-copies',
      relativePath: i % 2 ? 'IMG_0001.JPG' : 'IMG_0001.MOV',
      originalName: i % 2 ? 'IMG_0001.JPG' : 'IMG_0001.MOV',
      size: sources[i % 7].bytes.length,
      sha256: sources[i % 7].sha256,
      mimeType: i % 2 ? 'image/jpeg' : 'video/quicktime',
      modified: 1000,
      bytes: sources[i % 7].bytes.length,
      phase: 'verified',
      scope: 'browser',
      updated: 1000 + i,
      localRole: 'receive',
    }));
    const db = await connect('pixelbridge-v1', 3);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['files', 'history'], 'readwrite');
      for (const record of records) {
        tx.objectStore('files').put(record);
        tx.objectStore('history').put({
          ...record,
          historyKey: `receive:504-copies:${record.id}`,
        });
      }
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    });
    db.close();
    const staging = await connect('pixelgate-staging-v1', 1);
    await new Promise<void>((resolve, reject) => {
      const tx = staging.transaction(['files', 'chunks'], 'readwrite');
      for (let i = 0; i < records.length; i++) {
        tx.objectStore('files').put({
          id: records[i].id,
          size: records[i].size,
        });
        tx.objectStore('chunks').put({
          fileId: records[i].id,
          offset: 0,
          bytes: new Blob([sources[i % 7].bytes]),
        });
      }
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    });
    staging.close();
  });
  await page.reload();
  await page
    .getByRole('button', { name: 'Receive files', exact: true })
    .click();
  const saves = page.getByRole('region', {
    name: 'Save received files',
    exact: true,
  });
  await expect(saves).toContainText('504 selected');
  await saves
    .getByRole('button', { name: 'Prepare selected files', exact: true })
    .click();
  await expect(
    saves.getByRole('button', {
      name: 'Download all 504 selected',
      exact: true,
    }),
  ).toBeEnabled();
  const downloads: { name: string; bytes: Promise<Buffer> }[] = [];
  page.on('download', (download) =>
    downloads.push({
      name: download.suggestedFilename(),
      bytes: download.path().then((path) => readFile(path!)),
    }),
  );
  await saves
    .getByRole('button', { name: 'Download all 504 selected', exact: true })
    .click();
  await expect(saves.locator('.file-selection-bar')).toContainText(
    '0 selected',
    { timeout: 150000 },
  );
  await expect.poll(() => downloads.length).toBe(504);
  expect(new Set(downloads.map((d) => d.name)).size).toBe(504);
  expect(downloads.filter((d) => d.name.endsWith('.JPG'))).toHaveLength(252);
  expect(downloads.filter((d) => d.name.endsWith('.MOV'))).toHaveLength(252);
  const observed = new Map<string, number>();
  for (const download of downloads) {
    expect(download.name).toMatch(
      /^IMG_0001 - SpeedGate [a-f0-9-]{36}\.(JPG|MOV)$/,
    );
    const hash = createHash('sha256')
      .update(await download.bytes)
      .digest('hex');
    observed.set(hash, (observed.get(hash) ?? 0) + 1);
  }
  for (let i = 0; i < 7; i++)
    expect(
      observed.get(
        createHash('sha256')
          .update(`Untouched original group ${i}`)
          .digest('hex'),
      ),
    ).toBe(72);
  const retained = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open('pixelbridge-v1', 3);
      request.onsuccess = () => resolve(request.result);
    });
    const records = await new Promise<
      {
        downloaded?: boolean;
        stagingCleared?: boolean;
        scope: string;
        saveName?: string;
      }[]
    >((resolve) => {
      const request = db.transaction('files').objectStore('files').getAll();
      request.onsuccess = () => resolve(request.result);
    });
    db.close();
    return records;
  });
  expect(retained).toHaveLength(504);
  expect(
    retained.every(
      (r) => r.downloaded && !r.stagingCleared && r.scope === 'browser',
    ),
  ).toBe(true);
  expect(new Set(retained.map((r) => r.saveName)).size).toBe(504);
  // Retrying a saved original after reload produces a new name and keeps bytes.
  await page.reload();
  await page
    .getByRole('button', { name: 'Receive files', exact: true })
    .click();
  await saves.getByRole('checkbox').first().check();
  await saves
    .getByRole('button', { name: 'Prepare selected files', exact: true })
    .click();
  await saves
    .getByRole('button', { name: 'Download verified files', exact: true })
    .click();
  await expect.poll(() => downloads.length).toBe(505);
  expect(new Set(downloads.map((d) => d.name)).size).toBe(505);
  expect(
    observed.has(
      createHash('sha256')
        .update(await downloads[504].bytes)
        .digest('hex'),
    ),
  ).toBe(true);
});
