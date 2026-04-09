import type { StrimulatorDB } from "../db";

// Resolver: given an ID and DB, return the expanded object
type Resolver = (id: string, db: StrimulatorDB) => any;

export interface ExpandConfig {
  [field: string]: {
    resolve: Resolver;
    // Nested expand config for the resolved object
    nested?: ExpandConfig;
  };
}

export async function applyExpand(
  obj: any,
  expandFields: string[],
  config: ExpandConfig,
  db: StrimulatorDB,
): Promise<any> {
  if (!expandFields.length) return obj;

  const result = { ...obj };

  for (const field of expandFields) {
    const dotIndex = field.indexOf(".");

    if (dotIndex === -1) {
      // Simple (non-nested) expansion — existing behavior
      if (!(field in config)) continue;
      const id = result[field];
      if (!id || typeof id !== "string") continue;

      try {
        result[field] = await config[field].resolve(id, db);
      } catch {
        // If expansion fails (e.g., deleted resource), leave as ID
      }
    } else {
      // Nested expansion: e.g. "latest_invoice.payment_intent"
      const first = field.slice(0, dotIndex);
      const rest = field.slice(dotIndex + 1);

      if (!(first in config)) continue;

      const topId = result[first];
      if (!topId || typeof topId !== "string") continue;

      let resolved: any;
      try {
        resolved = await config[first].resolve(topId, db);
      } catch {
        // If top-level expansion fails, leave as ID
        continue;
      }

      // Now recursively expand the nested field on the resolved object
      const nestedConfig = config[first].nested;
      if (nestedConfig) {
        resolved = await applyExpand(resolved, [rest], nestedConfig, db);
      }

      result[first] = resolved;
    }
  }

  return result;
}
