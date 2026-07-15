/**
 * Go-to-definition provider for gettext reference comments.
 *
 * When the user Ctrl+clicks a `#: path/to/file.ext:42` reference inside a
 * .po file, this provider resolves the referenced source file and returns a
 * {@link vscode.Location} so the editor can navigate there.
 *
 * Resolution strategy:
 *  1. If the path is absolute and exists, use it directly.
 *  2. Otherwise, search relative to every workspace folder.
 *  3. As a fallback, search in the directory of the .po file and up to four
 *     parent directories.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import vscode from "vscode";
import { getEntries } from "../services/parse-cache.js";

export class ReferenceDefinitionProvider implements vscode.DefinitionProvider {
	provideDefinition(
		doc: vscode.TextDocument,
		position: vscode.Position,
	): vscode.ProviderResult<vscode.Definition> {
		const entries = getEntries(doc);
		const line = position.line;

		// Find the entry that contains this document line
		const entry = entries.find((e) => line >= e.startLine && line <= e.endLine);
		if (!entry) return null;

		// Find the specific reference at the clicked line
		const ref = entry.references.find((r) => r.refDocLine === line);
		if (!ref) return null;

		// Check if the clicked position overlaps the reference column range
		if (position.character < ref.startCol || position.character > ref.endCol) {
			return null;
		}

		const targetPath = resolveReferencePath(ref.filePath, doc.uri);
		if (!targetPath) {
			vscode.window.showWarningMessage(
				`Gettext Lens: Could not find "${ref.filePath}". Check if it is inside the workspace.`,
			);
			return null;
		}

		const targetUri = vscode.Uri.file(targetPath);
		return new vscode.Location(
			targetUri,
			new vscode.Position(Math.max(0, ref.sourceLine - 1), 0),
		);
	}
}

/**
 * Try to locate the referenced file on disk.
 * Returns an absolute path or null if nothing was found.
 */
function resolveReferencePath(refPath: string, baseUri: vscode.Uri): string | null {
	// 1. Absolute path
	if (path.isAbsolute(refPath) && fs.existsSync(refPath)) {
		return refPath;
	}

	const candidates: string[] = [];

	// 2. Workspace folders
	for (const folder of vscode.workspace.workspaceFolders ?? []) {
		candidates.push(path.join(folder.uri.fsPath, refPath));
	}

	// 3. .po file directory + up to 4 parents
	const baseDir = path.dirname(baseUri.fsPath);
	let dir = baseDir;
	for (let i = 0; i < 5; i++) {
		candidates.push(path.join(dir, refPath));
		const parent = path.dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}

	// Return the first candidate that exists and stays within a workspace root
	for (const candidate of candidates) {
		try {
			const normalized = path.normalize(candidate);
			if (fs.existsSync(normalized) && isWithinWorkspace(normalized)) {
				return normalized;
			}
		} catch {
			// ignore — try next candidate
		}
	}

	return null;
}

/** Security check: prevent navigation outside workspace boundaries. */
function isWithinWorkspace(filePath: string): boolean {
	const folders = vscode.workspace.workspaceFolders;
	if (!folders || folders.length === 0) return true; // no workspace → allow
	return folders.some((folder) => {
		const folderPath = folder.uri.fsPath;
		const rel = path.relative(folderPath, filePath);
		return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
	});
}
