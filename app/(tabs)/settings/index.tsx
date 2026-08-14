import { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { auth, getCurrentActor, StaffRole } from '../../../src/lib/firebase';
import { checkBackendReachable } from '../../../src/lib/api';
import { useRouter } from 'expo-router';
import { config } from '../../../src/config';

export default function SettingsScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [role, setRole] = useState<StaffRole | 'Unknown'>('Unknown');
  const [checking, setChecking] = useState(false);
  const [isOnline, setIsOnline] = useState<boolean | null>(null);

  useEffect(() => {
    const unsub = auth.onAuthStateChanged(async (u) => {
      setUserEmail(u?.email ?? null);

      // Refresh role on auth changes
      try {
        const r = (await getCurrentActor())?.role ?? 'Unknown';
        setRole(r);
      } catch {
        setRole('Unknown');
      }

      // Best-effort backend check (non-blocking)
      try {
        const ok = await checkBackendReachable({ timeoutMs: 1200 });
        setIsOnline(ok);
      } catch {
        setIsOnline(false);
      }
    });
    return unsub;
  }, []);

  async function handleSignIn() {
    if (!email || !password) {
      Alert.alert('Missing credentials', 'Enter email and password.');
      return;
    }

    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);

      setEmail('');
      setPassword('');
      router.push('/');
    } catch (e: any) {
      Alert.alert('Sign-in failed', e?.message || 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  async function handleSignOut() {
    try {
      await signOut(auth);
      setRole('Unknown');
      setIsOnline(null);
    } catch (e: any) {
      Alert.alert('Sign-out failed', e?.message || 'Unknown error');
    }
  }

  async function refreshDiagnostics() {
    setChecking(true);
    try {
      const r = (await getCurrentActor())?.role ?? 'Unknown';
      setRole(r);
    } catch {
      setRole('Unknown');
    }

    try {
      const ok = await checkBackendReachable({ timeoutMs: 1500 });
      setIsOnline(ok);
    } catch {
      setIsOnline(false);
    } finally {
      setChecking(false);
    }
  }

  return (
    <View style={styles.container}>
      <Pressable
        style={styles.backButton}
        onPress={() => router.push('/')}
      >
        <Text style={styles.backButtonText}>Back</Text>
      </Pressable>
      <Text style={styles.title}>Settings</Text>
      <Text style={styles.subtitle}>Staff authentication and environment</Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Environment</Text>
        <Text style={styles.cardRow}>
          API Base URL: {config.api.baseUrl}
        </Text>
        <Text style={styles.cardRow}>
          Restaurant ID: {config.restaurantId}
        </Text>
      </View>

      <View style={styles.card}>
        <View style={styles.cardHeaderRow}>
          <Text style={styles.cardTitle}>Diagnostics</Text>
          <Pressable
            style={[styles.chipBtn, checking && { opacity: 0.6 }]}
            onPress={refreshDiagnostics}
            disabled={checking}
          >
            {checking ? (
              <ActivityIndicator />
            ) : (
              <Text style={styles.chipBtnText}>Refresh</Text>
            )}
          </Pressable>
        </View>

        <Text style={styles.cardRow}>Role: {role}</Text>
        <Text style={styles.cardRow}>
          Backend reachable: {isOnline === null ? '—' : isOnline ? 'Yes' : 'No'}
        </Text>

        {role === 'Unknown' ? (
          <Text style={styles.hintText}>
            The backend could not resolve this staff account. Privileged order actions are disabled.
          </Text>
        ) : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Account</Text>

        {userEmail ? (
          <>
            <Text style={styles.cardRow}>Signed in as: {userEmail}</Text>
            <Pressable
              style={[
                styles.button,
                {
                  height: 48,
                  backgroundColor: '#efe7d8',
                  borderColor: '#c8bda8',
                },
              ]}
              onPress={handleSignOut}
            >
              <Text style={styles.buttonText}>Sign out</Text>
            </Pressable>
          </>
        ) : (
          <>
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="Staff email"
              autoCapitalize="none"
              keyboardType="email-address"
              style={styles.input}
            />
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="Password"
              secureTextEntry
              style={styles.input}
            />
            <Pressable
              style={[styles.button, loading && { opacity: 0.6 }]}
              onPress={handleSignIn}
              disabled={loading}
            >
              <Text style={styles.buttonText}>
                {loading ? 'Signing in…' : 'Sign in'}
              </Text>
            </Pressable>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backButton: {
    alignSelf: 'flex-end',
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#c8bda8',
    borderRadius: 10,
    paddingHorizontal: 11,
    paddingVertical: 9,
    backgroundColor: '#fffaf2',
  },
  backButtonText: {
    color: '#4f463b',
    fontWeight: '900',
    fontSize: 13,
  },
  container: {
    flex: 1,
    backgroundColor: '#f6f2eb',
    padding: 24,
    gap: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: -0.4,
    marginBottom: 4,
    color: '#111111',
  },
  subtitle: {
    fontSize: 15,
    color: '#6f6252',
    fontWeight: '700',
    marginBottom: 8,
  },
  card: {
    borderWidth: 1,
    borderColor: '#c8bda8',
    borderRadius: 10,
    padding: 16,
    backgroundColor: '#fffaf2',
    gap: 10,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  chipBtn: {
    borderWidth: 1,
    borderColor: '#c8bda8',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
    minWidth: 84,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fffaf2',
  },
  chipBtnText: {
    color: '#4f463b',
    fontWeight: '900',
    fontSize: 13,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: '#111111',
    letterSpacing: -0.2,
  },
  cardRow: {
    fontSize: 14,
    color: '#4f463b',
    lineHeight: 20,
  },
  hintText: {
    fontSize: 13,
    color: '#6f6252',
    lineHeight: 18,
  },
  input: {
    height: 48,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#c8bda8',
    backgroundColor: '#fffaf2',
    paddingHorizontal: 12,
    fontSize: 16,
    color: '#111111',
  },
  button: {
    marginTop: 8,
    height: 54,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#111111',
    backgroundColor: '#FFFFFF',
  },
  buttonText: {
    color: '#111111',
    fontWeight: '900',
    fontSize: 15,
  },
});