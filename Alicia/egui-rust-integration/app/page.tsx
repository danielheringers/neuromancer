"use client"

import { useRef, useEffect, useState, useCallback } from "react"
import { TitleBar } from "@/components/alicia/title-bar"
import { Sidebar } from "@/components/alicia/sidebar"
import { TerminalMessage } from "@/components/alicia/terminal-message"
import { CommandInput } from "@/components/alicia/command-input"
import { StatusBar } from "@/components/alicia/status-bar"
import { DiffViewer } from "@/components/alicia/diff-viewer"
import { BootScreen } from "@/components/alicia/boot-screen"
import { Bot } from "lucide-react"

interface Message {
  id: number
  type: "user" | "agent" | "system"
  content: string
  timestamp: string
  toolCalls?: { name: string; status: "running" | "done" | "error"; detail?: string }[]
  codeBlocks?: { language: string; filename?: string; content: string }[]
  thinking?: boolean
  diff?: {
    filename: string
    lines: { type: "add" | "remove" | "context"; content: string; lineNumber: number }[]
  }
}

const initialMessages: Message[] = [
  {
    id: 1,
    type: "system",
    content: "Alicia v0.1.0-alpha initialized. Working directory: ~/projects/my-app\nSandbox mode enabled. Model: gpt-4o-mini",
    timestamp: "09:41:02",
  },
  {
    id: 2,
    type: "user",
    content: "Refactor the authentication handler to use JWT tokens instead of session cookies. Make sure to handle token refresh.",
    timestamp: "09:41:15",
  },
  {
    id: 3,
    type: "agent",
    content: "I'll refactor the authentication system to use JWT tokens. Let me first analyze the current codebase to understand the existing auth implementation.",
    timestamp: "09:41:16",
    toolCalls: [
      { name: "Search: auth handler", status: "done", detail: "src/auth/" },
      { name: "Read: src/auth/handler.rs", status: "done" },
      { name: "Read: src/auth/middleware.rs", status: "done" },
      { name: "Search: session references", status: "done", detail: "12 files found" },
    ],
  },
  {
    id: 4,
    type: "agent",
    content: "I've analyzed the codebase. The current auth system uses session cookies stored in Redis. I'll replace it with JWT-based authentication with refresh token support. Here's the new token handler:",
    timestamp: "09:41:22",
    codeBlocks: [
      {
        language: "rust",
        filename: "src/auth/token.rs",
        content: `use jsonwebtoken::{encode, decode, Header, Algorithm, Validation, EncodingKey, DecodingKey};
use serde::{Deserialize, Serialize};
use chrono::{Utc, Duration};

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,
    pub exp: usize,
    pub iat: usize,
    pub role: String,
}

pub fn create_access_token(user_id: &str, role: &str) -> Result<String, AuthError> {
    let expiration = Utc::now()
        .checked_add_signed(Duration::minutes(15))
        .expect("valid timestamp")
        .timestamp() as usize;

    let claims = Claims {
        sub: user_id.to_owned(),
        exp: expiration,
        iat: Utc::now().timestamp() as usize,
        role: role.to_owned(),
    };

    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(get_secret().as_ref()),
    )
    .map_err(|e| AuthError::TokenCreation(e.to_string()))
}`,
      },
    ],
  },
  {
    id: 5,
    type: "agent",
    content: "Now updating the middleware to validate JWT tokens on each request:",
    timestamp: "09:41:28",
    diff: {
      filename: "src/auth/middleware.rs",
      lines: [
        { type: "context", content: "use actix_web::{HttpRequest, HttpResponse};", lineNumber: 1 },
        { type: "remove", content: "use crate::session::SessionStore;", lineNumber: 2 },
        { type: "add", content: "use crate::auth::token::{verify_token, Claims};", lineNumber: 2 },
        { type: "add", content: "use actix_web::HttpMessage;", lineNumber: 3 },
        { type: "context", content: "", lineNumber: 4 },
        { type: "context", content: "pub async fn auth_middleware(", lineNumber: 5 },
        { type: "context", content: "    req: HttpRequest,", lineNumber: 6 },
        { type: "remove", content: "    session: SessionStore,", lineNumber: 7 },
        { type: "remove", content: ") -> Result<HttpResponse, AuthError> {", lineNumber: 8 },
        { type: "remove", content: "    let session_id = req.cookie(\"session_id\")", lineNumber: 9 },
        { type: "remove", content: "        .ok_or(AuthError::Unauthorized)?;", lineNumber: 10 },
        { type: "remove", content: "    let user = session.get(&session_id.value()).await?;", lineNumber: 11 },
        { type: "add", content: ") -> Result<HttpResponse, AuthError> {", lineNumber: 7 },
        { type: "add", content: "    let token = req.headers()", lineNumber: 8 },
        { type: "add", content: "        .get(\"Authorization\")", lineNumber: 9 },
        { type: "add", content: "        .and_then(|v| v.to_str().ok())", lineNumber: 10 },
        { type: "add", content: "        .and_then(|v| v.strip_prefix(\"Bearer \"))", lineNumber: 11 },
        { type: "add", content: "        .ok_or(AuthError::MissingToken)?;", lineNumber: 12 },
        { type: "add", content: "", lineNumber: 13 },
        { type: "add", content: "    let claims = verify_token(token)?;", lineNumber: 14 },
        { type: "add", content: "    req.extensions_mut().insert(claims);", lineNumber: 15 },
      ],
    },
  },
]

const fakeAgentResponses = [
  {
    content: "I'll look into that for you. Let me search the codebase and understand the current implementation.",
    toolCalls: [
      { name: "Search: codebase", status: "done" as const, detail: "scanning..." },
      { name: "Read: relevant files", status: "done" as const },
    ],
  },
  {
    content: "Found the relevant code. I've analyzed the patterns and will implement the changes now. Here's what I'm doing:\n\n1. Updating the core logic\n2. Adding proper error handling\n3. Writing tests for the new behavior",
    codeBlocks: [
      {
        language: "rust",
        filename: "src/core/handler.rs",
        content: `pub async fn handle_request(ctx: &Context) -> Result<Response> {
    let validated = ctx.validate_input()?;
    let result = process(validated).await?;

    Ok(Response::new(result))
}`,
      },
    ],
  },
  {
    content: "Changes applied successfully. All tests are passing. Is there anything else you'd like me to modify?",
  },
]

export default function AliciaTerminal() {
  const [booted, setBooted] = useState(false)
  const [fadeIn, setFadeIn] = useState(false)
  const [messages, setMessages] = useState<Message[]>(initialMessages)
  const [isThinking, setIsThinking] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const responseIndex = useRef(0)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, isThinking])

  const handleSubmit = useCallback((value: string) => {
    const now = new Date()
    const ts = now.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })

    // Add user message
    setMessages(prev => [...prev, {
      id: Date.now(),
      type: "user" as const,
      content: value,
      timestamp: ts,
    }])

    // Simulate thinking
    setIsThinking(true)

    const response = fakeAgentResponses[responseIndex.current % fakeAgentResponses.length]
    responseIndex.current++

    // Simulate tool calls first
    if (response.toolCalls) {
      setTimeout(() => {
        const agentTs = new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })
        setIsThinking(false)
        setMessages(prev => [...prev, {
          id: Date.now(),
          type: "agent" as const,
          content: response.content,
          timestamp: agentTs,
          toolCalls: response.toolCalls,
          codeBlocks: response.codeBlocks,
        }])
      }, 2000)
    } else {
      setTimeout(() => {
        const agentTs = new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })
        setIsThinking(false)
        setMessages(prev => [...prev, {
          id: Date.now(),
          type: "agent" as const,
          content: response.content,
          timestamp: agentTs,
          codeBlocks: response.codeBlocks,
        }])
      }, 1500)
    }
  }, [])

  const handleBootComplete = useCallback(() => {
    setBooted(true)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setFadeIn(true))
    })
  }, [])

  if (!booted) {
    return <BootScreen onComplete={handleBootComplete} />
  }

  return (
    <div className={`h-screen w-screen flex flex-col bg-background overflow-hidden transition-opacity duration-500 ${fadeIn ? "opacity-100" : "opacity-0"}`}>
      <TitleBar />

      <div className="flex flex-1 min-h-0">
        <Sidebar />

        {/* Main Terminal Area */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto">
            {/* Welcome Section */}
            <div className="flex flex-col items-center justify-center py-8 border-b border-panel-border bg-terminal-bg/30">
              <div className="w-14 h-14 rounded-xl bg-terminal-green/10 border border-terminal-green/20 flex items-center justify-center mb-4">
                <Bot className="w-8 h-8 text-terminal-green" />
              </div>
              <h1 className="text-lg font-bold text-terminal-fg mb-1">Alicia</h1>
              <p className="text-xs text-muted-foreground mb-4">Your AI-powered coding agent</p>
              <div className="flex items-center gap-3 text-[10px]">
                <span className="px-2 py-1 rounded-full bg-terminal-green/10 text-terminal-green border border-terminal-green/20">
                  Sandbox Mode
                </span>
                <span className="px-2 py-1 rounded-full bg-terminal-blue/10 text-terminal-blue border border-terminal-blue/20">
                  Auto-approve: Off
                </span>
                <span className="px-2 py-1 rounded-full bg-terminal-purple/10 text-terminal-purple border border-terminal-purple/20">
                  Model: gpt-4o-mini
                </span>
              </div>
            </div>

            {/* Messages */}
            <div className="flex flex-col">
              {messages.map((msg) => (
                <div key={msg.id}>
                  <TerminalMessage
                    type={msg.type}
                    content={msg.content}
                    timestamp={msg.timestamp}
                    toolCalls={msg.toolCalls}
                    codeBlocks={msg.codeBlocks}
                    thinking={msg.thinking}
                  />
                  {msg.diff && (
                    <div className="px-5 pb-3 -mt-1 ml-8">
                      <DiffViewer
                        filename={msg.diff.filename}
                        lines={msg.diff.lines}
                        onApprove={() => {}}
                        onReject={() => {}}
                      />
                    </div>
                  )}
                </div>
              ))}

              {isThinking && (
                <TerminalMessage
                  type="agent"
                  content=""
                  thinking={true}
                />
              )}
            </div>

            {/* Bottom padding */}
            <div className="h-4" />
          </div>

          {/* Input */}
          <CommandInput onSubmit={handleSubmit} disabled={isThinking} />
        </div>
      </div>

      <StatusBar />
    </div>
  )
}
