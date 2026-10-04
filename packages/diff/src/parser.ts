import parseDiff from "parse-diff";
import type { DiffChangeType, DiffHunk, DiffLine, FileDiff, DiffSummary } from "./types.js";

/**
 * Parse unified diff string into structured FileDiff array.
 */
export function parseUnifiedDiff(rawDiff: string): FileDiff[] {
  if (!rawDiff || rawDiff.trim().length === 0) {
    return [];
  }

  const parsed = parseDiff(rawDiff);

  return parsed.map((file): FileDiff => {
    let status: FileDiff["status"] = "modified";
    if (file.new || file.from === "/dev/null") {
      status = "added";
    } else if (file.deleted || file.to === "/dev/null") {
      status = "deleted";
    } else if (file.from && file.to && file.from !== file.to) {
      status = "renamed";
    }

    const newPath = file.to || file.from || "unknown";
    const oldPath = file.from && file.from !== "/dev/null" ? file.from : undefined;

    let positionCounter = 0;
    const hunks: DiffHunk[] = file.chunks.map((chunk) => {
      positionCounter++; // Hunk header line counts in GitHub diff position
      const lines: DiffLine[] = chunk.changes.map((change) => {
        positionCounter++;
        let type: DiffChangeType = "normal";
        if (change.type === "add") type = "add";
        else if (change.type === "del") type = "del";

        return {
          type,
          content: change.content,
          oldLineNumber: change.type !== "add" ? (change as any).ln1 ?? (change as any).ln : undefined,
          newLineNumber: change.type !== "del" ? (change as any).ln2 ?? (change as any).ln : undefined,
          diffPosition: positionCounter,
        };
      });

      return {
        content: chunk.content,
        oldStart: chunk.oldStart,
        oldLines: chunk.oldLines,
        newStart: chunk.newStart,
        newLines: chunk.newLines,
        lines,
      };
    });

    return {
      oldPath,
      newPath,
      status,
      additions: file.additions,
      deletions: file.deletions,
      isBinary: Boolean((file as any).binary),
      hunks,
    };
  });
}

/**
 * Summarize a parsed diff.
 */
export function getDiffSummary(files: FileDiff[]): DiffSummary {
  let additions = 0;
  let deletions = 0;

  for (const f of files) {
    additions += f.additions;
    deletions += f.deletions;
  }

  return {
    filesChanged: files.length,
    additions,
    deletions,
    files,
  };
}

/**
 * Check if a line is within any changed hunk for the specified side.
 * - side "RIGHT": target is a line in the new/modified file.
 * - side "LEFT": target is a line in the original/deleted file.
 */
export function isLineInHunk(file: FileDiff, line: number, side: "RIGHT" | "LEFT" = "RIGHT"): boolean {
  for (const hunk of file.hunks) {
    if (side === "RIGHT") {
      const start = hunk.newStart;
      const end = hunk.newStart + hunk.newLines - 1;
      if (line >= start && line <= end) {
        return true;
      }
    } else {
      const start = hunk.oldStart;
      const end = hunk.oldStart + hunk.oldLines - 1;
      if (line >= start && line <= end) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Check if a specific line was specifically added/modified (not just context) in the diff.
 */
export function isLineModified(file: FileDiff, line: number, side: "RIGHT" | "LEFT" = "RIGHT"): boolean {
  for (const hunk of file.hunks) {
    for (const l of hunk.lines) {
      if (side === "RIGHT" && l.type === "add" && l.newLineNumber === line) {
        return true;
      }
      if (side === "LEFT" && l.type === "del" && l.oldLineNumber === line) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Find hunk that contains the specified line.
 */
export function findHunkForLine(
  file: FileDiff,
  line: number,
  side: "RIGHT" | "LEFT" = "RIGHT"
): DiffHunk | undefined {
  for (const hunk of file.hunks) {
    if (side === "RIGHT") {
      const start = hunk.newStart;
      const end = hunk.newStart + hunk.newLines - 1;
      if (line >= start && line <= end) return hunk;
    } else {
      const start = hunk.oldStart;
      const end = hunk.oldStart + hunk.oldLines - 1;
      if (line >= start && line <= end) return hunk;
    }
  }
  return undefined;
}
