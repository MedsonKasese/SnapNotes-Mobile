import { Linking, Text } from 'react-native';
import { normalizeNoteLink, type RichLine, type RichRun } from '../noteFormatting.ts';

export type FormattedTextProps = {
  line?: RichLine;
  fallback: string;
  skipChecklistMarker?: boolean;
};

function removeChecklistMarker(runs: RichRun[]): RichRun[] {
  const text = runs.map(run => run.text).join('');
  const marker = /^\s*[☐☑](?:\s|$)/.exec(text);
  if (!marker) return runs;
  let remaining = marker[0].length;
  const result: RichRun[] = [];
  for (const run of runs) {
    const remove = Math.min(remaining, run.text.length);
    remaining -= remove;
    const textAfter = run.text.slice(remove);
    if (textAfter) result.push({ ...run, text: textAfter });
  }
  return result;
}

function openSafeLink(url: string): void {
  const safeUrl = normalizeNoteLink(url);
  if (!safeUrl) return;
  try { void Linking.openURL(safeUrl).catch(() => undefined); }
  catch { /* A platform may reject or lack a handler for an otherwise safe URI. */ }
}

export function FormattedText({ line, fallback, skipChecklistMarker = false }: FormattedTextProps) {
  const runs = line?.runs ?? [{ text: fallback }];
  const visibleRuns = skipChecklistMarker ? removeChecklistMarker(runs) : runs;
  return (
    <Text>
      {line?.bullet ? <Text>{line.bullet}</Text> : null}
      {visibleRuns.map((run, index) => {
        const href = run.href ? normalizeNoteLink(run.href) : null;
        return (
          <Text
            key={`${index}-${run.text}`}
            style={[
              run.bold && { fontWeight: '700' },
              run.italic && { fontStyle: 'italic' },
              href && { color: '#2563eb', textDecorationLine: 'underline' },
            ]}
            onPress={href ? event => { event.stopPropagation(); openSafeLink(href); } : undefined}
            accessibilityRole={href ? 'link' : undefined}
          >
            {run.text}
          </Text>
        );
      })}
    </Text>
  );
}
