# Cody Standalone Mode

This document describes the standalone mode configuration for Cody, which allows the extension to work completely offline without dependencies on Sourcegraph servers.

## Overview

Standalone mode is enabled by setting the environment variable `CODY_STANDALONE_MODE=true`. In this mode:

1. **Server health checks are disabled** - No `/healthz` pings to Sourcegraph servers
2. **Token validation API calls are stubbed** - No `/.api/` endpoint calls for authentication
3. **Telemetry is disabled** - No analytics or telemetry data sent to Sourcegraph servers
4. **Model syncing is disabled** - No server-side model configuration fetching
5. **GraphQL API calls return mock responses** - Avoid all server GraphQL queries
6. **REST API calls return mock responses** - Avoid all server REST API calls
7. **OpenTelemetry is disabled** - No tracing data sent to servers
8. **Remote rule fetching is disabled** - No rule configuration from servers

## Key Files Modified

### Health Monitoring
- `vscode/src/services/UpstreamHealthProvider.ts` - Stubbed health checks with mock latency values

### API Clients
- `vscode/src/completions/default-client.ts` - Disabled Sourcegraph completion API calls
- `lib/shared/src/sourcegraph-api/graphql/client.ts` - Added mock responses for GraphQL queries
- `lib/shared/src/models/sync.ts` - Disabled server-side model fetching

### Telemetry
- `vscode/src/services/telemetry-v2.ts` - Use MockServerTelemetryRecorderProvider in standalone mode
- `vscode/src/services/open-telemetry/OpenTelemetryService.node.ts` - Disabled OpenTelemetry service

### Rules and Configuration
- `vscode/src/rules/remote-rule-provider.ts` - Return empty rules instead of fetching from server

## Usage

To enable standalone mode, set the environment variable before starting VS Code:

```bash
export CODY_STANDALONE_MODE=true
code
```

Or in VS Code settings, you can configure the extension to run in standalone mode by setting the environment variable in your shell before launching VS Code.

## BYOK (Bring Your Own Key) Functionality

Standalone mode preserves all BYOK functionality:
- Local API key configuration for OpenAI, Anthropic, etc.
- Direct API calls to third-party LLM providers
- Local Ollama model support
- Custom model configurations

## What Still Works

In standalone mode, the following features continue to work:
- Code completion using configured API keys (OpenAI, Anthropic, etc.)
- Chat functionality with BYOK models
- Local file context and indexing
- Custom commands and prompts
- Local Ollama model support
- All VS Code integrations and UI features

## What Is Disabled

The following server-dependent features are disabled:
- Sourcegraph server authentication
- Server-side model configuration and syncing
- Remote rule fetching and enforcement
- Telemetry and analytics reporting
- Health monitoring of Sourcegraph servers
- Context from remote Sourcegraph repositories

## Environment Variable

Set `CODY_STANDALONE_MODE=true` to enable this mode. The extension will automatically detect this environment variable and configure itself accordingly.
