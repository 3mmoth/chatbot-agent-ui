"use client";

import { useState } from "react";

type Citation = {
  citation: string;
  time_stamp: string;
  source_url: string;
  date: string;
};

type Message = {
  role: "user" | "assistant" | "error";
  content: string;
  citations?: Citation[];
  isError?: boolean;
};

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  // Format message content with citations as block quotes
  function formatMessageWithCitations(content: string, citations?: Citation[]) {
    if (!citations || citations.length === 0) {
      return <div style={{ lineHeight: 1.6 }}>{content}</div>;
    }

    const parts: React.ReactElement[] = [];
    let lastIndex = 0;
    
    // Find and replace each citation in the content with a styled block quote
    citations.forEach((cite, idx) => {
      const citationText = cite.citation;
      const index = content.indexOf(citationText, lastIndex);
      
      if (index !== -1) {
        // Add text before citation
        if (index > lastIndex) {
          parts.push(
            <div key={`text-${idx}`} style={{ lineHeight: 1.6, marginBottom: 12 }}>
              {content.substring(lastIndex, index)}
            </div>
          );
        }
        
        // Add citation as block quote
        parts.push(
          <blockquote 
            key={`cite-${idx}`}
            style={{
              margin: "16px 0",
              padding: "12px 16px",
              backgroundColor: "#f8f9fa",
              borderLeft: "4px solid #0066cc",
              borderRadius: "4px",
              fontStyle: "italic"
            }}
          >
            <div style={{ marginBottom: 8 }}>"{citationText}"</div>
            <div style={{ fontSize: "0.85em", color: "#666", fontStyle: "normal" }}>
              {cite.time_stamp && (
                <span style={{ marginRight: 12 }}>⏱ {cite.time_stamp}</span>
              )}
              {cite.source_url && (
                <a 
                  href={cite.source_url} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  style={{ color: "#0066cc", textDecoration: "none" }}
                >
                  🔗 Se källa (Fullmäktige {cite.date})
                </a>
              )}
            </div>
          </blockquote>
        );
        
        lastIndex = index + citationText.length;
      }
    });
    
    // Add remaining text
    if (lastIndex < content.length) {
      parts.push(
        <div key="text-end" style={{ lineHeight: 1.6 }}>
          {content.substring(lastIndex)}
        </div>
      );
    }
    
    return <div>{parts}</div>;
  }

  async function sendMessage() {
    if (!input.trim()) return;

    const newMessages: Message[] = [...messages, { role: "user", content: input }];
    setMessages(newMessages);
    const userInput = input;
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userInput }),
      });

      const data = await res.json();

      // Check if response contains an error
      if (data.error) {
        setMessages([
          ...newMessages,
          { 
            role: "error", 
            content: data.message || "Ett fel uppstod vid behandlingen av din fråga.",
            isError: true
          },
        ]);
      } else {
        // Successful response
        setMessages([
          ...newMessages,
          { 
            role: "assistant", 
            content: data.output_text || data.reply || "Inget svar",
            citations: data.citations || []
          },
        ]);
      }
    } catch (error) {
      console.error("Fetch error:", error);
      setMessages([
        ...newMessages,
        { 
          role: "error", 
          content: "Kunde inte ansluta till servern. Kontrollera din internetanslutning och försök igen.",
          isError: true
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 800, margin: "40px auto", padding: "0 20px" }}>
      <h1>AI‑Agent Chat</h1>

      <div style={{ border: "1px solid #ccc", padding: 16, minHeight: 300, borderRadius: 8 }}>
        {messages.map((m, i) => (
          <div 
            key={i} 
            style={{ 
              marginBottom: 20,
              padding: m.isError ? "12px" : "0",
              backgroundColor: m.isError ? "#fff3cd" : "transparent",
              border: m.isError ? "1px solid #ffc107" : "none",
              borderRadius: m.isError ? "6px" : "0"
            }}
          >
            <strong style={{ 
              color: m.role === "user" ? "#0066cc" : m.role === "error" ? "#dc3545" : "#00aa00" 
            }}>
              {m.role === "user" ? "Du" : m.role === "error" ? "⚠️ Fel" : "Agent"}:
            </strong>
            <div style={{ 
              marginTop: 8,
              color: m.isError ? "#856404" : "inherit"
            }}>
              {m.role === "assistant" 
                ? formatMessageWithCitations(m.content, m.citations)
                : <div style={{ lineHeight: 1.6 }}>{m.content}</div>
              }
            </div>
          </div>
        ))}
        {loading && <div style={{ color: "#666", fontStyle: "italic" }}>Agenten skriver…</div>}
      </div>

      <div style={{ display: "flex", marginTop: 12 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sendMessage()}
          style={{ 
            flex: 1, 
            marginRight: 8, 
            padding: "10px 12px",
            fontSize: "1em",
            borderRadius: 4,
            border: "1px solid #ccc"
          }}
          placeholder="Skriv din fråga här..."
        />
        <button 
          onClick={sendMessage} 
          disabled={loading}
          style={{
            padding: "10px 20px",
            fontSize: "1em",
            borderRadius: 4,
            border: "none",
            backgroundColor: loading ? "#ccc" : "#0066cc",
            color: "white",
            cursor: loading ? "not-allowed" : "pointer"
          }}
        >
          Skicka
        </button>
      </div>
    </main>
  );
}