import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  FirebaseApp,
  getApp,
  getApps,
  initializeApp,
} from 'firebase/app';
import * as FirebaseAuth from 'firebase/auth';
import type {
  Auth,
  Persistence,
  User,
} from 'firebase/auth';
import { config } from '../config';
import { fetchWithTimeout } from './network';

const {
  getAuth,
  initializeAuth,
  getReactNativePersistence,
  onAuthStateChanged,
} = FirebaseAuth as typeof FirebaseAuth & {
  getReactNativePersistence(
    storage: typeof AsyncStorage
  ): Persistence;
};

const REQUIRED_FIREBASE_CONFIG: Array<
  [keyof typeof config.firebase, string]
> = [
  ['apiKey', 'EXPO_PUBLIC_FIREBASE_API_KEY'],
  ['authDomain', 'EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN'],
  ['projectId', 'EXPO_PUBLIC_FIREBASE_PROJECT_ID'],
  ['storageBucket', 'EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET'],
  [
    'messagingSenderId',
    'EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
  ],
  ['appId', 'EXPO_PUBLIC_FIREBASE_APP_ID'],
];

function requireFirebaseProjectId(): string {
  for (const [key, envName] of REQUIRED_FIREBASE_CONFIG) {
    const value = String(config.firebase[key] ?? '').trim();

    if (!value) {
      throw new Error(
        `Missing required Firebase configuration: ${envName}`
      );
    }
  }

  return String(config.firebase.projectId ?? '').trim();
}

function validateFirebaseProject(
  app: FirebaseApp,
  configuredProjectId: string
): void {
  const initializedProjectId = String(
    app.options.projectId ?? ''
  ).trim();

  if (!initializedProjectId) {
    throw new Error(
      'Initialized Firebase app does not declare a projectId'
    );
  }

  if (initializedProjectId !== configuredProjectId) {
    throw new Error(
      `Firebase project mismatch: expected ${configuredProjectId}, received ${initializedProjectId}`
    );
  }
}

function getFirebaseErrorCode(
  error: unknown
): string | null {
  if (
    typeof error !== 'object' ||
    error === null ||
    !('code' in error)
  ) {
    return null;
  }

  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

const configuredProjectId =
  requireFirebaseProjectId();

const DEFAULT_APP_NAME = '[DEFAULT]';

const defaultAppExists = getApps().some(
  ({ name }) => name === DEFAULT_APP_NAME
);

const app = defaultAppExists
  ? getApp(DEFAULT_APP_NAME)
  : initializeApp(config.firebase);

validateFirebaseProject(
  app,
  configuredProjectId
);

let authInstance: Auth;

try {
  authInstance = initializeAuth(app, {
    persistence:
      getReactNativePersistence(AsyncStorage),
  });
} catch (error: unknown) {
  if (
    getFirebaseErrorCode(error) !==
    'auth/already-initialized'
  ) {
    throw error;
  }

  authInstance = getAuth(app);
}

export const auth = authInstance;

async function waitForAuthUser():
  Promise<User | null> {
  if (auth.currentUser) {
    return auth.currentUser;
  }

  return new Promise((resolve) => {
    let unsubscribe:
      | (() => void)
      | undefined;

    const timeout = setTimeout(() => {
      unsubscribe?.();
      resolve(auth.currentUser);
    }, 1500);

    unsubscribe = onAuthStateChanged(
      auth,
      (user) => {
        clearTimeout(timeout);
        unsubscribe?.();
        resolve(user);
      }
    );
  });
}

export async function getIdToken(
  forceRefresh = false
): Promise<string | null> {
  const user = await waitForAuthUser();

  if (!user) {
    return null;
  }

  return user.getIdToken(forceRefresh);
}

export type StaffRole =
  | 'Owner'
  | 'Manager'
  | 'Employee';

export interface CurrentActor {
  userId: string;
  firebaseUid: string;
  restaurantId: string;
  role: StaffRole;
  active: boolean;
}

function isStaffRole(
  value: unknown
): value is StaffRole {
  return (
    value === 'Owner' ||
    value === 'Manager' ||
    value === 'Employee'
  );
}

function parseCurrentActor(
  payload: unknown
): CurrentActor {
  if (
    typeof payload !== 'object' ||
    payload === null
  ) {
    throw new Error(
      'Backend returned an invalid actor payload'
    );
  }

  const actor =
    payload as Partial<CurrentActor>;

  if (
    typeof actor.userId !== 'string' ||
    !actor.userId.trim() ||
    typeof actor.firebaseUid !== 'string' ||
    !actor.firebaseUid.trim() ||
    typeof actor.restaurantId !== 'string' ||
    !actor.restaurantId.trim() ||
    !isStaffRole(actor.role) ||
    actor.active !== true
  ) {
    throw new Error(
      'Backend returned an invalid active actor payload'
    );
  }

  return {
    userId: actor.userId,
    firebaseUid: actor.firebaseUid,
    restaurantId: actor.restaurantId,
    role: actor.role,
    active: true,
  };
}

export async function getCurrentActor():
  Promise<CurrentActor | null> {
  const token = await getIdToken();

  if (!token) {
    return null;
  }

  const response = await fetchWithTimeout(
    `${config.api.baseUrl}/api/auth/me`,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
    }
  );

  if (
    response.status === 401 ||
    response.status === 403
  ) {
    return null;
  }

  if (!response.ok) {
    throw new Error(
      `Actor lookup failed with status ${response.status}`
    );
  }

  const payload = await response.json();

  if (
    typeof payload !== 'object' ||
    payload === null ||
    typeof (payload as { user?: unknown }).user !== 'object' ||
    (payload as { user?: unknown }).user === null
  ) {
    throw new Error(
      'Backend returned an invalid actor payload'
    );
  }

  const user = (payload as {
    user: {
      id?: unknown;
      firebase_uid?: unknown;
      restaurant_id?: unknown;
      role?: unknown;
      active?: unknown;
    };
  }).user;

  return parseCurrentActor({
    userId: user.id,
    firebaseUid: user.firebase_uid,
    restaurantId: user.restaurant_id,
    role: user.role,
    active: user.active,
  });
}
