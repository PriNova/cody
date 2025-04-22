# Features Implemented

1. **LLM Provider Improvement (BYOK)**:
   - Added support for OpenRouter model configuration as a LLM provider.
   - Filters out last assistant messages in the chat stream for BYOK models (Groq).
   - Turn the first user message into a system prompt (Google)

2. **AI Visual Workflow Editor**:
   - https://youtu.be/-U3HLyGLIZ4

4. **Add clickable file names in chat messages (Smart Apply)**:

5. **Chat Improvements**:
   - Change chat history title.
   - Show token counter in message
   - Expose temperature setting with validation.
   - Add copy functionality to assistant messages.
   - Implement configurable temperature for chat completions.
   - Image modality for the Gemini Flash 2.0 models via own API key
   - Google Search integration for Google models with toggle functionality
   - Configuration to enable/disable automatic inclusion of a README file from the context
   - Consider context filtering via .gitignore.
   - Add support for loading custom system instructions from `.cody/configs/system.md`

6. **Chat History:**
   - Change chat history title.
   - Search across both chat titles and message content with support for multi-word search queries

7. **Use external repositories, directories and files for context**

8. **Agent Mode (BYOK only):** You can set the Agent Mode in the mode dropdown to use multi-turn completions and with MCP integration
   - Support for Agent Mode is only for BYOK models with the `RPM` key/value field in the `options` property of the dev models.
   This field determines the rounds per minute (RPM) for the specified model to prevent exceeding the rate limits.
   Read before you set this value what rate-limits apply to your plan.
   ```
   "options": {
                "temperature": 0.0,
                "googleSearch": true,
                "googleImage": true,
                "RPM": 15
            }
   ```

   - All default standard tools apply to this mode like in the Agentic Chat model. Ask with the following prompts what tools are available:
   "What tools are available? Please list them."
   - To integrate MCP servers into the Agent Mode use the following configuration in the settings.json file:
   ```
   "cody.mcpServers": {
        "Memory": {
            "transportType": "stdio",
            "command": "npx",
            "args": [
                "-y",
                "@modelcontextprotocol/server-memory"
            ],
            "env": {
                "MEMORY_FILE_PATH": "/home/prinova/CodeProjects/cody/.sourcegraph/memory/memory.json"
            }
        },
        "DuckDuckGo": {
            "transportType": "stdio",
            "command": "uvx",
            "args": [
                "duckduckgo-mcp-server"
            ]
        },
        "Context7": {
            "transportType": "stdio",
            "command": "npx",
            "args": [
                "-y",
                "@upstash/context7-mcp@latest"
            ]
        },
    },
    ```