export interface UsageStats {
  total: number
  input: number
  output: number
}

function asInt(value: string): number | null {
  const normalized = value.replace(/,/g, "").trim()
  if (!/^\d+$/.test(normalized)) {
    return null
  }
  const parsed = Number.parseInt(normalized, 10)
  return Number.isFinite(parsed) ? parsed : null
}

export function parseUsageSystemMessage(content: string): UsageStats | null {
  if (typeof content !== "string" || !content.startsWith("[usage]")) {
    return null
  }

  const totalMatch = content.match(/\btotal\s*=\s*([\d,]+)/i)
  const inputMatch = content.match(/\binput\s*=\s*([\d,]+)/i)
  const outputMatch = content.match(/\boutput\s*=\s*([\d,]+)/i)

  const total = totalMatch ? asInt(totalMatch[1]) : null
  const input = inputMatch ? asInt(inputMatch[1]) : null
  const output = outputMatch ? asInt(outputMatch[1]) : null

  if (total == null || input == null || output == null) {
    return null
  }

  return { total, input, output }
}

function cleanReasoningLine(value: string): string {
  return value
    .replace(/^\*+/, "")
    .replace(/\*+$/, "")
    .replace(/`/g, "")
    .trim()
}

export function parseReasoningSystemMessage(content: string): string | null {
  if (typeof content !== "string" || !content.startsWith("[reasoning]")) {
    return null
  }

  const afterTag = content.replace(/^\[reasoning\]\s*/i, "")
  const firstLine = afterTag
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0)

  if (!firstLine) {
    return "reasoning"
  }

  const cleaned = cleanReasoningLine(firstLine)
  return cleaned || "reasoning"
}
