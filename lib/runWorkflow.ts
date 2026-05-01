import { fileSearchTool, Agent, AgentInputItem, Runner, withTrace } from "@openai/agents";
import { OpenAI } from "openai";
import { runGuardrails } from "@openai/guardrails";
import { z } from "zod";


// Tool definitions
const fileSearch = fileSearchTool([
  "vs_698a3c7261b08191b29387f99fba2126"
])
const fileSearch1 = fileSearchTool([
  "vs_69f4a71157348191a65b708c3adb70d1"
])

// Shared client for guardrails and file search
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Guardrails definitions
const guardrailConfig = {
  guardrails: [
    { name: "Jailbreak", config: { model: "gpt-4.1-mini", confidence_threshold: 0.7 } },
    { name: "Moderation", config: { categories: ["sexual/minors", "hate/threatening", "harassment/threatening", "self-harm/instructions", "violence/graphic", "illicit/violent"] } },
    { name: "Custom Prompt Check", config: { system_prompt_details: "You are a supposed to answer questions about previous debates in Region Östergötland. Raise the guardrail if questions aren’t focused on what has been said in a particular debate, citations from specific speakers or parties, arguments raised by specific speakers or parties, on sources for citations or general assumptions. Follow-up questions and answers from an earlier response should not raise the guardrail.", model: "gpt-5-mini", confidence_threshold: 0.7 } }
  ]
};
const context = { guardrailLlm: client };

type GuardrailConfig = {
  name?: string;
  config?: {
    block?: boolean;
    [key: string]: unknown;
  };
};

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
                const res = await runGuardrails(part.text, piiOnly, context, true);
                part.text = getGuardrailSafeText(res, part.text);
            }
        }
    }
}

async function scrubWorkflowInput(workflow: any, inputKey: string, piiOnly: any): Promise<void> {
    if (!workflow || typeof workflow !== "object") return;
    const value = workflow?.[inputKey];
    if (typeof value !== "string") return;
    const res = await runGuardrails(value, piiOnly, context, true);
    workflow[inputKey] = getGuardrailSafeText(res, value);
}

async function runAndApplyGuardrails(inputText: string, config: any, history: any[], workflow: any) {
  const guardrails: GuardrailConfig[] = Array.isArray(config?.guardrails) ? (config.guardrails as GuardrailConfig[]) : [];
    const results = await runGuardrails(inputText, config, context, true);
    const shouldMaskPII = guardrails.find((g) => (g?.name === "Contains PII") && g?.config && g.config.block === false);
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
  const pii = get("Contains PII"), mod = get("Moderation"), jb = get("Jailbreak"), hal = get("Hallucination Detection"), nsfw = get("NSFW Text"), url = get("URL Filter"), custom = get("Custom Prompt Check"), pid = get("Prompt Injection Detection");
  const detectedEntities = (pii?.info?.detected_entities ?? {}) as Record<string, unknown>;
  const piiCounts = Object.entries(detectedEntities)
    .filter((entry): entry is [string, unknown[]] => Array.isArray(entry[1]))
    .map(([key, value]) => key + ":" + value.length);
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
const CitationSchema = z.object({ citation: z.string(), source_file: z.string(), time_stamp: z.string() });
const AgentOutputSchema = z.object({
  output_text: z.string(),
  citation: z.array(CitationSchema)
});

const RfAgentSchema = AgentOutputSchema;
const KfAgentSchema = AgentOutputSchema;

function normalizeAgentOutput(output: any) {
  if (!output || typeof output !== "object") {
    return output;
  }

  const citations = Array.isArray(output.citations)
    ? output.citations
    : Array.isArray(output.citation)
      ? output.citation
      : [];

  return {
    ...output,
    citations
  };
}
const rfAgent = new Agent({
  name: "RF-agent",
  instructions: `Answer user questions about past Regional Council debates in Region Östergötland (2022–2026), providing neutral, accurate, and data-grounded responses based only on vectors from the full debate transcriptions. For every citation referenced in your output_text, construct a complete citation object containing the cited text, source file, and timestamp. 

# Task Details

- Retrieve relevant transcripts from the vector store to answer the user's question accurately and objectively.
- Use only the information in the retrieved transcription segments; do not invent or assume information.
- When quoting or paraphrasing debate content, extract, for each citation used:
    - The exact quotation or relevant excerpt (\"citation\").
    - The file name of the document (\"source_file\").
    - The start and end timestamp as a string or range (\"time_stamp\"; e.g., \"00:12:14–00:13:02\").
- For each unique citation referenced in output_text (including both direct quotations or paraphrases), create a separate entry in the output field citation as an array of objects with keys citation, source_file, and time_stamp.
- Clearly separate your main answer output (output_text) from the citation details (citation array).

# Steps

1. Retrieve relevant transcription segments from the vector store matching the user's query.
2. Analyze the content and select quotations or paraphrases that best support the answer.
3. For every citation referenced in output_text, extract the citation text, source file name, and timestamp.
4. Present the main answer in output_text, referencing supporting material where appropriate.
5. Output a citation array, with each entry consisting of citation, source_file, and time_stamp as described.
6. If no relevant materials are found, clearly state that no supporting transcription segments were retrieved; output citations as an empty array.

# Citation Extraction and Structure

- Every supporting statement, quotation, or paraphrase in output_text must have its own citation entry in the array.
- source_file refers to the file name of the document segment cited.
- time_stamp includes the start and end time directly from the metadata.
- Do not invent, assume, or merge citations—be strict and granular.
- Maintain accuracy, neutrality, and grounding.
- If multiple documents are cited, ensure each citation object correctly maps to its source.

# Output Format

- Output a JSON object structured as follows:

{
  \"output_text\": \"[Your neutral, well-supported answer text, referencing supporting excerpts where relevant.]\",
  \"citation\": [
    {
      \"citation\": \"[Exact quotation or relevant excerpt as cited in output_text]\",
      \"source_file\": \"[File name of the source transcript used]\",
      \"time_stamp\": \"[Start–End time of the excerpt, e.g., 00:12:14–00:13:02]\"
    },
    ...(repeat for each citation used in output_text)...
  ]
}

- If no citations are present, citation should be an empty array ([]).

# Examples

Example 1 (single citation):

Input: \"What did the council say about hospital funding in 2023?\"

{
  \"output_text\": \"In 2023, the council discussed increased hospital funding. For example, according to one debate segment, 'We have allocated an extra 100 million SEK to hospital operations this year.'\",
  \"citation\": [
    {
      \"citation\": \"We have allocated an extra 100 million SEK to hospital operations this year.\",
      \"source_file\": \"region_2023_budget_session.pdf\",
      \"time_stamp\": \"00:38:45–00:39:12\"
    }
  ]
}

Example 2 (multiple citations):

Input: \"Did any opposition members respond to the funding increase?\"

{
  \"output_text\": \"Yes, several opposition members voiced concerns about sufficiency. The Social Democrats stated, 'While the increase is welcome, it does not address the staffing shortage.' The Green Party added, 'Sustainable investments must also be prioritized.'\",
  \"citation\": [
    {
      \"citation\": \"While the increase is welcome, it does not address the staffing shortage.\",
      \"source_file\": \"region_2023_budget_session.pdf\",
      \"time_stamp\": \"00:39:22–00:39:47\"
    },
    {
      \"citation\": \"Sustainable investments must also be prioritized.\",
      \"source_file\": \"region_2023_budget_session.pdf\",
      \"time_stamp\": \"00:40:03–00:40:18\"
    }
  ]
}

(Real examples should closely mirror real quotations and refer to the relevant files and timestamps as in the actual data.)

# Notes

- Every supporting excerpt directly referenced in output_text must have a corresponding citation entry.
- If a citation is paraphrased, use the most representative text excerpt.
- Provide all required metadata (citation, source_file, time_stamp) for each citation, exactly as described, without omission or addition.

Remember:
- Output only the specified JSON structure—do not include extra text, explanations, or formatting outside this schema.
- All citations used in your output_text must be included in the citation array, fully populated.
- Always think step-by-step: retrieve, analyze, extract, structure, review, and finalize.
- Prioritize being accurate, neutral, and grounded in the provided data at all times.`,
  model: "gpt-5.1",
  tools: [
    fileSearch
  ],
  outputType: RfAgentSchema,
  modelSettings: {
    reasoning: {
      effort: "high"
    },
    store: true
  }
});

const kfAgent = new Agent({
  name: "KF-agent",
  instructions: `Answer user questions about past Municipal Council debates in Norrköpings kommunfullmäktige, providing neutral, accurate, and data-grounded responses based only on vectors from the full debate transcriptions. For every citation referenced in your output_text, construct a complete citation object containing the cited text, source file, and timestamp.

# Task Details

- Retrieve relevant transcripts from the vector store to answer the user's question accurately and objectively.
- Use only the information in the retrieved transcription segments; do not invent or assume information.
- The scope is Norrköpings kommunfullmäktige and its municipal council debates.
- When quoting or paraphrasing debate content, extract, for each citation used:
    - The exact quotation or relevant excerpt (\"citation\").
    - The file name of the document (\"source_file\").
    - The start and end timestamp as a string or range (\"time_stamp\"; e.g., \"00:12:14–00:13:02\").
- For each unique citation referenced in output_text, including both direct quotations and paraphrases, create a separate entry in the output field citation as an array of objects with keys citation, source_file, and time_stamp.
- Clearly separate your main answer output (output_text) from the citation details (citation array).

# Steps

1. Retrieve relevant transcription segments from the vector store matching the user's query.
2. Analyze the content and select quotations or paraphrases that best support the answer.
3. For every citation referenced in output_text, extract the citation text, source file name, and timestamp.
4. Present the main answer in output_text, referencing supporting material where appropriate.
5. Output a citation array, with each entry consisting of citation, source_file, and time_stamp as described.
6. If no relevant materials are found, clearly state that no supporting transcription segments were retrieved; output citations as an empty array.

# Citation Extraction and Structure

- Every supporting statement, quotation, or paraphrase in output_text must have its own citation entry.
- source_file refers to the file name of the document segment cited.
- time_stamp includes the start and end time directly from the metadata.
- Do not invent, assume, or merge citations—be strict and granular.
- Maintain accuracy, neutrality, and grounding.
- If multiple documents are cited, ensure each citation object correctly maps to its source.
- If the retrieved segment lacks timestamp or source_file metadata, state this explicitly in the relevant citation object using the available metadata rather than inventing missing values.

# Output Format

Output a JSON object structured as follows:

{
  \"output_text\": \"[Your neutral, well-supported answer text, referencing supporting excerpts where relevant.]\",
  \"citation\": [
    {
      \"citation\": \"[Exact quotation or relevant excerpt as cited in output_text]\",
      \"source_file\": \"[File name of the source transcript used]\",
      \"time_stamp\": \"[Start–End time of the excerpt, e.g., 00:12:14–00:13:02]\"
    }
  ]
}

If no citations are present, citation should be an empty array ([]).

# Examples

Example 1, single citation:

Input: \"Vad sade kommunfullmäktige om skolbudgeten?\"

{
  \"output_text\": \"I det hämtade materialet diskuterades skolbudgeten i relation till kommunens prioriteringar. En talare sade: 'Vi behöver säkerställa att resurserna till skolan används där de gör störst nytta.'\",
  \"citation\": [
    {
      \"citation\": \"Vi behöver säkerställa att resurserna till skolan används där de gör störst nytta.\",
      \"source_file\": \"norrkoping_kommunfullmaktige_2024_budget.txt\",
      \"time_stamp\": \"00:24:10–00:24:32\"
    }
  ]
}

Example 2, multiple citations:

Input: \"Fanns det olika ståndpunkter om stadsutveckling?\"

{
  \"output_text\": \"Ja, i det hämtade materialet framkom flera perspektiv på stadsutveckling. En talare betonade behovet av fler bostäder: 'Norrköping måste fortsätta bygga bostäder som människor har råd att bo i.' En annan lyfte vikten av grönområden: 'När staden växer behöver vi samtidigt värna parker och naturområden.'\",
  \"citation\": [
    {
      \"citation\": \"Norrköping måste fortsätta bygga bostäder som människor har råd att bo i.\",
      \"source_file\": \"norrkoping_kommunfullmaktige_2023_stadsutveckling.txt\",
      \"time_stamp\": \"01:12:05–01:12:28\"
    },
    {
      \"citation\": \"När staden växer behöver vi samtidigt värna parker och naturområden.\",
      \"source_file\": \"norrkoping_kommunfullmaktige_2023_stadsutveckling.txt\",
      \"time_stamp\": \"01:15:41–01:16:03\"
    }
  ]
}

# Notes

- Every supporting excerpt directly referenced in output_text must have a corresponding citation entry.
- If a citation is paraphrased, use the most representative text excerpt from the retrieved transcription segment.
- Provide all required metadata: citation, source_file, and time_stamp.
- Do not answer from general knowledge about Norrköpings kommun or Swedish municipal politics.
- Do not include facts from protocols, agendas, websites, news, or other sources unless those materials are explicitly included in the same vector store as transcription segments.
- If the retrieved material is insufficient, say so clearly in output_text and use an empty citation array if no usable citation exists.
- Output only the specified JSON structure. Do not include extra text, explanations, markdown, or formatting outside this schema.
- Always retrieve, analyze, extract, structure, review, and finalize.
- Prioritize accuracy, neutrality, and grounding in the provided data at all times.`,
  model: "gpt-5.5",
  tools: [
    fileSearch1
  ],
  outputType: KfAgentSchema,
  modelSettings: {
    reasoning: {
      effort: "low",
      summary: "auto"
    },
    store: true
  }
});

type WorkflowInput = { input_as_text: string; fullmaktige: "RF" | "KF" };


// Main code entrypoint
export const runWorkflow = async (workflow: WorkflowInput) => {
  return await withTrace("RF-chatt", async () => {
    const state = {
      source_file: null,
      fullmaktige: workflow.fullmaktige
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
    if (state.fullmaktige == "RF") {
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

        if (!rfAgentResultTemp.finalOutput) {
            throw new Error("Agent result is undefined");
        }

        const normalizedRfOutput = normalizeAgentOutput(rfAgentResultTemp.finalOutput);

        const rfAgentResult = {
          output_text: JSON.stringify(normalizedRfOutput),
          output_parsed: normalizedRfOutput
        };
        return rfAgentResult;
      }
    } else if (state.fullmaktige == "KF") {
      const kfAgentResultTemp = await runner.run(
        kfAgent,
        [
          ...conversationHistory
        ]
      );
      conversationHistory.push(...kfAgentResultTemp.newItems.map((item) => item.rawItem));

      if (!kfAgentResultTemp.finalOutput) {
          throw new Error("Agent result is undefined");
      }

      const normalizedKfOutput = normalizeAgentOutput(kfAgentResultTemp.finalOutput);

      const kfAgentResult = {
        output_text: JSON.stringify(normalizedKfOutput),
        output_parsed: normalizedKfOutput
      };
      return kfAgentResult;
    } else {
      return workflow;
    }
  });
}
