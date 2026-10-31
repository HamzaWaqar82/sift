import { isNull, type SQL } from "drizzle-orm";
import { triageResults } from "@/lib/db/schema";

/**
 * THE validity rule for stored triage results: a result is valid when it has no error
 * (the table's check constraint then guarantees category, urgency and draft are set).
 * Every "current triage" query uses this predicate.
 */
export function isValidTriage(): SQL {
  return isNull(triageResults.error);
}
