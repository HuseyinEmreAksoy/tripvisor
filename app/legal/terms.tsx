/**
 * Public terms of use (v2 M4 X3.2). Outside the auth guard: linked from the
 * store listing, signup, and Profile & settings.
 *
 * Text: `legal:terms.*` in src/i18n/locales/{en,tr}/legal.json (M5 Y1.4).
 * English is the binding version; the Turkish page says so and can show the
 * English original. Any change to the terms goes into BOTH files.
 */
import { LegalDocument } from '@/components/legal/LegalDocument';

export default function TermsOfUse() {
  return <LegalDocument doc="terms" />;
}
