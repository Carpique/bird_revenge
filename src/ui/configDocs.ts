/**
 * Reads the doc comments of `config` out of the source of config.ts, so the tuning panel can show them as tooltips
 * while the comments stay the one place they're written.
 *
 * Keys are dotted paths: 'tilt' for a section's own comment, 'tilt.sideSpeed' for an option's.
 */
export function parseConfigDocs(source: string): Record<string, string> {
  const docs: Record<string, string> = {};
  const lines = source.split('\n');
  const start = lines.findIndex((l) => /^export const config = \{/.test(l));
  if (start < 0) return docs;

  const path: string[] = [];
  let comment: string[] | null = null;
  let pending: string | null = null;

  for (const line of lines.slice(start + 1)) {
    const t = line.trim();
    if (/^};?$/.test(line)) break;

    if (comment) {
      const end = t.endsWith('*/');
      const text = t.replace(/\*\/$/, '').replace(/^\*\s?/, '').trim();
      if (text) comment.push(text);
      if (end) (pending = comment.join(' ')), (comment = null);
      continue;
    }
    if (t.startsWith('/**')) {
      const body = t.slice(3);
      if (body.endsWith('*/')) pending = body.slice(0, -2).trim();
      else comment = body.trim() ? [body.trim()] : [];
      continue;
    }

    const key = /^(\w+):/.exec(t);
    if (key) {
      if (pending) docs[[...path, key[1]].join('.')] = clean(pending);
      if (t.endsWith('{')) path.push(key[1]);
    } else if (/^\},?$/.test(t)) {
      path.pop();
    }
    pending = null;
  }
  return docs;
}

/** Plain text for a native tooltip: code quotes and list dashes dropped. */
function clean(text: string): string {
  return text.replace(/`/g, '').replace(/\s+-\s+/g, '\n• ').trim();
}
