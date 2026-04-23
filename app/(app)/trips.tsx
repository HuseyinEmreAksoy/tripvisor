import { FlatList, RefreshControl, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, EmptyState, Heading, Screen } from '@/components';
import { TripCard } from '@/components/TripCard';
import { useTrips, useSignOut } from '@/api';
import { useTheme } from '@/theme';

export default function TripsList() {
  const t = useTheme();
  const router = useRouter();
  const { data: trips, isLoading, error, refetch, isRefetching } = useTrips();
  const signOut = useSignOut();

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
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Heading level={1}>Your trips</Heading>
          <Button
            variant="ghost"
            label="Sign out"
            fullWidth={false}
            onPress={() => signOut.mutate()}
            loading={signOut.isPending}
          />
        </View>
      </View>

      {isEmpty ? (
        <EmptyState
          title="No trips yet"
          description="Create your first trip to start planning."
          action={
            <Button label="Create trip" onPress={() => router.push('/trip/new')} fullWidth={false} />
          }
        />
      ) : (
        <FlatList
          data={trips}
          keyExtractor={(trip) => trip.id}
          renderItem={({ item }) => (
            <TripCard trip={item} onPress={() => router.push(`/trip/${item.id}`)} />
          )}
          contentContainerStyle={{
            padding: t.spacing.lg,
            gap: t.spacing.md,
          }}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
          ListFooterComponent={
            <View style={{ marginTop: t.spacing.lg }}>
              <Button label="New trip" onPress={() => router.push('/trip/new')} />
            </View>
          }
        />
      )}
    </Screen>
  );
}
