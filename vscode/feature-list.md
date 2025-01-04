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

6. **Use external repositories, directories and files for context