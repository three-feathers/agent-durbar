/*
 * Spec 096 FR-022, FR-024..FR-026: runs only in the hidden, sandboxed encoder window (src/main/charencoder.ts), one job per window. Decodes the bytes
 * of one sheet, checks the decoded size against the header, slices the 2x2 panels, keys out a flat background, checks each panel, resizes to 352x352,
 * encodes WebP and finds the face points. It answers over its MessagePort with the frames and points, or a refusal code; main checks that reply again.
 * The pixel rules below are pure, so `test:charencoder` runs them in Node.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.DurbarCharEncoder = api; api.listen(root); }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const FRAME = 352, MAX_FRAME_BYTES = 40 * 1024;
  const QUALITIES = [0.82, 0.78, 0.74, 0.70]; // FR-022, *Edge cases*: 82 down to 70 in steps of 4
  const CLEAR_ALPHA = 16; // at or below this a pixel counts as transparent
  const SOLID_ALPHA = 128; // at or above this a pixel counts as figure
  const SHEET_TRANSPARENT = 0.05, BORDER_DISTANCE = 18, GUTTER = 0.02, GUTTER_CLEAR = 0.9, MIN_FIGURE = 0.15, MAX_FIGURE = 0.85;
  const FACE_CROP = 235, DEFAULT_FACE = [176, 150];

  /** FR-024: more than 5% of the sheet's pixels are already transparent, so nothing is keyed out. */
  function sheetHasTransparency(rgba) {
    const n = rgba.length / 4, limit = n * SHEET_TRANSPARENT;
    let clear = 0;
    for (let i = 3; i < rgba.length; i += 4) if (rgba[i] <= CLEAR_ALPHA && ++clear > limit) return true;
    return false;
  }

  const median = (vals) => { const v = vals.slice().sort((a, b) => a - b); return v[v.length >> 1]; };

  /**
   * FR-024: keys out one panel (w x h RGBA, changed in place) when its border pixels are all within a colour distance of 18 of their median: a flood
   * fill from the border clears that colour, then a 2-pixel soft edge. Returns false, leaving the pixels alone, when the border is not that even.
   */
  function keyOutPanel(rgba, w, h) {
    const border = [];
    for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x);
    for (let y = 1; y < h - 1; y++) border.push(y * w, y * w + w - 1);
    const pick = (ch) => median(border.map((p) => rgba[p * 4 + ch]));
    const r0 = pick(0), g0 = pick(1), b0 = pick(2);
    const LIMIT = BORDER_DISTANCE * BORDER_DISTANCE;
    const near = (p) => { const o = p * 4, r = rgba[o] - r0, g = rgba[o + 1] - g0, b = rgba[o + 2] - b0; return r * r + g * g + b * b <= LIMIT; };
    for (const p of border) if (!near(p)) return false;
    // 0 = figure, 1 = cleared; then rings 2 and 3 are the soft edge
    const mark = new Uint8Array(w * h), stack = new Int32Array(w * h);
    let top = 0;
    for (const p of border) if (!mark[p]) { mark[p] = 1; stack[top++] = p; }
    while (top) {
      const p = stack[--top], x = p % w;
      const visit = (q) => { if (!mark[q] && near(q)) { mark[q] = 1; stack[top++] = q; } };
      if (x > 0) visit(p - 1);
      if (x < w - 1) visit(p + 1);
      if (p >= w) visit(p - w);
      if (p < w * (h - 1)) visit(p + w);
    }
    for (let ring = 2; ring <= 3; ring++) {
      for (let p = 0; p < mark.length; p++) {
        if (mark[p]) continue;
        const x = p % w;
        if ((x > 0 && mark[p - 1] === ring - 1) || (x < w - 1 && mark[p + 1] === ring - 1) || (p >= w && mark[p - w] === ring - 1) || (p < w * (h - 1) && mark[p + w] === ring - 1)) mark[p] = ring;
      }
    }
    for (let p = 0; p < mark.length; p++) {
      const a = p * 4 + 3;
      if (mark[p] === 1) rgba[a] = 0;
      else if (mark[p] === 2) rgba[a] = Math.round(rgba[a] / 3);
      else if (mark[p] === 3) rgba[a] = Math.round(rgba[a] * 2 / 3);
    }
    return true;
  }

  /** FR-026: the figure covers 15-85% of the panel, and the outer 2% is at least 90% transparent. */
  function panelSane(rgba, w, h) {
    const band = Math.max(1, Math.ceil(Math.min(w, h) * GUTTER));
    let solid = 0, edge = 0, edgeClear = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const a = rgba[(y * w + x) * 4 + 3];
        if (a >= SOLID_ALPHA) solid++;
        if (x < band || y < band || x >= w - band || y >= h - band) { edge++; if (a <= CLEAR_ALPHA) edgeClear++; }
      }
    }
    const cover = solid / (w * h);
    return cover >= MIN_FIGURE && cover <= MAX_FIGURE && edgeClear / edge >= GUTTER_CLEAR;
  }

  /** FR-025: the top of the figure and the horizontal centre of its upper third, clamped so the 235-px crop stays inside; no figure: the default. */
  function facePoint(rgba, w, h) {
    let top = -1, bottom = -1;
    for (let y = 0; y < h && top < 0; y++) for (let x = 0; x < w; x++) if (rgba[(y * w + x) * 4 + 3] >= SOLID_ALPHA) { top = y; break; }
    if (top < 0) return DEFAULT_FACE.slice();
    for (let y = h - 1; y >= top && bottom < 0; y--) for (let x = 0; x < w; x++) if (rgba[(y * w + x) * 4 + 3] >= SOLID_ALPHA) { bottom = y; break; }
    const third = Math.max(1, Math.round((bottom - top + 1) / 3));
    let sum = 0, n = 0;
    for (let y = top; y < top + third; y++) for (let x = 0; x < w; x++) if (rgba[(y * w + x) * 4 + 3] >= SOLID_ALPHA) { sum += x; n++; }
    const min = Math.ceil(FACE_CROP / 2), max = w - min;
    const clamp = (v) => Math.min(max, Math.max(min, Math.round(v)));
    return [clamp(sum / n), clamp(top + third / 2)];
  }

  /** The panels' origins and side for a sheet; null when it is not square (a stretched face is never kept; spec `## Changes`, 2026-10-31). */
  function panelsOf(width, height) {
    if (width !== height) return null;
    const s = Math.floor(width / 2);
    return { side: s, origins: [[0, 0], [s, 0], [0, s], [s, s]] };
  }

  async function encodeSheet(bytes, want) {
    let bmp;
    try {
      bmp = await createImageBitmap(new Blob([bytes]), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    } catch (e) { return { ok: false, code: 'decode' }; }
    if (bmp.width !== want.width || bmp.height !== want.height) return { ok: false, code: 'size' };
    const panels = panelsOf(bmp.width, bmp.height);
    if (!panels) return { ok: false, code: 'separate' };
    const sheet = new OffscreenCanvas(bmp.width, bmp.height), gs = sheet.getContext('2d', { willReadFrequently: true });
    gs.drawImage(bmp, 0, 0);
    bmp.close();
    const keep = sheetHasTransparency(gs.getImageData(0, 0, sheet.width, sheet.height).data);
    const s = panels.side, frames = [], face = [];
    for (const [ox, oy] of panels.origins) {
      const img = gs.getImageData(ox, oy, s, s);
      // FR-024 asks to keep a background it cannot remove, FR-023 and FR-026 refuse such a frame: it fails closed (coordinator's choice of 2026-10-31)
      if (!keep && !keyOutPanel(img.data, s, s)) return { ok: false, code: 'background' };
      if (!panelSane(img.data, s, s)) return { ok: false, code: 'separate' };
      const panel = new OffscreenCanvas(s, s);
      panel.getContext('2d').putImageData(img, 0, 0);
      const out = new OffscreenCanvas(FRAME, FRAME), go = out.getContext('2d', { willReadFrequently: true });
      go.imageSmoothingEnabled = true;
      go.imageSmoothingQuality = 'high';
      go.drawImage(panel, 0, 0, FRAME, FRAME);
      face.push(facePoint(go.getImageData(0, 0, FRAME, FRAME).data, FRAME, FRAME));
      let done = null;
      for (const quality of QUALITIES) {
        const blob = await out.convertToBlob({ type: 'image/webp', quality });
        if (blob.type !== 'image/webp') return { ok: false, code: 'decode' };
        if (blob.size <= MAX_FRAME_BYTES) { done = new Uint8Array(await blob.arrayBuffer()); break; }
      }
      if (!done) return { ok: false, code: 'big' };
      frames.push(done);
    }
    return { ok: true, frames, face };
  }

  /** Main hands over one MessagePort (through the sandboxed preload); one sheet comes in on it, one answer goes out, and the window is then destroyed. */
  function listen(w) {
    const onPort = (ev) => {
      if (ev.data !== 'charencoder:port' || !ev.ports || !ev.ports[0]) return;
      w.removeEventListener('message', onPort);
      const port = ev.ports[0];
      port.onmessage = (m) => {
        port.onmessage = null;
        const d = m.data || {};
        encodeSheet(d.bytes, { width: d.width, height: d.height }).catch(() => ({ ok: false, code: 'decode' })).then((r) => port.postMessage(r));
      };
    };
    w.addEventListener('message', onPort);
  }

  return { sheetHasTransparency, keyOutPanel, panelSane, facePoint, panelsOf, listen };
}));
