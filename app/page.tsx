"use client";

import { useState } from "react";

export default function ChatPage() {
  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  async function sendMessage() {
    if (!input.trim()) return;

    const newMessages = [...messages, { role: "user", content: input }];
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
      { role: "assistant", content: data.reply },
    ]);

    setLoading(false);
  }

  return (
    <main style={{ maxWidth: 600, margin: "40px auto" }}>
      <h1>AI‑Agent Chat</h1>

      <div style={{ border: "1px solid #ccc", padding: 16, minHeight: 300 }}>
        {messages.map((m, i) => (
          <div key={i} style={{ marginBottom: 12 }}>
            <strong>{m.role === "user" ? "Du" : "Agent"}:</strong>
            <div>{m.content}</div>
          </div>
        ))}
        {loading && <div>Agenten skriver…</div>}
      </div>

      <div style={{ display: "flex", marginTop: 12 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sendMessage()}
          style={{ flex: 1, marginRight: 8 }}
        />
        <button onClick={sendMessage} disabled={loading}>Skicka</button>
      </div>
    </main>
  );
}