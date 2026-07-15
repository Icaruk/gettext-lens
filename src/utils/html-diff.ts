/**
 * HTML tag extraction and comparison for gettext string validation.
 *
 * Compares the set of HTML tags between a source string (msgid) and its
 * translation (msgstr). Tags are normalised by kind (open / close / void)
 * and attributes are ignored so that `<a href="…">` matches `<a>`.
 */

const TAG_PATTERN = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?\/?>/g;

export type TagKind = "open" | "close" | "void";

export interface HtmlTag {
	name: string;
	kind: TagKind;
}

/** Normalise a raw tag string like `<br/>`, `</p>`, `<a href=…>` into a key. */
function classify(raw: string): HtmlTag {
	const isClosing = raw.startsWith("</");
	const isSelfClosing = raw.endsWith("/>");
	const nameMatch = raw.match(/^<\/?\s*([a-zA-Z][a-zA-Z0-9]*)/);
	const name = nameMatch ? nameMatch[1].toLowerCase() : "";
	return {
		name,
		kind: isClosing ? "close" : isSelfClosing ? "void" : "open",
	};
}

/** Reconstruct a display string for a tag kind (used in messages / inserts). */
export function renderTag(tag: HtmlTag): string {
	if (tag.kind === "close") return `</${tag.name}>`;
	if (tag.kind === "void") return `<${tag.name}/>`;
	return `<${tag.name}>`;
}

function tagKey(tag: HtmlTag): string {
	return `${tag.kind}:${tag.name}`;
}

/** Extract all HTML tags from a string, in order of appearance. */
export function extractTags(text: string): HtmlTag[] {
	const result: HtmlTag[] = [];
	for (const match of text.matchAll(TAG_PATTERN)) {
		result.push(classify(match[0]));
	}
	return result;
}

export interface TagDiff {
	/** Tags present in the source but missing from the translation. */
	missing: HtmlTag[];
	/** Tags present in the translation but not in the source. */
	extra: HtmlTag[];
}

/**
 * Multiset comparison of tag sequences. Returns missing and extra tags so the
 * caller can append the missing ones to the translation.
 */
export function diffTags(source: string, translation: string): TagDiff {
	const srcTags = extractTags(source);
	const trnTags = extractTags(translation);

	const srcCounts = new Map<string, { count: number; tag: HtmlTag }>();
	for (const t of srcTags) {
		const k = tagKey(t);
		const entry = srcCounts.get(k);
		if (entry) entry.count++;
		else srcCounts.set(k, { count: 1, tag: t });
	}

	// Subtract translation tags from source counts — anything left is "missing"
	for (const t of trnTags) {
		const k = tagKey(t);
		const entry = srcCounts.get(k);
		if (entry && entry.count > 0) entry.count--;
	}

	const missing: HtmlTag[] = [];
	for (const { count, tag } of srcCounts.values()) {
		for (let i = 0; i < count; i++) missing.push(tag);
	}

	// Compute extra (in translation but not source) symmetrically
	const trnCounts = new Map<string, { count: number; tag: HtmlTag }>();
	for (const t of trnTags) {
		const k = tagKey(t);
		const entry = trnCounts.get(k);
		if (entry) entry.count++;
		else trnCounts.set(k, { count: 1, tag: t });
	}
	for (const t of srcTags) {
		const k = tagKey(t);
		const entry = trnCounts.get(k);
		if (entry && entry.count > 0) entry.count--;
	}
	const extra: HtmlTag[] = [];
	for (const { count, tag } of trnCounts.values()) {
		for (let i = 0; i < count; i++) extra.push(tag);
	}

	return { missing, extra };
}
