/**
 * FlowEdgesLayer – SVG-Kanten und Klick-Hit-Targets für den Live Flow Graph.
 * Zeichnet Kanten zwischen Nodes und animierbaren Punkt; ref-Callback füllt pathRefs für Animation.
 * Location: src/modules/appflow/components/FlowEdgesLayer.tsx
 */

import type { GraphEdge } from "../layout";
import type { NodePosition } from "../layout";
import styles from "../styles/LiveFlowCanvas.module.css";

const NODE_WIDTH = 320;
/** Must match LiveFlowCanvas NODE_HEIGHT (card height for 320×240 iframe area). */
const NODE_HEIGHT = 296;

interface FlowEdgesLayerProps {
  edges: GraphEdge[];
  positions: Map<string, NodePosition>;
  maxX: number;
  maxY: number;
  pathRefs: React.MutableRefObject<Map<string, SVGPathElement>>;
  dotPosition: { x: number; y: number } | null;
  onEdgeClick: (edge: GraphEdge) => void;
}

export function FlowEdgesLayer({
  edges,
  positions,
  maxX,
  maxY,
  pathRefs,
  dotPosition,
  onEdgeClick,
}: FlowEdgesLayerProps): React.ReactElement {
  return (
    <>
      <svg className={styles.svgLayer} width={maxX} height={maxY} aria-hidden="true">
        <defs>
          <marker
            id="live-arrow-nav"
            markerWidth="8"
            markerHeight="8"
            refX="7"
            refY="4"
            orient="auto"
          >
            <polygon className={styles.arrowNav} points="0 0, 8 4, 0 8" />
          </marker>
          <marker
            id="live-arrow-call"
            markerWidth="8"
            markerHeight="8"
            refX="7"
            refY="4"
            orient="auto"
          >
            <polygon className={styles.arrowCall} points="0 0, 8 4, 0 8" />
          </marker>
        </defs>
        {edges.map((edge, i) => {
          const fromPos = positions.get(edge.fromId);
          const toPos = positions.get(edge.toId);
          if (!fromPos || !toPos) return null;
          const x1 = fromPos.x + NODE_WIDTH;
          const y1 = fromPos.y + NODE_HEIGHT / 2;
          const x2 = toPos.x;
          const y2 = toPos.y + NODE_HEIGHT / 2;
          const cpx = (x1 + x2) / 2;
          const pathD = `M ${x1} ${y1} C ${cpx} ${y1}, ${cpx} ${y2}, ${x2} ${y2}`;
          return (
            <path
              key={`${edge.fromId}-${edge.toId}-${i}`}
              id={`${edge.fromId}-${edge.toId}`}
              d={pathD}
              className={edge.type === "navigate" ? styles.edgeNav : styles.edgeCall}
              markerEnd={
                edge.type === "navigate" ? "url(#live-arrow-nav)" : "url(#live-arrow-call)"
              }
            />
          );
        })}
        {dotPosition && (
          <circle className={styles.dot} r={8} cx={dotPosition.x} cy={dotPosition.y} />
        )}
      </svg>
      <svg className={styles.svgHit} width={maxX} height={maxY} aria-hidden="true">
        {edges.map((edge, i) => {
          const fromPos = positions.get(edge.fromId);
          const toPos = positions.get(edge.toId);
          if (!fromPos || !toPos) return null;
          const x1 = fromPos.x + NODE_WIDTH;
          const y1 = fromPos.y + NODE_HEIGHT / 2;
          const x2 = toPos.x;
          const y2 = toPos.y + NODE_HEIGHT / 2;
          const cpx = (x1 + x2) / 2;
          const pathD = `M ${x1} ${y1} C ${cpx} ${y1}, ${cpx} ${y2}, ${x2} ${y2}`;
          const edgeKey = `${edge.fromId}-${edge.toId}`;
          return (
            <path
              key={`hit-${edge.fromId}-${edge.toId}-${i}`}
              ref={(el) => {
                if (el) pathRefs.current.set(edgeKey, el);
              }}
              d={pathD}
              className={styles.edgeHit}
              onClick={(e) => {
                e.stopPropagation();
                onEdgeClick(edge);
              }}
            />
          );
        })}
      </svg>
    </>
  );
}
