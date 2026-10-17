/**
 * Dev tool, READ-ONLY and FREE (spec 030 T040): starts the runtime with the existing Copilot login, lists the models and the runtime's built-in catalog,
 * and writes a sanitized fixture. No session is created, no prompt is sent, no AI credit is spent. Not part of `npm test`.
 * Only the model objects and the auth TYPE are kept: no token, login name, host or status message is read into the output.
 *   node dist-scripts/scripts/capture-models.js <out.json>
 */
import { CopilotClient } from '@github/copilot-sdk';
import * as fs from 'fs';

async function main(): Promise<void> {
  const out = process.argv[2] ?? 'scripts/fixtures/models/real-list-models.json';
  const client = new CopilotClient({});
  await client.start();
  try {
    const auth = await client.getAuthStatus();
    const models = await client.listModels();
    const catalog = await (client as unknown as { rpc: { models: { getBuiltInCatalog: () => Promise<{ models: Array<{ id: string }> }> } } }).rpc.models.getBuiltInCatalog().catch(() => undefined);
    const status = await client.getStatus();
    const fixture = {
      provenance: 'real',
      source: 'CopilotClient.listModels() (SDK @github/copilot-sdk 1.0.22), rpc.models.getBuiltInCatalog()',
      runtimeVersion: status.version,
      capturedAt: new Date().toISOString().slice(0, 10),
      authenticated: auth.isAuthenticated === true,
      authType: auth.authType,
      note: 'No prompt, no session, 0 AI credits. Account details are not recorded.',
      models,
      builtInCatalogIds: catalog?.models.map((m) => m.id),
    };
    fs.mkdirSync(require('path').dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(fixture, null, 2) + '\n');
    console.log(`wrote ${out}: ${models.length} model(s) listed, ${fixture.builtInCatalogIds?.length ?? 0} built-in catalog ids`);
  } finally {
    await client.stop();
  }
}
main().catch((e) => {
  console.error(String(e instanceof Error ? e.message : e).slice(0, 300));
  process.exit(1);
});
