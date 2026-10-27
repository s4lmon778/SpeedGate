import { describe, expect, it, vi } from 'vitest';
import { selected } from '../lib/bridge/selection';

describe('mobile picker selection', () => {
  it('queues 500 originals without reading payloads, size or modification dates', () => {
    const original = new File(['original'], 'IMG_0001.JPG');
    for (const property of ['size', 'lastModified'])
      Object.defineProperty(original, property, {
        get: () => {
          throw new Error(`Premature ${property} read`);
        },
      });
    const read = vi.spyOn(original, 'arrayBuffer');
    const slice = vi.spyOn(original, 'slice');
    const uuid = vi.spyOn(crypto, 'randomUUID');
    try {
      const first = selected(Array.from({ length: 500 }, () => original));
      expect(first).toHaveLength(500);
      expect(new Set(first.map((q) => q.key)).size).toBe(500);
      expect(
        first.every(
          (q) =>
            q.file === original &&
            q.path === original.name &&
            q.phase === 'pending',
        ),
      ).toBe(true);
      expect(uuid).toHaveBeenCalledTimes(1);
      expect(read).not.toHaveBeenCalled();
      expect(slice).not.toHaveBeenCalled();
      const second = selected([original]);
      expect(first.some((q) => q.key === second[0].key)).toBe(false);
    } finally {
      vi.restoreAllMocks();
    }
  });
  it('validates paths while preserving folder entries and repeated selections', () => {
    const original = new File(['original'], 'IMG.JPG');
    Object.defineProperty(original, 'webkitRelativePath', {
      value: '旅行/IMG.JPG',
    });
    expect(selected([original, original]).map((q) => q.path)).toEqual([
      '旅行/IMG.JPG',
      '旅行/IMG.JPG',
    ]);
    expect(() => selected([new File(['original'], '../unsafe.JPG')])).toThrow(
      'Unsafe',
    );
  });
});
