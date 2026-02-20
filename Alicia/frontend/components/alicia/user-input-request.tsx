"use client"

import { useEffect, useMemo, useState } from "react"
import { Check, Circle, CircleDot } from "lucide-react"

import type { UserInputRequestState } from "@/lib/alicia-runtime-helpers"

interface UserInputRequestProps {
  request: UserInputRequestState
  onSubmit: (
    actionId: string,
    answers: Record<string, { answers: string[] }>,
  ) => Promise<void> | void
  onCancel: (actionId: string) => Promise<void> | void
}

function buildInitialSelections(
  request: UserInputRequestState,
): Record<string, string> {
  return Object.fromEntries(
    request.questions.map((question) => [question.id, question.options[0]?.label ?? ""]),
  )
}

export function UserInputRequest({
  request,
  onSubmit,
  onCancel,
}: UserInputRequestProps) {
  const [selectedByQuestionId, setSelectedByQuestionId] = useState<Record<string, string>>(
    () => buildInitialSelections(request),
  )
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    setSelectedByQuestionId(buildInitialSelections(request))
  }, [request])

  const canSubmit = useMemo(
    () =>
      request.questions.length > 0 &&
      request.questions.every((question) => {
        const selected = selectedByQuestionId[question.id]?.trim() ?? ""
        return selected.length > 0
      }),
    [request.questions, selectedByQuestionId],
  )

  const timeoutLabel = useMemo(() => {
    if (!request.timeoutMs || request.timeoutMs <= 0) {
      return null
    }

    const seconds = Math.floor(request.timeoutMs / 1000)
    if (seconds < 60) {
      return `${seconds}s`
    }

    const minutes = Math.floor(seconds / 60)
    const remainderSeconds = seconds % 60
    if (remainderSeconds === 0) {
      return `${minutes}m`
    }

    return `${minutes}m ${remainderSeconds}s`
  }, [request.timeoutMs])

  return (
    <section className="mx-5 my-2 ml-14 rounded-lg border border-terminal-cyan/35 bg-terminal-cyan/5 p-3">
      <header className="mb-2">
        <p className="text-xs font-semibold text-terminal-fg">Input Required</p>
        <p className="mt-1 text-xs text-terminal-fg/85">
          {request.questions.length} question{request.questions.length > 1 ? "s" : ""}
        </p>
        {timeoutLabel && (
          <p className="mt-1 text-xs text-muted-foreground">Timeout: {timeoutLabel}</p>
        )}
      </header>

      <div className="space-y-3">
        {request.questions.map((question) => {
          const selectedLabel = selectedByQuestionId[question.id] ?? ""
          return (
            <fieldset key={question.id} className="rounded border border-panel-border p-2">
              {question.header && (
                <legend className="px-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                  {question.header}
                </legend>
              )}
              <p className="text-xs text-terminal-fg">{question.question}</p>
              <div className="mt-2 space-y-1.5">
                {question.options.map((option, optionIndex) => {
                  const optionKey = `${question.id}-${optionIndex}`
                  const selected = option.label === selectedLabel
                  return (
                    <button
                      key={optionKey}
                      type="button"
                      onClick={() => {
                        setSelectedByQuestionId((previous) => ({
                          ...previous,
                          [question.id]: option.label,
                        }))
                      }}
                      className={`w-full rounded border px-2 py-1.5 text-left transition-colors ${
                        selected
                          ? "border-terminal-cyan/60 bg-terminal-cyan/12"
                          : "border-panel-border hover:bg-background/40"
                      }`}
                      aria-pressed={selected}
                    >
                      <span className="flex items-center gap-2 text-xs text-terminal-fg">
                        {selected ? (
                          <CircleDot className="h-3.5 w-3.5 text-terminal-cyan" />
                        ) : (
                          <Circle className="h-3.5 w-3.5 text-muted-foreground" />
                        )}
                        <span className="font-medium">{option.label}</span>
                      </span>
                      {option.description && (
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {option.description}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </fieldset>
          )
        })}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          disabled={!canSubmit || submitting}
          onClick={async () => {
            if (!canSubmit) {
              return
            }

            const answers = Object.fromEntries(
              request.questions.map((question) => {
                const selected = selectedByQuestionId[question.id] ?? ""
                return [question.id, { answers: selected ? [selected] : [] }]
              }),
            )

            setSubmitting(true)
            try {
              await onSubmit(request.actionId, answers)
            } finally {
              setSubmitting(false)
            }
          }}
          className="inline-flex items-center gap-1 rounded border border-terminal-green/25 bg-terminal-green/12 px-3 py-1.5 text-xs text-terminal-green disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Check className="h-3.5 w-3.5" />
          Submit
        </button>
        <button
          type="button"
          disabled={submitting}
          onClick={async () => {
            setSubmitting(true)
            try {
              await onCancel(request.actionId)
            } finally {
              setSubmitting(false)
            }
          }}
          className="rounded border border-panel-border px-3 py-1.5 text-xs text-muted-foreground hover:text-terminal-fg disabled:cursor-not-allowed disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </section>
  )
}
