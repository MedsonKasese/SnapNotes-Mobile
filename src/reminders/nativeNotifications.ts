import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { Platform } from 'react-native';
import { createReminderScheduler } from './scheduler';
import { getAndroidReminderDelivery } from './androidDelivery';

export const REMINDER_CHANNEL_ID = 'local-reminders';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

async function prepareNotifications() {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(REMINDER_CHANNEL_ID, {
      name: 'Reminders',
      importance: AndroidImportance.DEFAULT,
      vibrationPattern: [0, 250, 250, 250],
    });
  }
}

function isPermissionGranted(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const response = value as { granted?: unknown; ios?: { status?: unknown } };
  if (response.granted === true) return true;
  const status = String(response.ios?.status ?? '').toLowerCase();
  return ['authorized', 'provisional', 'ephemeral', '2', '3', '4'].includes(status);
}

export const localReminderScheduler = createReminderScheduler({
  prepare: prepareNotifications,
  async hasPermission() {
    return isPermissionGranted(await Notifications.getPermissionsAsync());
  },
  async requestPermission() {
    const current = await Notifications.getPermissionsAsync();
    if (isPermissionGranted(current)) return true;
    const requested = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowBadge: false, allowSound: true },
    });
    return isPermissionGranted(requested);
  },
  getAllScheduledNotificationsAsync: () => Notifications.getAllScheduledNotificationsAsync(),
  scheduleNotificationAsync(request) {
    const androidDelivery = getAndroidReminderDelivery(Platform.OS, Platform.Version);
    return Notifications.scheduleNotificationAsync({
      content: {
        title: request.content.title,
        body: request.content.body,
        data: request.content.data,
        sound: true,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: request.trigger.date,
        ...(Platform.OS === 'android' ? {
          channelId: REMINDER_CHANNEL_ID,
          ...(androidDelivery ? { delivery: androidDelivery } : {}),
        } : {}),
      },
    });
  },
  cancelScheduledNotificationAsync: identifier => Notifications.cancelScheduledNotificationAsync(identifier),
});

export function addReminderReceivedListener(listener: () => void): () => void {
  const subscription = Notifications.addNotificationReceivedListener(() => listener());
  return () => subscription.remove();
}
