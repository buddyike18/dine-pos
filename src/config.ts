const ENV = process.env;

const required = (value: string | undefined, name: string): string => {
  if (!value) {
    throw new Error(`[CONFIG ERROR] Missing required env: ${name}`);
  }
  return value;
};

const optional = (value: string | undefined, fallback = ''): string => {
  return value ?? fallback;
};

const APP_ENV = required(
  ENV.EXPO_PUBLIC_APP_ENV,
  'EXPO_PUBLIC_APP_ENV'
);

if (!['local', 'staging', 'production'].includes(APP_ENV)) {
  throw new Error(
    `[CONFIG ERROR] EXPO_PUBLIC_APP_ENV must be one of: local, staging, production`
  );
}

const API_BASE_URL = required(
  ENV.EXPO_PUBLIC_API_BASE_URL,
  'EXPO_PUBLIC_API_BASE_URL'
);

let parsedUrl: URL;

try {
  parsedUrl = new URL(API_BASE_URL);
} catch {
  throw new Error(
    `[CONFIG ERROR] EXPO_PUBLIC_API_BASE_URL must be a valid HTTP/HTTPS URL`
  );
}

if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
  throw new Error(
    `[CONFIG ERROR] EXPO_PUBLIC_API_BASE_URL must use HTTP or HTTPS`
  );
}

const host = parsedUrl.hostname.toLowerCase();

const isLocalHost =
  host === 'localhost' ||
  host === '127.0.0.1' ||
  host.startsWith('10.') ||
  host.startsWith('192.168.') ||
  /^172\.(1[6-9]|2\d|3[01])\./.test(host);

if (APP_ENV === 'production') {
  if (parsedUrl.protocol !== 'https:') {
    throw new Error(
      `[CONFIG ERROR] Production API URL must use HTTPS`
    );
  }

  if (isLocalHost) {
    throw new Error(
      `[CONFIG ERROR] Production API URL cannot target localhost or a private network`
    );
  }
}

const RESTAURANT_ID = required(
  ENV.EXPO_PUBLIC_RESTAURANT_ID,
  'EXPO_PUBLIC_RESTAURANT_ID'
);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

if (!UUID_RE.test(RESTAURANT_ID)) {
  throw new Error(
    `[CONFIG ERROR] EXPO_PUBLIC_RESTAURANT_ID must be a UUID`
  );
}

export const config = {
  app: {
    env: APP_ENV,
    nodeEnv: optional(ENV.NODE_ENV, 'development'),
  },

  api: {
    baseUrl: API_BASE_URL,
  },

  restaurantId: RESTAURANT_ID,

  firebase: {
    apiKey: required(
      ENV.EXPO_PUBLIC_FIREBASE_API_KEY,
      'EXPO_PUBLIC_FIREBASE_API_KEY'
    ),
    authDomain: required(
      ENV.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
      'EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN'
    ),
    projectId: required(
      ENV.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
      'EXPO_PUBLIC_FIREBASE_PROJECT_ID'
    ),
    storageBucket: required(
      ENV.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
      'EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET'
    ),
    messagingSenderId: required(
      ENV.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
      'EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID'
    ),
    appId: required(
      ENV.EXPO_PUBLIC_FIREBASE_APP_ID,
      'EXPO_PUBLIC_FIREBASE_APP_ID'
    ),
    measurementId: optional(
      ENV.EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID
    ),
  },

  stripe: {
    publishableKey: required(
      ENV.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY,
      'EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY'
    ),
  },
};
