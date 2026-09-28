/**
 * TripHubTab — the "Trip" tab of the trip detail route (v2 M4 X2.2).
 *
 * Replaces the old SettingsTab's content half. Each surface is a summary
 * card that either expands the EXISTING section inline (the JSX was moved
 * from SettingsTab, not rewritten) or links to its existing route:
 *
 *   Budget   spent / total + bar        → BudgetCard · CategoryBreakdown · ExpenseList
 *   Stays    tonight / next check-in    → AccommodationList
 *   Packing  X / Y packed + bar         → /trip/[id]/packing
 *   Docs     N documents                → DocumentsSection
 *   People   avatars + invite           → /trip/[id]/collaborators
 *   Share    public link                → ShareLinkCard (editors)
 *   + the "You liked / didn't like" catalogs (reactions)
 *
 * Trip-level settings (cover, hours, transport, currency, export, delete)
 * moved to TripSettingsSheet, opened from the header ⋯ menu.
 *
 * Role gating: the moved components keep their own `canEdit` gates; the
 * Share card only expands for editors (viewers can't mint links).
 */
import { useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ShareLinkCard } from '@/components/ShareLinkCard';
import { useTheme } from '@/theme';
import { formatCurrency } from '@/lib/formatCurrency';
import { toLocalDateString } from '@/lib/tripToday';
import { useDeleteTripExpense, useTripPlaces, type TripCurrency, type TripPlace } from '@/api';
import { useTripExpenseRollup, useTripExpenses } from '@/api/trip-expenses';
import { useTripAccommodations, useDeleteTripAccommodation } from '@/api/trip-accommodations';
import { useTripPackingItems } from '@/api/trip-packing';
import { useTripDocuments } from '@/api/trip-documents';
import { useTripCollaborators } from '@/api/trip-collaborators';
import { useTripReactions } from '@/api/trip-place-reactions';
import { useSession } from '@/api/auth';
import type { TripAccommodation, TripExpense } from '@/api/types';
import { BudgetCard } from '@/components/budget/BudgetCard';
import { BudgetEditSheet } from '@/components/budget/BudgetEditSheet';
import { CategoryBreakdown } from '@/components/budget/CategoryBreakdown';
import { ExpenseList } from '@/components/budget/ExpenseList';
import { ExpenseEditSheet } from '@/components/budget/ExpenseEditSheet';
import { AccommodationList } from '@/components/accommodation/AccommodationList';
import { AccommodationEditSheet } from '@/components/accommodation/AccommodationEditSheet';
import { DocumentsSection } from './DocumentsSection';
import { HubCard, ProgressBar, ReactionCatalogSection } from './TripHubCards';

export type HubSection = 'budget' | 'stays' | 'docs' | 'share';

export interface TripHubTabProps {
  tripId: string;
  /** Used in the share message ("Check out <title> on Tripvisor"). */
  tripTitle?: string;
  tripStartDate: string | null;
  currency: TripCurrency;
  tripDayCount: number;
  canEdit: boolean;
  isOwner: boolean;
  /** Opens place detail with trip context (reactions). */
  onOpenPlace: (place: TripPlace) => void;
  /** Sections open on first render (desktop opens budget + stays). */
  initialExpanded?: HubSection[];
  /** Extra bottom padding so the FAB never covers the last card. */
  bottomInset?: number;
}

export function TripHubTab({
  tripId,
  tripTitle,
  tripStartDate,
  currency,
  tripDayCount,
  canEdit,
  isOwner,
  onOpenPlace,
  initialExpanded = [],
  bottomInset = 0,
}: TripHubTabProps) {
  const t = useTheme();
  const router = useRouter();
  const [open, setOpen] = useState<ReadonlySet<HubSection>>(() => new Set(initialExpanded));
  const toggle = (s: HubSection) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });

  // ── Budget (Phase 21 Step 21.10) ────────────────────────────────────────
  const rollup = useTripExpenseRollup(tripId);
  const { data: expenses = [] } = useTripExpenses(tripId);
  const [budgetSheetOpen, setBudgetSheetOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<TripExpense | null>(null);
  const [expenseSheetOpen, setExpenseSheetOpen] = useState(false);
  const deleteExpense = useDeleteTripExpense();

  // ── Accommodation (Phase 21 Step 21.13) ─────────────────────────────────
  const { data: accommodations = [] } = useTripAccommodations(tripId);
  const deleteAccommodation = useDeleteTripAccommodation();
  const [editingAccommodation, setEditingAccommodation] = useState<TripAccommodation | null>(null);
  const [accommodationSheetOpen, setAccommodationSheetOpen] = useState(false);

  // ── Summary-only reads (TanStack dedupes against the owning screens) ────
  const { data: packing = [] } = useTripPackingItems(tripId);
  const { data: documents = [] } = useTripDocuments(tripId);
  const { data: collaborators = [] } = useTripCollaborators(tripId);

  // ── Reactions catalog (Phase 24 Step 24.5) ──────────────────────────────
  const { data: session } = useSession();
  const currentUserId = session?.user?.id;
  const { data: tripReactions = [] } = useTripReactions(tripId);
  const { data: tripPlaces = [] } = useTripPlaces(tripId);
  const { likedPlaces, dislikedPlaces } = useMemo(() => {
    const pick = (kind: 'liked' | 'disliked') => {
      if (!currentUserId) return [];
      const ids = new Set(
        tripReactions
          .filter((r) => r.user_id === currentUserId && r.reaction === kind)
          .map((r) => r.trip_place_id),
      );
      return tripPlaces
        .filter((p) => ids.has(p.id))
        .sort(
          (a, b) =>
            (a.day_index ?? 999) - (b.day_index ?? 999) || (a.order_in_day ?? 0) - (b.order_in_day ?? 0),
        );
    };
    return { likedPlaces: pick('liked'), dislikedPlaces: pick('disliked') };
  }, [tripReactions, tripPlaces, currentUserId]);

  // ── Summaries ───────────────────────────────────────────────────────────
  const budgetSummary = rollup.hasBudget && rollup.budget !== null
    ? `${formatCurrency(rollup.totalActual, currency)} of ${formatCurrency(rollup.budget, currency)} spent`
    : rollup.totalActual > 0
      ? `${formatCurrency(rollup.totalActual, currency)} spent · no budget set`
      : 'No expenses yet';
  const budgetRatio = rollup.budget ? rollup.totalActual / rollup.budget : 0;

  const staySummary = useMemo(() => summarizeStays(accommodations), [accommodations]);

  const livePacking = packing.filter((i) => !i.deleted);
  const packedCount = livePacking.filter((i) => i.checked).length;
  const liveDocs = documents.filter((d) => !(d as { deleted?: boolean }).deleted);

  const people = collaborators.filter((c) => c.status !== 'revoked');
  const peopleSummary = isOwner
    ? people.length > 0
      ? `${people.length} ${people.length === 1 ? 'person' : 'people'} · tap to invite`
      : 'Just you · invite a travel buddy'
    : 'See who is on this trip';

  return (
    <ScrollView
      contentContainerStyle={{ padding: t.spacing.lg, gap: t.spacing.md, paddingBottom: t.spacing.lg + bottomInset }}
    >
      <HubCard
        icon="wallet"
        title="Budget"
        summary={budgetSummary}
        expanded={open.has('budget')}
        onPress={() => toggle('budget')}
        accessory={rollup.hasBudget ? <ProgressBar value={budgetRatio} over={budgetRatio > 1} /> : null}
      >
        <BudgetCard
          rollup={rollup}
          currency={currency}
          onSetBudget={() => setBudgetSheetOpen(true)}
          canEdit={canEdit}
          onAddExpense={() => {
            setEditingExpense(null);
            setExpenseSheetOpen(true);
          }}
        />
        <CategoryBreakdown rollup={rollup} currency={currency} />
        <ExpenseList
          expenses={expenses}
          tripId={tripId}
          currency={currency}
          canEdit={canEdit}
          tripDayCount={tripDayCount}
          tripStartDate={tripStartDate}
          onAdd={() => {
            setEditingExpense(null);
            setExpenseSheetOpen(true);
          }}
          onEdit={(expense) => {
            setEditingExpense(expense);
            setExpenseSheetOpen(true);
          }}
          onDelete={(expense) => {
            deleteExpense.mutate({ id: expense.id, trip_id: tripId });
          }}
        />
      </HubCard>

      <HubCard
        icon="calendar"
        title="Stays"
        summary={staySummary}
        expanded={open.has('stays')}
        onPress={() => toggle('stays')}
      >
        <AccommodationList
          accommodations={accommodations}
          tripStartDate={tripStartDate}
          canEdit={canEdit}
          onAdd={() => {
            setEditingAccommodation(null);
            setAccommodationSheetOpen(true);
          }}
          onEdit={(acc) => {
            setEditingAccommodation(acc);
            setAccommodationSheetOpen(true);
          }}
          onDelete={(acc) => {
            deleteAccommodation.mutate({ id: acc.id, trip_id: tripId });
          }}
        />
      </HubCard>

      <HubCard
        icon="luggage"
        title="Packing"
        summary={
          livePacking.length > 0
            ? `${packedCount} of ${livePacking.length} packed`
            : canEdit
              ? 'Start a checklist with smart suggestions'
              : 'See what the group is packing'
        }
        accessibilityLabel={`Open the packing list, ${packedCount} of ${livePacking.length} packed`}
        onPress={() => router.push(`/trip/${tripId}/packing`)}
        accessory={
          livePacking.length > 0 ? <ProgressBar value={packedCount / livePacking.length} /> : null
        }
      />

      <HubCard
        icon="file-text"
        title="Documents"
        summary={
          liveDocs.length > 0
            ? `${liveDocs.length} ${liveDocs.length === 1 ? 'document' : 'documents'}`
            : 'Tickets, bookings and passes'
        }
        expanded={open.has('docs')}
        onPress={() => toggle('docs')}
      >
        <DocumentsSection tripId={tripId} canEdit={canEdit} />
      </HubCard>

      <HubCard
        icon="users"
        title="People"
        summary={peopleSummary}
        accessibilityLabel={`Manage collaborators, ${peopleSummary}`}
        onPress={() => router.push(`/trip/${tripId}/collaborators`)}
        accessory={people.length > 0 ? <AvatarStack emails={people.map((p) => p.invitee_email)} /> : null}
      />

      <HubCard
        icon="share-2"
        title="Share"
        summary={canEdit ? 'Read-only public link or invite by email' : 'Ask an editor for a share link'}
        expanded={canEdit ? open.has('share') : undefined}
        onPress={() => (canEdit ? toggle('share') : router.push(`/trip/${tripId}/collaborators`))}
      >
        <ShareLinkCard tripId={tripId} tripTitle={tripTitle} />
      </HubCard>

      {/* ── Phase 24 Step 24.5: Liked / disliked catalog ────────────────── */}
      <ReactionCatalogSection label="You liked" places={likedPlaces} onOpenPlace={onOpenPlace} />
      <ReactionCatalogSection label="You didn't like" places={dislikedPlaces} onOpenPlace={onOpenPlace} />

      {/* Budget + Accommodation edit sheets */}
      <BudgetEditSheet
        tripId={tripId}
        currentBudget={rollup.budget}
        currency={currency}
        visible={budgetSheetOpen}
        onClose={() => setBudgetSheetOpen(false)}
      />
      <ExpenseEditSheet
        tripId={tripId}
        expense={editingExpense}
        currency={currency}
        visible={expenseSheetOpen}
        onClose={() => setExpenseSheetOpen(false)}
        tripDayCount={tripDayCount}
        tripStartDate={tripStartDate}
      />
      <AccommodationEditSheet
        tripId={tripId}
        accommodation={editingAccommodation}
        visible={accommodationSheetOpen}
        onClose={() => setAccommodationSheetOpen(false)}
      />
    </ScrollView>
  );
}

/**
 * Stays card summary. Local-date string comparison (same convention as
 * tripToday): tonight's stay wins, then the next check-in, then a count.
 */
export function summarizeStays(
  stays: ReadonlyArray<{
    name: string;
    check_in_date: string;
    check_out_date: string;
    deleted?: boolean;
  }>,
  today: string = toLocalDateString(new Date()),
): string {
  const live = stays.filter((s) => !s.deleted);
  if (live.length === 0) return 'No stays yet';
  const tonight = live.find((s) => s.check_in_date <= today && today < s.check_out_date);
  if (tonight) return `Tonight: ${tonight.name}`;
  const next = [...live]
    .filter((s) => s.check_in_date > today)
    .sort((a, b) => a.check_in_date.localeCompare(b.check_in_date))[0];
  if (next) return `Next check-in ${next.check_in_date} · ${next.name}`;
  return `${live.length} ${live.length === 1 ? 'stay' : 'stays'}`;
}

function AvatarStack({ emails }: { emails: string[] }) {
  const t = useTheme();
  const shown = emails.slice(0, 4);
  const extra = emails.length - shown.length;
  return (
    <View
      style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {shown.map((email, i) => (
        <View
          key={`${email}-${i}`}
          style={{
            width: 26,
            height: 26,
            borderRadius: 13,
            marginLeft: i === 0 ? 0 : -6,
            borderWidth: 2,
            borderColor: t.colors.bgElevated,
            backgroundColor: t.colors.primary,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={[t.typography.small, { color: t.colors.primaryText }]}>
            {email.slice(0, 1).toUpperCase()}
          </Text>
        </View>
      ))}
      {extra > 0 ? (
        <Text style={[t.typography.small, { color: t.colors.textMuted, marginLeft: 6 }]}>{`+${extra}`}</Text>
      ) : null}
    </View>
  );
}
