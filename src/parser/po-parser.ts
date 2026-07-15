/**
 * A tolerant line-oriented parser for gettext catalog files (.po / .pot).
 *
 * The parser walks the document line by line, groups consecutive non-blank
 * lines into blocks, then extracts comments, flags, references and keyword
 * fields from each block.  It is designed to never throw — malformed input
 * simply yields fewer fields rather than crashing.
 */

import type { CatalogEntry, FieldValue, SourceLocation } from "../types.js";

// Matches `msgid`, `msgstr`, `msgstr[2]`, `msgctxt`, `msgid_plural` and the
// obsolete `#~` prefix variants.
const FIELD_KEYWORD = /^#~\s*(msg(?:id|str|ctxt|id_plural)(?:\[\d+\])?)\s+"(.*)"$/;
const FIELD_KEYWORD_EMPTY = /^#~\s*(msg(?:id|str|ctxt|id_plural)(?:\[\d+\])?)\s*$/;
const PLAIN_KEYWORD = /^(msg(?:id|str|ctxt|id_plural)(?:\[\d+\])?)\s+"(.*)"$/;
const PLAIN_KEYWORD_EMPTY = /^(msg(?:id|str|ctxt|id_plural)(?:\[\d+\])?)\s*$/;

const CONTINUATION = /^"(.*)"$/;

// `#: src/app.ts:12  lib/util.go:45`  — may have multiple space-separated refs.
const REFERENCE_LINE = /^#:\s*(.+)$/;
// `#, fuzzy, c-format`
const FLAGS_LINE = /^#,\s*(.+)$/;
// `#~ ` obsolete marker on non-field lines
const OBSOLETE_COMMENT = /^#~\s/;

interface Block {
	startLine: number;
	endLine: number;
	raw: string[];
}

/**
 * Split the raw text into blank-separated line blocks.
 * Returns 0-based line indices.
 */
function groupBlocks(lines: string[]): Block[] {
	const blocks: Block[] = [];
	let current: string[] = [];
	let start = 0;

	for (let i = 0; i < lines.length; i++) {
		const trimmed = lines[i].trim();
		if (trimmed === "") {
			if (current.length > 0) {
				blocks.push({ startLine: start, endLine: i - 1, raw: current });
				current = [];
			}
			start = i + 1;
		} else {
			if (current.length === 0) start = i;
			current.push(lines[i]);
		}
	}
	if (current.length > 0) {
		blocks.push({ startLine: start, endLine: lines.length - 1, raw: current });
	}
	return blocks;
}

/** Remove surrounding double-quotes and process backslash escape sequences. */
function decodeEscapes(raw: string): string {
	let out = "";
	for (let i = 0; i < raw.length; i++) {
		const ch = raw[i];
		if (ch === "\\" && i + 1 < raw.length) {
			const next = raw[++i];
			switch (next) {
				case "n":
					out += "\n";
					break;
				case "t":
					out += "\t";
					break;
				case "r":
					out += "\r";
					break;
				case '"':
					out += '"';
					break;
				case "\\":
					out += "\\";
					break;
				default:
					out += next;
			}
		} else {
			out += ch;
		}
	}
	return out;
}

/** Extract the content between the first and last double-quote. */
function innerContent(line: string): string {
	const first = line.indexOf('"');
	const last = line.lastIndexOf('"');
	if (first === -1 || last === first) return "";
	return line.slice(first + 1, last);
}

/**
 * Walk the continuation lines that follow a keyword line and collect both the
 * accumulated text and the full span of document lines they occupy.
 */
function collectContinuation(
	blockLines: string[],
	startIndex: number,
): { text: string; spanLines: number[] } {
	const parts: string[] = [innerContent(blockLines[startIndex])];
	const spanLines: number[] = [startIndex];

	for (let j = startIndex + 1; j < blockLines.length; j++) {
		const m = blockLines[j].match(CONTINUATION);
		if (m) {
			parts.push(decodeEscapes(m[1]));
			spanLines.push(j);
		} else {
			break;
		}
	}
	return { text: decodeEscapes(parts.join("")), spanLines };
}

function parseReferences(
	content: string,
	docLine: number,
	contentOffset: number,
): SourceLocation[] {
	const refs: SourceLocation[] = [];
	// Walk the content tracking each token's absolute column on the line.
	let cursor = 0;
	for (const part of content.split(/(\s+)/)) {
		if (!part || /^\s+$/.test(part)) {
			cursor += part.length;
			continue;
		}
		const token = part;
		const colonIdx = token.lastIndexOf(":");
		let filePath = token;
		let sourceLine = 0;
		if (colonIdx > 0) {
			const maybeLine = Number(token.slice(colonIdx + 1));
			if (Number.isInteger(maybeLine) && maybeLine > 0) {
				filePath = token.slice(0, colonIdx);
				sourceLine = maybeLine;
			}
		}
		refs.push({
			filePath,
			sourceLine,
			refDocLine: docLine,
			startCol: contentOffset + cursor,
			endCol: contentOffset + cursor + token.length,
		});
		cursor += token.length;
	}
	return refs;
}

/** Parse an entire .po / .pot document into catalog entries. */
export function parseCatalog(text: string): CatalogEntry[] {
	const lines = text.split(/\r?\n/);
	const blocks = groupBlocks(lines);
	const entries: CatalogEntry[] = [];

	for (const block of blocks) {
		const blockLines = block.raw;
		const isObsolete = blockLines.some((l) => OBSOLETE_COMMENT.test(l));

		let flags: string[] = [];
		let flagsLine = -1;
		const references: SourceLocation[] = [];
		let context: FieldValue | undefined;
		let id: FieldValue | undefined;
		let pluralId: FieldValue | undefined;
		const translations = new Map<number, FieldValue>();

		// Build field assigners once per block — reused for every keyword line.
		const assigners: FieldAssigners = {
			setContext: (v) => (context = v),
			setId: (v) => (id = v),
			setPlural: (v) => (pluralId = v),
			setTranslation: (idx, v) => translations.set(idx, v),
		};

		for (let i = 0; i < blockLines.length; i++) {
			const line = blockLines[i];
			const absLine = block.startLine + i;

			// --- references ---
			const refMatch = line.match(REFERENCE_LINE);
			if (refMatch && !line.startsWith("#~")) {
				const contentStart = line.indexOf(refMatch[1]);
				references.push(...parseReferences(refMatch[1], absLine, contentStart));
				continue;
			}

			// --- flags ---
			const flagsMatch = line.match(FLAGS_LINE);
			if (flagsMatch && !line.startsWith("#~")) {
				flagsLine = absLine;
				flags = flagsMatch[1].split(",").map((f) => f.trim());
				continue;
			}

			// --- keyword fields (msgid, msgstr, msgctxt, msgid_plural) ---
			const obsMatch = line.match(FIELD_KEYWORD);
			const plainMatch = line.match(PLAIN_KEYWORD);
			const matched = obsMatch ?? plainMatch;

			if (matched) {
				const keyword = matched[1];
				const { text, spanLines } = collectContinuation(blockLines, i);
				const docLines = spanLines.map((sl) => block.startLine + sl);
				const value: FieldValue = {
					text,
					keywordLine: absLine,
					spanLines: docLines,
				};
				assignField(keyword, value, assigners);
				i += spanLines.length - 1; // skip consumed continuation lines
				continue;
			}

			// keyword with no content on the same line (e.g. `msgstr ""`  split
			// across lines — value is on the next continuation line)
			const obsEmpty = line.match(FIELD_KEYWORD_EMPTY);
			const plainEmpty = line.match(PLAIN_KEYWORD_EMPTY);
			const emptyMatch = obsEmpty ?? plainEmpty;
			if (emptyMatch) {
				// Keyword with no inline content — value may be on continuation lines
				const nextLine = blockLines[i + 1];
				const nextMatch = nextLine?.match(CONTINUATION);
				if (nextMatch) {
					const parts: string[] = [];
					const span: number[] = [];
					for (let j = i + 1; j < blockLines.length; j++) {
						const cm = blockLines[j].match(CONTINUATION);
						if (!cm) break;
						parts.push(unescape(cm[1]));
						span.push(j);
					}
					const value: FieldValue = {
						text: decodeEscapes(parts.join("")),
						keywordLine: absLine,
						spanLines: [absLine, ...span.map((s) => block.startLine + s)],
					};
					assignField(emptyMatch[1], value, assigners);
					i += span.length;
				} else {
					// Truly empty value
					const value: FieldValue = {
						text: "",
						keywordLine: absLine,
						spanLines: [absLine],
					};
					assignField(emptyMatch[1], value, assigners);
				}
			}
		}

		entries.push({
			startLine: block.startLine,
			endLine: block.endLine,
			isObsolete,
			flags,
			flagsLine,
			references,
			context,
			id,
			pluralId,
			translations,
		});
	}

	return entries;
}

interface FieldAssigners {
	setContext: (v: FieldValue) => void;
	setId: (v: FieldValue) => void;
	setPlural: (v: FieldValue) => void;
	setTranslation: (idx: number, v: FieldValue) => void;
}

function assignField(keyword: string, value: FieldValue, ops: FieldAssigners): void {
	if (keyword === "msgctxt") ops.setContext(value);
	else if (keyword === "msgid") ops.setId(value);
	else if (keyword === "msgid_plural") ops.setPlural(value);
	else if (keyword.startsWith("msgstr")) {
		const idx = keyword.includes("[")
			? Number(keyword.slice(keyword.indexOf("[") + 1, keyword.indexOf("]")))
			: 0;
		ops.setTranslation(idx, value);
	}
}
