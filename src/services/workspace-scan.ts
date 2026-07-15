/**
 * Workspace-wide scanning for gettext files.
 *
 * Finds every `.po` / `.pot` file in the workspace (excluding `node_modules`
 * and `.git`), lints each one, and aggregates the results.  The aggregate is
 * surfaced through the workspace status bar item and a completion message.
 */

import vscode from "vscode";
import type { WorkspaceStats } from "../providers/status-bar.js";
import { lintDocument } from "./linter.js";

const MAX_FILES = 3000;
const GLOB_PATTERN = "**/*.{po,pot}";

export interface ScanResult extends WorkspaceStats {
	filesWithErrors: number;
	htmlIssues: number;
	duplicates: number;
}

/**
 * Scan all .po/.pot files in the workspace and return aggregate statistics.
 * Shows a progress notification during the scan.
 */
export async function scanWorkspace(): Promise<ScanResult | null> {
	const folders = vscode.workspace.workspaceFolders;
	if (!folders || folders.length === 0) return null;

	const files = await vscode.workspace.findFiles(GLOB_PATTERN, "**/node_modules/**", MAX_FILES);
	if (files.length === 0) return null;

	const aggregate: ScanResult = {
		files: 0,
		withIssues: 0,
		filesWithErrors: 0,
		untranslated: 0,
		fuzzy: 0,
		htmlIssues: 0,
		duplicates: 0,
	};

	await vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: "Scanning gettext files…",
			cancellable: false,
		},
		async (progress) => {
			const increment = 100 / files.length;
			let scanned = 0;

			for (const uri of files) {
				try {
					const doc = await vscode.workspace.openTextDocument(uri);
					if (doc.languageId !== "po") continue;

					const { summary } = lintDocument(doc);
					aggregate.files++;
					const hasIssues =
						summary.untranslated > 0
						|| summary.fuzzy > 0
						|| summary.htmlIssues > 0
						|| summary.duplicates > 0;
					if (hasIssues) aggregate.withIssues++;
					aggregate.untranslated += summary.untranslated;
					aggregate.fuzzy += summary.fuzzy;
					aggregate.htmlIssues += summary.htmlIssues;
					aggregate.duplicates += summary.duplicates;
				} catch {
					// skip files that can't be opened
				}

				scanned++;
				progress.report({ increment, message: `${scanned}/${files.length}` });
			}
		},
	);

	return aggregate;
}
