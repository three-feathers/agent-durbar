/**
 * Claude Code's descriptor and transport choice (spec 012). Claude was experimental behind `DURBAR_CLAUDE` (FR-114); since
 * FR-135 (2026-10-19) it is registered in every build and detection decides whether it can be used.
 */
import type { AdapterDescriptor } from './capabilities';
import { claudeDescriptor, cliTransportFactory } from './claude';
import type { TransportFactory } from './claude';
import { createSdkTransport, loadSdk } from './claudeSdk';
import { CODEX_DESCRIPTOR } from './codex';
import type { SdkModule } from './claudeSdk';


/**
 * The Claude transport (FR-113/FR-114): the CLI, unless `DURBAR_CLAUDE_TRANSPORT=sdk` and the SDK package can be loaded
 * (loaded once, at the first session start). When it cannot be, the CLI is used.
 */
export function claudeTransportFor(dev: Readonly<Record<string, string | undefined>>, load: () => Promise<SdkModule | undefined> = loadSdk): TransportFactory {
  if (dev.DURBAR_CLAUDE_TRANSPORT !== 'sdk') return cliTransportFactory;
  let sdk: Promise<SdkModule | undefined> | undefined;
  return async (o) => {
    const m = await (sdk ??= load());
    return m ? createSdkTransport(m, o) : cliTransportFactory(o);
  };
}

/** FR-135/FR-145: the harnesses offered next to Copilot, always registered (`dev` only picks Claude's transport); detection decides what is ready. */
export function offeredDescriptors(dev: Readonly<Record<string, string | undefined>>): AdapterDescriptor[] {
  return [claudeDescriptor(claudeTransportFor(dev), dev.DURBAR_CLAUDE_TRANSPORT === 'sdk'), CODEX_DESCRIPTOR];
}
