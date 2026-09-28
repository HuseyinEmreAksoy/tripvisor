/**
 * iOS drops a second RN <Modal> presented in the same tick another one is
 * dismissing. Sheets that close themselves and then open another modal wait
 * this long on iOS (Android/web open immediately).
 */
export const IOS_MODAL_HANDOFF_MS = 450;
