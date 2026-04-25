import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, EmptyState, Heading, Screen, SegmentedControl } from '@/components';
import { noTrips } from '@/components/emptyStates';
import { TripCard } from '@/components/TripCard';
import {
  useTrips,
  useArchiveTrip,
  useUnarchiveTrip,
  useDuplicateTrip,
  useDeleteTrip,
} from '@/api';
import { useTheme } from '@/theme';
import { confirmDestructive } from '@/lib/confirm';

type Tab = 'active' | 'archived';

const TAB_OPTIONS: Array<{ value: Tab; label: string }> = [
  { value: 'active', label: 'Active' },
  { value: 'archived', label: 'Archived' },
];

export default function TripsList() {
  const t = useTheme();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('active');

  const { data: trips, isLoading, error, refetch, isRefetching } = useTrips({
    archived: tab === 'archived',
  });

  const archiveMutation = useArchiveTrip();
  const unarchiveMutation = useUnarchiveTrip();
  const duplicateMutation = useDuplicateTrip();
  const deleteMutation = useDeleteTrip();

  const handleDelete = async (id: string) => {
    const confirmed = await confirmDestructive({
      title: 'Delete trip?',
      message: 'This permanently deletes the trip and all its places. This cannot be undone.',
      confirmLabel: 'Delete',
    });
    if (confirmed) {
      deleteMutation.mutate(id);
    }
  };

  if (isLoading) {
    return (
      <Screen>
        <Text style={[t.typography.body, { color: t.colors.textMuted }]}>Loading trips…</Text>
      </Screen>
    );
  }

  if (error) {
    return (
      <Screen>
        <EmptyState
          title="Couldn't load trips"
          description={(error as Error).message}
          action={<Button label="Retry" onPress={() => refetch()} />}
        />
      </Screen>
    );
  }

  const isEmpty = !trips || trips.length === 0;

  return (
    <Screen padded={false}>
      <View style={{ paddingHorizontal: t.spacing.lg, paddingTop: t.spacing.lg, gap: t.spacing.md }}>
        {/* ─── Header row: title + settings link ──────────────────────────── */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Heading level={1}>Your trips</Heading>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open settings"
            onPress={() => router.push('/settings')}
            hitSlop={8}
            style={({ pressed }) => ({
              paddingHorizontal: t.spacing.md,
              paddingVertical: t.spacing.sm,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Text style={[t.typography.bodyStrong, { color: t.colors.primary }]}>
              Settings
            </Text>
          </Pressable>
        </View>

        {/* ─── Active / Archived segmented control ────────────────────────── */}
        <SegmentedControl
          value={tab}
          options={TAB_OPTIONS}
          onChange={setTab}
        />
      </View>

      {isEmpty ? (
        tab === 'active' ? (
          // Active tab empty state — preserve existing "Plan your first trip" copy
          <EmptyState
            {...noTrips}
            onPress={() => router.push('/trip/new')}
          />
        ) : (
          // Archived tab empty state
          <EmptyState
            title="No archived trips"
            body="Archived trips will appear here."
          />
        )
      ) : (
        <FlatList
          data={trips}
          keyExtractor={(trip) => trip.id}
          renderItem={({ item }) => (
            <TripCard
              trip={item}
              onPress={() => router.push(`/trip/${item.id}`)}
              onArchive={(id) => archiveMutation.mutate(id)}
              onUnarchive={(id) => unarchiveMutation.mutate(id)}
              onDuplicate={(id) => duplicateMutation.mutate(id)}
              onDelete={handleDelete}
            />
          )}
          contentContainerStyle={{
            padding: t.spacing.lg,
            gap: t.spacing.md,
          }}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
          ListFooterComponent={
            tab === 'active' ? (
              <View style={{ marginTop: t.spacing.lg }}>
                <Button label="New trip" onPress={() => router.push('/trip/new')} />
              </View>
            ) : null
          }
        />
      )}
    </Screen>
  );
}
