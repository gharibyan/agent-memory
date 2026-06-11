import { createHash } from "node:crypto"
import type {
  CandidateMemoryPatch,
  CompilerProvider,
  MemoryPatch,
  MemoryRecordType,
  ValidationResult
} from "./types.js"

export function createDefaultCompiler(): CompilerProvider {
  return {
    id: "default-deterministic-compiler",
    async compile(input) {
      const patches: MemoryPatch[] = []

      for (const message of input.currentMessages) {
        if (message.role !== "user") continue

        for (const candidate of extractCandidates(message.content)) {
          patches.push({
            op: "create",
            ...candidate,
            confidence: 0.9,
            importance: candidate.type === "constraint" ? 0.9 : 0.75,
            sensitivity: "normal",
            evidence: [
              {
                eventId: input.inputEventId,
                quote: message.content,
                reason: "User explicitly stated a durable memory pattern."
              }
            ]
          })
        }
      }

      return {
        patches: patches.length > 0 ? patches : [{ op: "noop", reason: "No durable memory detected." }]
      }
    }
  }
}

export function canonicalKeyFor(type: MemoryRecordType, content: string): string {
  const normalized = content
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()

  return `${type}:${createHash("sha1").update(normalized).digest("hex").slice(0, 16)}`
}

export function validateMemoryPatch(patch: MemoryPatch): ValidationResult {
  if (patch.op === "noop") {
    return { accepted: false, reason: patch.reason }
  }

  if (patch.op !== "create") {
    return { accepted: false, reason: `Unsupported patch operation: ${patch.op}` }
  }

  if (!Array.isArray(patch.evidence) || patch.evidence.length === 0) {
    return { accepted: false, reason: "Memory patch missing evidence." }
  }

  if (patch.sensitivity === "secret") {
    return { accepted: false, reason: "Secret-like memory rejected by default policy." }
  }

  if ((patch.confidence ?? 0) < 0.75) {
    return { accepted: false, reason: "Memory confidence below threshold." }
  }

  if (!patch.content || patch.content.length < 4) {
    return { accepted: false, reason: "Memory content too short." }
  }

  return { accepted: true }
}

type ExtractedCandidate = Pick<CandidateMemoryPatch, "type" | "content">

function extractCandidates(content: string): ExtractedCandidate[] {
  const candidates: ExtractedCandidate[] = []
  const sentences = content
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)

  for (const sentence of sentences) {
    const remember = sentence.match(/remember that\s+(.+?)[.!?]?$/i)
    if (remember?.[1]) {
      candidates.push(classifyMemoryPhrase(remember[1]))
      continue
    }

    const prefer = sentence.match(/\bi prefer\s+(.+?)[.!?]?$/i)
    if (prefer?.[1]) {
      candidates.push({
        type: "preference",
        content: `User prefers ${cleanPhrase(prefer[1])}.`
      })
      continue
    }

    const doNot = sentence.match(/\bdo not\s+(.+?)[.!?]?$/i)
    if (doNot?.[1]) {
      candidates.push({
        type: "constraint",
        content: `Do not ${cleanPhrase(doNot[1])}.`
      })
      continue
    }

    const dont = sentence.match(/\bdon't\s+(.+?)[.!?]?$/i)
    if (dont?.[1]) {
      candidates.push({
        type: "constraint",
        content: `Do not ${cleanPhrase(dont[1])}.`
      })
      continue
    }

    const worksAt = sentence.match(/\bi work at\s+(.+?)[.!?]?$/i)
    if (worksAt?.[1]) {
      candidates.push({
        type: "fact",
        content: `User works at ${cleanPhrase(worksAt[1])}.`
      })
    }
  }

  return candidates
}

function classifyMemoryPhrase(phrase: string): ExtractedCandidate {
  const cleaned = cleanPhrase(phrase)

  if (/^i prefer\b/i.test(cleaned)) {
    return {
      type: "preference",
      content: `${cleaned.replace(/^i prefer\b/i, "User prefers")}.`
    }
  }

  if (/^(do not|don't)\b/i.test(cleaned)) {
    return {
      type: "constraint",
      content: `${cleaned.replace(/^don't\b/i, "Do not")}.`
    }
  }

  if (/^i work at\b/i.test(cleaned)) {
    return {
      type: "fact",
      content: `${cleaned.replace(/^i work at\b/i, "User works at")}.`
    }
  }

  return {
    type: "fact",
    content: `${cleaned[0]?.toUpperCase() ?? ""}${cleaned.slice(1)}.`
  }
}

function cleanPhrase(value: string): string {
  return value
    .trim()
    .replace(/[.!?]+$/g, "")
    .replace(/\s+/g, " ")
}

