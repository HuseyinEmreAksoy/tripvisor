// Platform-split barrel (same pattern as BottomSheet.ts). Metro resolves
// locationPermission.native.ts / locationPermission.web.ts; this file only
// exists so `tsc --noEmit` can resolve './locationPermission'.
export { getLocationPermissionState, type LocationPermissionState } from './locationPermission.web';
