import type { ReactNode } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

type OpenTabDetailShellProps = {
  title: string;
  subtitle?: string;
  status?: string;
  onBack: () => void;
  headerActions?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
};

export function OpenTabDetailShell({
  title,
  subtitle,
  status,
  onBack,
  headerActions,
  footer,
  children,
}: OpenTabDetailShellProps) {
  return (
    <View style={styles.screen}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to Open Tabs"
          onPress={onBack}
          style={({ pressed }) => [
            styles.backButton,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.backButtonText}>← Open Tabs</Text>
        </Pressable>

        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.title}>{title}</Text>

            {subtitle ? (
              <Text style={styles.subtitle}>{subtitle}</Text>
            ) : null}
          </View>

          {status || headerActions ? (
            <View style={styles.headerRight}>
              {status ? (
                <View style={styles.statusPill}>
                  <Text style={styles.statusText}>{status}</Text>
                </View>
              ) : null}

              {headerActions}
            </View>
          ) : null}
        </View>

        {children}
      </ScrollView>

      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#f7f4ee',
  },
  scroll: {
    flex: 1,
  },
  content: {
    width: '100%',
    alignSelf: 'center',
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 48,
  },
  footer: {
    width: '100%',
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 20,
    backgroundColor: '#f7f4ee',
  },
  backButton: {
    alignSelf: 'flex-start',
    minHeight: 40,
    justifyContent: 'center',
    marginBottom: 14,
    paddingHorizontal: 2,
  },
  backButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#40392f',
  },
  pressed: {
    opacity: 0.72,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 20,
  },
  headerText: {
    flex: 1,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '700',
    color: '#171512',
  },
  subtitle: {
    marginTop: 5,
    fontSize: 15,
    color: '#746b60',
  },
  statusPill: {
    borderWidth: 1,
    borderColor: '#c9bda9',
    borderRadius: 999,
    backgroundColor: '#fffaf2',
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
    color: '#40392f',
  },
});
