import ollama from 'ollama/browser'
import { OLLAMA_DEFAULT_CONTEXT_WINDOW } from '.'
import { type Model, ModelUsage, cenv } from '../..'
import { createModel } from '../../models/model'
import { ModelTag } from '../../models/tags'
import { CHAT_OUTPUT_TOKEN_BUDGET } from '../../token/constants'
/**
 * Fetches available Ollama models from the Ollama server.
 */
export async function fetchLocalOllamaModels(): Promise<Model[]> {
    if (cenv.CODY_OVERRIDE_DISABLE_OLLAMA) {
        // We currently never intend to fetch local Ollama models during tests, but it's easy to
        // accidentally invoke this and introduce test nondeterminism or local vs. remote
        // divergence.
        return []
    }

    try {
        const response = await ollama.list()
        const models =
            response.models?.map(m => {
                const model = createModel({
                    id: `ollama/${m.name}`,
                    usage: [ModelUsage.Chat, ModelUsage.Edit],
                    contextWindow: {
                        input: OLLAMA_DEFAULT_CONTEXT_WINDOW,
                        output: CHAT_OUTPUT_TOKEN_BUDGET,
                    },
                    tags: [ModelTag.Local, ModelTag.Ollama, ModelTag.Experimental],
                })
                return model
            }) || []

        return models
    } catch (error) {
        console.error('Error fetching Ollama models:', error)
        return []
    }
}
