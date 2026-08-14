export interface ParsedMarkdown {
  attributes: Record<string, string>;
  body: string;
}

export function parseMarkdownFrontmatter(content: string): ParsedMarkdown {
  const normalizedContent = content
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n");

  if (!normalizedContent.startsWith("---\n")) {
    return { attributes: {}, body: normalizedContent };
  }

  const closingDelimiterIndex = normalizedContent.indexOf("\n---\n", 4);

  if (closingDelimiterIndex === -1) {
    return { attributes: {}, body: normalizedContent };
  }

  return {
    attributes: parseAttributes(
      normalizedContent.slice(4, closingDelimiterIndex)
    ),
    body: normalizedContent.slice(closingDelimiterIndex + 5)
  };
}

function parseAttributes(frontmatter: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const lines = frontmatter.split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const property = /^([a-zA-Z][\w-]*):\s*(.*)$/.exec(lines[index]);

    if (!property) {
      continue;
    }

    const key = property[1].toLowerCase();
    const value = property[2].trim();

    if (value === "|" || value === ">") {
      const blockLines: string[] = [];

      while (
        index + 1 < lines.length &&
        (lines[index + 1].trim() === "" || /^\s+/.test(lines[index + 1]))
      ) {
        index += 1;
        blockLines.push(lines[index].replace(/^\s+/, ""));
      }

      attributes[key] = value === ">"
        ? blockLines.join(" ").trim()
        : blockLines.join("\n").trim();
      continue;
    }

    attributes[key] = removeWrappingQuotes(value);
  }

  return attributes;
}

function removeWrappingQuotes(value: string): string {
  if (value.length < 2) {
    return value;
  }

  const firstCharacter = value[0];
  const lastCharacter = value[value.length - 1];

  if (
    firstCharacter === "\"" && lastCharacter === "\""
  ) {
    try {
      const decodedValue: unknown = JSON.parse(value);

      if (typeof decodedValue === "string") {
        return decodedValue;
      }
    } catch {
      return value.slice(1, -1);
    }
  }

  if (firstCharacter === "'" && lastCharacter === "'") {
    return value.slice(1, -1);
  }

  return value;
}
