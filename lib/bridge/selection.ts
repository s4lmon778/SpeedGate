import { safePath, type QueuedFile } from './model';
function entry(file: File, path?: string): QueuedFile {
  return {
    key: crypto.randomUUID(),
    file,
    path: safePath(path || file.webkitRelativePath || file.name),
    phase: 'pending',
  };
}
export function selected(files: FileList | File[]) {
  // One random namespace per picker result; every entry still has its own key.
  // Keep this path metadata-only: no byte reads, hashing or lastModified probes
  // before Send. Large mobile selections should become usable immediately.
  const batch = crypto.randomUUID();
  const paths = new Map<string, string>();
  const result: QueuedFile[] = [];
  for (const file of files) {
    const sourcePath = file.webkitRelativePath || file.name;
    let path = paths.get(sourcePath);
    if (path === undefined) {
      path = safePath(sourcePath);
      paths.set(sourcePath, path);
    }
    result.push({
      key: `${batch}-${result.length}`,
      file,
      path,
      phase: 'pending',
    });
  }
  return result;
}
interface LegacyEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file(callback: (f: File) => void, error: (e: Error) => void): void;
  createReader(): {
    readEntries(
      callback: (entries: LegacyEntry[]) => void,
      error: (e: Error) => void,
    ): void;
  };
}
export async function dropped(
  items: DataTransferItemList,
): Promise<QueuedFile[]> {
  const roots = Array.from(items)
    .filter((i) => i.kind === 'file')
    .map((i) => ({
      entry: i.webkitGetAsEntry() as unknown as LegacyEntry | null,
      file: i.getAsFile(),
    }));
  const result: QueuedFile[] = [];
  async function walk(e: LegacyEntry, prefix: string) {
    const path = safePath(prefix + e.name);
    if (e.isFile) {
      const f = await new Promise<File>((resolve, reject) =>
        e.file(resolve, reject),
      );
      result.push(entry(f, path));
    } else if (e.isDirectory) {
      const reader = e.createReader();
      while (true) {
        const entries = await new Promise<LegacyEntry[]>((resolve, reject) =>
          reader.readEntries(resolve, reject),
        );
        if (!entries.length) break;
        for (const child of entries) await walk(child, `${path}/`);
      }
    }
  }
  for (const root of roots) {
    if (root.entry) await walk(root.entry, '');
    else if (root.file) result.push(entry(root.file));
  }
  return result;
}
