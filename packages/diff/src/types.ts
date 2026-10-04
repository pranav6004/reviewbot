export type DiffChangeType = "add" | "del" | "normal";

export interface DiffLine {
  type: DiffChangeType;
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
  /** 1-based offset within the diff patch for GitHub comments */
  diffPosition?: number;
}

export interface DiffHunk {
  content: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface FileDiff {
  oldPath?: string;
  newPath: string;
  status: "added" | "modified" | "deleted" | "renamed";
  additions: number;
  deletions: number;
  isBinary: boolean;
  hunks: DiffHunk[];
  /** Raw unified diff patch for this file */
  rawPatch?: string;
}

export interface DiffSummary {
  filesChanged: number;
  additions: number;
  deletions: number;
  files: FileDiff[];
}
