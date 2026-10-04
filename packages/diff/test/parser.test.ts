import { describe, it, expect } from "vitest";
import { parseUnifiedDiff, isLineInHunk, isLineModified, getDiffSummary } from "../src/index.js";

const SAMPLE_DIFF = `diff --git a/src/auth.ts b/src/auth.ts
index e69de29..d95f3ad 100644
--- a/src/auth.ts
+++ b/src/auth.ts
@@ -10,6 +10,8 @@ export function verifyToken(token: string): boolean {
   if (!token) {
     return false;
   }
+  const payload = decode(token);
+  return payload.exp > Date.now();
 }
diff --git a/README.md b/README.md
new file mode 100644
index 0000000..3b18e51
--- /dev/null
+++ b/README.md
@@ -0,0 +1,5 @@
+# Test Project
+
+A sample project.
`;

describe("diff parser", () => {
  it("parses multiple files and hunks accurately", () => {
    const files = parseUnifiedDiff(SAMPLE_DIFF);
    expect(files).toHaveLength(2);

    const authFile = files[0];
    expect(authFile.newPath).toBe("src/auth.ts");
    expect(authFile.status).toBe("modified");
    expect(authFile.additions).toBe(2);
    expect(authFile.deletions).toBe(0);
    expect(authFile.hunks).toHaveLength(1);

    const readmeFile = files[1];
    expect(readmeFile.newPath).toBe("README.md");
    expect(readmeFile.status).toBe("added");
    expect(readmeFile.additions).toBe(3);
  });

  it("checks if lines are in changed hunk", () => {
    const files = parseUnifiedDiff(SAMPLE_DIFF);
    const authFile = files[0];

    // hunk is newStart: 10, newLines: 8 -> lines 10..17
    expect(isLineInHunk(authFile, 10, "RIGHT")).toBe(true);
    expect(isLineInHunk(authFile, 14, "RIGHT")).toBe(true);
    expect(isLineInHunk(authFile, 17, "RIGHT")).toBe(true);
    expect(isLineInHunk(authFile, 25, "RIGHT")).toBe(false);
  });

  it("checks if line is specifically modified", () => {
    const files = parseUnifiedDiff(SAMPLE_DIFF);
    const authFile = files[0];

    // lines 13 and 14 were added
    expect(isLineModified(authFile, 13, "RIGHT")).toBe(true);
    expect(isLineModified(authFile, 14, "RIGHT")).toBe(true);
    // line 10 is unchanged context
    expect(isLineModified(authFile, 10, "RIGHT")).toBe(false);
  });

  it("generates correct summary stats", () => {
    const files = parseUnifiedDiff(SAMPLE_DIFF);
    const summary = getDiffSummary(files);
    expect(summary.filesChanged).toBe(2);
    expect(summary.additions).toBe(5);
    expect(summary.deletions).toBe(0);
  });
});
