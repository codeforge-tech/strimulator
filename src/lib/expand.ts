import type { StrimulatorDB } from "../db";

// Resolver: given an ID and DB, return the expanded object
type Resolver = (id: string, db: StrimulatorDB) => any;

export interface ExpandConfig {
  [field: string]: {
    resolve: Resolver;
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
    if (!(field in config)) continue;
    const id = result[field];
    if (!id || typeof id !== "string") continue;

    try {
      result[field] = await config[field].resolve(id, db);
    } catch {
      // If expansion fails (e.g., deleted resource), leave as ID
    }
  }

  return result;
}
