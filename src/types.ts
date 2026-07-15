/**
 * Shared type definitions for the Gettext Lens extension.
 *
 * These interfaces describe the structural data extracted from a .po / .pot
 * file after parsing, as well as the diagnostic categories the linter emits.
 */

// ---------------------------------------------------------------------------
// Parser output types
// ---------------------------------------------------------------------------

/** A single `#: path:line` reference comment. */
export interface SourceLocation {
  readonly filePath: string;
  readonly sourceLine: number;
  /** Zero-based line index inside the .po document where this reference appears. */
  readonly refDocLine: number;
  readonly startCol: number;
  readonly endCol: number;
}

/** The value of a keyword field (msgid, msgstr, msgctxt, msgid_plural). */
export interface FieldValue {
  /** Unescaped text content (without surrounding quotes). */
  readonly text: string;
  /** Zero-based line of the keyword token (`msgid`, `msgstr`, …). */
  readonly keywordLine: number;
  /** Every document line index that contributes to this value (keyword + continuations). */
  readonly spanLines: number[];
}

/** A complete gettext catalog entry (one `msgid` / `msgstr` block). */
export interface CatalogEntry {
  readonly startLine: number;
  readonly endLine: number;
  readonly isObsolete: boolean;
  readonly flags: readonly string[];
  /** Line that carries the `#,` flags comment, or -1. */
  readonly flagsLine: number;
  readonly references: readonly SourceLocation[];
  readonly context?: FieldValue;
  readonly id?: FieldValue;
  readonly pluralId?: FieldValue;
  /** Map of plural-index → translation value (0 for singular). */
  readonly translations: ReadonlyMap<number, FieldValue>;
}

// ---------------------------------------------------------------------------
// Diagnostic types
// ---------------------------------------------------------------------------

export type IssueKind =
  | "fuzzy"
  | "empty"
  | "html"
  | "duplicate";
