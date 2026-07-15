/**
 * Minimal runtime stub for the `vscode` module used in unit tests.
 *
 * Only the classes and enums that the parser, linter and range helpers touch
 * at runtime are implemented.  Everything else from the vscode API is not
 * needed because those code paths are not exercised by the unit tests.
 *
 * Vitest aliases `vscode` → this file via `vitest.config.ts`.
 */

export class Position {
  constructor(
    public line: number,
    public character: number,
  ) {}
}

export class Range {
  constructor(
    public start: Position,
    public end: Position,
  ) {}
}

export const DiagnosticSeverity = {
  Error: 0,
  Warning: 1,
  Information: 2,
  Hint: 3,
} as const;

export class Diagnostic {
  range: Range;
  message: string;
  severity: number;
  source?: string;
  code?: string | number;
  data?: unknown;

  constructor(range: Range, message: string, severity?: number) {
    this.range = range;
    this.message = message;
    this.severity = severity ?? DiagnosticSeverity.Error;
  }
}

export class Uri {
  constructor(private _fsPath: string) {}
  static file(p: string): Uri {
    return new Uri(p);
  }
  get fsPath(): string {
    return this._fsPath;
  }
  toString(): string {
    return `file:///${this._fsPath.replace(/\\/g, "/")}`;
  }
}

/**
 * Lightweight implementation of the parts of `vscode.TextDocument` that the
 * linter and parse-cache call at runtime.  Pass the raw .po text and it will
 * split it into lines for `lineAt()`.
 */
export class MockTextDocument {
  readonly uri: Uri;
  readonly languageId = "po";
  readonly version: number;
  private readonly lines: string[];

  constructor(
    public readonly text: string,
    public readonly fileName = "test.po",
    version = 1,
  ) {
    this.version = version;
    this.uri = Uri.file(`test/${fileName}`);
    this.lines = text.split(/\r?\n/);
  }

  getText(): string {
    return this.text;
  }

  lineAt(line: number) {
    const text = this.lines[line] ?? "";
    return {
      text,
      lineNumber: line,
      range: new Range(new Position(line, 0), new Position(line, text.length)),
      rangeIncludingLineBreak: new Range(
        new Position(line, 0),
        new Position(Math.min(line + 1, this.lines.length - 1), 0),
      ),
      firstNonWhitespaceCharacterIndex: text.length - text.trimStart().length,
      isEmptyOrWhitespace: text.trim().length === 0,
    };
  }
}

// ---------------------------------------------------------------------------
// Stubs for types/enums referenced by provider code (not used in unit tests
// but required for the module graph to load without errors).
// ---------------------------------------------------------------------------

export const StatusBarAlignment = { Left: 1, Right: 2 } as const;
export const OverviewRulerLane = { Left: 1, Right: 2, Full: 7 } as const;

export class MarkdownString {
  constructor(public value = "") {}
  isTrusted = false;
  appendMarkdown(md: string): this {
    this.value += md;
    return this;
  }
}

export class ThemeColor {
  constructor(public id: string) {}
}

// Default export — satisfies `import vscode from "vscode"`
const vscode = {
  Position,
  Range,
  Diagnostic,
  DiagnosticSeverity,
  Uri,
  StatusBarAlignment,
  OverviewRulerLane,
  MarkdownString,
  ThemeColor,
};

export default vscode;
