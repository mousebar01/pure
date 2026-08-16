"use client";

import { useEffect, useMemo, useState } from "react";
import { getFileIcon } from "./FileIcons";
import { getFileName, getRelativeFilePath } from "@/lib/file-paths";
import type { GitFileStatus } from "@/lib/git-types";
import { useI18n } from "@/hooks/useI18n";
import { fetchGitStatus, GIT_STATUS_COLORS, GitStatusBadge } from "./FileExplorer";

type Translate = ReturnType<typeof useI18n>["t"];

type ChangeGroupKind = "staged" | "unstaged" | "untracked";

interface ChangeGroup {
  kind: ChangeGroupKind;
  files: GitFileStatus[];
}

/**
 * Group working-tree rows into staged / unstaged / untracked sections.
 * A file with both staged and unstaged parts appears in both sections
 * (indexStatus vs worktreeStatus from `git status --porcelain`), like
 * VS Code. Conflicts stay in the unstaged section — they are a
 * working-tree problem and carry the red badge.
 */
function groupChanges(files: GitFileStatus[]): ChangeGroup[] {
  const staged: GitFileStatus[] = [];
  const unstaged: GitFileStatus[] = [];
  const untracked: GitFileStatus[] = [];
  for (const file of files) {
    if (file.status === "untracked") {
      untracked.push(file);
      continue;
    }
    if (file.indexStatus && file.indexStatus !== " ") staged.push(file);
    if (file.worktreeStatus && file.worktreeStatus !== " ") unstaged.push(file);
  }
  const groups: ChangeGroup[] = [];
  if (staged.length > 0) groups.push({ kind: "staged", files: staged });
  if (unstaged.length > 0) groups.push({ kind: "unstaged", files: unstaged });
  if (untracked.length > 0) groups.push({ kind: "untracked", files: untracked });
  return groups;
}

function ChangeRow({
  status,
  cwd,
  onOpenFile,
  t,
}: {
  status: GitFileStatus;
  cwd: string;
  onOpenFile: (filePath: string, fileName: string, options?: { sourceSessionId?: string | null; modeHint?: "diff" }) => void;
  t: Translate;
}) {
  const [hovered, setHovered] = useState(false);
  const name = getFileName(status.filePath);
  const rel = getRelativeFilePath(status.filePath, cwd);
  return (
    <div
      onClick={() => onOpenFile(status.filePath, name, { modeHint: "diff" })}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={status.filePath}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        paddingLeft: 10,
        paddingRight: 8,
        height: 24,
        cursor: "pointer",
        background: hovered ? "var(--bg-hover)" : "transparent",
        borderRadius: 4,
        userSelect: "none",
      }}
    >
      <GitStatusBadge status={status} t={t} />
      <span style={{ flexShrink: 0, display: "flex", alignItems: "center", opacity: 0.85 }}>
        {getFileIcon(name, 13)}
      </span>
      <span
        style={{
          fontSize: 12,
          color: "var(--text)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          flex: 1,
        }}
      >
        {rel}
      </span>
    </div>
  );
}

interface Props {
  cwd: string;
  onOpenFile: (filePath: string, fileName: string, options?: { sourceSessionId?: string | null; modeHint?: "diff" }) => void;
  refreshKey?: number;
  onCountChange?: (count: number) => void;
  /** Staged / unstaged breakdown — drives the sidebar branch dirty dot. */
  onStatsChange?: (stats: { staged: number; unstaged: number }) => void;
}

/**
 * The Changes tab: working-tree status grouped into staged / unstaged /
 * untracked sections with per-file diff badges and line stats. Clicking a
 * row opens the file in diff mode in the right panel.
 */
export function ChangesPanel({ cwd, onOpenFile, refreshKey, onCountChange, onStatsChange }: Props) {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isGit, setIsGit] = useState(false);
  const [gitFiles, setGitFiles] = useState<GitFileStatus[]>([]);
  const [gitLineStats, setGitLineStats] = useState({ additions: 0, deletions: 0 });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchGitStatus(cwd)
      .then((status) => {
        if (cancelled) return;
        setIsGit(status.isGitRepository);
        setGitFiles(status.isGitRepository ? status.files : []);
        setGitLineStats(status.isGitRepository
          ? { additions: status.additions, deletions: status.deletions }
          : { additions: 0, deletions: 0 });
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [cwd, refreshKey]);

  useEffect(() => {
    onCountChange?.(gitFiles.length);
  }, [gitFiles, onCountChange]);

  // Staged / unstaged breakdown for the branch dirty dot (untracked files
  // count as unstaged — they are working-tree changes too).
  const groupCounts = useMemo(() => {
    let staged = 0;
    let unstaged = 0;
    for (const file of gitFiles) {
      if (file.status === "untracked") {
        unstaged += 1;
        continue;
      }
      if (file.indexStatus && file.indexStatus !== " ") staged += 1;
      if (file.worktreeStatus && file.worktreeStatus !== " ") unstaged += 1;
    }
    return { staged, unstaged };
  }, [gitFiles]);

  useEffect(() => {
    onStatsChange?.(groupCounts);
  }, [groupCounts, onStatsChange]);

  const groups = useMemo(() => groupChanges(gitFiles), [gitFiles]);

  return (
    <div style={{ minHeight: "100%", paddingBottom: 8 }}>
      {loading && (
        <div style={{ padding: "14px 12px", fontSize: 11, color: "var(--text-dim)" }}>
          {t("sidebar.loading")}
        </div>
      )}
      {!loading && error && (
        <div style={{ padding: "12px", fontSize: 11, color: "#f87171" }}>{error}</div>
      )}
      {!loading && !error && !isGit && (
        <div style={{ padding: "20px 12px", fontSize: 11, color: "var(--text-dim)", textAlign: "center" }}>
          {t("changes.notGitRepository")}
        </div>
      )}
      {!loading && !error && isGit && gitFiles.length === 0 && (
        <div style={{ padding: "20px 12px", fontSize: 11, color: "var(--text-dim)", textAlign: "center" }}>
          {t("changes.empty")}
        </div>
      )}
      {!loading && !error && isGit && gitFiles.length > 0 && (
        <>
          {/* Stats line */}
          <div
            aria-label={t("files.changeStats", {
              count: gitFiles.length,
              additions: gitLineStats.additions,
              deletions: gitLineStats.deletions,
            })}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              height: 26,
              padding: "0 12px",
              fontSize: 11,
              color: "var(--text-dim)",
              borderBottom: "1px solid var(--border)",
            }}
          >
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {t("files.changedCount", { count: gitFiles.length })}
            </span>
            <span style={{ color: GIT_STATUS_COLORS.added, fontFamily: "var(--font-mono)", flexShrink: 0 }}>
              +{gitLineStats.additions}
            </span>
            <span style={{ color: GIT_STATUS_COLORS.deleted, fontFamily: "var(--font-mono)", flexShrink: 0 }}>
              -{gitLineStats.deletions}
            </span>
          </div>
          {/* Grouped rows */}
          {groups.map((group) => (
            <div key={group.kind}>
              <div
                style={{
                  padding: "8px 12px 2px",
                  fontSize: 10.5,
                  fontWeight: 600,
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                  color: "var(--text-dim)",
                }}
              >
                {t(`changes.${group.kind}`)}
                <span style={{ marginLeft: 6, color: "var(--text-dim)", fontWeight: 400, fontVariantNumeric: "tabular-nums" }}>
                  {group.files.length}
                </span>
              </div>
              {group.files.map((status) => (
                <ChangeRow key={status.filePath} status={status} cwd={cwd} onOpenFile={onOpenFile} t={t} />
              ))}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
