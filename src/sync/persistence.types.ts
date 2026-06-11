/**
 * persistence.types.ts — shared contract for the platform-split persistence
 * resolvers (persistence.native.ts / persistence.web.ts). Type-only module
 * so both variants and hydrate.ts agree on one shape without a runtime
 * import cycle.
 */

import type { ObservablePersistPlugin } from '@legendapp/state/sync';

export interface SyncPersistenceResult {
  /** undefined = no durable persistence; the store runs in-memory only. */
  plugin: ObservablePersistPlugin | undefined;
  /**
   * true = we WANTED durable persistence but couldn't get it (web without
   * cross-origin isolation, native module missing). Sync itself still works
   * — the store just re-hydrates from the network instead of disk on cold
   * start. Surfaced via telemetry per risk R5.
   */
  degraded: boolean;
  reason: string | null;
}
