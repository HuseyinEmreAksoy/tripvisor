import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Linking } from 'react-native';
import {
  buildAppleDirectionsUrl,
  buildDirectionsUrl,
  buildGoogleDirectionsUrl,
  openDirections,
} from '../directions';

const belem = { lat: 38.6916, lng: -9.216, placeId: 'ChIJ_belem', label: 'Belém Tower' };
const hotel = { lat: 38.7101, lng: -9.1432 };

function params(url: string): URLSearchParams {
  return new URL(url).searchParams;
}

describe('buildGoogleDirectionsUrl', () => {
  it('always carries a destination (the old transit link did not)', () => {
    const url = buildGoogleDirectionsUrl({ destination: belem });
    expect(url.startsWith('https://www.google.com/maps/dir/?')).toBe(true);
    const p = params(url);
    expect(p.get('api')).toBe('1');
    expect(p.get('destination')).toBe('38.6916,-9.216');
    expect(p.get('destination_place_id')).toBe('ChIJ_belem');
    expect(p.get('travelmode')).toBe('driving');
    expect(p.has('origin')).toBe(false);
  });

  it('adds an origin and the requested travel mode', () => {
    const p = params(buildGoogleDirectionsUrl({ destination: belem, origin: hotel, mode: 'transit' }));
    expect(p.get('origin')).toBe('38.7101,-9.1432');
    expect(p.get('travelmode')).toBe('transit');
  });

  it('omits destination_place_id when there is none', () => {
    const p = params(buildGoogleDirectionsUrl({ destination: hotel, mode: 'walking' }));
    expect(p.has('destination_place_id')).toBe(false);
    expect(p.get('travelmode')).toBe('walking');
  });
});

describe('buildAppleDirectionsUrl', () => {
  it('maps modes to Apple dirflg values', () => {
    expect(params(buildAppleDirectionsUrl({ destination: belem, mode: 'driving' })!).get('dirflg')).toBe('d');
    expect(params(buildAppleDirectionsUrl({ destination: belem, mode: 'walking' })!).get('dirflg')).toBe('w');
    expect(params(buildAppleDirectionsUrl({ destination: belem, mode: 'transit' })!).get('dirflg')).toBe('r');
  });

  it('includes daddr, label and optional saddr', () => {
    const p = params(buildAppleDirectionsUrl({ destination: belem, origin: hotel })!);
    expect(p.get('daddr')).toBe('38.6916,-9.216');
    expect(p.get('q')).toBe('Belém Tower');
    expect(p.get('saddr')).toBe('38.7101,-9.1432');
  });

  it('returns null for cycling (unsupported by Apple Maps)', () => {
    expect(buildAppleDirectionsUrl({ destination: belem, mode: 'bicycling' })).toBeNull();
  });
});

describe('buildDirectionsUrl (per platform)', () => {
  it('uses Google on Android and web', () => {
    expect(buildDirectionsUrl({ destination: belem, platform: 'android' })).toContain('google.com/maps/dir');
    expect(buildDirectionsUrl({ destination: belem, platform: 'web' })).toContain('google.com/maps/dir');
  });

  it('uses Apple Maps on iOS', () => {
    expect(buildDirectionsUrl({ destination: belem, platform: 'ios' })).toContain('maps.apple.com');
  });

  it('falls back to Google on iOS for cycling', () => {
    const url = buildDirectionsUrl({ destination: belem, platform: 'ios', mode: 'bicycling' });
    expect(url).toContain('google.com/maps/dir');
    expect(params(url).get('travelmode')).toBe('bicycling');
  });
});

describe('openDirections', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('opens the platform URL', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await expect(openDirections({ destination: belem, platform: 'android' })).resolves.toBe(true);
    expect(open).toHaveBeenCalledTimes(1);
    expect(String(open.mock.calls[0]![0])).toContain('google.com/maps/dir');
  });

  it('retries with Google when Apple Maps fails to open', async () => {
    const open = jest
      .spyOn(Linking, 'openURL')
      .mockRejectedValueOnce(new Error('no handler'))
      .mockResolvedValueOnce(true);
    await expect(openDirections({ destination: belem, platform: 'ios' })).resolves.toBe(true);
    expect(String(open.mock.calls[0]![0])).toContain('maps.apple.com');
    expect(String(open.mock.calls[1]![0])).toContain('google.com/maps/dir');
  });

  it('resolves false when nothing can be opened', async () => {
    jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('no handler'));
    await expect(openDirections({ destination: belem, platform: 'android' })).resolves.toBe(false);
  });
});
