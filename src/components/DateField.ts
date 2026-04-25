// Platform-split barrel.
// Metro resolves DateField.native.tsx on iOS/Android and DateField.web.tsx on web.
// TypeScript resolves this barrel for module resolution during `tsc --noEmit`.
export { DateField } from './DateField.web';
