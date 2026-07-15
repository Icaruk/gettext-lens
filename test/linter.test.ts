/**
 * Unit tests for the linter (diagnostic engine).
 *
 * Uses the same .po fixture as the parser tests plus a MockTextDocument
 * that satisfies the parts of vscode.TextDocument the linter touches.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { type IssueData, lintDocument } from "../src/services/linter.js";
import { clearAll } from "../src/services/parse-cache.js";
import type { IssueKind } from "../src/types.js";
import { MockTextDocument } from "./helpers/vscode-mock.js";

const FIXTURE = readFileSync(join(process.cwd(), "test", "fixtures", "sample.po"), "utf-8");

function countByKind(diagnostics: object[], kind: IssueKind) {
	return diagnostics.filter((d) => (d as { data?: IssueData }).data?.kind === kind).length;
}

describe("linter — summary counts", () => {
	beforeEach(() => clearAll());

	it("counts translated and untranslated entries", () => {
		const doc = new MockTextDocument(FIXTURE);
		const { summary } = lintDocument(doc);

		expect(summary.total).toBe(20); // excluding header + obsolete
		expect(summary.translated).toBe(19);
		expect(summary.untranslated).toBe(1);
	});

	it("counts fuzzy entries", () => {
		const doc = new MockTextDocument(FIXTURE);
		const { summary } = lintDocument(doc);
		expect(summary.fuzzy).toBe(1); // "Porciones"
	});

	it("counts HTML mismatches", () => {
		const doc = new MockTextDocument(FIXTURE);
		const { summary } = lintDocument(doc);
		expect(summary.htmlIssues).toBe(2); // missing <b></b> + extra <img/>
	});

	it("counts duplicates", () => {
		const doc = new MockTextDocument(FIXTURE);
		const { summary } = lintDocument(doc);
		expect(summary.duplicates).toBe(1); // second "Recetas"
	});
});

describe("linter — diagnostic details", () => {
	beforeEach(() => clearAll());

	it("produces the expected total number of diagnostics", () => {
		const doc = new MockTextDocument(FIXTURE);
		const { diagnostics } = lintDocument(doc);
		// 1 fuzzy + 1 empty + 2 html + 1 duplicate = 5
		expect(diagnostics).toHaveLength(5);
	});

	it("tags each diagnostic with IssueData for code lens consumption", () => {
		const doc = new MockTextDocument(FIXTURE);
		const { diagnostics } = lintDocument(doc);

		for (const d of diagnostics) {
			const data = (d as unknown as { data: IssueData }).data;
			expect(data).toBeDefined();
			expect(data.kind).toBeTruthy();
			expect(typeof data.entryStartLine).toBe("number");
		}
	});

	it("sets the diagnostic source to 'Gettext Lens'", () => {
		const doc = new MockTextDocument(FIXTURE);
		const { diagnostics } = lintDocument(doc);
		expect(diagnostics.every((d) => d.source === "Gettext Lens")).toBe(true);
	});
});

describe("linter — rule-specific checks", () => {
	beforeEach(() => clearAll());

	it("detects exactly one fuzzy diagnostic", () => {
		const doc = new MockTextDocument(FIXTURE);
		const { diagnostics } = lintDocument(doc);
		expect(countByKind(diagnostics, "fuzzy")).toBe(1);
	});

	it("detects exactly one empty translation", () => {
		const doc = new MockTextDocument(FIXTURE);
		const { diagnostics } = lintDocument(doc);
		expect(countByKind(diagnostics, "empty")).toBe(1);
	});

	it("detects exactly two HTML mismatches", () => {
		const doc = new MockTextDocument(FIXTURE);
		const { diagnostics } = lintDocument(doc);
		expect(countByKind(diagnostics, "html")).toBe(2);
	});

	it("attaches missing tags to the HTML issue data", () => {
		const doc = new MockTextDocument(FIXTURE);
		const { diagnostics } = lintDocument(doc);
		const htmlDiags = diagnostics.filter(
			(d) => (d as { data?: IssueData }).data?.kind === "html",
		);

		// The "Compartir <b>esta</b> receta" → "Share this recipe" case should
		// have missing <b></b>
		const missingDiag = htmlDiags.find((d) =>
			(d as { message: string }).message.includes("Missing"),
		);
		expect(missingDiag).toBeDefined();
		const data = (missingDiag as unknown as { data: IssueData }).data;
		expect(data.missingTags).toBeDefined();
		expect(data.missingTags?.length).toBeGreaterThan(0);
	});

	it("detects self-closing tag as extra in translation", () => {
		const doc = new MockTextDocument(FIXTURE);
		const { diagnostics } = lintDocument(doc);
		const htmlDiags = diagnostics.filter(
			(d) => (d as { data?: IssueData }).data?.kind === "html",
		);

		// "Enviar por correo" → "Send <img/> by email" should flag the extra <img/>
		const extraDiag = htmlDiags.find((d) =>
			(d as { message: string }).message.includes("Unexpected"),
		);
		expect(extraDiag).toBeDefined();
	});

	it("does not flag JSX-style numeric tags as HTML mismatch", () => {
		const doc = new MockTextDocument(FIXTURE);
		const { diagnostics } = lintDocument(doc);
		// The entry with <0>...</0> and <1/> should NOT produce an HTML diagnostic
		// because numeric tags are not standard HTML
		const jsxDiags = diagnostics.filter(
			(d) =>
				(d as { data?: IssueData }).data?.kind === "html"
				&& (d as { message: string }).message.includes("Pulsa"),
		);
		expect(jsxDiags).toHaveLength(0);
	});

	it("detects exactly one duplicate msgid", () => {
		const doc = new MockTextDocument(FIXTURE);
		const { diagnostics } = lintDocument(doc);
		expect(countByKind(diagnostics, "duplicate")).toBe(1);
	});

	it("does not flag same msgid under different msgctxt as duplicate", () => {
		const doc = new MockTextDocument(FIXTURE);
		const { diagnostics } = lintDocument(doc);
		// "Cortar" appears twice but with different msgctxt ("verb" / "noun")
		const cortarDiags = diagnostics.filter(
			(d) =>
				(d as { data?: IssueData }).data?.kind === "duplicate"
				&& (d as { message: string }).message.includes("Cortar"),
		);
		expect(cortarDiags).toHaveLength(0);
	});
});

describe("linter — template (.pot) handling", () => {
	beforeEach(() => clearAll());

	it("does not emit empty-translation warnings for .pot files", () => {
		const doc = new MockTextDocument(FIXTURE, "template.pot");
		const { diagnostics, summary } = lintDocument(doc);

		expect(countByKind(diagnostics, "empty")).toBe(0);
		// untranslated entries are not counted for templates
		expect(summary.untranslated).toBe(0);
	});

	it("still detects other issues in .pot files", () => {
		const doc = new MockTextDocument(FIXTURE, "template.pot");
		const { diagnostics } = lintDocument(doc);
		// fuzzy should still fire
		expect(countByKind(diagnostics, "fuzzy")).toBe(1);
	});
});

describe("linter — edge cases", () => {
	beforeEach(() => clearAll());

	it("handles an empty document gracefully", () => {
		const doc = new MockTextDocument("");
		const { diagnostics, summary } = lintDocument(doc);
		expect(diagnostics).toHaveLength(0);
		expect(summary.total).toBe(0);
	});

	it("skips obsolete entries entirely", () => {
		const doc = new MockTextDocument(FIXTURE);
		const { diagnostics } = lintDocument(doc);
		// The obsolete entry "Receta antigua" should not produce any diagnostic
		const obsoleteMessages = diagnostics.filter((d) => d.message.includes("Receta antigua"));
		expect(obsoleteMessages).toHaveLength(0);
	});

	it("handles emoji and special characters without errors", () => {
		const doc = new MockTextDocument(FIXTURE);
		const { summary } = lintDocument(doc);
		// Emoji entries (📅, 🧂) and special chars (€, ¿) are counted normally
		expect(summary.total).toBe(20);
		expect(summary.translated).toBe(19);
	});
});
