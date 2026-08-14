import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import { FloorBoard } from '../../src/features/floorboard';
import { startOrderSync, stopOrderSync } from '../../src/state/orderSync';
import { View, Pressable, Text } from 'react-native';
import {
  getIdToken,
  getCurrentActor,
  type StaffRole,
} from '../../src/lib/firebase';
import { listTableAssignments, type TableAssignment } from '../../src/lib/api';
import { background } from '../../src/design-system/tokens/colors';

export default function RootScreen() {
  const router = useRouter();
  const [assignments, setAssignments] = useState<TableAssignment[]>([]);
  const [uiRole, setUiRole] = useState<StaffRole | 'unknown'>('unknown');
  const [currentStaffUserId, setCurrentStaffUserId] = useState<string | null>(null);

  useEffect(() => {
    startOrderSync(getIdToken);
    let mounted = true;

    async function loadAssignments() {
      try {
        const token = await getIdToken();
        const actor = await getCurrentActor();
        const nextRole = actor?.role ?? 'unknown';
        const nextStaffUserId = actor?.userId ?? null;


        if (mounted) {
          setUiRole(nextRole);
          setCurrentStaffUserId(nextStaffUserId);
        }

        if (!token) {
          console.warn('[floorboard] skipped table assignments load: missing token');
          return;
        }

        const nextAssignments = await listTableAssignments({ token });

        if (mounted) {
          setAssignments(nextAssignments);
        }
      } catch (error) {
        console.warn('[floorboard] failed to load table assignments', error);
      }
    }

    loadAssignments();

    return () => {
      mounted = false;
      stopOrderSync();
    };
  }, []);

  const visibleTableIds = useMemo(() => {
    if (uiRole === 'unknown') {
      return [];
    }

    if (uiRole === 'Owner' || uiRole === 'Manager') {
      return undefined;
    }

    if (!currentStaffUserId) {
      return [];
    }

    return assignments
      .filter((assignment) => assignment.active !== false)
      .filter(
        (assignment) =>
          String(assignment.staff_user_id ?? '').trim() === currentStaffUserId
      )
      .map((assignment) => String(assignment.table_id ?? '').trim())
      .filter(Boolean);
  }, [assignments, currentStaffUserId, uiRole]);

  return (
    <View style={{ flex: 1, backgroundColor: background.app }}>
      <Pressable
        onPress={() => router.push('/settings')}
        style={{
          position: 'absolute',
          top: 50,
          right: 20,
          zIndex: 1000,
          paddingVertical: 8,
          paddingHorizontal: 12,
          backgroundColor: '#111',
          borderRadius: 6,
        }}
      >
        <Text style={{ color: '#fff', fontWeight: '600' }}>Settings</Text>
      </Pressable>

      <FloorBoard
        assignments={assignments}
        visibleTableIds={visibleTableIds}
        onOpenTable={(tableId) => {
          router.push(`/table/${tableId}`);
        }}
      />
    </View>
  );
}
