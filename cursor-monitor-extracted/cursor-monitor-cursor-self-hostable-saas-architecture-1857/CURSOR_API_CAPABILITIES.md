# Cursor Cloud Agents API - Capabilities Analysis

## Current Implementation

### Endpoints Used:
1. **GET /v0/agents** - List all agents
   - Parameters: `limit`, `cursor` (pagination)
   - Returns: `{ agents: CursorAgent[], cursor?: string }`

2. **GET /v0/agents/{id}** - Get single agent details
   - Returns: `CursorAgent` with full details

3. **GET /v0/agents/{id}/conversation** - Get agent conversation
   - Returns: `{ messages: CursorConversationMessage[] }`

4. **POST /v0/agents** - Launch new agent
   - Payload: `LaunchAgentPayload`
   - Supports: `prompt.text`, `repository`, `ref`, `model`, `autoCreatePr`, `webhook`

5. **POST /v0/agents/{id}/followup** - Add follow-up message
   - Payload: `{ prompt: { text: string } }`

6. **POST /v0/agents/{id}/stop** - Stop running agent

7. **DELETE /v0/agents/{id}** - Delete agent

8. **GET /v0/me** - Get user info
   - Returns: `{ apiKeyName, userEmail, createdAt }`

9. **GET /v0/models** - List available models
   - Returns: `{ models: string[] }`

10. **GET /v0/repositories** - List available repositories
    - Returns: `{ repositories: RepositorySummary[] }`

## Webhook Capabilities

### Supported Events:
- **statusChange**: Triggered when agent status changes to FINISHED, ERROR, or EXPIRED
  - Payload includes: `id`, `status`, `source`, `target`, `summary`

### Webhook Configuration:
- Can be set per-agent in `LaunchAgentPayload.webhook`
- Requires: `url` and `secret`
- Signature verification: HMAC-SHA256

### Limitations:
- Currently only supports `statusChange` events
- Does NOT support real-time message events (must use polling)
- Webhook URL must be publicly accessible

## Potential Enhancements

### 1. Real-time Updates
- **Current**: Polling every 2-3 seconds
- **Potential**: Use webhooks for status changes, polling for messages
- **Note**: Cursor API doesn't support message webhooks yet

### 2. Agent Metadata
- Agent objects support `[key: string]: unknown` - can store custom metadata
- Could track: branch info, PR links, task progress, etc.

### 3. Image Support
- `LaunchAgentPayload.prompt` has comment: "Images are omitted for now; can be added later"
- Future: Support image prompts for visual tasks

### 4. Streaming Responses
- Current API doesn't support streaming
- Would require polling for incremental message updates

### 5. Batch Operations
- No batch endpoints found
- Could implement client-side batching for multiple agents

### 6. Agent Filtering
- List endpoint supports `cursor` for pagination
- Could add filtering by status, repository, date range

### 7. Repository Management
- Can list repositories
- Could add: create repo, check access, validate repo URL

### 8. Model Selection
- Can list available models dynamically
- Should use API models instead of hardcoded list

## Recommendations

1. ✅ **Use dynamic model list** - Fetch from `/v0/models` instead of hardcoding
2. ✅ **Improve polling** - Better change detection, poll finished agents for final messages
3. ⚠️ **Webhook for status** - Already implemented, use for status updates
4. ⚠️ **Polling for messages** - Current best approach until Cursor adds message webhooks
5. 🔄 **Agent metadata** - Store branch, PR info in agent object if supported
6. 🔄 **Error handling** - Better error messages based on API response

## API Rate Limits
- Not documented in current implementation
- Should implement rate limiting and retry logic
- Consider exponential backoff for failed requests

