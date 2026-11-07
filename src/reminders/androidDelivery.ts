// Expo SDK 58 maps alarmClock to AlarmManager.setAlarmClock(), which avoids
// Doze/OEM alarm deferral but requires exact-alarm access on Android 12+.
// Android 9–11 need no such permission, so use it there and keep the default
// best-effort path on newer Android until the app has an explicit permission flow.
export function getAndroidReminderDelivery(
  platform: string,
  platformVersion: string | number,
): 'alarmClock' | undefined {
  if (platform !== 'android') return undefined;
  const apiLevel = typeof platformVersion === 'number' ? platformVersion : Number(platformVersion);
  return Number.isInteger(apiLevel) && apiLevel > 0 && apiLevel < 31 ? 'alarmClock' : undefined;
}
