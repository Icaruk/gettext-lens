/**
 * Helpers for working with PO string escaping and VS Code ranges.
 */

import vscode from "vscode";
import type { FieldValue } from "../types.js";

/**
 * Escape a plain-text value so it can be placed inside a PO double-quoted
 * string literal (handles newline, tab, quote and backslash).
 */
export function escapePoValue(text: string): string {
	return text
		.replace(/\\/g, "\\\\")
		.replace(/"/g, '\\"')
		.replace(/\n/g, "\\n")
		.replace(/\t/g, "\\t")
		.replace(/\r/g, "\\r");
}

/** Build a VS Code Range covering every line in a FieldValue's span. */
export function fieldSpanRange(doc: vscode.TextDocument, field: FieldValue): vscode.Range {
	const firstLine = field.spanLines[0] ?? field.keywordLine;
	const lastLine = field.spanLines[field.spanLines.length - 1] ?? firstLine;
	const start = new vscode.Position(firstLine, 0);
	const lastLineText = doc.lineAt(lastLine).text;
	const end = new vscode.Position(lastLine, lastLineText.length);
	return new vscode.Range(start, end);
}

/** Range covering the entire content portion of a msgstr line (between quotes). */
export function valueContentRange(doc: vscode.TextDocument, keywordLine: number): vscode.Range {
	const line = doc.lineAt(keywordLine).text;
	const firstQuote = line.indexOf('"');
	const lastQuote = line.lastIndexOf('"');
	if (firstQuote === -1 || lastQuote <= firstQuote) {
		return new vscode.Range(keywordLine, 0, keywordLine, line.length);
	}
	return new vscode.Range(
		new vscode.Position(keywordLine, firstQuote + 1),
		new vscode.Position(keywordLine, lastQuote),
	);
}
