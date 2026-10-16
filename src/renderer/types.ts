// Shared data shapes. Persisted shapes mirror src/main/settings.js; event
// shapes mirror src/main/claude.js.

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreate: number;
}

export type MapId = 'forest' | 'desert' | 'snowy' | 'lava' | 'night';
export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions';
export type Theme = 'dark' | 'light';
export type ModelAlias = 'opus' | 'sonnet' | 'haiku';
/** Where the archive drawer sits: left or right of the chat panel (the window widens), or over it when there is no room. */
export type DrawerMode = 'left' | 'right' | 'overlay';
/** What main's window holds (main -> renderer only): the panel's side, the room for it and the drawer mode.
 *  `fixed`: the OS window never resizes for the panel or drawer (open / close is CSS); false = the old fit-to-open window. */
export interface PanelLayout {
  side: 'above' | 'below';
  /** Panel height + gap main would show for the saved setting. */
  panelH: number;
  /** The most the window can hold (fixed layout), 1000 otherwise. */
  maxPanelH: number;
  drawerMode: DrawerMode;
  fixed: boolean;
}
/** A chat entry. Tool calls carry a name/summary, everything else text. */
export type ChatMessage =
  | { kind: 'tool'; name: string; summary?: string }
  | { kind: 'user'; text: string; images?: { thumb: string }[]; imageCount?: number }
  | { kind: 'assistant' | 'error' | 'meta' | 'thinking'; text: string };

/** Something that can follow a "/" in the chat: an agent, a skill, a custom command, or a built-in Claude Code command. */
export interface CommandEntry {
  name: string;
  kind: 'agent' | 'skill' | 'command' | 'builtin';
  /** Where it comes from: "project", "user", "claude.ai sync", "built in"... */
  source: string;
  description: string;
  argumentHint: string;
}

/** An agent a project can invoke with "/<name>": a markdown file under .claude/agents/. */
export interface AgentDefinition {
  name: string;
  description: string;
  source: 'project' | 'user';
}

export interface AgentRecord {
  id: string;
  name: string;
  status: string;
}

/** A retired or closed agent's chat, kept per project (main/archive.js clamps and validates it). Read-only. */
export interface ArchivedAgent {
  /** The agent id ("observed-<toolUseId>" for delegated ones); a repeat replaces the older entry. */
  id: string;
  name: string;
  definition: string;
  /** The first message sent to the agent. */
  task: string;
  observed: boolean;
  status: 'done' | 'error' | 'cancelled';
  /** idle = retired after the idle time; closed = its tab was closed. */
  reason: 'idle' | 'closed';
  startedAt: number;
  endedAt: number | null;
  /** Set by the main process. */
  archivedAt: number;
  usage: Usage;
  /** Kept for a future "resume"; nothing uses it yet. */
  sessionId: string | null;
  messages: ChatMessage[];
}

export interface Workspace {
  id: string;
  path: string;
  name: string;
  heroSeed: string;
  /** Look of a summoned hero, designed by Claude and validated in the main process (null: generated from the seed). */
  heroDesign?: HeroDesign | null;
  usage: Usage;
  lastContext: number;
  contextWindow: number;
  kills: number;
  map: MapId;
  sessionId: string | null;
  messages: ChatMessage[];
  agents: AgentRecord[];
  /** Chats of retired / closed agents, newest last. Changed only through the archive handlers in main. */
  archive: ArchivedAgent[];
  /** Map and legendary bosses defeated, by boss id ("boss:forest"). */
  trophies: Record<string, { count: number; firstAt: number }>;
  /** Earned achievements by id (main allowlists the ids). Never removed once earned, except the one-time boss-badge sync by main (migrations.achievementSyncV1). */
  achievements: Record<string, { at: number }>;
  /** Lifetime counters the achievements read (main clamps what the renderer reports). */
  stats: WorkspaceStats;
}

export interface WorkspaceStats {
  bestCombo: number;
  crits: number;
  agents: number;
  mapsSeen: string[];
}

export type MinimizeTo = 'bubble' | 'tray';

export interface Settings {
  permissionMode: PermissionMode;
  windowPos: { x: number; y: number } | null;
  workspaces: Workspace[];
  activeId: string | null;
  theme: Theme;
  panelHeight: number;
  /** Notify (OS notification, or an in-app cue) when work finishes / when something fails. Booleans only. */
  notifyDone: boolean;
  notifyFail: boolean;
  /** Where "Hide the app" goes: a small floating bubble, or only the tray icon. (The bubble's position is main-only.) */
  minimizeTo?: MinimizeTo;
  /** One-time data migrations applied by the main process (read-only here). */
  migrations?: Record<string, boolean>;
}

/** A validated hero design (main/hero-design.js) plus the time it was saved. */
export interface HeroDesign {
  cls: string;
  weapon: string;
  body: string;
  gear: string;
  hair: string;
  shield: boolean;
  cape: boolean;
  stache: boolean;
  glasses: boolean;
  colors: Record<string, string>;
  stats: { hp: number; atk: number; def: number; spd: number };
  signatureGlow?: string;
  at: number;
}

/** Generated by engine/heroes.js from a workspace's seed. */
export interface Hero {
  seed: string;
  name: string;
  classId: string;
  cls: string;
  weapon: string;
  colors: { armor?: string; [key: string]: string | undefined };
  stats: { hp: number; atk: number; def: number; spd: number };
  [key: string]: unknown;
}

/** One entry of the map list. */
export interface Background {
  id: MapId;
  name: string;
}

// ----- Events streamed from the main process -----

export interface ClaudeEvent {
  type: 'start' | 'session' | 'turn' | 'usage' | 'thinking' | 'text' | 'tool' | 'subagent' | 'result' | 'error' | 'end' | 'permission' | 'permission-resolved' | 'permission-mode';
  wsId?: string;
  sessionId?: string;
  text?: string;
  name?: string;
  summary?: string;
  message?: string;
  isError?: boolean;
  costUsd?: number;
  turns?: number;
  durationMs?: number;
  contextWindow?: number | null;
  /** Exit code on 'end' (non-zero or null when the process failed or was cancelled). */
  code?: number | null;
  /** Tokens of one model call: a snapshot on 'turn', the final count on 'usage'. */
  usage?: Usage;
  /** Workspace lifetime totals, attached to 'usage' events. */
  totals?: Usage;
  lastContext?: number;
  /**
   * 'subagent' = Claude delegated to one of its agents through its Agent tool. `toolUseId` is that call's id:
   * 'start' carries agentType/description/prompt, 'event' one thing the subagent did (`inner` = 'tool' with
   * name/summary, or 'text' with text), 'end' its result (text, isError).
   */
  phase?: 'start' | 'event' | 'end';
  toolUseId?: string;
  agentType?: string;
  description?: string;
  prompt?: string;
  inner?: 'tool' | 'text';
  /**
   * 'permission' = Claude asks to use a tool (Ask me each time): `requestId` plus what the card shows (all text is
   * already sanitised and capped by main). 'permission-resolved' = that request is over: `how` says why.
   */
  requestId?: string;
  tool?: string;
  detail?: string;
  truncatedLines?: number;
  truncated?: boolean;
  path?: string;
  viaSubagent?: boolean;
  expiresAt?: number;
  how?: 'allowed' | 'denied' | 'timeout' | 'cancelled' | 'stopped' | 'ended' | 'replied' | 'auto-allowed';
  /** 'permission-resolved' with how 'replied': the user's reply, already cleaned and capped by main. */
  reply?: string;
  /**
   * 'permission-mode' = the footer mode was applied to this running process: `mode` is the mode asked for, `ok` whether
   * Claude confirmed it (`errorCode` says why not). A failed switch to a stricter mode also stops the run (an 'error' event).
   */
  mode?: PermissionMode;
  ok?: boolean;
  /** 'permission-mode': why a switch failed. 'error': a fixed code main adds for the notification wording (not-found, start, host-unsupported, mode-switch). */
  errorCode?: string;
}

/** Whose process asked: the project chat (Quest) of a workspace, or one /<agent> process. */
export type PermissionOwner = { kind: 'quest'; wsId: string } | { kind: 'agent'; agentId: string };

/** A pending permission request, as the card shows it. Main holds the real thing; this is only a view. */
export interface PermissionRequest {
  requestId: string;
  owner: PermissionOwner;
  tool: string;
  summary: string;
  detail: string;
  truncatedLines: number;
  truncated: boolean;
  path: string;
  viaSubagent: boolean;
  expiresAt: number;
}

/** Where a notification leads (built by main from its own records). */
export interface NotifyTarget {
  wsId: string | null;
  agentId: string | null;
}

/** A notification as main built it: plain text only. `title` is the short headline, `text` the full sentence. */
export interface NotifyEvent {
  kind: 'done' | 'failed' | 'mixed' | 'test';
  title: string;
  text: string;
  target: NotifyTarget | null;
}

export interface AgentEvent extends ClaudeEvent {
  agentId: string;
}

// ----- Preload bridge (window.bar) -----

export type Unsubscribe = () => void;

export interface Bar {
  getSettings(): Promise<Settings>;
  setSettings(patch: Partial<Settings>): Promise<Settings>;
  updateSettings(patch: Partial<Settings>): Promise<Settings>;
  importWorkspace(): Promise<Settings | null>;
  selectWorkspace(id: string): Promise<Settings>;
  removeWorkspace(id: string): Promise<Settings>;
  /** Random new hero, or a secret hero when `seed` is one of the allowed secret seeds. */
  rerollHero(id: string, seed?: string): Promise<Settings>;
  /** Asks Claude (in main, no tools) to design the look of a summoned name; main validates and saves it. */
  designSummon(wsId: string, name: string): Promise<{ ok: true; cached?: boolean; settings: Settings } | { ok: false; reason: string }>;
  updateWorkspace(id: string, patch: Partial<Pick<Workspace, 'kills' | 'map'>>): Promise<Settings>;
  /** A map or legendary boss was defeated: adds it to the workspace's trophies (main validates the boss id). */
  addTrophy(id: string, bossId: string): Promise<Settings>;
  /** An achievement was earned (main validates the id; a repeat is ignored). */
  addAchievement(id: string, achId: string): Promise<Settings>;
  /** Counter changes since the last flush: `crits` and `agents` are added, `bestCombo` is a max, `mapsSeen` is merged. */
  addStats(id: string, delta: Partial<WorkspaceStats>): Promise<Settings>;
  /** The silent first-load unlock of already-earned achievements is done (sets the migration flag). */
  achievementsBackfilled(): Promise<Settings>;
  /** The one-time "boss badges were re-synced" bubble was shown: main clears the pending flag. */
  achievementSyncNoticeSeen(): Promise<Settings>;

  setClickThrough(ignore: boolean): void;
  /** A panel resize is in progress (main's click-through watchdog waits; it expires by itself). */
  setInteracting(on: boolean): void;
  focus(): void;
  dragStart(): void;
  dragEnd(): void;
  panelSide(): Promise<'above' | 'below'>;
  /** The current layout (asked once at startup; changes arrive through onPanelLayout). */
  panelLayout(): Promise<PanelLayout>;
  setPanelOpen(open: boolean): Promise<'above' | 'below'>;
  /** Where the archive drawer would open for the strip's current spot. */
  drawerMode(): Promise<DrawerMode>;
  /** Ask main to open or close the drawer (it chooses the mode and the window size). 'none' = closed or refused. */
  setDrawerOpen(open: boolean): Promise<DrawerMode | 'none'>;
  /** Ask main to hide the app (it closes the panel first). `ok: false` when it cannot (no tray icon = no way back). */
  hideWindow(): Promise<{ ok: boolean; reason?: string }>;
  /** Whether hiding is possible at all (the tray icon exists, or the bubble can be the way back), and where it goes. */
  windowInfo(): Promise<{ canHide: boolean; minimizeTo?: MinimizeTo; tray?: boolean; bubble?: boolean }>;
  quit(): void;
  restartApp(): void;

  /** `imageIds` are ids from `stageImage`; main owns the bytes. */
  send(prompt: string, model: ModelAlias, imageIds?: string[]): void;
  /** Gives main the bytes of an attached image. Main checks them (type, size, header), keeps them and answers an id plus a small thumbnail, or a fixed refusal message. */
  stageImage(bytes: ArrayBuffer): Promise<{ ok: true; id: string; thumb: string; size: number } | { ok: false; code: string; message: string }>;
  /** Forgets staged images (removed chips, abandoned drafts). */
  discardImages(ids: string[]): void;
  cancel(): void;
  newSession(): Promise<Settings>;
  info(): Promise<{ bin: string }>;

  sendGeneralChat(prompt: string, model: ModelAlias): void;
  cancelGeneralChat(): void;

  /** Everything the "/" popup offers for this project: agents, skills and custom commands. */
  commandCatalog(wsId: string): Promise<CommandEntry[]>;
  /** Agents defined under .claude/agents/ for this project (and the user's own). */
  agentDefinitions(wsId: string): Promise<AgentDefinition[]>;
  /** Runs one agent in its own process; `error` is set when it could not start. */
  runAgent(
    wsId: string, definitionName: string, displayName: string, task: string,
  ): Promise<{ agent?: AgentRecord; definitionName?: string; error?: string }>;
  messageAgent(
    wsId: string, agentId: string, sessionId: string, definitionName: string, prompt: string, cwd: string, imageIds?: string[],
  ): void;
  /** Whether the project has .claude/review.md (the path comes from the workspace). */
  projectHasReview(wsId: string): Promise<boolean>;
  cancelAgent(wsId: string, agentId: string): Promise<Settings | null>;
  /**
   * Answers a pending permission request of the project chat (`target` 'quest', agentId null) or of one agent.
   * Main accepts it only for a request it recorded as pending and answers from its own stored copy of the tool input.
   * `message` (a reply) is only valid with 'deny'; main cleans and caps it.
   */
  answerPermission(target: 'quest' | 'agent', agentId: string | null, requestId: string, decision: 'allow' | 'deny', message?: string): Promise<{ ok: boolean }>;
  listAgents(wsId: string): Promise<AgentRecord[]>;
  /** Stores a retired / closed agent's chat in the project's archive (main clamps it; null = refused). */
  archiveAgent(wsId: string, record: Omit<ArchivedAgent, 'archivedAt'>): Promise<{ archive: ArchivedAgent[] } | null>;
  deleteArchived(wsId: string, id: string): Promise<{ archive: ArchivedAgent[] } | null>;
  clearArchive(wsId: string): Promise<{ archive: ArchivedAgent[] } | null>;

  onClaudeEvent(cb: (event: ClaudeEvent) => void): Unsubscribe;
  onAgentEvent(cb: (event: AgentEvent) => void): Unsubscribe;
  onGeneralChatEvent(cb: (event: ClaudeEvent) => void): Unsubscribe;
  onTogglePanel(cb: () => void): Unsubscribe;
  onPanelLayout(cb: (layout: PanelLayout) => void): Unsubscribe;
  /** Main made the window click-through on its own (watchdog): start over from "ignoring". */
  onClickThroughReset(cb: () => void): Unsubscribe;
  onDrawerMode(cb: (mode: DrawerMode) => void): Unsubscribe;
  addMessage(wsId: string, message: ChatMessage): void;

  /** Tells main what is on screen (tab and chat) so it does not notify about a chat you are reading. */
  setNotifyView(view: { tab: string; wsId: string | null; agentId: string | null }): void;
  /** Sends a test notification; `native` is whether the system one was shown (false: unavailable, blocked or rate-limited). */
  testNotify(): Promise<{ native: boolean }>;
  /** Main hid or showed the window (the renderer pauses the battle loop while hidden). */
  onWindowVisible(cb: (state: { visible: boolean }) => void): Unsubscribe;
  onNotify(cb: (note: NotifyEvent) => void): Unsubscribe;
  onNotifyOpen(cb: (target: NotifyTarget) => void): Unsubscribe;
}

declare global {
  interface Window {
    bar: Bar;
  }
}
