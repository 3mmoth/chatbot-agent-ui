import { NextResponse } from "next/server";
import { runWorkflow } from "@/lib/runWorkflow";

export async function POST(req: Request) {
  const { message } = await req.json();

  console.log("📥 Inkommande meddelande:", message);

  const result = await runWorkflow({
    input_as_text: message
  });

  console.log("📤 Resultat från runWorkflow:", JSON.stringify(result, null, 2));

  // Format the response for the frontend
  let reply = "";
  
  if (typeof result === "string") {
    reply = result;
  } else if (result && typeof result === "object") {
    // If it has output_text (from rfAgent)
    if ("output_text" in result) {
      reply = result.output_text;
      
      // If there's also a source_url, append it
      if ("source_url" in result && result.source_url) {
        reply += "\n\n" + result.source_url;
      }
    } else {
      // Fallback: stringify the object
      reply = JSON.stringify(result, null, 2);
    }
  } else {
    reply = "Inget svar från agenten";
  }
  console.log("✅ Formaterat svar:", reply);
  return NextResponse.json({ reply });
}