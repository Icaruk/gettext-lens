/**
 * Lightweight document-version cache for parsed catalogs.
 *
 * Keeps the most recent parse result per document so repeated lint passes
 * (text edits, active-editor switches, saves) don't re-parse unnecessarily.
 */

import type vscode from "vscode";
import { parseCatalog } from "../parser/po-parser.js";
import type { CatalogEntry } from "../types.js";

interface CacheSlot {
	version: number;
	entries: CatalogEntry[];
}

const slots = new Map<string, CacheSlot>();

/** Return cached entries for a document, parsing if the version is stale. */
export function getEntries(doc: vscode.TextDocument): CatalogEntry[] {
	const key = doc.uri.toString();
	const cached = slots.get(key);
	if (cached && cached.version === doc.version) {
		return cached.entries;
	}
	const entries = parseCatalog(doc.getText());
	slots.set(key, { version: doc.version, entries });
	return entries;
}

/** Invalidate the cache slot for a single document. */
export function invalidate(doc: vscode.TextDocument): void {
	slots.delete(doc.uri.toString());
}

/** Clear every cached entry (used on extension deactivation). */
export function clearAll(): void {
	slots.clear();
}
