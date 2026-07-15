/**
 * Entry point for the Gettext Lens extension.
 *
 * Wires together the parser, linter, code-lens fix actions, status bar,
 * fuzzy decorations and go-to-source navigation.  All features are always
 * enabled — there are no user-configurable settings.
 */

import * as vscode from "vscode";
import { ActionLensProvider } from "./providers/action-lens.js";
import { EntryDecorator } from "./providers/decorations.js";
import * as fixes from "./providers/fixes.js";
import { ReferenceDefinitionProvider } from "./providers/go-to-source.js";
import { StatusBarManager } from "./providers/status-bar.js";
import { DIAG_SOURCE, lintDocument } from "./services/linter.js";
import { clearAll, invalidate } from "./services/parse-cache.js";
import { scanWorkspace } from "./services/workspace-scan.js";

const LANG_ID = "po";
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
const DEBOUNCE_MS = 300;

let diagnostics: vscode.DiagnosticCollection;
let lensProvider: ActionLensProvider;
let statusbar: StatusBarManager;
let decorator: EntryDecorator;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isPoDoc(doc: vscode.TextDocument): boolean {
	return doc.languageId === LANG_ID;
}

/** Lint a single document: update diagnostics, status bar and decorations. */
function refreshDocument(doc: vscode.TextDocument): void {
	if (!isPoDoc(doc)) return;
	const { diagnostics: diags, summary } = lintDocument(doc);
	diagnostics.set(doc.uri, diags);

	const isTemplate = doc.fileName.endsWith(".pot");

	// Only update the file status bar for the active editor
	const active = vscode.window.activeTextEditor;
	if (active && active.document.uri.toString() === doc.uri.toString()) {
		statusbar.showFile(summary, isTemplate);
	}

	// Refresh decorations for all visible editors showing this document
	refreshDecorations();
	lensProvider.refresh();
}

function refreshDecorations(): void {
	decorator.refresh(vscode.window.visibleTextEditors);
}

/** Debounced refresh for text-change events. */
function scheduleRefresh(doc: vscode.TextDocument): void {
	if (!isPoDoc(doc)) return;
	const key = doc.uri.toString();
	const existing = debounceTimers.get(key);
	if (existing) clearTimeout(existing);
	const timer = setTimeout(() => {
		debounceTimers.delete(key);
		refreshDocument(doc);
	}, DEBOUNCE_MS);
	debounceTimers.set(key, timer);
}

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------

export function activate(context: vscode.ExtensionContext): void {
	diagnostics = vscode.languages.createDiagnosticCollection(DIAG_SOURCE);
	lensProvider = new ActionLensProvider();
	statusbar = new StatusBarManager();
	decorator = new EntryDecorator();

	// --- register providers ---
	context.subscriptions.push(
		vscode.languages.registerCodeLensProvider({ language: LANG_ID }, lensProvider),
		vscode.languages.registerDefinitionProvider(
			{ language: LANG_ID },
			new ReferenceDefinitionProvider(),
		),
		diagnostics,
		statusbar,
		decorator,
	);

	// --- register commands ---

	// fix commands (internal — not in palette)
	context.subscriptions.push(
		vscode.commands.registerCommand("gettextLens.fix.stripFuzzy", (uri: string, line: number) =>
			fixes.stripFuzzy(uri, line),
		),
		vscode.commands.registerCommand("gettextLens.fix.copySource", (uri: string, line: number) =>
			fixes.copySourceToTranslation(uri, line),
		),
		vscode.commands.registerCommand(
			"gettextLens.fix.insertTags",
			(uri: string, line: number, tags: unknown) =>
				fixes.insertMissingTags(
					uri,
					line,
					tags as Parameters<typeof fixes.insertMissingTags>[2],
				),
		),
	);

	// workspace scan command
	context.subscriptions.push(
		vscode.commands.registerCommand("gettextLens.scanWorkspace", async () => {
			const result = await scanWorkspace();
			if (!result) {
				vscode.window.showInformationMessage(
					"No .po or .pot files found in the workspace.",
				);
				return;
			}
			statusbar.showWorkspace(result);
			vscode.window.showInformationMessage(
				`Scanned ${result.files} files — ${result.withIssues} with issues`,
			);
		}),
	);

	// --- event listeners ---
	context.subscriptions.push(
		// Lint on open
		vscode.workspace.onDidOpenTextDocument((doc) => {
			if (isPoDoc(doc)) refreshDocument(doc);
		}),

		// Debounced re-lint on text change
		vscode.workspace.onDidChangeTextDocument((e) => {
			if (isPoDoc(e.document)) scheduleRefresh(e.document);
		}),

		// Clean up on close
		vscode.workspace.onDidCloseTextDocument((doc) => {
			diagnostics.delete(doc.uri);
			invalidate(doc);
			const key = doc.uri.toString();
			const timer = debounceTimers.get(key);
			if (timer) {
				clearTimeout(timer);
				debounceTimers.delete(key);
			}
		}),

		// Active editor switch — update status bar and decorations
		vscode.window.onDidChangeActiveTextEditor((editor) => {
			if (!editor) {
				statusbar.hideFile();
				return;
			}
			if (isPoDoc(editor.document)) {
				refreshDocument(editor.document);
			} else {
				statusbar.hideFile();
			}
			refreshDecorations();
		}),

		// Visible editors changed — refresh decorations
		vscode.window.onDidChangeVisibleTextEditors(() => {
			refreshDecorations();
		}),

		// Re-lint on save (parse cache is version-checked so it auto-updates)
		vscode.workspace.onDidSaveTextDocument((doc) => {
			if (isPoDoc(doc)) refreshDocument(doc);
		}),
	);

	// --- initial pass: lint any .po files that are already open ---
	for (const doc of vscode.workspace.textDocuments) {
		if (isPoDoc(doc)) refreshDocument(doc);
	}

	// Show status bar for the active editor if it's a .po file
	const active = vscode.window.activeTextEditor;
	if (active && isPoDoc(active.document)) {
		refreshDocument(active.document);
	}
}

export function deactivate(): void {
	for (const timer of debounceTimers.values()) clearTimeout(timer);
	debounceTimers.clear();
	clearAll();
}
