/**
 * Converts CLI/AI-style formatted text to proper Markdown.
 * Handles:
 * - Box-drawing tables (┌─┬─┐ │ │ ├─┼─┤ └─┴─┘) → markdown tables
 * - ⏺ bullet markers → ## headings or regular text
 * - ❯ prompt lines → blockquotes
 * - Cleans up excessive whitespace
 */

/** Detect if a line is a box-drawing border line */
function isTableBorder(line: string): boolean {
  const trimmed = line.trim();
  return /^[┌┬┐├┼┤└┴┘─│╔╦╗╠╬╣╚╩╝═║+\-|]+$/.test(trimmed);
}

/** Detect if a line is a table data row (│ cell │ cell │) */
function isTableDataRow(line: string): boolean {
  const trimmed = line.trim();
  return (
    (trimmed.startsWith("│") || trimmed.startsWith("|")) &&
    (trimmed.endsWith("│") || trimmed.endsWith("|"))
  );
}

/** Extract cells from a table data row */
function extractCells(line: string): string[] {
  const trimmed = line.trim();
  // Remove leading/trailing pipe
  const inner = trimmed.slice(1, -1);
  return inner.split(/│|\|/).map((c) => c.trim());
}

/** Convert a block of box-drawing table lines to markdown table */
function convertTable(lines: string[]): string {
  const dataRows: string[][] = [];

  for (const line of lines) {
    if (isTableBorder(line)) continue;
    if (isTableDataRow(line)) {
      dataRows.push(extractCells(line));
    }
  }

  if (dataRows.length === 0) return lines.join("\n");

  // Determine column widths for alignment
  const colCount = Math.max(...dataRows.map((r) => r.length));
  const result: string[] = [];

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    // Pad row to colCount
    while (row.length < colCount) row.push("");
    result.push("| " + row.join(" | ") + " |");

    // Add separator after first row (header)
    if (i === 0) {
      result.push("| " + row.map(() => "---").join(" | ") + " |");
    }
  }

  return result.join("\n");
}

export function cleanToMarkdown(text: string): string {
  const lines = text.split("\n");
  const output: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Detect table blocks (consecutive table border/data lines)
    if (isTableBorder(trimmed) || isTableDataRow(trimmed)) {
      const tableLines: string[] = [];
      while (
        i < lines.length &&
        (isTableBorder(lines[i].trim()) ||
          isTableDataRow(lines[i].trim()) ||
          lines[i].trim() === "")
      ) {
        if (lines[i].trim() !== "") {
          tableLines.push(lines[i]);
        }
        i++;
      }
      output.push(convertTable(tableLines));
      continue;
    }

    // ⏺ marker → heading or bold text
    if (trimmed.startsWith("⏺")) {
      const content = trimmed.replace(/^⏺\s*/, "").trim();
      if (content) {
        // If it looks like a section header (short, no punctuation at end)
        if (content.length < 80 && !content.endsWith(".") && !content.endsWith(":")) {
          output.push(`## ${content}`);
        } else {
          output.push(`**${content}**`);
        }
      }
      i++;
      continue;
    }

    // ❯ prompt lines → blockquote
    if (trimmed.startsWith("❯")) {
      const content = trimmed.replace(/^❯\s*/, "").trim();
      output.push(`> ${content}`);
      i++;
      continue;
    }

    // Clean up lines that are just decorative dashes/equals
    if (/^[-=]{3,}$/.test(trimmed) && trimmed.length > 5) {
      output.push("---");
      i++;
      continue;
    }

    // Convert "Option N:" style to ### heading
    if (/^Option \d+:/.test(trimmed)) {
      output.push(`### ${trimmed}`);
      i++;
      continue;
    }

    // Convert "My recommendation:" style to heading
    if (/^(My |The |Your |For )\w.*:$/.test(trimmed) && trimmed.length < 60) {
      output.push(`### ${trimmed}`);
      i++;
      continue;
    }

    // Convert "- Best if:" to bold within list item
    if (trimmed.startsWith("- Best if:")) {
      output.push(trimmed.replace("- Best if:", "- **Best if:**"));
      i++;
      continue;
    }

    // Convert "- But:" to bold within list item
    if (trimmed.startsWith("- But:")) {
      output.push(trimmed.replace("- But:", "- **But:**"));
      i++;
      continue;
    }

    // Convert "Why:" standalone to heading
    if (/^(Why|Note|Warning|Important|Summary):?\s*$/.test(trimmed)) {
      output.push(`### ${trimmed}`);
      i++;
      continue;
    }

    // Pass through everything else
    output.push(line);
    i++;
  }

  // Clean up multiple consecutive blank lines
  let result = output.join("\n");
  result = result.replace(/\n{3,}/g, "\n\n");
  result = result.trim() + "\n";

  return result;
}
