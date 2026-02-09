import { NextResponse } from "next/server";
import { runWorkflow } from "@/lib/runWorkflow";
import urlMapping from "@/lib/data/url-mapping.json";

// Helper function to check if result is a guardrail failure
function isGuardrailFailure(result: any): boolean {
  if (!result || typeof result !== "object") return false;
  
  // Check if result has guardrail failure structure
  const hasGuardrailKeys = ["pii", "moderation", "jailbreak", "custom_prompt_check", "prompt_injection"]
    .some(key => key in result);
  
  if (!hasGuardrailKeys) return false;
  
  // Check if any guardrail actually failed
  return Object.values(result).some((check: any) => 
    check && typeof check === "object" && check.failed === true
  );
}

// Helper function to create user-friendly error message from guardrail failure
function formatGuardrailError(result: any): string {
  const errors: string[] = [];
  
  if (result.jailbreak?.failed) {
    errors.push("Din fråga innehåller ett försök att kringgå systemets säkerhetsbegränsningar.");
  }
  
  if (result.moderation?.failed) {
    const categories = result.moderation.flagged_categories || [];
    errors.push(`Din fråga innehåller olämpligt innehåll${categories.length > 0 ? ` (${categories.join(", ")})` : ""}.`);
  }
  
  if (result.custom_prompt_check?.failed) {
    errors.push("Din fråga ligger utanför systemets ämnesområde. Vänligen ställ frågor om regionfullmäktigedebatter i Region Östergötland.");
  }
  
  if (result.prompt_injection?.failed) {
    errors.push("Din fråga innehåller ett försök att manipulera systemet.");
  }
  
  if (result.pii?.failed) {
    errors.push("Din fråga innehåller personlig information som inte kan hanteras.");
  }
  
  if (result.nsfw?.failed) {
    errors.push("Din fråga innehåller olämpligt innehåll.");
  }
  
  if (result.url_filter?.failed) {
    errors.push("Din fråga innehåller otillåtna webbadresser.");
  }
  
  if (errors.length === 0) {
    return "Din fråga kunde inte behandlas av säkerhetsskäl.";
  }
  
  return errors.join(" ");
}

export async function POST(req: Request) {
  try {
    const { message } = await req.json();

    if (!message || typeof message !== "string" || message.trim().length === 0) {
      return NextResponse.json(
        { 
          error: true,
          message: "Vänligen ange en giltig fråga."
        },
        { status: 400 }
      );
    }

    console.log("📥 Inkommande meddelande:", message);

    const result = await runWorkflow({
      input_as_text: message
    });

    console.log("📤 Resultat från runWorkflow:", JSON.stringify(result, null, 2));

    // Check if result is a guardrail failure
    if (isGuardrailFailure(result)) {
      console.log("⚠️ Guardrail-fel upptäckt");
      return NextResponse.json(
        {
          error: true,
          message: formatGuardrailError(result),
          guardrail_details: result
        },
        { status: 400 }
      );
    }

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
          console.log("📄 Citation source_file:", cite.source_file);
          const mapping = (urlMapping as Record<string, any>)[cite.source_file];
          console.log("🗺️ Mapping found:", mapping ? "Yes" : "No", mapping);
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

    // Check if we got an empty response
    if (!response.output_text || response.output_text.trim().length === 0) {
      return NextResponse.json(
        {
          error: true,
          message: "Kunde inte hitta något relevant svar på din fråga. Vänligen omformulera eller ställ en annan fråga om regionfullmäktigedebatter."
        },
        { status: 404 }
      );
    }

    console.log("✅ Formaterat svar:", JSON.stringify(response, null, 2));

    return NextResponse.json(response);

  } catch (error) {
    console.error("❌ Fel i chat-route:", error);
    
    // Handle specific error types
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        {
          error: true,
          message: "Ogiltigt format på förfrågan. Vänligen försök igen."
        },
        { status: 400 }
      );
    }
    
    // Check for OpenAI API errors
    if (error && typeof error === "object" && "status" in error) {
      const apiError = error as any;
      if (apiError.status === 401) {
        return NextResponse.json(
          {
            error: true,
            message: "Autentiseringsfel. Kontakta systemadministratören."
          },
          { status: 500 }
        );
      }
      if (apiError.status === 429) {
        return NextResponse.json(
          {
            error: true,
            message: "För många förfrågningar. Vänligen vänta en stund och försök igen."
          },
          { status: 429 }
        );
      }
    }
    
    // Generic error response
    return NextResponse.json(
      {
        error: true,
        message: "Ett oväntat fel uppstod. Vänligen försök igen senare."
      },
      { status: 500 }
    );
  }
}