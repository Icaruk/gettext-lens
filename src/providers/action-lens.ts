/**
 * Code-lens provider that renders inline, click-to-apply quick fixes directly
 * above entries with issues — similar to the action buttons shown for git
 * merge conflicts.
 *
 * A summary lens is always emitted on the first line showing translation
 * progress.  Then, for every fixable issue, one or more clickable lenses are
 * placed on the entry's keyword line.
 */

import vscode from "vscode";
import type { IssueData } from "../services/linter.js";
import { lintDocument } from "../services/linter.js";
import { renderTag } from "../utils/html-diff.js";

export const CMD_STRIP_FUZZY = "gettextLens.fix.stripFuzzy";
export const CMD_COPY_SOURCE = "gettextLens.fix.copySource";
export const CMD_INSERT_TAGS = "gettextLens.fix.insertTags";

export class ActionLensProvider implements vscode.CodeLensProvider {
  private emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.emitter.event;

  refresh(): void {
    this.emitter.fire();
  }

  provideCodeLenses(
    doc: vscode.TextDocument,
  ): vscode.ProviderResult<vscode.CodeLens[]> {
    const { diagnostics, summary } = lintDocument(doc);
    const lenses: vscode.CodeLens[] = [];

    // --- progress summary on the first line ---
    const isTemplate = doc.fileName.endsWith(".pot");
    let title: string;
    if (isTemplate) {
      title = `Template — ${summary.total} entries`;
    } else if (summary.total === 0) {
      title = "No entries";
    } else if (summary.untranslated === 0) {
      title = `${summary.translated}/${summary.total} translated ✓`;
    } else {
      title = `${summary.translated}/${summary.total} translated · ${summary.untranslated} remaining`;
    }
    lenses.push(new vscode.CodeLens(new vscode.Range(0, 0, 0, 0)));

    // --- per-issue action lenses ---
    for (const diag of diagnostics) {
      const data = (diag as unknown as { data?: IssueData }).data;
      if (!data) continue;

      const line = data.entryStartLine;
      const range = new vscode.Range(line, 0, line, 0);

      switch (data.kind) {
        case "fuzzy":
          lenses.push(new vscode.CodeLens(range, {
            title: "Fuzzy — Remove flag",
            command: CMD_STRIP_FUZZY,
            arguments: [doc.uri.toString(), line],
          }));
          break;

        case "empty":
          lenses.push(new vscode.CodeLens(range, {
            title: "Empty — Copy from source",
            command: CMD_COPY_SOURCE,
            arguments: [doc.uri.toString(), line],
          }));
          break;

        case "html":
          if (data.missingTags && data.missingTags.length > 0) {
            const tagStr = data.missingTags.map(renderTag).join(" ");
            lenses.push(new vscode.CodeLens(range, {
              title: `Insert missing ${tagStr}`,
              command: CMD_INSERT_TAGS,
              arguments: [doc.uri.toString(), line, data.missingTags],
            }));
          }
          break;
      }
    }

    return lenses;
  }
}
