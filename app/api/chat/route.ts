import { NextResponse } from "next/server";
import { runWorkflow } from "@/lib/runWorkflow";
import urlMapping from "@/lib/data/url-mapping.json";

export async function POST(req: Request) {
  const { message } = await req.json();

  console.log("📥 Inkommande meddelande:", message);

  const result = await runWorkflow({
    input_as_text: message
  });

  console.log("📤 Resultat från runWorkflow:", JSON.stringify(result, null, 2));

  // Default response structure
  let response = {
    output_text: "",
    citations: [] as Array<{
      citation: string;
      time_stamp: string;
      source_url: string;
      date: string;
    }>
  };
  
  if (typeof result === "string") {
    response.output_text = result;
  } else if (result && typeof result === "object") {
    let outputText = "";
    let citations = [];
    
    if ("output_text" in result) {
      // Try to parse output_text if it's a JSON string
      try {
        const parsed = typeof result.output_text === "string" 
          ? JSON.parse(result.output_text) 
          : result.output_text;
        
        outputText = parsed.output_text || "";
        citations = parsed.citations || [];
      } catch {
        // If parsing fails, use as is
        outputText = String(result.output_text);
      }
    }
    
    // If output_parsed exists, use it directly
    if ("output_parsed" in result && result.output_parsed) {
      outputText = result.output_parsed.output_text || outputText;
      citations = result.output_parsed.citations || citations;
    }
    
    response.output_text = outputText;
    
    // Map citations with source_url from url-mapping.json
    if (Array.isArray(citations) && citations.length > 0) {
      response.citations = citations.map((cite: any) => {
        const mapping = (urlMapping as Record<string, any>)[cite.source_file];
        return {
          citation: cite.citation || "",
          time_stamp: cite.time_stamp || "",
          source_url: mapping?.url || "",
          date: mapping?.date || ""
        };
      });
    }
  } else {
    response.output_text = "Inget svar från agenten";
  }

  console.log("✅ Formaterat svar:", JSON.stringify(response, null, 2));

  return NextResponse.json(response);
}