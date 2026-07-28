// Types for the Slack Socket Mode bridge (docker/slack-bridge.js).

/** The subset of a Slack `message` event the bridge reads. */
export interface SlackMessageEvent {
  type: string
  user?: string
  text?: string
  ts?: string
  thread_ts?: string
  channel?: string
  subtype?: string
  bot_id?: string
}

/** A Socket Mode envelope — the frame Slack sends over the WebSocket. */
export interface SocketEnvelope {
  envelope_id?: string
  type: string
  reason?: string
  payload?: {
    type?: string
    event_id?: string
    event?: SlackMessageEvent
  }
}

/** Bridge configuration, read once from the environment at startup. */
export interface BridgeConfig {
  appToken: string
  channel: string
  allowlist: string[]
  session: string
}

/** classifyEnvelope verdict: inject the framed text, or drop with a reason. */
export type Classified =
  | { kind: 'inject', framed: string }
  | { kind: 'drop', reason: string }

/**
 * Minimal tmux command runner the injector goes through — the seam that makes
 * injection offline-testable with a fake target (LLP 0042 R4). `args` are tmux
 * arguments (no leading `tmux`); `input` is piped to stdin when present.
 */
export type Exec = (args: string[], input?: string) => Promise<string>
