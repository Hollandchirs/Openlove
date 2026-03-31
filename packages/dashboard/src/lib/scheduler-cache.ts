/**
 * Shared scheduler cache — one SchedulerEntry per character.
 *
 * IMPORTANT: We store the Map on `globalThis` so it survives across
 * webpack-bundled route entry points.  Next.js bundles each API route
 * into its own chunk, so a plain module-level `new Map()` would create
 * a separate instance per route — meaning the wake route and the bridge
 * route would each have their own empty Map and could never see each
 * other's entries.  Using `globalThis` guarantees a single Map for the
 * entire Node.js process.
 */

export interface BridgeInstance {
  sendProactiveMessage: (r: any) => Promise<void>;
  stop: () => Promise<void>;
  updatePresence?: (a: any) => void;
}

export interface SchedulerEntry {
  scheduler: any;
  engine: any;
  activityManager: any;
  bridges: BridgeInstance[];
  platforms: string[];
  startedAt: number;
}

const CACHE_KEY = "__opencrush_schedulerCache";

declare global {
  // eslint-disable-next-line no-var
  var __opencrush_schedulerCache: Map<string, SchedulerEntry> | undefined;
}

if (!globalThis[CACHE_KEY as keyof typeof globalThis]) {
  (globalThis as Record<string, unknown>)[CACHE_KEY] = new Map<string, SchedulerEntry>();
}

export const schedulerCache = (globalThis as Record<string, unknown>)[
  CACHE_KEY
] as Map<string, SchedulerEntry>;
