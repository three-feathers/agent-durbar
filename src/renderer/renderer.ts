// Renderer entry. For now the UI is the static prototype; this only proves the preload bridge works.
interface DurbarBridge {
  version(): Promise<string>;
}
const bridge = (window as unknown as { agentDurbar?: DurbarBridge }).agentDurbar;
// spec 010 FR-032: a failed or refused call is never an unhandled rejection (the version is only logged)
bridge?.version().then((v) => console.log(`[agent-durbar] v${v}`)).catch(() => undefined);
