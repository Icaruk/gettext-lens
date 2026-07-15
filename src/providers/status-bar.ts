/**
 * Status bar integration.
 *
 * Manages two status bar items:
 *  - **fileItem** — progress and issue counts for the active .po document.
 *  - **workspaceItem** — aggregate workspace statistics after a scan.
 *
 * The workspace item is only visible after a scan has been performed.
 */

import vscode from "vscode";
import type { LintSummary } from "../services/linter.js";

export interface WorkspaceStats {
  files: number;
  withIssues: number;
  untranslated: number;
  fuzzy: number;
}

export class StatusBarManager {
  private fileItem: vscode.StatusBarItem;
  private workspaceItem: vscode.StatusBarItem;
  private currentSummary: LintSummary | null = null;
  private workspaceStats: WorkspaceStats | null = null;

  constructor() {
    this.fileItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      50,
    );
    this.workspaceItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      49,
    );
  }

  /** Update the file-level status from a lint summary. */
  showFile(summary: LintSummary, isTemplate: boolean): void {
    this.currentSummary = summary;
    const parts: string[] = [];

    if (isTemplate) {
      parts.push("$(file-code) template");
      parts.push(`${summary.total} entries`);
    } else {
      const pct = summary.total > 0
        ? Math.round((summary.translated / summary.total) * 100)
        : 0;
      parts.push(`${pct}% done`);
      parts.push(`${summary.translated}/${summary.total}`);
    }

    const issues: string[] = [];
    if (summary.fuzzy > 0) issues.push(`${summary.fuzzy} fuzzy`);
    if (summary.untranslated > 0) issues.push(`${summary.untranslated} empty`);
    if (summary.htmlIssues > 0) issues.push(`${summary.htmlIssues} html`);
    if (issues.length > 0) parts.push(issues.join(" · "));

    this.fileItem.text = parts.join("  |  ");

    if (issues.length > 0) {
      this.fileItem.backgroundColor = new vscode.ThemeColor(
        "statusBarItem.warningBackground",
      );
    } else {
      this.fileItem.backgroundColor = undefined;
    }

    this.fileItem.tooltip = this.buildFileTooltip(summary, isTemplate);
    this.fileItem.show();
  }

  hideFile(): void {
    this.fileItem.hide();
  }

  /** Update the workspace aggregate after a scan. */
  showWorkspace(stats: WorkspaceStats): void {
    this.workspaceStats = stats;
    this.workspaceItem.text = `$(fold) ${stats.files} files · ${stats.untranslated} empty · ${stats.fuzzy} fuzzy`;
    this.workspaceItem.tooltip = this.buildWorkspaceTooltip(stats);
    this.workspaceItem.command = "gettextLens.scanWorkspace";
    this.workspaceItem.show();
  }

  hideWorkspace(): void {
    this.workspaceItem.hide();
  }

  private buildFileTooltip(s: LintSummary, isTemplate: boolean): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    md.appendMarkdown(`**${isTemplate ? "Template" : "Translation"} file**\n\n`);
    md.appendMarkdown(`- Entries: ${s.total}\n`);
    if (!isTemplate) {
      md.appendMarkdown(`- Translated: ${s.translated}\n`);
      md.appendMarkdown(`- Untranslated: ${s.untranslated}\n`);
    }
    md.appendMarkdown(`- Fuzzy: ${s.fuzzy}\n`);
    md.appendMarkdown(`- HTML issues: ${s.htmlIssues}\n`);
    md.appendMarkdown(`- Duplicates: ${s.duplicates}\n`);
    return md;
  }

  private buildWorkspaceTooltip(s: WorkspaceStats): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    md.appendMarkdown(`**Workspace scan**\n\n`);
    md.appendMarkdown(`- Files scanned: ${s.files}\n`);
    md.appendMarkdown(`- Files with issues: ${s.withIssues}\n`);
    md.appendMarkdown(`- Untranslated: ${s.untranslated}\n`);
    md.appendMarkdown(`- Fuzzy: ${s.fuzzy}\n`);
    md.appendMarkdown(`\n_Click to re-scan_\n`);
    return md;
  }

  dispose(): void {
    this.fileItem.dispose();
    this.workspaceItem.dispose();
  }
}
