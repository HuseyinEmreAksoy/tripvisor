/**
 * i18next resource typing (ADR-0011 §6): English is the source of truth, so a
 * mistyped key or namespace is a tsc error at the call site.
 */
import 'i18next';
import type { DEFAULT_NS, en } from './resources';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: typeof DEFAULT_NS;
    resources: typeof en;
    returnNull: false;
  }
}
