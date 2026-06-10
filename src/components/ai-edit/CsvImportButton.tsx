/**
 * CsvImportButton — Google Takeout CSV picker for the import sheet
 * (v2 Phase N4 step 4.3).
 *
 * WEB-ONLY surface: the real implementation lives in CsvImportButton.web.tsx
 * (a plain HTML `<input type="file">` — explicitly NO new native dependency
 * per plan-v2 N4.3). This base file is what native resolves at runtime (and
 * what tsc type-checks for consumers): it renders nothing, so the import
 * sheet on iOS/Android simply shows the paste textarea without a file
 * affordance.
 */

export interface CsvImportButtonProps {
  /** Receives the Title-column values parsed from the chosen CSV. */
  onNames: (names: string[]) => void;
  /** Receives a human-readable parse/read failure message. */
  onError: (message: string) => void;
  disabled?: boolean;
}

export function CsvImportButton(_props: CsvImportButtonProps): null {
  return null;
}
