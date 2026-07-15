/**
 * Unit tests for the HTML tag comparison utility.
 */

import { describe, it, expect } from "vitest";
import {
  extractTags,
  diffTags,
  renderTag,
  type HtmlTag,
} from "../src/utils/html-diff.js";

describe("extractTags", () => {
  it("extracts simple tags", () => {
    const tags = extractTags("<b>bold</b>");
    expect(tags.map((t) => t.name)).toEqual(["b", "b"]);
    expect(tags[0].kind).toBe("open");
    expect(tags[1].kind).toBe("close");
  });

  it("handles void elements", () => {
    const tags = extractTags("line<br/>break");
    expect(tags.length).toBe(1);
    expect(tags[0].kind).toBe("void");
    expect(tags[0].name).toBe("br");
  });

  it("ignores attributes", () => {
    const tags = extractTags('<a href="x">link</a>');
    expect(tags[0].name).toBe("a");
    expect(tags[0].kind).toBe("open");
  });

  it("normalises tag names to lowercase", () => {
    const tags = extractTags("<DIV>");
    expect(tags[0].name).toBe("div");
  });

  it("returns empty for plain text", () => {
    expect(extractTags("no tags here")).toEqual([]);
  });
});

describe("diffTags", () => {
  it("returns no diff when tags match", () => {
    const d = diffTags("<b>text</b>", "<b>tekst</b>");
    expect(d.missing).toHaveLength(0);
    expect(d.extra).toHaveLength(0);
  });

  it("detects missing tags in translation", () => {
    const d = diffTags("<b>bold</b>", "plain");
    expect(d.missing).toHaveLength(2); // open + close
    expect(d.extra).toHaveLength(0);
  });

  it("detects extra tags in translation", () => {
    const d = diffTags("plain", "<i>extra</i>");
    expect(d.missing).toHaveLength(0);
    expect(d.extra).toHaveLength(2);
  });

  it("handles partial matches (one of two tags present)", () => {
    const d = diffTags("<b><i>text</i></b>", "<b>text");
    // missing: close </b>, close </i> → but <b> open matches
    // Actually: source has [open b, open i, close i, close b]
    // translation has [open b]
    // After multiset subtraction: missing = [open i, close i, close b]
    expect(d.missing.length).toBe(3);
    expect(d.extra).toHaveLength(0);
  });

  it("handles void elements correctly", () => {
    const d = diffTags("a<br/>b", "ab");
    expect(d.missing).toHaveLength(1);
    expect(d.missing[0].kind).toBe("void");
  });
});

describe("renderTag", () => {
  it("renders open tags", () => {
    const tag: HtmlTag = { name: "a", kind: "open" };
    expect(renderTag(tag)).toBe("<a>");
  });

  it("renders close tags", () => {
    const tag: HtmlTag = { name: "a", kind: "close" };
    expect(renderTag(tag)).toBe("</a>");
  });

  it("renders void tags", () => {
    const tag: HtmlTag = { name: "br", kind: "void" };
    expect(renderTag(tag)).toBe("<br/>");
  });
});
