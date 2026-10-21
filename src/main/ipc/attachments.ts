/** IPC for attachments: the native picker and pasted / dropped files (spec 004; moved out of main.ts as it was, spec 045 FR-060). */
import { dialog } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { ipcHandle } from '../ipcguard';
import { kindOfFile, stageAttachment } from '../../shared/attachments';
import type { PickedFile } from '../../shared/api';
import type { DevEnv } from '../devhooks';

export interface AttachmentsIpcDeps {
  dev: DevEnv;
  /** Files the user picked through the native dialog; only these can be attached. */
  pickedFiles: Set<string>;
  /** Private folder for pasted / dropped files (removed on quit). */
  getStageDir(): string;
  sizeOf(p: string): number | undefined;
}

export function register(deps: AttachmentsIpcDeps): void {
  const { dev, pickedFiles, getStageDir, sizeOf } = deps;
  ipcHandle('agents:pickAttachments', async (_e, want: unknown): Promise<PickedFile[]> => {
    const images = want === 'image'; // spec 004 FR-013: the image button opens the picker with an image filter
    // Dev/test hook: DURBAR_PICK="/a.txt:/b.png" answers the picker without a native dialog.
    const preset = (dev.DURBAR_PICK ?? '').split(path.delimiter).filter((p) => p && fs.existsSync(p));
    let paths: string[] = preset;
    if (!preset.length) {
      const r = await dialog.showOpenDialog({
        title: images ? 'Attach images' : 'Attach files or images',
        properties: ['openFile', 'multiSelections'],
        ...(images ? { filters: [{ name: 'Images (PNG, JPEG, GIF, WebP, BMP)', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }] } : {}),
      });
      if (r.canceled) return [];
      paths = r.filePaths;
    }
    const out: PickedFile[] = [];
    for (const p of paths) {
      const size = sizeOf(p);
      if (!size) continue; // spec 004 FR-012: empty (or unreadable) files are not attached
      pickedFiles.add(p);
      out.push({ path: p, name: path.basename(p), kind: kindOfFile(p), size }); // FR-009: the bytes decide, not the extension
    }
    return out;
  });

  ipcHandle('agents:stageAttachment', (_e, name: unknown, mime: unknown, data: unknown) => {
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : undefined;
    if (!bytes) return { ok: false, error: 'No file data.' };
    try {
      const r = stageAttachment(getStageDir(), String(name ?? ''), String(mime ?? ''), bytes);
      if (!r.ok) return r;
      pickedFiles.add(r.path);
      return { ok: true, file: { path: r.path, name: r.name, kind: r.kind, size: r.size } };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}
