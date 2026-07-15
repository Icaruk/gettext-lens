/**
 * Unit tests for the PO catalog parser.
 *
 * Reads the real .po fixture file and verifies that the parser correctly
 * extracts entries, flags, references, translations, plurals, multiline
 * strings, context, emoji, ICU placeholders, and obsolete markers.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCatalog } from "../src/parser/po-parser.js";
import type { CatalogEntry } from "../src/types.js";

const FIXTURE = readFileSync(join(process.cwd(), "test", "fixtures", "sample.po"), "utf-8");
const entries = parseCatalog(FIXTURE);

/** Shorthand: find the first entry whose msgid matches. */
function byId(text: string): CatalogEntry | undefined {
	return entries.find((e) => e.id?.text === text);
}

/** Find an entry by both context and msgid (for disambiguation). */
function byContext(ctx: string, id: string): CatalogEntry | undefined {
	return entries.find((e) => e.context?.text === ctx && e.id?.text === id);
}

describe("parser — block count", () => {
	it("parses all blocks including header and obsolete", () => {
		// Header + 20 content entries + 1 obsolete = 22
		expect(entries.length).toBe(22);
	});
});

describe("parser — header entry", () => {
	it("has an empty msgid", () => {
		const header = entries[0];
		expect(header.id?.text).toBe("");
		expect(header.translations.get(0)?.text).toContain("Project-Id-Version");
	});
});

describe("parser — simple entries", () => {
	it("extracts msgid and msgstr text", () => {
		const e = byId("Recetas");
		expect(e).toBeDefined();
		expect(e?.translations.get(0)?.text).toBe("Recipes");
	});

	it("captures start and end line indices", () => {
		const e = byId("Compartir receta");
		expect(e?.startLine).toBeGreaterThanOrEqual(0);
		expect(e?.endLine).toBeGreaterThanOrEqual(e?.startLine);
	});
});

describe("parser — flags", () => {
	it("detects the fuzzy flag", () => {
		const e = byId("Porciones");
		expect(e?.flags).toContain("fuzzy");
		expect(e?.flagsLine).toBeGreaterThanOrEqual(0);
	});

	it("has no flags for entries without #, lines", () => {
		const e = byId("Recetas");
		expect(e?.flags.length).toBe(0);
		expect(e?.flagsLine).toBe(-1);
	});
});

describe("parser — empty translation", () => {
	it("stores an empty string for untranslated entries", () => {
		const e = byId("Añadir ingrediente");
		const tr = e?.translations.get(0);
		expect(tr).toBeDefined();
		expect(tr?.text).toBe("");
	});
});

describe("parser — HTML in strings", () => {
	it("preserves HTML tags inside source values", () => {
		const e = byId("Compartir <b>esta</b> receta");
		expect(e?.id?.text).toBe("Compartir <b>esta</b> receta");
	});

	it("preserves self-closing tags in translations", () => {
		const e = byId("Enviar por correo");
		expect(e?.translations.get(0)?.text).toBe("Send <img/> by email");
	});

	it("preserves JSX-style numeric component tags", () => {
		const e = entries.find((e) => e.id?.text.startsWith("Pulsa <0>aquí</0>"));
		expect(e).toBeDefined();
		expect(e?.translations.get(0)?.text).toContain("<0>here</0>");
		expect(e?.translations.get(0)?.text).toContain("<1/>");
	});
});

describe("parser — msgctxt", () => {
	it("captures context for disambiguation", () => {
		const verb = byContext("verb", "Cortar");
		expect(verb).toBeDefined();
		expect(verb?.context?.text).toBe("verb");
		expect(verb?.translations.get(0)?.text).toBe("Cut");
	});

	it("allows same msgid under different context", () => {
		const noun = byContext("noun", "Cortar");
		expect(noun).toBeDefined();
		expect(noun?.context?.text).toBe("noun");
		expect(noun?.translations.get(0)?.text).toBe("Slice");
	});
});

describe("parser — plural forms", () => {
	it("extracts msgid_plural", () => {
		const e = byId("ingrediente");
		expect(e?.pluralId?.text).toBe("ingredientes");
	});

	it("maps plural-indexed translations", () => {
		const e = byId("ingrediente");
		expect(e?.translations.get(0)?.text).toBe("ingredient");
		expect(e?.translations.get(1)?.text).toBe("ingredients");
	});

	it("parses lingui ICU-compiled plural entries", () => {
		const e = byId("# paso");
		expect(e?.pluralId?.text).toBe("# pasos");
		expect(e?.translations.get(0)?.text).toBe("# step");
		expect(e?.translations.get(1)?.text).toBe("# steps");
	});
});

describe("parser — multiline strings", () => {
	it("joins continuation lines into a single value", () => {
		const e = byId("Esta receta requiere tiempo de preparación");
		expect(e).toBeDefined();
		expect(e?.translations.get(0)?.text).toBe("This recipe requires preparation time");
	});

	it("records every line that contributes to the value", () => {
		const e = byId("Esta receta requiere tiempo de preparación");
		const id = e?.id;
		expect(id?.spanLines.length).toBeGreaterThanOrEqual(2);
	});
});

describe("parser — references", () => {
	it("parses #: file:line references", () => {
		const e = byId("Recetas");
		expect(e?.references.length).toBeGreaterThan(0);
		const ref = e?.references[0];
		expect(ref.filePath).toBe("src/features/recipes/RecipeList.tsx");
		expect(ref.sourceLine).toBe(42);
	});

	it("computes correct column offsets relative to the line", () => {
		const e = byId("Buscar");
		const ref = e?.references[0];
		const token = "src/features/recipes/RecipeList.tsx:100";
		// Line: "#: src/features/recipes/RecipeList.tsx:100"
		//        0123                               3...
		expect(ref.startCol).toBe(3);
		expect(ref.endCol).toBe(3 + token.length);
	});

	it("captures multiple references for the same entry", () => {
		const e = byId("Buscar");
		expect(e?.references.length).toBe(2);
		expect(e?.references[0].filePath).toBe("src/features/recipes/RecipeList.tsx");
		expect(e?.references[0].sourceLine).toBe(100);
		expect(e?.references[1].filePath).toBe("src/features/recipes/RecipeSearch.tsx");
		expect(e?.references[1].sourceLine).toBe(22);
	});
});

describe("parser — emoji and special characters", () => {
	it("preserves emoji in msgid and msgstr", () => {
		const planner = byId("📅 Planificador");
		expect(planner).toBeDefined();
		expect(planner?.translations.get(0)?.text).toBe("📅 Planner");

		const ingredients = byId("🧂 Ingredientes");
		expect(ingredients?.translations.get(0)?.text).toBe("🧂 Ingredients");
	});

	it("preserves special characters (€, ¿, ¡)", () => {
		const euro = byId("€");
		expect(euro?.translations.get(0)?.text).toBe("€");

		const free = byId("¿Gratis?");
		expect(free?.translations.get(0)?.text).toBe("Free?");
	});
});

describe("parser — ICU message format", () => {
	it("preserves ICU inline plurals in msgid", () => {
		const e = byId("Caduca en {0} {1, plural, one {día} other {días}}");
		expect(e).toBeDefined();
		expect(e?.translations.get(0)?.text).toBe(
			"Expires in {0} {1, plural, one {day} other {days}}",
		);
	});

	it("preserves brace placeholders", () => {
		const e = byId("Cocinar {0}");
		expect(e?.translations.get(0)?.text).toBe("Cook {0}");
	});
});

describe("parser — obsolete entries", () => {
	it("marks #~ entries as obsolete", () => {
		const e = entries.find((e) => e.isObsolete);
		expect(e).toBeDefined();
		expect(e?.id?.text).toBe("Receta antigua");
	});
});
