import { fileSearchTool, Agent, RunContext, AgentInputItem, Runner, withTrace } from "@openai/agents";
import { OpenAI } from "openai";
import { runGuardrails } from "@openai/guardrails";
import { z } from "zod";


// Tool definitions
const fileSearch = fileSearchTool([
  "vs_691a5156555c8191ab2a810b9a3148dc"
])

let client: OpenAI | null = null;
function getClient() {
  if (!client) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY environment variable is not set");
    }
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return client;
}

// Guardrails definitions
const guardrailConfig = {
  guardrails: [
    { name: "Jailbreak", config: { model: "gpt-4.1-mini", confidence_threshold: 0.7 } },
    { name: "Moderation", config: { categories: ["sexual/minors", "hate/threatening", "harassment/threatening", "self-harm/instructions", "violence/graphic", "illicit/violent"] } },
    { name: "Custom Prompt Check", config: { system_prompt_details: "You are a supposed to answer questions about previous debates in Region Östergötland. Raise the guardrail if questions aren’t focused on what has been said in a particular debate, citations from specific speakers or parties, arguments raised by specific speakers or parties, on sources for citations or general assumptions. Follow-up questions and answers from an earlier response should not raise the guardrail.", model: "gpt-4.1-mini", confidence_threshold: 0.7 } }
  ]
};
function getContext() {
  return { guardrailLlm: getClient() };
}

function guardrailsHasTripwire(results: any[]): boolean {
    return (results ?? []).some((r) => r?.tripwireTriggered === true);
}

function getGuardrailSafeText(results: any[], fallbackText: string): string {
    for (const r of results ?? []) {
        if (r?.info && ("checked_text" in r.info)) {
            return r.info.checked_text ?? fallbackText;
        }
    }
    const pii = (results ?? []).find((r) => r?.info && "anonymized_text" in r.info);
    return pii?.info?.anonymized_text ?? fallbackText;
}

async function scrubConversationHistory(history: any[], piiOnly: any): Promise<void> {
    for (const msg of history ?? []) {
        const content = Array.isArray(msg?.content) ? msg.content : [];
        for (const part of content) {
            if (part && typeof part === "object" && part.type === "input_text" && typeof part.text === "string") {
                const res = await runGuardrails(part.text, piiOnly, getContext(), true);
                part.text = getGuardrailSafeText(res, part.text);
            }
        }
    }
}

async function scrubWorkflowInput(workflow: any, inputKey: string, piiOnly: any): Promise<void> {
    if (!workflow || typeof workflow !== "object") return;
    const value = workflow?.[inputKey];
    if (typeof value !== "string") return;
    const res = await runGuardrails(value, piiOnly, getContext(), true);
    workflow[inputKey] = getGuardrailSafeText(res, value);
}

async function runAndApplyGuardrails(inputText: string, config: any, history: any[], workflow: any) {
    const guardrails = Array.isArray(config?.guardrails) ? config.guardrails : [];
    const results = await runGuardrails(inputText, config, getContext(), true);
    const shouldMaskPII = guardrails.find((g: any) => (g?.name === "Contains PII") && g?.config && g.config.block === false);
    if (shouldMaskPII) {
        const piiOnly = { guardrails: [shouldMaskPII] };
        await scrubConversationHistory(history, piiOnly);
        await scrubWorkflowInput(workflow, "input_as_text", piiOnly);
        await scrubWorkflowInput(workflow, "input_text", piiOnly);
    }
    const hasTripwire = guardrailsHasTripwire(results);
    const safeText = getGuardrailSafeText(results, inputText) ?? inputText;
    return { results, hasTripwire, safeText, failOutput: buildGuardrailFailOutput(results ?? []), passOutput: { safe_text: safeText } };
}

function buildGuardrailFailOutput(results: any[]) {
    const get = (name: string) => (results ?? []).find((r: any) => ((r?.info?.guardrail_name ?? r?.info?.guardrailName) === name));
    const pii = get("Contains PII"), mod = get("Moderation"), jb = get("Jailbreak"), hal = get("Hallucination Detection"), nsfw = get("NSFW Text"), url = get("URL Filter"), custom = get("Custom Prompt Check"), pid = get("Prompt Injection Detection"), piiCounts = Object.entries(pii?.info?.detected_entities ?? {}).filter(([, v]) => Array.isArray(v)).map(([k, v]: [any, any]) => k + ":" + v.length), conf = jb?.info?.confidence;
    return {
        pii: { failed: (piiCounts.length > 0) || pii?.tripwireTriggered === true, detected_counts: piiCounts },
        moderation: { failed: mod?.tripwireTriggered === true || ((mod?.info?.flagged_categories ?? []).length > 0), flagged_categories: mod?.info?.flagged_categories },
        jailbreak: { failed: jb?.tripwireTriggered === true },
        hallucination: { failed: hal?.tripwireTriggered === true, reasoning: hal?.info?.reasoning, hallucination_type: hal?.info?.hallucination_type, hallucinated_statements: hal?.info?.hallucinated_statements, verified_statements: hal?.info?.verified_statements },
        nsfw: { failed: nsfw?.tripwireTriggered === true },
        url_filter: { failed: url?.tripwireTriggered === true },
        custom_prompt_check: { failed: custom?.tripwireTriggered === true },
        prompt_injection: { failed: pid?.tripwireTriggered === true },
    };
}
const RfAgentSchema = z.object({ source_files: z.string(), output_text: z.string() });
const rfAgent = new Agent({
  name: "RF-agent",
  instructions: `Role and Context
You are an assistant that answers questions about past Regional Council (fullmäktige) debates in Region Östergötland during the 2022–2026 mandate period. In Region Östergötland, the Moderate Party, the Liberal Party, and the Christian Democrats govern with support from the Sweden Democrats. The Social Democrats, the Centre Party, the Green Party, and the Left Party are in opposition.

Your Purpose
Users will ask questions about events, statements, or topics discussed in past council debates.
Your job is to search the available vector stores and use the retrieved documents to produce accurate, source-grounded answers.

Your Available Tools
You have access to a vector stores:

A vector store containing full transcriptions of all debates, including metadata such as timestamps and source URLs.

How to Answer
When the user asks a question:

Retrieve relevant transcription segments from the transcription vector store.
Use only the retrieved transcription text as the factual basis for your answer. Do not invent or assume information.
If quoting or paraphrasing a debate:

Include the exact timestamps (start and end time) from the transcription metadata.
Provide a short explanation of how the retrieved excerpt answers the user’s question.

Clearly separate your answer from the citation information.

Citation Format
When presenting supporting material:

Provide timestamp range
Provide the quotation or relevant excerpt
Example:
“According to the transcription (00:12:14–00:13:02): ‘…quoted text…’

Additional Rules

Do not claim knowledge of debate content that is not present in the retrieved transcriptions.
If no relevant material is found, clearly state that no supporting transcription segments were retrieved.
Always prioritize accuracy, neutrality, and grounding in the provided data.

Put the output in output_text. 

If there is a citation referenced in the output_text, put the file name of the file where the citation has been fetched in source_files.`,
  model: "gpt-4.1",
  tools: [
    fileSearch
  ],
  outputType: RfAgentSchema,
  modelSettings: {
    temperature: 1,
    topP: 1,
    maxTokens: 2048,
    store: true
  }
});

interface UrlAgentContext {
  inputOutputParsedSourceFiles: string;
}
const urlAgentInstructions = (runContext: RunContext<UrlAgentContext>, _agent: Agent<UrlAgentContext>) => {
  const { inputOutputParsedSourceFiles } = runContext.context;
  return `You must find and extract a URL from a JSON file in the vector store.

## Your Task:
1. Search the vector store for a file named: "${inputOutputParsedSourceFiles}"
2. Open that JSON file and find the path: metadata.links[0]
3. Extract the URL value at that location
4. Return ONLY the raw URL string (no markdown, no formatting, just the URL)

## Example:
If the file contains: {"metadata": {"links": ["https://example.com/debate"]}}
You should output: https://example.com/debate

## Important:
- Return ONLY the URL string
- No markdown formatting like [Link](url)
- No explanatory text
- Just the raw URL`
}

const UrlAgentSchema = z.object({ 
  url: z.string().describe("The extracted URL from metadata.links[0]")
});

const urlAgent = new Agent({
  name: "Url Agent",
  instructions: urlAgentInstructions,
  model: "gpt-4.1",
  tools: [
    fileSearch
  ],
  outputType: UrlAgentSchema,
  ],
  modelSettings: {
    temperature: 1,
    topP: 1,
    maxTokens: 2048,
    store: true
  }
});

type WorkflowInput = { input_as_text: string };


// Main code entrypoint
export const runWorkflow = async (workflow: WorkflowInput) => {
  return await withTrace("RF-chatt", async () => {
    const state = {
      source_file: null
    };
    const conversationHistory: AgentInputItem[] = [
      { role: "user", content: [{ type: "input_text", text: workflow.input_as_text }] }
    ];
    const runner = new Runner({
      traceMetadata: {
        __trace_source__: "agent-builder",
        workflow_id: "wf_68f3692fcd708190bb77e8713a84a94903dee35caea5f98b"
      }
    });
    const guardrailsInputText = workflow.input_as_text;
    const { hasTripwire: guardrailsHasTripwire, safeText: guardrailsAnonymizedText, failOutput: guardrailsFailOutput, passOutput: guardrailsPassOutput } = await runAndApplyGuardrails(guardrailsInputText, guardrailConfig, conversationHistory, workflow);
    const guardrailsOutput = (guardrailsHasTripwire ? guardrailsFailOutput : guardrailsPassOutput);
    if (guardrailsHasTripwire) {
      return guardrailsOutput;
    } else {
      const rfAgentResultTemp = await runner.run(
        rfAgent,
        [
          ...conversationHistory
        ]
      );
      conversationHistory.push(...rfAgentResultTemp.newItems.map((item) => item.rawItem));

      if (!rfAgentResultTemp.finalOutput) {
          throw new Error("Agent result is undefined");
      }

      console.log("🤖 RF Agent finalOutput:", JSON.stringify(rfAgentResultTemp.finalOutput, null, 2));

      const rfAgentResult = {
        output_text: JSON.stringify(rfAgentResultTemp.finalOutput),
        output_parsed: rfAgentResultTemp.finalOutput
      };
      
      console.log("📋 Parsed source_files:", rfAgentResult.output_parsed.source_files);
      
      if (rfAgentResult.output_parsed.source_files != null) {
        console.log("🔗 Kör URL Agent med source_files:", rfAgentResult.output_parsed.source_files);
        
        const urlAgentResultTemp = await runner.run(
          urlAgent,
          [
            ...conversationHistory
          ],
          {
            context: {
              inputOutputParsedSourceFiles: rfAgentResult.output_parsed.source_files
            }
          }
        );
        conversationHistory.push(...urlAgentResultTemp.newItems.map((item) => item.rawItem));

        if (!urlAgentResultTemp.finalOutput) {
            throw new Error("Agent result is undefined");
        }

        console.log("🌐 URL Agent finalOutput:", urlAgentResultTemp.finalOutput);

        const urlAgentResult = {
          output_text: rfAgentResult.output_parsed.output_text,
          source_url: typeof urlAgentResultTemp.finalOutput === 'object' && urlAgentResultTemp.finalOutput?.url 
            ? urlAgentResultTemp.finalOutput.url 
            : (urlAgentResultTemp.finalOutput ?? "")
        };
        
        console.log("✨ Returnerar med source_url:", urlAgentResult);
        return urlAgentResult;
      } else {
        console.log("⚠️ Ingen source_files hittades, returnerar bara rfAgentResult");
        console.log("📦 rfAgentResult:", rfAgentResult);
        return rfAgentResult;
      }
    }
  });
}
