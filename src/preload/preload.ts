import { contextBridge, ipcRenderer } from 'electron';

// Narrow, typed bridge. Agent adapters will be exposed here later (list/start/send/stop/events).
contextBridge.exposeInMainWorld('agentDurbar', {
  version: (): Promise<string> => ipcRenderer.invoke('app:version'),
});
