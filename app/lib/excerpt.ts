import { Lexer, type Token, type Tokens } from "marked";

/** Notifications show about this many characters of what someone wrote. */
export const EXCERPT_LENGTH = 140;

type WithTokens = { tokens?: Token[] };

// These hold inline tokens, which run together: "foo**bar**" reads "foobar".
const INLINE_CONTAINERS = new Set([
  "paragraph",
  "heading",
  "text",
  "strong",
  "em",
  "del",
  "link",
]);

// Collects the readable text of a markdown token tree, dropping the syntax.
// Returns one string per block (paragraph, list item, ...), which the caller
// joins with spaces. Raw HTML is dropped altogether, not escaped: the Inbox
// shows plain text.
function plainText(tokens: Token[]): string[] {
  return tokens.flatMap((token): string[] => {
    const { tokens: children } = token as WithTokens;
    if (children && INLINE_CONTAINERS.has(token.type)) {
      return [plainText(children).join("")];
    }
    switch (token.type) {
      case "html":
      case "hr":
      case "space":
        return [];
      case "br":
        return [" "];
      case "list":
        return (token as Tokens.List).items.flatMap((item) =>
          plainText(item.tokens)
        );
      case "table": {
        const { header, rows } = token as Tokens.Table;
        return [
          ...header.flatMap((cell) => plainText(cell.tokens)),
          ...rows.flatMap((row) =>
            row.flatMap((cell) => plainText(cell.tokens))
          ),
        ];
      }
      default: {
        if (children) return plainText(children);
        return "text" in token && typeof token.text === "string"
          ? [token.text]
          : [];
      }
    }
  });
}

/**
 * A plain-text excerpt of markdown (or plain text) for a Notification: no
 * formatting, one line, cut to about 140 characters with "…". The Inbox shows
 * it as plain text, and the Knock workflow bodies never include it.
 */
export function excerpt(markdown: string): string {
  const text = plainText(Lexer.lex(markdown))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= EXCERPT_LENGTH) return text;
  return text.slice(0, EXCERPT_LENGTH - 1).trimEnd() + "…";
}
