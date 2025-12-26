/**
 * Reference Library Builder Script
 *
 * Purpose:
 * - Read documentation URLs from references/sources.json and fetch their HTML
 *   to extract page titles and h2/h3 headings into a local index.
 * - For known sources, enrich the index with a "basics" section that
 *   summarizes how to use the API or library.
 *
 * Usage:
 * - Run `npm run build:references` after updating references/sources.json.
 * - Consumes { "sources": [{ "name": string, "url": string }] } and produces
 *   references/library.json with a summarized structure.
 *
 * Notes:
 * - This is a lightweight helper for developers, not a general-purpose crawler.
 * - Avoid adding authenticated or sensitive URLs.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const sourcesPath = path.join(ROOT, 'references', 'sources.json');
const outputPath = path.join(ROOT, 'references', 'library.json');

async function readSources() {
  try {
    const raw = await fs.promises.readFile(sourcesPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.sources)) {
      throw new Error('Invalid sources.json: expected { "sources": [...] }');
    }
    return parsed.sources;
  } catch (error) {
    console.error('[build:references] Failed to read sources.json:', error.message);
    process.exitCode = 1;
    return [];
  }
}

function extractTitle(html) {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  if (!match) return null;
  return match[1].trim();
}

function extractHeadings(html) {
  const headings = [];
  const regex = /<(h2|h3)[^>]*>(.*?)<\/\1>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const text = match[2]
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (text.length > 0) {
      headings.push({ level: match[1].toLowerCase(), text });
    }
  }
  return headings;
}

function enrichWithBasics(entry) {
  if (!entry.url) return entry;

  // Special-case: Cursor Cloud Agents API "List Agents" docs
  if (entry.url.startsWith('https://cursor.com/docs/cloud-agent/api/endpoints#list-agents')) {
    return {
      ...entry,
      basics: {
        kind: 'cursor-cloud-agents-list',
        summary: 'List all Cursor Cloud Agents for the authenticated API key.',
        endpoint: {
          method: 'GET',
          path: '/v0/agents',
          description: 'Returns a paginated list of cloud agents associated with the API key.',
          auth: {
            type: 'basic',
            headerExample: 'Authorization: Basic <base64(YOUR_API_KEY:)>',
            curlExample: 'curl --request GET \\n  --url https://api.cursor.com/v0/agents \\\n  -u YOUR_API_KEY:'
          },
          queryParameters: [
            {
              name: 'limit',
              type: 'number',
              description: 'Maximum number of agents to return. Default: implementation-specific; respect server limits.'
            },
            {
              name: 'cursor',
              type: 'string',
              description: 'Pagination cursor returned from a previous List Agents response.'
            }
          ],
          responseShape: {
            successExample: {
              agents: '[{ id, name, status, ... }, ...]',
              cursor: 'string | null (next page token)'
            }
          }
        },
        usageNotes: [
          'Use Basic Auth where the API key is the username and the password is empty (i.e. "YOUR_API_KEY:").',
          'Always handle pagination via the returned cursor to avoid missing agents.',
          'Never log raw API keys; store them in environment variables and pass them via headers only.'
        ]
      }
    };
  }

  return entry;
}

async function buildReferenceEntry(source) {
  const { name, url } = source;
  if (!url) {
    return { name: name ?? 'Unnamed Source', url: null, error: 'Missing url' };
  }

  try {
    const response = await fetch(url);
    if (!response.ok) {
      return {
        name: name ?? url,
        url,
        error: `HTTP ${response.status}`
      };
    }

    const html = await response.text();
    const title = extractTitle(html) ?? name ?? url;
    const headings = extractHeadings(html);

    const baseEntry = {
      name: name ?? title,
      url,
      title,
      headings,
      fetchedAt: new Date().toISOString()
    };

    return enrichWithBasics(baseEntry);
  } catch (error) {
    return {
      name: name ?? url,
      url,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

async function main() {
  console.log('[build:references] Reading sources from', sourcesPath);
  const sources = await readSources();
  if (!sources.length) {
    console.log('[build:references] No sources defined. Edit references/sources.json to add docs URLs.');
    return;
  }

  const results = [];
  for (const source of sources) {
    console.log(`[build:references] Fetching: ${source.url}`);
    // eslint-disable-next-line no-await-in-loop
    const entry = await buildReferenceEntry(source);
    results.push(entry);
  }

  await fs.promises.writeFile(
    outputPath,
    JSON.stringify({ generatedAt: new Date().toISOString(), entries: results }, null, 2),
    'utf8'
  );
  console.log('[build:references] Wrote', outputPath);
}

main().catch((error) => {
  console.error('[build:references] Unhandled error:', error);
  process.exitCode = 1;
});
