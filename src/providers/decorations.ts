/**
 * Text-editor decorations for catalog entries.
 *
 * Two decoration types:
 *  - **fuzzy** entries get a calm teal-tinted background.
 *  - **empty** translations get a muted red background.
 *
 * Both use the overview ruler for at-a-glance visibility.
 */

import vscode from "vscode";
import { getEntries } from "../services/parse-cache.js";

export class EntryDecorator {
	private readonly fuzzyType: vscode.TextEditorDecorationType;
	private readonly emptyType: vscode.TextEditorDecorationType;

	constructor() {
		this.fuzzyType = vscode.window.createTextEditorDecorationType({
			isWholeLine: true,
			backgroundColor: "rgba(86, 182, 139, 0.07)",
			overviewRulerColor: "rgba(86, 182, 139, 0.4)",
			overviewRulerLane: vscode.OverviewRulerLane.Left,
		});

		this.emptyType = vscode.window.createTextEditorDecorationType({
			isWholeLine: true,
			backgroundColor: "rgba(220, 90, 90, 0.06)",
			overviewRulerColor: "rgba(220, 90, 90, 0.35)",
			overviewRulerLane: vscode.OverviewRulerLane.Left,
		});
	}

	/** Dispose decoration types — call on extension deactivation. */
	dispose(): void {
		this.fuzzyType.dispose();
		this.emptyType.dispose();
	}

	/** Apply decorations to every visible editor showing a .po file. */
	refresh(editors: readonly vscode.TextEditor[]): void {
		for (const editor of editors) {
			if (!isPoDoc(editor.document)) continue;

			const entries = getEntries(editor.document);
			const isTemplate = editor.document.fileName.endsWith(".pot");

			const fuzzyRanges: vscode.Range[] = [];
			const emptyRanges: vscode.Range[] = [];

			for (const entry of entries) {
				if (entry.isObsolete) continue;
				if (entry.id == null || entry.id.text === "") continue; // skip header

				if (entry.flags.includes("fuzzy")) {
					fuzzyRanges.push(new vscode.Range(entry.startLine, 0, entry.startLine, 0));
				}

				const tr = entry.translations.get(0);
				if (!isTemplate && (!tr || tr.text.length === 0)) {
					emptyRanges.push(new vscode.Range(entry.startLine, 0, entry.startLine, 0));
				}
			}

			editor.setDecorations(this.fuzzyType, fuzzyRanges);
			editor.setDecorations(this.emptyType, emptyRanges);
		}
	}
}

function isPoDoc(doc: vscode.TextDocument): boolean {
	return doc.languageId === "po";
}
