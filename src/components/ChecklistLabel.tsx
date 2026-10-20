import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { TextLayoutEvent } from 'react-native';

type Lines = TextLayoutEvent['nativeEvent']['lines'];

// Native textDecorationStyle does not provide a portable Android stroke width.
// Measure the actual italic text and draw a 2-point stroke per visual line,
// rather than crossing the empty space at the end of a wrapped label.
export function ChecklistLabel({ text, checked }: { text: string; checked: boolean }) {
  const [layout, setLayout] = useState<{ text: string; lines: Lines } | null>(null);
  const lines = checked && layout?.text === text ? layout.lines : [];

  return (
    <View style={[styles.container, checked && styles.completed]}>
      <Text
        style={[styles.text, checked && styles.italic]}
        onTextLayout={checked ? event => setLayout({ text, lines: event.nativeEvent.lines }) : undefined}
      >
        {text || ' '}
      </Text>
      <View pointerEvents="none" accessible={false} style={StyleSheet.absoluteFill}>
        {lines.filter(line => line.text.trim().length > 0).map((line, index) => (
          <View
            key={index}
            style={[
              styles.strike,
              {
                left: line.x,
                top: line.y + line.height / 2 - 1,
                width: line.width,
              },
            ]}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, minWidth: 0 },
  text: { color: '#485843', fontSize: 14, lineHeight: 21, includeFontPadding: false },
  completed: { opacity: 0.7 },
  italic: { fontStyle: 'italic' },
  strike: { position: 'absolute', height: 2, backgroundColor: '#485843' },
});
