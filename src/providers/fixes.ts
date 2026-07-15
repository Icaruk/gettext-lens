/**
 * Quick-fix command implementations.
 *
 * Each function receives a document URI and the starting line of the target
 * entry, re-parses the current document text to locate that entry, then
 * builds and applies a {@link vscode.WorkspaceEdit}.
 *
 * These are invoked exclusively through code-lens actions — they are never
 * surfaced as palette commands.
 */

import vscode from "vscode";
import { getEntries } from "../services/parse-cache.js";
import type { CatalogEntry } from "../types.js";
import type { HtmlTag } from "../utils/html-diff.js";
import { renderTag } from "../utils/html-diff.js";
import { escapePoValue, valueContentRange } from "../utils/ranges.js";

/** Locate an entry whose startLine matches the given document line. */
function findEntryAtLine(entries: readonly CatalogEntry[], line: number): CatalogEntry | undefined {
	return entries.find((e) => e.startLine === line);
}

async function getDoc(uri: string): Promise<vscode.TextDocument | undefined> {
	try {
		const u = vscode.Uri.parse(uri);
		const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === u.toString());
		return doc ?? (await vscode.workspace.openTextDocument(u));
	} catch {
		return undefined;
	}
}

/**
 * Remove the `fuzzy` flag from an entry.
 * If it was the only flag, the entire `#,` line is deleted.
 */
export async function stripFuzzy(uri: string, line: number): Promise<void> {
	const doc = await getDoc(uri);
	if (!doc) return;
	const entry = findEntryAtLine(getEntries(doc), line);
	if (!entry || entry.flagsLine < 0) return;

	const remaining = entry.flags.filter((f) => f !== "fuzzy");
	const edit = new vscode.WorkspaceEdit();
	if (remaining.length === 0) {
		// Delete the entire flags line including its newline
		const range = doc.lineAt(entry.flagsLine).rangeIncludingLineBreak;
		edit.delete(doc.uri, range);
	} else {
		const range = doc.lineAt(entry.flagsLine).range;
		edit.replace(doc.uri, range, `#, ${remaining.join(", ")}`);
	}
	await vscode.workspace.applyEdit(edit);
}

/**
 * Copy the source string (msgid) into the translation slot (msgstr[0]),
 * properly escaped.
 */
export async function copySourceToTranslation(uri: string, line: number): Promise<void> {
	const doc = await getDoc(uri);
	if (!doc) return;
	const entry = findEntryAtLine(getEntries(doc), line);
	if (!entry?.id) return;

	const target = entry.translations.get(0);
	if (!target) return;

	const escaped = escapePoValue(entry.id.text);
	const range = valueContentRange(doc, target.keywordLine);
	const edit = new vscode.WorkspaceEdit();
	edit.replace(doc.uri, range, escaped);
	await vscode.workspace.applyEdit(edit);
}

/**
 * Append missing HTML tags to the translation value.
 */
export async function insertMissingTags(uri: string, line: number, tags: HtmlTag[]): Promise<void> {
	if (tags.length === 0) return;
	const doc = await getDoc(uri);
	if (!doc) return;
	const entry = findEntryAtLine(getEntries(doc), line);
	if (!entry) return;

	const target = entry.translations.get(0);
	if (!target) return;

	const insert = tags.map(renderTag).join("");
	const range = valueContentRange(doc, target.keywordLine);
	const currentText = doc.getText(range);
	const edit = new vscode.WorkspaceEdit();
	edit.replace(doc.uri, range, currentText + insert);
	await vscode.workspace.applyEdit(edit);
}
