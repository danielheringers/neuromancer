"use client"

import { Check, FileCode2, ShieldAlert, ShieldCheck, X } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { DiffViewer } from "@/components/alicia/diff-viewer"
import { type FileChange } from "@/lib/alicia-types"
import {
  parseAgentDiffMarkdownSegments,
  parseDiffSystemMessage,
  parseUnifiedDiffFiles,
  type ApprovalRequestState,
  type DiffFileView,
  type Message,
} from "@/lib/alicia-runtime-helpers"

type FileDecision = "pending" | "approved" | "rejected"

interface ReviewModeProps {
  fileChanges: FileChange[]
  turnDiffFiles: DiffFileView[]
  pendingApprovals: ApprovalRequestState[]
  reviewMessages: Message[]
  isReviewThinking: boolean
  onRunReview: () => void
  onCommitApproved: (payload: {
    approvedPaths: string[]
    message: string
    comments: Record<string, string>
  }) => Promise<void>
  onClose: () => void
}

interface ReviewFileItem {
  name: string
  status: FileChange["status"]
  diff: DiffFileView | null
}

type ReviewFeedEntry =
  {
    id: string
    label: string
    files: DiffFileView[]
  }

function inferStatusFromDiff(diff: DiffFileView): FileChange["status"] {
  const additions = diff.lines.some((line) => line.type === "add")
  const removals = diff.lines.some((line) => line.type === "remove")
  if (additions && removals) return "modified"
  if (additions) return "added"
  if (removals) return "deleted"
  return "modified"
}

const statusClass: Record<FileChange["status"], string> = {
  modified: "text-terminal-blue",
  added: "text-terminal-green",
  deleted: "text-terminal-red",
  renamed: "text-terminal-cyan",
  copied: "text-terminal-cyan",
  untracked: "text-terminal-gold",
  unmerged: "text-terminal-red",
}

const statusLabel: Record<FileChange["status"], string> = {
  modified: "M",
  added: "A",
  deleted: "D",
  renamed: "R",
  copied: "C",
  untracked: "?",
  unmerged: "!",
}

export function ReviewMode({
  fileChanges,
  turnDiffFiles,
  pendingApprovals,
  reviewMessages,
  isReviewThinking,
  onRunReview,
  onCommitApproved,
  onClose,
}: ReviewModeProps) {
  const files = useMemo<ReviewFileItem[]>(() => {
    const byName = new Map<string, ReviewFileItem>()

    for (const item of fileChanges) {
      byName.set(item.name, {
        name: item.name,
        status: item.status,
        diff: turnDiffFiles.find((entry) => entry.filename === item.name) ?? null,
      })
    }

    for (const diff of turnDiffFiles) {
      if (byName.has(diff.filename)) {
        continue
      }

      byName.set(diff.filename, {
        name: diff.filename,
        status: inferStatusFromDiff(diff),
        diff,
      })
    }

    return Array.from(byName.values())
  }, [fileChanges, turnDiffFiles])

  const reviewFeedEntries = useMemo<ReviewFeedEntry[]>(() => {
    const entries: ReviewFeedEntry[] = []

    for (const message of reviewMessages) {
      const diffPayload = parseDiffSystemMessage(message.content)
      if (diffPayload) {
        const resolvedFiles =
          diffPayload.version === 1
            ? parseUnifiedDiffFiles(diffPayload.diff)
            : turnDiffFiles

        if (resolvedFiles.length > 0) {
          entries.push({
            id: `message-${message.id}-diff-system`,
            label: diffPayload.title ?? "Review diff update",
            files: resolvedFiles,
          })
        }
        continue
      }

      const parsedSegments = parseAgentDiffMarkdownSegments(message.content)
      const segmentFiles = parsedSegments.flatMap((segment) =>
        segment.kind === "diff" ? segment.files : [],
      )
      if (segmentFiles.length > 0) {
        entries.push({
          id: `message-${message.id}-diff-md`,
          label: message.type === "agent" ? "Alicia diff update" : "Review diff update",
          files: segmentFiles,
        })
        continue
      }

      const fallbackFiles = parseUnifiedDiffFiles(message.content)
      if (fallbackFiles.length > 0) {
        entries.push({
          id: `message-${message.id}-diff-inline`,
          label: "Review diff update",
          files: fallbackFiles,
        })
        continue
      }
    }

    return entries
  }, [reviewMessages, turnDiffFiles])

  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [decisions, setDecisions] = useState<Record<string, FileDecision>>({})
  const [comments, setComments] = useState<Record<string, string>>({})
  const [expandedComments, setExpandedComments] = useState<Record<string, boolean>>({})
  const [commitMessage, setCommitMessage] = useState("chore(review): commit approved files")
  const [isCommitting, setIsCommitting] = useState(false)
  const [hasPendingFeedItems, setHasPendingFeedItems] = useState(0)
  const [feedAtBottom, setFeedAtBottom] = useState(true)

  const feedRef = useRef<HTMLDivElement | null>(null)
  const previousFeedEntryCountRef = useRef(0)

  const isFeedNearBottom = useCallback((container: HTMLDivElement) => {
    const thresholdPx = 72
    const remaining = container.scrollHeight - container.scrollTop - container.clientHeight
    return remaining <= thresholdPx
  }, [])

  const scrollFeedToBottom = useCallback(() => {
    const container = feedRef.current
    if (!container) {
      return
    }
    container.scrollTop = container.scrollHeight
    setFeedAtBottom(true)
    setHasPendingFeedItems(0)
  }, [])

  useEffect(() => {
    const container = feedRef.current
    if (!container) {
      return
    }

    const onScroll = () => {
      const atBottom = isFeedNearBottom(container)
      setFeedAtBottom(atBottom)
      if (atBottom) {
        setHasPendingFeedItems(0)
      }
    }

    onScroll()
    container.addEventListener("scroll", onScroll, { passive: true })
    return () => {
      container.removeEventListener("scroll", onScroll)
    }
  }, [isFeedNearBottom])

  useEffect(() => {
    const nextCount = reviewFeedEntries.length + (isReviewThinking ? 1 : 0)
    const delta = Math.max(0, nextCount - previousFeedEntryCountRef.current)
    previousFeedEntryCountRef.current = nextCount

    if (delta === 0) {
      return
    }

    const container = feedRef.current
    if (!container) {
      return
    }

    if (feedAtBottom || isFeedNearBottom(container)) {
      window.requestAnimationFrame(() => {
        scrollFeedToBottom()
      })
      return
    }

    setHasPendingFeedItems((previous) => previous + delta)
  }, [feedAtBottom, isFeedNearBottom, isReviewThinking, reviewFeedEntries, scrollFeedToBottom])

  useEffect(() => {
    setDecisions((previous) => {
      const next: Record<string, FileDecision> = {}
      for (const file of files) {
        next[file.name] = previous[file.name] ?? "pending"
      }
      return next
    })

    setComments((previous) => {
      const next: Record<string, string> = {}
      for (const file of files) {
        next[file.name] = previous[file.name] ?? ""
      }
      return next
    })

    setExpandedComments((previous) => {
      const next: Record<string, boolean> = {}
      for (const file of files) {
        next[file.name] = previous[file.name] ?? false
      }
      return next
    })

    setSelectedPath((previous) => {
      if (previous && files.some((file) => file.name === previous)) {
        return previous
      }
      return files[0]?.name ?? null
    })
  }, [files])

  const selectedFile = useMemo(
    () => files.find((file) => file.name === selectedPath) ?? null,
    [files, selectedPath],
  )
  const selectedFileHasConflict = selectedFile?.status === "unmerged"

  const approvedPaths = useMemo(
    () => files.filter((file) => decisions[file.name] === "approved").map((file) => file.name),
    [decisions, files],
  )

  const canCommit = approvedPaths.length > 0 && commitMessage.trim().length > 0 && !isCommitting

  const selectedDiffStats = useMemo(() => {
    if (!selectedFile?.diff) {
      return { additions: 0, removals: 0 }
    }

    const additions = selectedFile.diff.lines.filter((line) => line.type === "add").length
    const removals = selectedFile.diff.lines.filter((line) => line.type === "remove").length
    return { additions, removals }
  }, [selectedFile])

  const handleCommitApproved = async () => {
    if (!canCommit) {
      return
    }

    setIsCommitting(true)
    try {
      await onCommitApproved({
        approvedPaths,
        message: commitMessage.trim(),
        comments,
      })
    } finally {
      setIsCommitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-background">
      <div className="h-full w-full bg-panel-bg overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-panel-border">
          <div className="flex items-center gap-2">
            <FileCode2 className="w-4 h-4 text-terminal-blue" />
            <span className="text-sm font-semibold text-terminal-fg">Review Mode</span>
            <span className="text-[10px] text-muted-foreground bg-background/60 px-1.5 py-0.5 rounded">
              {files.length} file(s)
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onRunReview}
              className="px-2 py-1 rounded text-xs bg-terminal-blue/15 text-terminal-blue hover:bg-terminal-blue/25"
            >
              Run /review
            </button>
            <button
              onClick={onClose}
              className="p-1 rounded hover:bg-[#b9bcc01c] text-muted-foreground"
              aria-label="Close review mode"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {files.length === 0 ? (
          <div className="flex-1 p-6 flex flex-col items-center justify-center gap-3 text-center">
            <FileCode2 className="w-8 h-8 text-muted-foreground/60" />
            <p className="text-sm text-terminal-fg">No file changes available for review.</p>
            <p className="text-xs text-muted-foreground">
              Execute a turn with file updates or run <code>/review</code> again.
            </p>
          </div>
        ) : (
          <div className="flex-1 min-h-0 grid grid-cols-[minmax(240px,320px)_1fr]">
            <div className="border-r border-panel-border min-h-0 overflow-y-auto p-2">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground px-2 py-1">
                Files
              </div>
              {files.map((file) => {
                const decision = decisions[file.name] ?? "pending"
                const isSelected = selectedPath === file.name
                return (
                  <button
                    key={file.name}
                    onClick={() => setSelectedPath(file.name)}
                    className={`w-full text-left rounded px-2 py-2 mb-1 border transition-colors ${
                      isSelected
                        ? "bg-sidebar-accent border-sidebar-accent"
                        : "border-transparent hover:bg-[#b9bcc01c]"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-bold w-3 ${statusClass[file.status]}`}>
                        {statusLabel[file.status]}
                      </span>
                      <span className="text-xs text-terminal-fg truncate">{file.name}</span>
                    </div>
                    <div className="mt-1 text-[10px] text-muted-foreground">
                      {decision === "approved" ? "Approved" : decision === "rejected" ? "Rejected" : "Pending"}
                    </div>
                  </button>
                )
              })}
            </div>

            <div className="min-h-0 flex flex-col">
              <div className="min-h-[240px] max-h-[46%] border-b border-panel-border flex flex-col">
                <div className="px-3 py-2 text-[11px] uppercase tracking-wider text-muted-foreground">
                  Review Feed
                </div>
                <div className="relative flex-1 min-h-0">
                  <div ref={feedRef} className="h-full overflow-y-auto border-t border-panel-border/60 bg-background/20 px-3 py-2">
                    {reviewFeedEntries.length === 0 && !isReviewThinking ? (
                      <div className="py-3 text-xs text-muted-foreground">
                        No review updates yet. Run <code>/review</code> to start.
                      </div>
                    ) : (
                      reviewFeedEntries.map((entry) => (
                        <div key={entry.id} className="mb-3">
                          <div className="text-[11px] text-muted-foreground mb-1">{entry.label}</div>
                          {entry.files.map((file, index) => (
                            <DiffViewer
                              key={`${entry.id}-${file.filename}-${index}`}
                              filename={file.filename}
                              lines={file.lines}
                              className="my-1"
                            />
                          ))}
                        </div>
                      ))
                    )}
                    {isReviewThinking && (
                      <div className="rounded border border-panel-border/70 bg-background/50 px-2 py-1.5 text-[11px] text-muted-foreground">
                        Alicia is reviewing changes...
                      </div>
                    )}
                  </div>
                  {hasPendingFeedItems > 0 && !feedAtBottom && (
                    <div className="pointer-events-none absolute bottom-3 right-3">
                      <button
                        onClick={scrollFeedToBottom}
                        className="pointer-events-auto rounded border border-terminal-blue/30 bg-terminal-blue/15 px-2 py-1 text-[11px] text-terminal-blue hover:bg-terminal-blue/25"
                      >
                        {hasPendingFeedItems} new update{hasPendingFeedItems > 1 ? "s" : ""}
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {selectedFile ? (
                <div className="flex-1 min-h-0 flex flex-col">
                  <div className="p-3 border-b border-panel-border flex items-center gap-2">
                    <span className={`text-xs font-bold ${statusClass[selectedFile.status]}`}>
                      {statusLabel[selectedFile.status]}
                    </span>
                    <span className="text-sm text-terminal-fg truncate">{selectedFile.name}</span>
                    <span className="ml-auto text-[10px] text-terminal-green bg-terminal-green/10 px-1.5 py-0.5 rounded">
                      +{selectedDiffStats.additions}
                    </span>
                    <span className="text-[10px] text-terminal-red bg-terminal-red/10 px-1.5 py-0.5 rounded">
                      -{selectedDiffStats.removals}
                    </span>
                  </div>

                  <div className="p-3 border-b border-panel-border flex flex-wrap items-center gap-2">
                    <button
                      onClick={() =>
                        setDecisions((previous) => ({ ...previous, [selectedFile.name]: "approved" }))
                      }
                      disabled={selectedFileHasConflict}
                      className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${
                        decisions[selectedFile.name] === "approved"
                          ? "bg-terminal-green/20 text-terminal-green"
                          : "bg-background/50 text-muted-foreground hover:text-terminal-green"
                      } disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                      <ShieldCheck className="w-3.5 h-3.5" />
                      Approve
                    </button>
                    <button
                      onClick={() =>
                        setDecisions((previous) => ({ ...previous, [selectedFile.name]: "rejected" }))
                      }
                      className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${
                        decisions[selectedFile.name] === "rejected"
                          ? "bg-terminal-red/20 text-terminal-red"
                          : "bg-background/50 text-muted-foreground hover:text-terminal-red"
                      }`}
                    >
                      <ShieldAlert className="w-3.5 h-3.5" />
                      Reject
                    </button>
                    <button
                      onClick={() =>
                        setDecisions((previous) => ({ ...previous, [selectedFile.name]: "pending" }))
                      }
                      className="px-2 py-1 rounded text-xs bg-background/50 text-muted-foreground hover:text-terminal-fg"
                    >
                      Reset
                    </button>
                    {selectedFileHasConflict && (
                      <span className="text-[11px] text-terminal-red">
                        Resolve git conflicts before approval/commit.
                      </span>
                    )}
                  </div>

                  <div className="px-3 py-2 border-b border-panel-border">
                    <button
                      onClick={() =>
                        setExpandedComments((previous) => ({
                          ...previous,
                          [selectedFile.name]: !previous[selectedFile.name],
                        }))
                      }
                      className="text-[11px] uppercase tracking-wider text-muted-foreground hover:text-terminal-fg"
                    >
                      {expandedComments[selectedFile.name] ? "Hide comments" : "Show comments"}
                    </button>
                    {expandedComments[selectedFile.name] ? (
                      <textarea
                        value={comments[selectedFile.name] ?? ""}
                        onChange={(event) =>
                          setComments((previous) => ({
                            ...previous,
                            [selectedFile.name]: event.target.value,
                          }))
                        }
                        placeholder="Add review notes for this file..."
                        className="mt-2 w-full min-h-[72px] rounded border border-panel-border bg-background/60 px-2 py-1.5 text-xs text-terminal-fg outline-none focus:border-terminal-blue/40"
                      />
                    ) : (
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        {(comments[selectedFile.name] ?? "").trim().length > 0
                          ? "Comment saved"
                          : "No comments"}
                      </div>
                    )}
                  </div>

                  <div className="flex-1 min-h-0 overflow-auto px-3 pb-3">
                    {selectedFile.diff && selectedFile.diff.lines.length > 0 ? (
                      <DiffViewer
                        filename={selectedFile.name}
                        lines={selectedFile.diff.lines}
                        className="my-3"
                      />
                    ) : (
                      <div className="py-3 text-xs text-muted-foreground">
                        No parsed diff available for this file.
                      </div>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        )}

        <div className="border-t border-panel-border p-3 flex flex-col gap-2">
          {pendingApprovals.length > 0 && (
            <div className="text-xs text-muted-foreground bg-background/40 border border-panel-border rounded px-2 py-1.5">
              Pending approvals: {pendingApprovals.length}
            </div>
          )}

          <div className="flex items-center gap-2">
            <input
              value={commitMessage}
              onChange={(event) => setCommitMessage(event.target.value)}
              placeholder="Commit message"
              className="flex-1 rounded border border-panel-border bg-background/60 px-2 py-1.5 text-xs text-terminal-fg outline-none focus:border-terminal-blue/40"
            />
            <button
              onClick={handleCommitApproved}
              disabled={!canCommit}
              className="flex items-center gap-1 rounded px-3 py-1.5 text-xs bg-terminal-green/15 text-terminal-green disabled:opacity-50 disabled:cursor-not-allowed hover:bg-terminal-green/25"
            >
              <Check className="w-3.5 h-3.5" />
              Commit approved ({approvedPaths.length})
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
