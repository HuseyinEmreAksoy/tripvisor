// Tripvisor Phase 10 — account data export hook (web).
//
// Fetches the JSON payload via the shared helper and triggers a Blob download
// via an anchor click. Mirrors the structure of ics.web.ts exactly.

import { useMutation } from '@tanstack/react-query';
import { fetchAccountExportJson } from './account-export.shared';

export interface AccountExportResult {
  filename: string;
  bytes: number;
  shared: true;
}

export function useExportAccount() {
  return useMutation<AccountExportResult, Error, void>({
    mutationFn: async () => {
      if (typeof window === 'undefined' || typeof document === 'undefined') {
        // SSR / service-worker context — throw so React Query surfaces the error
        // through its onError path and the settings screen's existing error
        // banner appears, rather than silently reporting success with no download.
        throw new Error('Browser not available for account export download');
      }
      const { json, filename, bytes } = await fetchAccountExportJson();
      const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      try {
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        a.remove();
      } finally {
        // Defer revoke one tick so Safari has time to start the download.
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      return { filename, bytes, shared: true };
    },
  });
}
