/**
 * Cursor Cloud Agents API Config
 *
 * Purpose:
 * - Load Cursor Cloud Agents API configurations from a local JSON file.
 *
 * Notes:
 * - This is a legacy function for server-side configs from JSON file.
 * - Client-side apps should use localStorage-based API configs instead.
 * - The real API keys should be stored in `data/cursor-cloud-apis.json` (local dev),
 *   which is ignored by git. An example file is provided as
 *   `data/cursor-cloud-apis.example.json`.
 */
import fs from 'node:fs';
import path from 'node:path';

import { z } from 'zod';

const cursorApiConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  apiKey: z.string().min(10)
});

const cursorApiConfigListSchema = z.array(cursorApiConfigSchema);

export type CursorApiConfig = z.infer<typeof cursorApiConfigSchema>;

function getConfigFilePath(): string {
  return path.join(process.cwd(), 'data', 'cursor-cloud-apis.json');
}

/**
 * Load Cursor Cloud API configurations from local JSON file.
 *
 * Note: This is a legacy function. Client-side apps should use localStorage-based
 * API configs from api-config-manager.service.ts instead.
 *
 * This function is intended for server-side usage only (legacy support).
 */
export function loadCursorApiConfigs(): CursorApiConfig[] {
  const filePath = getConfigFilePath();

  if (!fs.existsSync(filePath)) {
    return [];
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw);
  const result = cursorApiConfigListSchema.safeParse(parsed);

  if (!result.success) {
    throw new Error(`Invalid cursor-cloud-apis.json: ${result.error.message}`);
  }

  return result.data;
}

/**
 * Get a single Cursor API config by id, or the first one if id is undefined.
 */
export function getCursorApiConfigById(id?: string | null): CursorApiConfig | null {
  const configs = loadCursorApiConfigs();
  if (!configs.length) return null;

  if (!id) return configs[0] ?? null;

  return configs.find((c) => c.id === id) ?? null;
}
