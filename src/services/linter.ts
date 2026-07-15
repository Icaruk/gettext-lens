/**
 * Catalog linter — converts parsed entries into VS Code diagnostics.
 *
 * Four rules are applied:
 *  - **fuzzy**     the entry carries the `fuzzy` flag
 *  - **empty**     the translation string is empty (skipped for .pot templates)
 *  - **html**      HTML tags differ between source and translation
 *  - **duplicate**  the same (msgctxt, msgid) pair appears more than once
 *
 * The linter also produces a {@link LintSummary} with aggregate counts that
 * the status bar and code lens consume.
 */

import vscode from "vscode";
import type { CatalogEntry, FieldValue, IssueKind } from "../types.js";
import { getEntries } from "./parse-cache.js";
import { diffTags, type HtmlTag, renderTag } from "../utils/html-diff.js";
import { fieldSpanRange } from "../utils/ranges.js";

export const DIAG_SOURCE = "Gettext Lens";

/** Data attached to every diagnostic for downstream consumers. */
export interface IssueData {
  kind: IssueKind;
  entryStartLine: number;
  /** Tags missing from the translation (html rule only). */
  missingTags?: HtmlTag[];
}

export interface LintSummary {
  total: number;
  translated: number;
  untranslated: number;
  fuzzy: number;
  htmlIssues: number;
  duplicates: number;
}

export interface LintResult {
  diagnostics: vscode.Diagnostic[];
  summary: LintSummary;
}

/** Key used for duplicate detection — msgctxt disambiguates identical msgids. */
function identityKey(context: string | undefined, id: string): string {
  return `${context ?? ""}\u0000${id}`;
}

/** True for the gettext header entry (empty msgid). */
function isHeader(entry: CatalogEntry): boolean {
  return entry.id == null || entry.id.text === "";
}

function buildDiagnostic(
  doc: vscode.TextDocument,
  entry: CatalogEntry,
  field: FieldValue | undefined,
  kind: IssueKind,
  message: string,
  severity: vscode.DiagnosticSeverity,
  missingTags?: HtmlTag[],
): vscode.Diagnostic {
  const range = field
    ? fieldSpanRange(doc, field)
    : new vscode.Range(entry.startLine, 0, entry.startLine, 0);

  const diag = new vscode.Diagnostic(range, message, severity);
  diag.source = DIAG_SOURCE;
  const data: IssueData = { kind, entryStartLine: entry.startLine, missingTags };
  // VS Code >= 1.73 supports the `data` property; fall back gracefully.
  (diag as unknown as { data: IssueData }).data = data;
  return diag;
}

/**
 * Run all lint rules against a document.
 * The document is parsed (or retrieved from cache) and each entry is checked.
 */
export function lintDocument(doc: vscode.TextDocument): LintResult {
  const entries = getEntries(doc);
  const isTemplate = doc.fileName.endsWith(".pot");
  const diagnostics: vscode.Diagnostic[] = [];

  let translated = 0;
  let untranslated = 0;
  let fuzzyCount = 0;
  let htmlIssueCount = 0;
  let duplicateCount = 0;

  // Track seen identities for duplicate detection.
  const seen = new Map<string, number>(); // key → first occurrence line

  for (const entry of entries) {
    if (entry.isObsolete) continue;
    if (isHeader(entry)) continue;

    const sourceText = entry.id?.text ?? "";
    const translation = entry.translations.get(0);

    // --- progress stats ---
    if (translation && translation.text.length > 0) {
      translated++;
    } else if (!isTemplate) {
      untranslated++;
    }

    // --- fuzzy rule ---
    if (entry.flags.includes("fuzzy")) {
      fuzzyCount++;
      diagnostics.push(
        buildDiagnostic(
          doc, entry, entry.id, "fuzzy",
          "Entry is marked as fuzzy.",
          vscode.DiagnosticSeverity.Warning,
        ),
      );
    }

    // --- empty translation rule (skip templates) ---
    if (!isTemplate && (!translation || translation.text.length === 0)) {
      diagnostics.push(
        buildDiagnostic(
          doc, entry, translation ?? entry.id, "empty",
          "Translation string is empty.",
          vscode.DiagnosticSeverity.Error,
        ),
      );
    }

    // --- HTML tag mismatch rule ---
    if (sourceText.length > 0 && translation && translation.text.length > 0) {
      const diff = diffTags(sourceText, translation.text);
      if (diff.missing.length > 0 || diff.extra.length > 0) {
        htmlIssueCount++;
        const parts: string[] = [];
        if (diff.missing.length > 0) {
          parts.push(`Missing: ${diff.missing.map(renderTag).join(" ")}`);
        }
        if (diff.extra.length > 0) {
          parts.push(`Unexpected: ${diff.extra.map(renderTag).join(" ")}`);
        }
        diagnostics.push(
          buildDiagnostic(
            doc, entry, translation, "html",
            `HTML tag mismatch — ${parts.join(" · ")}`,
            vscode.DiagnosticSeverity.Warning,
            diff.missing,
          ),
        );
      }
    }

    // --- duplicate msgid rule ---
    if (sourceText.length > 0) {
      const key = identityKey(entry.context?.text, sourceText);
      const firstLine = seen.get(key);
      if (firstLine !== undefined) {
        duplicateCount++;
        diagnostics.push(
          buildDiagnostic(
            doc, entry, entry.id, "duplicate",
            `Duplicate msgid (first seen on line ${firstLine + 1}).`,
            vscode.DiagnosticSeverity.Information,
          ),
        );
      } else {
        seen.set(key, entry.startLine);
      }
    }
  }

  const total = translated + untranslated;
  const summary: LintSummary = {
    total,
    translated,
    untranslated,
    fuzzy: fuzzyCount,
    htmlIssues: htmlIssueCount,
    duplicates: duplicateCount,
  };

  return { diagnostics, summary };
}
