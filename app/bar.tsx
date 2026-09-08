import { useCallback, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  BarChair,
  BarCheck,
  createBarCheck,
  listBarChairs,
  listBarChecks,
} from '../src/lib/api';
import { getIdToken } from '../src/lib/firebase';

const TOP_CHAIR_NUMBERS = Array.from(
  { length: 14 },
  (_, index) => 14 - index
);

const LEFT_CHAIR_NUMBERS = [15, 16, 17, 18, 19];

const BOTTOM_CHAIR_NUMBERS = Array.from(
  { length: 15 },
  (_, index) => 20 + index
);

export default function BarScreen() {
  const router = useRouter();

  const [chairs, setChairs] = useState<BarChair[]>([]);
  const [openChecks, setOpenChecks] = useState<BarCheck[]>([]);
  const [creatingChairId, setCreatingChairId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadBarState = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const token = await getIdToken();

      if (!token) {
        throw new Error('Staff authentication is required.');
      }

      const [loadedChairs, loadedChecks] = await Promise.all([
        listBarChairs({ token }),
        listBarChecks({ token, status: 'OPEN' }),
      ]);

      setChairs(
        loadedChairs
          .filter((chair) => chair.active)
          .sort((a, b) => a.chair_number - b.chair_number)
      );
      setOpenChecks(
        loadedChecks.filter((check) => check.status === 'OPEN')
      );
    } catch (loadError) {
      console.warn('[bar] Failed to load bar chairs', loadError);

      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Unable to load bar chairs.'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadBarState();
    }, [loadBarState])
  );

  const chairsByNumber = new Map(
    chairs.map((chair) => [chair.chair_number, chair])
  );

  const checksByChairId = new Map(
    openChecks
      .filter((check) => check.bar_chair_id)
      .map((check) => [check.bar_chair_id as string, check])
  );

  const renderChair = (chairNumber: number) => {
    const chair = chairsByNumber.get(chairNumber);

    if (!chair) {
      return (
        <View
          key={`missing-${chairNumber}`}
          style={[styles.chair, styles.missingChair]}
        >
          <Text style={styles.missingChairText}>{chairNumber}</Text>
        </View>
      );
    }

    const openCheck = checksByChairId.get(chair.id);
    const isOccupied = Boolean(openCheck);
    const isCreating = creatingChairId === chair.id;

    return (
      <Pressable
        key={chair.id}
        accessibilityRole="button"
        accessibilityLabel={chair.display_name ?? `Bar ${chair.chair_number}`}
        disabled={isCreating}
        onPress={async () => {
          if (isCreating) {
            return;
          }

          if (openCheck) {
            router.push({
              pathname: '/bar/check/[checkId]',
              params: {
                checkId: openCheck.id,
                chairNumber: String(chair.chair_number),
              },
            });
            return;
          }

          setCreatingChairId(chair.id);

          try {
            const token = await getIdToken();

            if (!token) {
              throw new Error('Staff authentication is required.');
            }

            const createdCheck = await createBarCheck({
              token,
              barChairId: chair.id,
            });

            router.push({
              pathname: '/bar/check/[checkId]/order',
              params: {
                checkId: createdCheck.id,
                chairNumber: String(chair.chair_number),
              },
            });
          } catch (createError) {
            console.warn(
              `[bar] Failed to create check for chair ${chair.chair_number}`,
              createError
            );

            setError(
              createError instanceof Error
                ? createError.message
                : 'Unable to open bar check.'
            );
          } finally {
            setCreatingChairId(null);
          }
        }}
        style={({ pressed }) => [
          styles.chair,
          isOccupied && styles.occupiedChair,
          isCreating && styles.creatingChair,
          pressed && !isOccupied && !isCreating && styles.chairPressed,
        ]}
      >
        <Text
          style={[
            styles.chairNumber,
            isOccupied && styles.occupiedChairNumber,
          ]}
        >
          {chair.chair_number}
        </Text>
        <Text
          numberOfLines={1}
          style={[
            styles.chairStatus,
            isOccupied && styles.occupiedChairStatus,
          ]}
        >
          {isCreating
            ? 'Opening…'
            : isOccupied
              ? openCheck?.display_name?.trim() || 'Open Tab'
              : 'Available'}
        </Text>
      </Pressable>
    );
  };

  const renderFloorchart = () => (
    <ScrollView
      horizontal
      contentContainerStyle={styles.horizontalScrollContent}
      showsHorizontalScrollIndicator={false}
    >
      <View style={styles.floorchart}>
        <View style={styles.topRow}>
          {TOP_CHAIR_NUMBERS.map(renderChair)}
        </View>

        <View style={styles.middleRow}>
          <View style={styles.leftColumn}>
            {LEFT_CHAIR_NUMBERS.map(renderChair)}
          </View>

          <View style={styles.barShape}>
            <Text style={styles.barLabel}>BAR</Text>
          </View>

          <View style={styles.rightSpacer} />
        </View>

        <View style={styles.bottomRow}>
          {BOTTOM_CHAIR_NUMBERS.map(renderChair)}
        </View>
      </View>
    </ScrollView>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Bar</Text>
          <Text style={styles.subtitle}>
            {chairs.length > 0
              ? `${chairs.length} active chairs`
              : 'Stats Charlotte'}
          </Text>
        </View>

        <View style={styles.headerActions}>
          <Pressable
            onPress={() => router.push('/bar/tabs')}
            style={({ pressed }) => [
              styles.openTabsButton,
              pressed && styles.backButtonPressed,
            ]}
          >
            <Text style={styles.openTabsButtonText}>
              Open Tabs ({openChecks.length})
            </Text>
          </Pressable>

          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [
              styles.backButton,
              pressed && styles.backButtonPressed,
            ]}
          >
            <Text style={styles.backButtonText}>Back to Floorboard</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.workspace}>
        {loading ? (
          <View style={styles.centerState}>
            <ActivityIndicator size="large" />
            <Text style={styles.stateText}>Loading bar chairs…</Text>
          </View>
        ) : error ? (
          <View style={styles.centerState}>
            <Text style={styles.errorTitle}>Unable to load bar</Text>
            <Text style={styles.stateText}>{error}</Text>

            <Pressable
              onPress={() => void loadBarState()}
              style={({ pressed }) => [
                styles.retryButton,
                pressed && styles.backButtonPressed,
              ]}
            >
              <Text style={styles.retryButtonText}>Retry</Text>
            </Pressable>
          </View>
        ) : chairs.length === 0 ? (
          <View style={styles.centerState}>
            <Text style={styles.errorTitle}>No bar chairs configured</Text>
            <Text style={styles.stateText}>
              Configure bar chairs before using the Bar workspace.
            </Text>
          </View>
        ) : (
          renderFloorchart()
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f4efe6',
    padding: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#111111',
  },
  subtitle: {
    marginTop: 4,
    fontSize: 14,
    color: '#6b6258',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  openTabsButton: {
    borderWidth: 1,
    borderColor: '#4f463b',
    borderRadius: 8,
    backgroundColor: '#fffaf2',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  openTabsButtonText: {
    color: '#4f463b',
    fontWeight: '700',
  },
  backButton: {
    backgroundColor: '#111111',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  backButtonPressed: {
    opacity: 0.82,
  },
  backButtonText: {
    color: '#ffffff',
    fontWeight: '700',
  },
  workspace: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#d8cdbd',
    backgroundColor: '#fffaf2',
    overflow: 'hidden',
  },
  horizontalScrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
  },
  floorchart: {
    minWidth: 1080,
    justifyContent: 'center',
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    gap: 10,
    marginLeft: 78,
    marginBottom: 10,
  },
  middleRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  leftColumn: {
    width: 68,
    gap: 10,
    justifyContent: 'center',
  },
  barShape: {
    flex: 1,
    minHeight: 330,
    marginLeft: 10,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: '#4f463b',
    backgroundColor: '#e8dece',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rightSpacer: {
    width: 68,
  },
  bottomRow: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    gap: 10,
    marginTop: 10,
  },
  chair: {
    width: 58,
    height: 58,
    borderRadius: 29,
    borderWidth: 2,
    borderColor: '#6b6258',
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  occupiedChair: {
    borderColor: '#4f463b',
    backgroundColor: '#4f463b',
  },
  creatingChair: {
    opacity: 0.58,
  },
  chairPressed: {
    opacity: 0.72,
    transform: [{ scale: 0.96 }],
  },
  chairNumber: {
    fontSize: 17,
    fontWeight: '800',
    color: '#111111',
  },
  occupiedChairNumber: {
    color: '#fffaf2',
  },
  chairStatus: {
    marginTop: 1,
    maxWidth: 48,
    fontSize: 7,
    fontWeight: '700',
    color: '#6b6258',
    textAlign: 'center',
  },
  occupiedChairStatus: {
    color: '#fffaf2',
  },
  missingChair: {
    borderStyle: 'dashed',
    borderColor: '#c8bca9',
    backgroundColor: '#f4efe6',
  },
  missingChairText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#a49684',
  },
  barLabel: {
    fontSize: 32,
    fontWeight: '800',
    color: '#4f463b',
    letterSpacing: 1.5,
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111111',
    textAlign: 'center',
  },
  stateText: {
    marginTop: 10,
    maxWidth: 420,
    fontSize: 15,
    lineHeight: 21,
    color: '#6b6258',
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 18,
    backgroundColor: '#111111',
    borderRadius: 8,
    paddingHorizontal: 18,
    paddingVertical: 11,
  },
  retryButtonText: {
    color: '#ffffff',
    fontWeight: '700',
  },
});
