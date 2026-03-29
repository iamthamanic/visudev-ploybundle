/** Rect in iframe viewport coordinates (getBoundingClientRect). */
export interface VisudevDomRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Nav item with path and rect for exact edge start position in App Flow. */
export interface VisudevNavItem {
  path: string;
  label?: string;
  rect: VisudevDomRect;
}

export interface VisudevDomElement {
  tagName: string;
  role?: string;
  label?: string;
  href?: string;
  selector?: string;
  testId?: string;
  visible: boolean;
  enabled: boolean;
  active?: boolean;
  open?: boolean;
  containerType?: "dialog" | "tablist" | "menu" | "listbox";
  rect?: VisudevDomRect;
}

export interface VisudevDomContainer {
  type: "dialog" | "tablist" | "tabpanel" | "menu" | "listbox" | "drawer";
  label?: string;
  selector?: string;
  testId?: string;
  visible: boolean;
  open?: boolean;
  active?: boolean;
  rect?: VisudevDomRect;
}

/** Payload sent by user app via postMessage for optional live DOM/route display. */
export interface VisudevDomReport {
  type: "visudev-dom-report";
  route: string;
  buttons?: { tagName: string; role?: string; label?: string }[];
  links?: { href: string; text?: string }[];
  interactiveElements?: VisudevDomElement[];
  containers?: VisudevDomContainer[];
  /** Nav/tab items with rects so App Flow can start edges at exact tab position. */
  navItems?: VisudevNavItem[];
}

export type NodeViewportMode = "fit-desktop" | "fit-mobile";

export interface AppFlowRecord extends Record<string, unknown> {
  flowId: string;
  projectId: string;
  createdAt?: string;
  updatedAt?: string;
}

export type AppFlowCreateInput = Omit<AppFlowRecord, "projectId" | "createdAt" | "updatedAt"> & {
  flowId?: string;
};

export type AppFlowUpdateInput = Partial<Omit<AppFlowRecord, "flowId" | "projectId" | "createdAt">>;
