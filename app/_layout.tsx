

import { StripeProvider } from '@stripe/stripe-react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { config } from '../src/config';

export default function RootLayout() {
  return (
    <StripeProvider
      publishableKey={config.stripe.publishableKey}
      merchantIdentifier="merchant.com.dineworkspace"
    >
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerShown: false,
        }}
      />
    </StripeProvider>
  );
}
