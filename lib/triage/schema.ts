// The AI triage result shape. The provider is asked for JSON matching TRIAGE_JSON_SCHEMA, and
// whatever comes back is re-validated with triageOutputSchema regardless of what it claims.
import { z } from "zod";
import { triageCategory, triageUrgency } from "@/lib/db/schema";

export const TRIAGE_CATEGORIES = triageCategory.enumValues;
export const TRIAGE_URGENCIES = triageUrgency.enumValues;
export const DRAFT_MAX_CHARS = 2000;

/** Zod schema for the model's JSON output. `article_id` existence is checked separately (needs the DB). */
export const triageOutputSchema = z.object({
  category: z.enum(TRIAGE_CATEGORIES),
  urgency: z.enum(TRIAGE_URGENCIES),
  draft: z.string().trim().min(1, "draft is empty").max(DRAFT_MAX_CHARS, "draft is too long"),
  article_id: z.string().trim().min(1).nullable(),
});

export type TriageOutput = z.infer<typeof triageOutputSchema>;

/** JSON schema sent to Gemini as `responseJsonSchema` (mirrors triageOutputSchema). */
export const TRIAGE_JSON_SCHEMA = {
  type: "object",
  properties: {
    category: { type: "string", enum: [...TRIAGE_CATEGORIES] },
    urgency: { type: "string", enum: [...TRIAGE_URGENCIES] },
    draft: { type: "string", description: "Reply to the customer, plain text", maxLength: DRAFT_MAX_CHARS },
    article_id: {
      type: ["string", "null"],
      description: "id of the help article the draft is based on, or null if none applies",
    },
  },
  required: ["category", "urgency", "draft", "article_id"],
  additionalProperties: false,
} as const;
