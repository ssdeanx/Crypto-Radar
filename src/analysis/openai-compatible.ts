import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText, isStepCount } from 'ai';
import type { ModelMessage, ToolSet, ToolChoice } from 'ai';

export interface GenerateChatOptions<TOOLS extends ToolSet = Record<string, never>> {
    temperature?: number;
    topP?: number;
    topK?: number;
    maxOutputTokens?: number;
    presencePenalty?: number;
    frequencyPenalty?: number;
    stopSequences?: string[];
    seed?: number;
    maxRetries?: number;
    abortSignal?: AbortSignal;
    timeout?: number;
    headers?: Record<string, string | undefined>;
    reasoning?: 'provider-default' | 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
    // Function calling / Tools
    tools?: TOOLS;
    toolChoice?: ToolChoice<TOOLS>;
    // Structured output format
    responseFormat?: { type: 'json'; schema?: unknown; name?: string; description?: string } | { type: 'text' };
    // OpenAI-compatible specific provider options
    user?: string;
    reasoningEffort?: string;
    textVerbosity?: string;
    strictJsonSchema?: boolean;
    providerOptions?: Record<string, Record<string, string | boolean | number | null | undefined>>;
}

/**
 * Generates a text response for OpenCode.
 * @param messages - Array of conversation messages (role: 'user' | 'assistant' | 'system')
 * @param options - Optional generation settings (e.g., reasoning level, temperature)
 * @returns A Promise resolving to the generated string, conforming to the migration plan.
 */
export async function generateChat<TOOLS extends ToolSet = Record<string, never>>(
    messages: ModelMessage[],
    options?: GenerateChatOptions<TOOLS>
): Promise<string> {
    const baseURL = process.env.RADAR__AI_BASE_URL;
    const apiKey = process.env.RADAR__AI_API_KEY;
    const modelId = process.env.RADAR__AI_MODEL || process.env.RADAR__AI_MODEL_ID;

    if (!baseURL) {
        throw new Error('Environment variable RADAR__AI_BASE_URL is required');
    }
    if (!apiKey) {
        throw new Error('Environment variable RADAR__AI_API_KEY is required');
    }
    if (!modelId) {
        throw new Error('Environment variable RADAR__AI_MODEL (or RADAR__AI_MODEL_ID) is required');
    }

    const provider = createOpenAICompatible({
        name: 'production-provider',
        baseURL,
        apiKey,
        includeUsage: true,
        supportsStructuredOutputs: true,
    });

    const model = provider.chatModel(modelId);

    const {
        user,
        reasoningEffort,
        textVerbosity,
        strictJsonSchema,
        providerOptions: userProviderOptions,
        ...coreOptions
    } = options || {};

    const providerOptions: Record<string, Record<string, string | boolean | number | null | undefined>> = {};
    if (user !== undefined || reasoningEffort !== undefined || textVerbosity !== undefined || strictJsonSchema !== undefined) {
        providerOptions.openaiCompatible = {
            ...(user !== undefined && { user }),
            ...(reasoningEffort !== undefined && { reasoningEffort }),
            ...(textVerbosity !== undefined && { textVerbosity }),
            ...(strictJsonSchema !== undefined && { strictJsonSchema }),
        };
    }

    const result = await generateText({
        model,
        messages,
        stopWhen: isStepCount(5),
        ...coreOptions,
        providerOptions: {
            ...userProviderOptions,
            ...providerOptions,
        },
    });

    return result.text;
}
