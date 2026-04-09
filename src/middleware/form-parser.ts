/**
 * Parse Stripe's application/x-www-form-urlencoded body format.
 *
 * Supports:
 *   - Flat:          email=foo@bar.com        → { email: "foo@bar.com" }
 *   - Nested:        metadata[key]=value      → { metadata: { key: "value" } }
 *   - Array indexed: items[0][price]=price_x  → { items: [{ price: "price_x" }] }
 *   - Array push:    expand[]=customer        → { expand: ["customer"] }
 *   - Empty body:    ""                       → {}
 */
export function parseStripeBody(body: string): Record<string, any> {
  if (!body || body.trim() === "") {
    return {};
  }

  const result: Record<string, any> = {};

  for (const pair of body.split("&")) {
    if (!pair) continue;

    const eqIdx = pair.indexOf("=");
    if (eqIdx === -1) continue;

    const rawKey = pair.slice(0, eqIdx);
    const rawValue = pair.slice(eqIdx + 1);

    const key = decodeURIComponent(rawKey.replace(/\+/g, " "));
    const value = decodeURIComponent(rawValue.replace(/\+/g, " "));

    setNestedValue(result, key, value);
  }

  return result;
}

/**
 * Parse a key like "items[0][price]" or "metadata[key]" or "expand[]"
 * into an array of path segments: ["items", "0", "price"], ["metadata", "key"], ["expand", ""]
 */
function parseKeySegments(key: string): string[] {
  // Split on bracket notation
  const bracketIdx = key.indexOf("[");
  if (bracketIdx === -1) {
    return [key];
  }

  const first = key.slice(0, bracketIdx);
  const rest = key.slice(bracketIdx);

  // Extract bracket segments: [x][y][z] → ["x", "y", "z"]
  const bracketParts: string[] = [];
  const bracketRegex = /\[([^\]]*)\]/g;
  let m: RegExpExecArray | null;
  while ((m = bracketRegex.exec(rest)) !== null) {
    bracketParts.push(m[1]);
  }

  return [first, ...bracketParts];
}

function setNestedValue(obj: Record<string, any>, key: string, value: string): void {
  const segments = parseKeySegments(key);
  setValueAtPath(obj, segments, value);
}

function setValueAtPath(target: Record<string, any> | any[], segments: string[], value: string): void {
  if (segments.length === 0) return;

  const [head, ...tail] = segments;

  if (tail.length === 0) {
    // Leaf node
    if (Array.isArray(target)) {
      if (head === "") {
        // expand[] — push
        (target as any[]).push(value);
      } else {
        const idx = parseInt(head, 10);
        (target as any[])[idx] = value;
      }
    } else {
      (target as Record<string, any>)[head] = value;
    }
    return;
  }

  // Determine what the next segment implies
  const nextSegment = tail[0];
  const nextIsArray = nextSegment === "" || /^\d+$/.test(nextSegment);

  if (Array.isArray(target)) {
    const idx = head === "" ? (target as any[]).length : parseInt(head, 10);
    if ((target as any[])[idx] === undefined) {
      (target as any[])[idx] = nextIsArray ? [] : {};
    }
    setValueAtPath((target as any[])[idx], tail, value);
  } else {
    if ((target as Record<string, any>)[head] === undefined) {
      (target as Record<string, any>)[head] = nextIsArray ? [] : {};
    }
    setValueAtPath((target as Record<string, any>)[head], tail, value);
  }
}
