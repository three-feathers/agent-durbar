/**
 * Adapters that exist but are not offered to users yet (spec 012 FR-114, same pattern as FR-100): each is registered only
 * when its developer hook is set (read through `devEnv`, so a packaged build ignores it unless `DURBAR_DEV=1`).
 */
import type { AdapterDescriptor } from './capabilities';
import { claudeDescriptor, cliTransportFactory } from './claude';
import type { TransportFactory } from './claude';
import { createSdkTransport, loadSdk } from './claudeSdk';
import type { SdkModule } from './claudeSdk';

/** Adapter id -> the developer hook that registers it. */
export const EXPERIMENTAL_HOOKS: Readonly<Record<string, string>> = { claude: 'DURBAR_CLAUDE' };

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

/** The experimental descriptors whose hook is `1` in `dev` (the object from `devEnv`). */
export function enabledExperimental(dev: Readonly<Record<string, string | undefined>>): AdapterDescriptor[] {
  const out: AdapterDescriptor[] = [];
  if (dev[EXPERIMENTAL_HOOKS.claude] === '1') out.push(claudeDescriptor(claudeTransportFor(dev)));
  return out;
}
