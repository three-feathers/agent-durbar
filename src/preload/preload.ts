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
  addFolder: (permMode, opts) => ipcRenderer.invoke('agents:addFolder', permMode, opts),
  addWorkspaceFile: (permMode, opts) => ipcRenderer.invoke('agents:addWorkspaceFile', permMode, opts),
  newSession: (id, opts) => ipcRenderer.invoke('agents:newSession', id, opts),
  listModels: () => ipcRenderer.invoke('models:list'),
  end: (id) => ipcRenderer.invoke('agents:end', id),
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
  setPermMode: (id, mode, opts) => ipcRenderer.invoke('agents:setMode', id, mode, opts),
  setRoomClosed: (id, closed) => ipcRenderer.invoke('folders:setClosed', id, closed),
  setFolderHidden: (id, hidden) => ipcRenderer.invoke('folders:setHidden', id, hidden),
  removeFolder: (id) => ipcRenderer.invoke('folders:remove', id),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setDefaultCap: (credits) => ipcRenderer.invoke('settings:setDefaultCap', credits),
  setPlace: (server, place) => ipcRenderer.invoke('settings:setPlace', server, place),
  setCap: (id, credits) => ipcRenderer.invoke('agents:setCap', id, credits),
  resolveLimit: (id, requestId, choice) => ipcRenderer.invoke('agents:resolveLimit', id, requestId, choice),
  usageAllTime: () => ipcRenderer.invoke('usage:allTime'),
  usageReset: () => ipcRenderer.invoke('usage:reset'),
  mcpState: () => ipcRenderer.invoke('mcp:state'),
  mcpSetCli: (name, enabled) => ipcRenderer.invoke('mcp:setCli', name, enabled),
  mcpFolderState: (key) => ipcRenderer.invoke('mcp:folderState', key),
  mcpUpsert: (key, input, originalName) => ipcRenderer.invoke('mcp:upsert', key, input, originalName),
  mcpRemove: (key, name) => ipcRenderer.invoke('mcp:remove', key, name),
  mcpSetEnabled: (key, name, enabled, trustAck) => ipcRenderer.invoke('mcp:setEnabled', key, name, enabled, trustAck),
  mcpMoveLegacy: (name, key) => ipcRenderer.invoke('mcp:moveLegacy', name, key),
  mcpImportPreview: (key) => ipcRenderer.invoke('mcp:importPreview', key),
  mcpImportApply: (key, ids, digest) => ipcRenderer.invoke('mcp:importApply', key, ids, digest),
  mcpRemoveLegacy: (name) => ipcRenderer.invoke('mcp:removeLegacy', name),
  agentMcp: (id) => ipcRenderer.invoke('agents:mcp', id),
  setAgentMcp: (id, name, enabled) => ipcRenderer.invoke('agents:setMcp', id, name, enabled),
  listAgents: () => ipcRenderer.invoke('agents:list'),
  pickAttachments: () => ipcRenderer.invoke('agents:pickAttachments'),
  stageAttachment: (name, mime, data) => ipcRenderer.invoke('agents:stageAttachment', name, mime, data),
  send: (id, text, attachments) => ipcRenderer.invoke('agents:send', id, text, attachments),
  stop: (id) => ipcRenderer.invoke('agents:stop', id),
  resolvePermission: (id, requestId, approve, remember, broad) => ipcRenderer.invoke('agents:resolvePermission', id, requestId, approve, remember, broad),
  revokeGrant: (id, key) => ipcRenderer.invoke('agents:revokeGrant', id, key),
  listPrevious: (id) => ipcRenderer.invoke('sessions:listPrevious', id),
  resumeSession: (id, sessionId, replace) => ipcRenderer.invoke('sessions:resume', id, sessionId, replace),
  listVsChats: (id) => ipcRenderer.invoke('vschat:list', id),
  readVsChat: (id, key) => ipcRenderer.invoke('vschat:read', id, key),
  openInVSCode: (id) => ipcRenderer.invoke('agents:openInVSCode', id),
  onEvent: (cb) => sub('agent:event', cb),
  onAgentAdded: (cb) => sub('agent:added', cb),
};
contextBridge.exposeInMainWorld('agentDurbar', api);
