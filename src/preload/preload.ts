import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
// Type-only imports: a sandboxed preload cannot require local modules.
import type { DurbarApi } from '../shared/api';

const sub = <T>(channel: string, cb: (v: T) => void): (() => void) => {
  const h = (_e: IpcRendererEvent, v: T) => cb(v);
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
};

// Narrow, typed bridge. The renderer never gets raw ipcRenderer or Node.
const api: DurbarApi = {
  version: () => ipcRenderer.invoke('app:version'),
  addFolder: (permMode) => ipcRenderer.invoke('agents:addFolder', permMode),
  addWorkspaceFile: (permMode) => ipcRenderer.invoke('agents:addWorkspaceFile', permMode),
  listAgents: () => ipcRenderer.invoke('agents:list'),
  pickAttachments: () => ipcRenderer.invoke('agents:pickAttachments'),
  send: (id, text, attachments) => ipcRenderer.invoke('agents:send', id, text, attachments),
  stop: (id) => ipcRenderer.invoke('agents:stop', id),
  resolvePermission: (id, requestId, approve, remember) => ipcRenderer.invoke('agents:resolvePermission', id, requestId, approve, remember),
  revokeGrant: (id, key) => ipcRenderer.invoke('agents:revokeGrant', id, key),
  openInVSCode: (id) => ipcRenderer.invoke('agents:openInVSCode', id),
  onEvent: (cb) => sub('agent:event', cb),
  onAgentAdded: (cb) => sub('agent:added', cb),
};
contextBridge.exposeInMainWorld('agentDurbar', api);
