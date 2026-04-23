import { useQuery } from '@tanstack/react-query';
import { useMemo, useRef } from 'react';
import { supabase } from './supabase';
import type { PlaceAutocompleteSuggestion, PlaceDetails } from './types';

export const placesKeys = {
  autocomplete: (input: string) => ['places', 'autocomplete', input] as const,
  details: (placeId: string) => ['places', 'details', placeId] as const,
};

function generateSessionToken(): string {
  // RFC4122 v4-ish. Crypto may be unavailable on some RN runtimes; fall back to Math.random.
  const bytes = new Uint8Array(16);
  const cryptoRef =
    typeof globalThis !== 'undefined' && (globalThis as { crypto?: Crypto }).crypto
      ? (globalThis as { crypto?: Crypto }).crypto
      : null;
  if (cryptoRef?.getRandomValues) {
    cryptoRef.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Returns a stable session token tied to this component mount.
 * Propagate the same token to autocomplete AND the following place-details call
 * — otherwise Google bills the details call separately.
 */
export function useAutocompleteSessionToken(): string {
  const ref = useRef<string | null>(null);
  if (ref.current === null) ref.current = generateSessionToken();
  return ref.current;
}

export function usePlacesAutocomplete(params: {
  input: string;
  sessionToken: string;
  locationBias?: { lat: number; lng: number; radiusMeters?: number };
  enabled?: boolean;
}) {
  const { input, sessionToken, locationBias, enabled = true } = params;
  const key = useMemo(() => placesKeys.autocomplete(input), [input]);

  return useQuery<PlaceAutocompleteSuggestion[]>({
    queryKey: key,
    enabled: enabled && input.trim().length >= 2,
    staleTime: 1000 * 60 * 5,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke<{
        suggestions: PlaceAutocompleteSuggestion[];
      }>('places-autocomplete', {
        body: { input, sessionToken, locationBias },
      });
      if (error) throw error;
      return data?.suggestions ?? [];
    },
  });
}

/**
 * Fetches full place details. Never persist the response —
 * leave it in the React Query cache only (ToS).
 */
export function usePlaceDetails(params: {
  placeId: string | undefined;
  sessionToken?: string;
  /**
   * Granular field mask. Default is a full detail-screen mask.
   * Use a narrower mask for list views to reduce billing.
   */
  fields?: string[];
  enabled?: boolean;
}) {
  const { placeId, sessionToken, fields, enabled = true } = params;
  return useQuery<PlaceDetails | null>({
    queryKey: placeId
      ? [...placesKeys.details(placeId), fields ?? 'full']
      : ['places', 'details', 'none'],
    enabled: enabled && Boolean(placeId),
    staleTime: 1000 * 60 * 60,
    gcTime: 1000 * 60 * 60 * 24,
    queryFn: async () => {
      if (!placeId) return null;
      const { data, error } = await supabase.functions.invoke<{ place: PlaceDetails }>(
        'place-details',
        { body: { placeId, sessionToken, fields } },
      );
      if (error) throw error;
      return data?.place ?? null;
    },
  });
}

