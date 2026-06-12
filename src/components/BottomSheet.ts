// Platform-split barrel (same pattern as DateField.ts / src/api/offline.ts).
// Metro resolves BottomSheet.native.tsx on iOS/Android and BottomSheet.web.tsx
// on web — platform extensions win over this plain .ts, so it never bundles.
// TypeScript resolves this barrel during `tsc --noEmit`. Both platform files
// export the identical { BottomSheet, BottomSheetProps } surface.
export { BottomSheet, type BottomSheetProps } from './BottomSheet.web';
