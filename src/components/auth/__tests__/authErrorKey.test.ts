import { describe, expect, it } from '@jest/globals';
import { i18n } from '@/i18n';
import { authErrorKey } from '../authErrorKey';

describe('authErrorKey', () => {
  it('maps Supabase rate limits, bad emails and network failures to translated keys', () => {
    expect(authErrorKey({ status: 429, message: 'For security purposes, you can only request this after 60 seconds.' })).toBe(
      'errors:auth.rateLimited',
    );
    expect(authErrorKey({ code: 'over_email_send_rate_limit' })).toBe('errors:auth.rateLimited');
    expect(authErrorKey({ code: 'email_address_invalid' })).toBe('errors:auth.invalidEmail');
    expect(authErrorKey({ name: 'AuthRetryableFetchError', message: 'Failed to fetch' })).toBe('errors:network');
    expect(authErrorKey(new Error('boom'))).toBe('errors:auth.sendLinkFailed');
    expect(authErrorKey(undefined)).toBe('errors:auth.sendLinkFailed');
  });

  it('every key it can return exists in both languages', () => {
    for (const key of ['errors:auth.rateLimited', 'errors:auth.invalidEmail', 'errors:network', 'errors:auth.sendLinkFailed'] as const) {
      expect(i18n.t(key, { lng: 'en' })).not.toBe(key.split(':')[1]);
      expect(i18n.t(key, { lng: 'tr' })).not.toBe(i18n.t(key, { lng: 'en' }));
    }
  });
});
