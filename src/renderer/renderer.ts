// Renderer entry. For now the UI is the static prototype; this only proves the preload bridge works.
interface DurbarBridge {
  version(): Promise<string>;
}
const bridge = (window as unknown as { agentDurbar?: DurbarBridge }).agentDurbar;
bridge?.version().then((v) => console.log(`[agent-durbar] v${v}`));
