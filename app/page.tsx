"use client";

import { useState } from "react";

type Citation = {
  citation: string;
  time_stamp: string;
  source_url: string;
  date: string;
};

type Message = {
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
};

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  async function sendMessage() {
    if (!input.trim()) return;

    const newMessages: Message[] = [...messages, { role: "user", content: input }];
    setMessages(newMessages);
    setInput("");
    setLoading(true);

    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: input }),
    });

    const data = await res.json();

    setMessages([
      ...newMessages,
      { 
        role: "assistant", 
        content: data.output_text || data.reply || "Inget svar",
        citations: data.citations || []
      },
    ]);

    setLoading(false);
  }

  return (
    <main style={{ maxWidth: 800, margin: "40px auto", padding: "0 20px" }}>
      <h1>AI‑Agent Chat</h1>

      <div style={{ border: "1px solid #ccc", padding: 16, minHeight: 300, borderRadius: 8 }}>
        {messages.map((m, i) => (
          <div key={i} style={{ marginBottom: 20 }}>
            <strong style={{ color: m.role === "user" ? "#0066cc" : "#00aa00" }}>
              {m.role === "user" ? "Du" : "Agent"}:
            </strong>
            <div style={{ marginTop: 8, lineHeight: 1.6 }}>{m.content}</div>
            
            {m.citations && m.citations.length > 0 && (
              <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid #eee" }}>
                <strong style={{ fontSize: "0.9em", color: "#666" }}>Källor:</strong>
                <div style={{ marginTop: 8 }}>
                  {m.citations.map((cite, idx) => (
                    <div key={idx} style={{ marginBottom: 12, fontSize: "0.9em" }}>
                      <div style={{ marginBottom: 4 }}>
                        <strong>{idx + 1}.</strong> "{cite.citation.length > 200 ? cite.citation.substring(0, 200) + "..." : cite.citation}"
                      </div>
                      <div style={{ color: "#666", fontSize: "0.85em" }}>
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
                    </div>
                  ))}
                </div>
              </div>
            )}
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