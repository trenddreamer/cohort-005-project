import { describe, it, expect } from "vitest";
import { excerpt, EXCERPT_LENGTH } from "./excerpt";

describe("excerpt", () => {
  it("leaves short plain text alone", () => {
    expect(excerpt("How do I reset it?")).toBe("How do I reset it?");
  });

  it("strips markdown formatting", () => {
    expect(excerpt("**Bold** and _italic_ and `code`")).toBe(
      "Bold and italic and code"
    );
  });

  it("does not put spaces between adjacent inline pieces of one sentence", () => {
    expect(excerpt("foo**bar**")).toBe("foobar");
    expect(excerpt("a*b*c and `x`y [l](u).")).toBe("abc and xy l.");
  });

  it("keeps the text of links and the alt text of images", () => {
    expect(
      excerpt("See [the docs](https://example.com) ![a cat](cat.png)")
    ).toBe("See the docs a cat");
  });

  it("flattens headings, lists, quotes and code blocks onto one line", () => {
    const body =
      "# Title\n\n- one\n- two\n\n> quoted\n\n```ts\nconst a = 1;\n```";

    expect(excerpt(body)).toBe("Title one two quoted const a = 1;");
  });

  it("drops raw HTML, so nobody can put markup into an Inbox", () => {
    expect(excerpt("hi <script>alert(1)</script> there")).not.toContain("<");
  });

  it("keeps characters that markdown escapes as they were written", () => {
    expect(excerpt("Tom & Jerry say 1 < 2")).toBe("Tom & Jerry say 1 < 2");
  });

  it("cuts long text to the excerpt length, ending in an ellipsis", () => {
    const result = excerpt("word ".repeat(100));

    expect(result.length).toBeLessThanOrEqual(EXCERPT_LENGTH);
    expect(result.length).toBeGreaterThan(EXCERPT_LENGTH - 10);
    expect(result.endsWith("…")).toBe(true);
  });

  it("does not add an ellipsis to text exactly at the limit", () => {
    const text = "a".repeat(EXCERPT_LENGTH);

    expect(excerpt(text)).toBe(text);
  });

  it("returns an empty string for text with nothing to show", () => {
    expect(excerpt("  \n ")).toBe("");
  });
});
