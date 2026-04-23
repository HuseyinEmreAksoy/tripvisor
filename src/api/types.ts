export type Uuid = string;

export type TransportMode = 'driving' | 'walking' | 'transit';

export interface Trip {
  id: Uuid;
  user_id: Uuid;
  title: string;
  start_date: string | null;
  end_date: string | null;
  daily_hours_budget: number;
  anchor_place_id: Uuid | null;
  transport_mode: TransportMode;
  timezone: string | null;
  created_at: string;
  updated_at: string;
}

export interface TripPlace {
  id: Uuid;
  trip_id: Uuid;
  google_place_id: string;
  user_title: string | null;
  category: string | null;
  lat: number;
  lng: number;
  visit_duration_minutes: number;
  day_index: number | null;
  order_in_day: number | null;
  notes: string | null;
  details_refreshed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TripDay {
  id: Uuid;
  trip_id: Uuid;
  day_index: number;
  day_start_place_id: Uuid | null;
  day_end_place_id: Uuid | null;
}

export interface TripLeg {
  id: Uuid;
  trip_id: Uuid;
  from_place_id: Uuid;
  to_place_id: Uuid;
  day_index: number;
  transport_mode: TransportMode;
  duration_seconds: number;
  distance_meters: number;
  polyline: string | null;
  computed_at: string;
}

export interface PlaceAutocompleteSuggestion {
  placeId: string;
  mainText: string;
  secondaryText: string;
}

export interface PlacePhoto {
  name: string;
  widthPx: number;
  heightPx: number;
  attributions: Array<{ displayName: string; uri?: string; photoUri?: string }>;
}

export interface PlaceReview {
  name: string;
  rating: number;
  text: { text: string; languageCode?: string } | null;
  authorAttribution: {
    displayName: string;
    uri?: string;
    photoUri?: string;
  };
  publishTime: string;
  relativePublishTimeDescription: string;
}

export interface PlaceOpeningHours {
  openNow: boolean;
  weekdayDescriptions: string[];
}

export interface PlaceDetails {
  placeId: string;
  displayName: string;
  formattedAddress: string;
  location: { latitude: number; longitude: number };
  types: string[];
  rating: number | null;
  userRatingCount: number | null;
  priceLevel: string | null;
  photos: PlacePhoto[];
  reviews: PlaceReview[];
  regularOpeningHours: PlaceOpeningHours | null;
  nationalPhoneNumber: string | null;
  websiteUri: string | null;
  googleMapsUri: string | null;
}

export type CreateTripInput = {
  title: string;
  start_date?: string | null;
  end_date?: string | null;
  daily_hours_budget?: number;
  transport_mode?: TransportMode;
  timezone?: string | null;
};

export type CreateTripPlaceInput = {
  trip_id: Uuid;
  google_place_id: string;
  user_title?: string | null;
  category?: string | null;
  lat: number;
  lng: number;
  visit_duration_minutes?: number;
  notes?: string | null;
};
