/**
 * Type surface for the platform-split auth storage adapter
 * (`storage.native.ts` = chunked expo-secure-store, `storage.web.ts` =
 * localStorage with an in-memory fallback). Metro and Jest resolve the
 * platform file; this declaration lets TypeScript resolve `./storage`.
 * Keep it in sync with both implementations.
 */
export declare const storageAdapter: {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};
