import { gutter, GutterMarker, EditorView, Decoration, keymap } from '@codemirror/view';
import { StateField, StateEffect, RangeSet, RangeSetBuilder, type EditorState, type Extension } from '@codemirror/state';

// Breakpoint gutter for the transform editor: click a line number area (or press F9) to toggle a
// breakpoint. Breakpoints follow their line while the code is edited. Lines with a console call
// get a lighter marker, since in debug mode they also stop.

const CONSOLE_CALL = /\bconsole\.(log|info|warn|error|debug|table|dir|checkpoint)\s*\(/;

class BreakpointMarker extends GutterMarker {
  toDOM() {
    const el = document.createElement('span');
    el.className = 'cm-bp-dot';
    el.title = 'Breakpoint · clic para quitar';
    return el;
  }
}

class ConsoleMarker extends GutterMarker {
  toDOM() {
    const el = document.createElement('span');
    el.className = 'cm-bp-console';
    el.title = 'console.* · también se detiene en modo debug';
    return el;
  }
}

const breakpointMarker = new BreakpointMarker();
const consoleMarker = new ConsoleMarker();

const toggleBreakpoint = StateEffect.define<{ pos: number; on: boolean }>({
  map: (val, mapping) => ({ pos: mapping.mapPos(val.pos), on: val.on }),
});

function hasBreakpointAt(set: RangeSet<GutterMarker>, pos: number): boolean {
  let found = false;
  set.between(pos, pos, () => { found = true; return false; });
  return found;
}

function createField(initialLines: number[]) {
  return StateField.define<RangeSet<GutterMarker>>({
    create(state) {
      const builder = new RangeSetBuilder<GutterMarker>();
      Array.from(new Set(initialLines))
        .filter(l => l >= 1 && l <= state.doc.lines)
        .sort((a, b) => a - b)
        .forEach(l => {
          const from = state.doc.line(l).from;
          builder.add(from, from, breakpointMarker);
        });
      return builder.finish();
    },
    update(set, tr) {
      set = set.map(tr.changes);
      for (const e of tr.effects) {
        if (!e.is(toggleBreakpoint)) continue;
        set = e.value.on
          ? set.update({ add: [breakpointMarker.range(e.value.pos)], sort: true })
          : set.update({ filter: from => from !== e.value.pos });
      }
      if (!tr.docChanged) return set;
      // Two breakpoints can land on the same line after deleting text between them
      const seen = new Set<number>();
      return set.update({
        filter: from => {
          const line = tr.state.doc.lineAt(from).number;
          if (seen.has(line)) return false;
          seen.add(line);
          return true;
        },
      });
    },
  });
}

function toggleAt(view: EditorView, field: StateField<RangeSet<GutterMarker>>, pos: number) {
  const lineStart = view.state.doc.lineAt(pos).from;
  const set = view.state.field(field);
  let existing: number | null = null;
  set.between(lineStart, view.state.doc.lineAt(pos).to, from => { existing = from; return false; });
  view.dispatch({
    effects: existing !== null
      ? toggleBreakpoint.of({ pos: existing, on: false })
      : toggleBreakpoint.of({ pos: lineStart, on: true }),
  });
}

const theme = EditorView.baseTheme({
  '.cm-bp-gutter': { width: '16px', cursor: 'pointer' },
  '.cm-bp-gutter .cm-gutterElement': { display: 'flex', alignItems: 'center', justifyContent: 'center' },
  '.cm-bp-dot': { width: '9px', height: '9px', borderRadius: '50%', background: '#dc2626', display: 'block' },
  '.cm-bp-console': { width: '7px', height: '7px', borderRadius: '50%', border: '1.5px solid #2f6feb', display: 'block', opacity: '0.7' },
  '.cm-bp-line': { backgroundColor: 'rgba(220, 38, 38, 0.07)' },
});

function linesOf(state: EditorState, field: StateField<RangeSet<GutterMarker>>): number[] {
  const lines: number[] = [];
  state.field(field).between(0, state.doc.length, from => { lines.push(state.doc.lineAt(from).number); });
  return lines;
}

/**
 * Editor extension with breakpoints on the given 1-based lines. `onChange` receives the lines
 * every time a breakpoint is toggled or moved by an edit.
 */
export function breakpointGutter(initialLines: number[], onChange?: (lines: number[]) => void): Extension {
  const field = createField(initialLines);
  return [
    field,
    EditorView.updateListener.of(update => {
      if (!onChange) return;
      if (update.docChanged || update.transactions.some(tr => tr.effects.some(e => e.is(toggleBreakpoint)))) {
        onChange(linesOf(update.state, field));
      }
    }),
    EditorView.decorations.compute([field], state => {
      const builder = new RangeSetBuilder<Decoration>();
      state.field(field).between(0, state.doc.length, from => {
        builder.add(from, from, Decoration.line({ class: 'cm-bp-line' }));
      });
      return builder.finish();
    }),
    gutter({
      class: 'cm-bp-gutter',
      lineMarker(view, line) {
        if (hasBreakpointAt(view.state.field(field), line.from)) return breakpointMarker;
        return CONSOLE_CALL.test(view.state.doc.sliceString(line.from, line.to)) ? consoleMarker : null;
      },
      lineMarkerChange: update =>
        update.docChanged || update.transactions.some(tr => tr.effects.some(e => e.is(toggleBreakpoint))),
      initialSpacer: () => breakpointMarker,
      domEventHandlers: {
        mousedown(view, line) {
          toggleAt(view, field, line.from);
          return true;
        },
      },
    }),
    keymap.of([{ key: 'F9', run: view => { toggleAt(view, field, view.state.selection.main.head); return true; } }]),
    theme,
  ];
}
