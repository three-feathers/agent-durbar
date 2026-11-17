/**
 * Spec 096 FR-022: the encoder window's preload. Sandboxed (no Node); it only hands the MessagePort main sends to the page and exposes nothing:
 * no `contextBridge`, no channel back to main. The page answers over that port and has no other way out.
 */
import { ipcRenderer } from 'electron';

ipcRenderer.on('charencoder:port', (e) => {
  window.postMessage('charencoder:port', '*', e.ports as unknown as MessagePort[]);
});
