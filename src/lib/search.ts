export interface SearchCondition {
  field: string;
  operator: "eq" | "like" | "gt" | "lt" | "gte" | "lte" | "neq";
  value: string;
  metadataKey?: string; // For metadata["key"] queries
}

export interface SearchResult<T> {
  object: "search_result";
  url: string;
  has_more: boolean;
  data: T[];
  total_count: number;
  next_page: null;
}

export function buildSearchResult<T>(items: T[], url: string, hasMore: boolean, totalCount: number): SearchResult<T> {
  return {
    object: "search_result",
    url,
    has_more: hasMore,
    data: items,
    total_count: totalCount,
    next_page: null,
  };
}

/**
 * Parse a Stripe-style search query string into an array of SearchCondition.
 *
 * Supported syntax:
 *   field:"value"             → eq
 *   field~"value"             → like (substring)
 *   -field:"value"            → neq
 *   metadata["key"]:"value"   → eq with metadataKey
 *   created>N                 → gt  (also <, >=, <=)
 *   cond1 AND cond2           → both conditions (AND is also implicit via space)
 */
export function parseSearchQuery(query: string): SearchCondition[] {
  const conditions: SearchCondition[] = [];

  // Strip leading/trailing whitespace
  const input = query.trim();
  if (!input) return conditions;

  // Tokenize: split on AND keyword or whitespace, but be careful not to split inside quoted values.
  // Strategy: iteratively match tokens from the front.
  let remaining = input;

  while (remaining.length > 0) {
    remaining = remaining.trimStart();
    if (!remaining) break;

    // Skip explicit AND keyword
    if (/^AND\b/i.test(remaining)) {
      remaining = remaining.replace(/^AND\b\s*/i, "");
      continue;
    }

    // Try to match a condition token
    const condition = parseNextCondition(remaining);
    if (!condition) {
      // Can't parse further — skip one character to avoid infinite loops
      remaining = remaining.slice(1);
      continue;
    }

    conditions.push(condition.condition);
    remaining = remaining.slice(condition.consumed).trimStart();
  }

  return conditions;
}

interface ParsedToken {
  condition: SearchCondition;
  consumed: number; // number of characters consumed from the start of the input
}

function parseNextCondition(input: string): ParsedToken | null {
  // 1. metadata["key"]:"value" or metadata["key"]~"value"
  const metaExact = /^metadata\["([^"]+)"\](:|~)"([^"]*)"/i;
  const metaMatch = input.match(metaExact);
  if (metaMatch) {
    const [fullMatch, key, opChar, value] = metaMatch;
    return {
      condition: {
        field: "metadata",
        operator: opChar === "~" ? "like" : "eq",
        value,
        metadataKey: key,
      },
      consumed: fullMatch.length,
    };
  }

  // 2. Negation: -field:"value" or -field~"value"
  const negationExact = /^-(\w+)(:|~)"([^"]*)"/;
  const negationMatch = input.match(negationExact);
  if (negationMatch) {
    const [fullMatch, field, opChar, value] = negationMatch;
    return {
      condition: {
        field,
        operator: opChar === "~" ? "like" : "neq",
        value,
      },
      consumed: fullMatch.length,
    };
  }

  // 3. Numeric comparison: field>N, field<N, field>=N, field<=N
  const numericComparison = /^(\w+)(>=|<=|>|<)(\d+)/;
  const numericMatch = input.match(numericComparison);
  if (numericMatch) {
    const [fullMatch, field, op, value] = numericMatch;
    const operator = opToEnum(op);
    if (operator) {
      return {
        condition: { field, operator, value },
        consumed: fullMatch.length,
      };
    }
  }

  // 4. field:"value" or field~"value"
  const fieldMatch = /^(\w+)(:|~)"([^"]*)"/;
  const fm = input.match(fieldMatch);
  if (fm) {
    const [fullMatch, field, opChar, value] = fm;
    return {
      condition: {
        field,
        operator: opChar === "~" ? "like" : "eq",
        value,
      },
      consumed: fullMatch.length,
    };
  }

  return null;
}

function opToEnum(op: string): SearchCondition["operator"] | null {
  switch (op) {
    case ">": return "gt";
    case "<": return "lt";
    case ">=": return "gte";
    case "<=": return "lte";
    default: return null;
  }
}

/**
 * Test whether a data object satisfies a single SearchCondition.
 */
export function matchesCondition(data: Record<string, unknown>, condition: SearchCondition): boolean {
  const { field, operator, value, metadataKey } = condition;

  // metadata["key"] queries
  if (field === "metadata" && metadataKey !== undefined) {
    const metadata = data.metadata as Record<string, string> | null | undefined;
    if (!metadata || typeof metadata !== "object") return false;
    const metaValue = metadata[metadataKey];
    if (metaValue === undefined || metaValue === null) return false;
    return compareValues(String(metaValue), operator, value);
  }

  // Regular field
  const rawFieldValue = data[field];

  if (rawFieldValue === undefined || rawFieldValue === null) {
    // neq against null/undefined: treat as "field doesn't have the value"
    return operator === "neq";
  }

  return compareValues(String(rawFieldValue), operator, value);
}

function compareValues(fieldStr: string, operator: SearchCondition["operator"], value: string): boolean {
  switch (operator) {
    case "eq":
      return fieldStr.toLowerCase() === value.toLowerCase();
    case "neq":
      return fieldStr.toLowerCase() !== value.toLowerCase();
    case "like":
      return fieldStr.toLowerCase().includes(value.toLowerCase());
    case "gt":
      return Number(fieldStr) > Number(value);
    case "lt":
      return Number(fieldStr) < Number(value);
    case "gte":
      return Number(fieldStr) >= Number(value);
    case "lte":
      return Number(fieldStr) <= Number(value);
    default:
      return false;
  }
}
