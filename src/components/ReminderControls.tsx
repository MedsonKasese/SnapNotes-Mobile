import { useMemo, useState } from 'react';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { normalizeReminderRepeat, type ReminderFrequency, type ReminderRepeat } from '../reminders/recurrence';

type ReminderValue = { reminderAt: string | null; reminderRepeat: ReminderRepeat | null; reminderNotified: boolean };
type Props = {
  reminderAt?: string | null;
  reminderRepeat?: ReminderRepeat | null;
  onChange(value: ReminderValue): void;
  disabled?: boolean;
};
const FREQUENCIES: { value: ReminderFrequency; label: string; unit: string }[] = [
  { value: 'daily', label: 'Daily', unit: 'days' },
  { value: 'weekly', label: 'Weekly', unit: 'weeks' },
  { value: 'monthly', label: 'Monthly', unit: 'months' },
];

function deviceTimeZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
  catch { return 'UTC'; }
}
function dateFor(value?: string | null): Date {
  const parsed = value ? new Date(value) : new Date(Date.now() + 60 * 60 * 1000);
  return Number.isFinite(parsed.getTime()) ? parsed : new Date(Date.now() + 60 * 60 * 1000);
}
function formatDateTime(value?: string | null): string {
  if (!value) return 'Choose date and time';
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : 'Choose date and time';
}

export function ReminderControls({ reminderAt, reminderRepeat, onChange, disabled = false }: Props) {
  const normalizedRepeat = useMemo(() => reminderRepeat == null
    ? null : normalizeReminderRepeat(reminderRepeat, reminderAt), [reminderRepeat, reminderAt]);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [pickerMode, setPickerMode] = useState<'date' | 'time' | null>(null);
  const [pickerValue, setPickerValue] = useState<Date>(() => dateFor(reminderAt));
  const [dateStage, setDateStage] = useState<Date>(() => dateFor(reminderAt));
  const intervalBase = normalizedRepeat?.interval ?? 2;
  const [intervalDraft, setIntervalDraft] = useState<{ reminderAt: string | null; base: number; text: string } | null>(null);
  const hasCurrentIntervalDraft = intervalDraft?.reminderAt === (reminderAt ?? null) && intervalDraft.base === intervalBase;
  const intervalText = hasCurrentIntervalDraft ? intervalDraft.text : String(intervalBase);
  const intervalNumber = /^\d{1,3}$/.test(intervalText) ? Number(intervalText) : 0;
  const invalidInterval = hasCurrentIntervalDraft && (intervalNumber < 1 || intervalNumber > 365);

  function emitReminderDate(date: Date) {
    const iso = date.toISOString();
    setIntervalDraft(null);
    const repeat = normalizedRepeat ? {
      ...normalizedRepeat, anchorAt: iso, timeZone: deviceTimeZone(),
    } : null;
    onChange({ reminderAt: iso, reminderRepeat: repeat, reminderNotified: false });
  }

  function openDatePicker() {
    if (disabled) return;
    const value = dateFor(reminderAt);
    setPickerValue(value);
    setDateStage(value);
    if (Platform.OS === 'ios') setPickerVisible(true);
    else setPickerMode('date');
  }

  function onAndroidPickerChange(event: { type?: string }, value?: Date) {
    const mode = pickerMode;
    if (event.type !== 'set' || !value || !mode) { setPickerMode(null); return; }
    if (mode === 'date') {
      const combined = new Date(dateStage);
      combined.setFullYear(value.getFullYear(), value.getMonth(), value.getDate());
      setDateStage(combined);
      setPickerValue(combined);
      setPickerMode('time');
      return;
    }
    const combined = new Date(dateStage);
    combined.setHours(value.getHours(), value.getMinutes(), 0, 0);
    setPickerMode(null);
    emitReminderDate(combined);
  }

  function setRepeat(frequency: ReminderFrequency | null, interval = 1) {
    if (!reminderAt || disabled) return;
    setIntervalDraft(null);
    if (frequency === null) {
      onChange({ reminderAt, reminderRepeat: null, reminderNotified: false });
      return;
    }
    const repeat: ReminderRepeat = {
      frequency, interval, timeZone: normalizedRepeat?.timeZone ?? deviceTimeZone(),
      anchorAt: normalizedRepeat?.anchorAt ?? reminderAt,
    };
    onChange({ reminderAt, reminderRepeat: repeat, reminderNotified: false });
  }

  function updateInterval(value: string) {
    setIntervalDraft({ reminderAt: reminderAt ?? null, base: intervalBase, text: value });
    const interval = /^\d{1,3}$/.test(value) ? Number(value) : 0;
    const valid = interval >= 1 && interval <= 365;
    if (!valid || !reminderAt || !normalizedRepeat) return;
    onChange({ reminderAt, reminderRepeat: { ...normalizedRepeat, interval }, reminderNotified: false });
  }

  const isCustom = Boolean(normalizedRepeat && normalizedRepeat.interval !== 1);
  return (
    <View style={styles.container}>
      <Text style={styles.label}>Reminder</Text>
      <View style={styles.dateRow}>
        <Pressable accessibilityRole="button" accessibilityLabel={reminderAt ? 'Change reminder date and time' : 'Set reminder date and time'}
          accessibilityState={{ disabled }} disabled={disabled} onPress={openDatePicker}
          style={({ pressed }) => [styles.dateButton, pressed && styles.pressed, disabled && styles.disabled]}>
          <Text style={styles.dateButtonText}>{formatDateTime(reminderAt)}</Text>
        </Pressable>
        {reminderAt && <Pressable accessibilityRole="button" accessibilityLabel="Clear reminder" disabled={disabled}
          onPress={() => { setIntervalDraft(null); onChange({ reminderAt: null, reminderRepeat: null, reminderNotified: false }); }}
          style={({ pressed }) => [styles.clearButton, pressed && styles.pressed, disabled && styles.disabled]}>
          <Text style={styles.clearText}>Clear</Text>
        </Pressable>}
      </View>
      {reminderAt && <>
        <Text style={styles.label}>Repeat</Text>
        <View style={styles.frequencyRow}>
          <FrequencyButton label="Never" selected={!normalizedRepeat} disabled={disabled} onPress={() => setRepeat(null)} />
          {FREQUENCIES.map(item => <FrequencyButton key={item.value} label={item.label}
            selected={normalizedRepeat?.frequency === item.value && normalizedRepeat.interval === 1}
            disabled={disabled} onPress={() => setRepeat(item.value, 1)} />)}
          <FrequencyButton label="Custom" selected={isCustom} disabled={disabled} onPress={() => setRepeat(normalizedRepeat?.frequency ?? 'daily', 2)} />
        </View>
        {normalizedRepeat && isCustom && <View style={styles.customRow}>
          <Text style={styles.customLabel}>Every</Text>
          <TextInput accessibilityLabel="Custom repeat interval" keyboardType="number-pad" editable={!disabled}
            value={intervalText} onChangeText={updateInterval} maxLength={3} style={[styles.intervalInput, invalidInterval && styles.invalidInput]} />
          {FREQUENCIES.map(item => <FrequencyButton key={item.value} label={item.unit}
            selected={normalizedRepeat.frequency === item.value} disabled={disabled}
            onPress={() => setRepeat(item.value, normalizedRepeat.interval)} />)}
        </View>}
        {invalidInterval && <Text accessibilityRole="alert" style={styles.validation}>Enter a repeat interval from 1 to 365.</Text>}
        <Text style={styles.helper}>Repeats use the saved time zone and are refreshed when SnapNotes opens.</Text>
      </>}
      {Platform.OS === 'ios' && <Modal visible={pickerVisible} transparent animationType="fade" onRequestClose={() => setPickerVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Reminder date and time</Text>
            <DateTimePicker value={pickerValue} mode="datetime" display="spinner"
              onChange={(event, date) => { if (event.type === 'set' && date) setPickerValue(date); }} />
            <View style={styles.modalActions}>
              <Pressable accessibilityRole="button" onPress={() => setPickerVisible(false)} style={styles.modalAction}><Text style={styles.modalCancel}>Cancel</Text></Pressable>
              <Pressable accessibilityRole="button" onPress={() => { emitReminderDate(pickerValue); setPickerVisible(false); }} style={[styles.modalAction, styles.modalConfirm]}><Text style={styles.modalConfirmText}>Set reminder</Text></Pressable>
            </View>
          </View>
        </View>
      </Modal>}
      {Platform.OS === 'android' && pickerMode && <DateTimePicker value={pickerMode === 'time' ? dateStage : pickerValue}
        mode={pickerMode} display="default" onChange={onAndroidPickerChange} />}
    </View>
  );
}

function FrequencyButton({ label, selected, disabled, onPress }: { label: string; selected: boolean; disabled: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected, disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.frequencyButton, selected && styles.frequencySelected, pressed && styles.pressed, disabled && styles.disabled]}>
    <Text style={[styles.frequencyText, selected && styles.frequencyTextSelected]}>{label}</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  container: { gap: 8, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: '#dfe7d9', backgroundColor: '#f8faf6' },
  label: { color: '#354b30', fontSize: 13, fontWeight: '800' },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dateButton: { flex: 1, minHeight: 42, justifyContent: 'center', paddingHorizontal: 11, borderRadius: 9, borderWidth: 1, borderColor: '#cbd9c3', backgroundColor: '#fff' },
  dateButtonText: { color: '#20351d', fontSize: 14, fontWeight: '700' },
  clearButton: { minHeight: 40, justifyContent: 'center', paddingHorizontal: 10 },
  clearText: { color: '#a32b2b', fontWeight: '700' },
  frequencyRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  frequencyButton: { minHeight: 34, justifyContent: 'center', paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: '#cbd9c3', backgroundColor: '#fff' },
  frequencySelected: { borderColor: '#3b7f16', backgroundColor: '#eaf5e4' },
  frequencyText: { color: '#50614b', fontSize: 12, fontWeight: '700' },
  frequencyTextSelected: { color: '#2f6b10' },
  customRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  customLabel: { color: '#50614b', fontSize: 13, fontWeight: '700' },
  intervalInput: { minWidth: 54, height: 38, paddingHorizontal: 8, textAlign: 'center', borderRadius: 8, borderWidth: 1, borderColor: '#cbd9c3', color: '#20351d', backgroundColor: '#fff' },
  invalidInput: { borderColor: '#b3261e' },
  validation: { color: '#a32b2b', fontSize: 12 },
  helper: { color: '#687b69', fontSize: 12, lineHeight: 17 },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.55 },
  modalBackdrop: { flex: 1, justifyContent: 'center', padding: 20, backgroundColor: 'rgba(0,0,0,0.35)' },
  modalCard: { padding: 16, borderRadius: 14, backgroundColor: '#fff' },
  modalTitle: { marginBottom: 8, color: '#20351d', fontSize: 17, fontWeight: '800' },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 12 },
  modalAction: { minHeight: 42, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 9 },
  modalConfirm: { backgroundColor: '#3b7f16' },
  modalCancel: { color: '#52634b', fontWeight: '700' },
  modalConfirmText: { color: '#fff', fontWeight: '800' },
});
