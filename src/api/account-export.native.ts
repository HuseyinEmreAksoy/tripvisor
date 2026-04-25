// Tripvisor Phase 10 — account data export hook (native).
//
// Fetches the JSON payload via the shared helper, writes it to the app cache
// directory, and opens the system share sheet. Mirrors the structure of
// ics.native.ts exactly.

import { useMutation } from '@tanstack/react-query';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { fetchAccountExportJson } from './account-export.shared';

export interface AccountExportResult {
  filename: string;
  uri: string;
  bytes: number;
  shared: boolean;
}

export function useExportAccount() {
  return useMutation<AccountExportResult, Error, void>({
    mutationFn: async () => {
      const { json, filename, bytes } = await fetchAccountExportJson();
      const uri = `${FileSystem.cacheDirectory ?? ''}${filename}`;
      await FileSystem.writeAsStringAsync(uri, json, {
        encoding: FileSystem.EncodingType.UTF8,
      });

      let shared = false;
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: 'application/json',
          UTI: 'public.json',
          dialogTitle: 'Export my Tripvisor data',
        });
        shared = true;
      }

      return { filename, uri, bytes, shared };
    },
  });
}
