import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import type { ComponentProps } from 'react';
import type { FormattingAction, FormattingState } from './RichNoteEditor';

type Tool = { action: FormattingAction; label: string; icon: ComponentProps<typeof FontAwesome>['name']; state?: keyof FormattingState };
export const FORMATTING_TOOLS: readonly Tool[] = [
  { action: 'bold', label: 'Bold', icon: 'bold', state: 'bold' },
  { action: 'italic', label: 'Italics', icon: 'italic', state: 'italic' },
  { action: 'insertUnorderedList', label: 'Unordered list', icon: 'list-ul', state: 'unordered' },
  { action: 'insertOrderedList', label: 'Ordered list', icon: 'list-ol', state: 'ordered' },
  { action: 'checklist', label: 'Checkbox', icon: 'check-square' },
  { action: 'link', label: 'Insert link', icon: 'link' },
];

export function FormattingToolbar({ disabled, active, onAction }: {
  disabled: boolean; active: FormattingState; onAction: (action: FormattingAction) => void;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scroll}
      contentContainerStyle={styles.tools} keyboardShouldPersistTaps="always" accessibilityLabel="Note formatting">
      {FORMATTING_TOOLS.map(tool => {
        const selected = tool.state ? Boolean(active[tool.state]) : false;
        return <Pressable key={tool.action} accessibilityRole="button" accessibilityLabel={tool.label}
          accessibilityHint={tool.action === 'link' ? 'Add a link to the selected text or insert a URL' : undefined}
          accessibilityState={{ disabled, ...(tool.state ? { selected } : {}) }} disabled={disabled}
          onPress={() => onAction(tool.action)}
          style={({ pressed }) => [styles.tool, selected && styles.active, (pressed || disabled) && styles.dimmed]}>
          <View accessible={false}><FontAwesome name={tool.icon} size={17} color={selected ? '#347b0a' : '#52634b'} accessible={false} /></View>
        </Pressable>;
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0, flexShrink: 1, minWidth: 0 },
  tools: { flexDirection: 'row', alignItems: 'center' },
  tool: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  active: { backgroundColor: '#eaf5e1' },
  dimmed: { opacity: 0.5 },
});
