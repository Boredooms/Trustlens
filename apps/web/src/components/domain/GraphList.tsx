import type { EntitySummary, Graph } from "@/lib/api/types";
import { humanise, percent } from "@/lib/format";
import { cn } from "@/lib/utils/cn";

// DESIGN_SYSTEM.md §7.9 — node colour by type, edge confidence in two channels (opacity + dash).
const NODE_SWATCH: Record<string, string> = {
  domain: "border-node-domain",
  url: "border-node-domain",
  ip: "border-node-ip",
  asn: "border-node-ip",
  nameserver: "border-node-ip",
  certificate: "border-node-cert",
  certificate_authority: "border-node-cert",
  payment_recipient: "border-node-payee",
  organisation: "border-node-org",
};

// 1.5px ring matches the node border in DESIGN_SYSTEM.md §7.9.
export function NodeSwatch({ type }: { type: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block h-3 w-3 shrink-0 rounded-full border-[1.5px] bg-surface", NODE_SWATCH[type] ?? "border-border-strong")}
    />
  );
}

function EdgeSample({ strong }: { strong: boolean }) {
  return (
    <svg aria-hidden width="28" height="6" className="shrink-0">
      <line
        x1="0"
        y1="3"
        x2="28"
        y2="3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeDasharray={strong ? undefined : "3 3"}
        opacity={strong ? 1 : 0.45}
      />
    </svg>
  );
}

export interface GraphLegendProps {
  nodeTypes: string[];
  edgeTypes: string[];
}

/** Always visible: names every node type and edge type present, and the confidence encoding. */
export function GraphLegend({ nodeTypes, edgeTypes }: GraphLegendProps) {
  return (
    <div className="flex flex-col gap-3 text-xs">
      <div>
        <p className="label-eyebrow">Nodes</p>
        <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
          {nodeTypes.map((t) => (
            <li key={t} className="flex items-center gap-1.5">
              <NodeSwatch type={t} />
              {humanise(t)}
            </li>
          ))}
        </ul>
      </div>
      <div>
        <p className="label-eyebrow">Edges</p>
        <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 font-mono">
          {edgeTypes.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-muted-strong">
          <li className="flex items-center gap-1.5">
            <EdgeSample strong /> confidence ≥ 50%
          </li>
          <li className="flex items-center gap-1.5">
            <EdgeSample strong={false} /> confidence &lt; 50% (dashed, faded)
          </li>
        </ul>
      </div>
    </div>
  );
}

export interface GraphListViewProps {
  graph: Graph;
  onSelectNode?: (node: EntitySummary) => void;
}

/** Accessible, keyboard-navigable alternative to a graph canvas: every edge as a row. */
export function GraphListView({ graph, onSelectNode }: GraphListViewProps) {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const strongest = graph.edges.slice().sort((a, b) => b.confidence - a.confidence)[0];
  const nodeTypes = [...new Set(graph.nodes.map((n) => n.type))];
  const edgeTypes = [...new Set(graph.edges.map((e) => e.type))];
  const label = (id: string) => byId.get(id)?.label ?? id;

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted-strong">
        {graph.counts?.nodes ?? graph.nodes.length} nodes, {graph.counts?.edges ?? graph.edges.length} edges
        {strongest
          ? `; strongest link: ${humanise(strongest.type).toLowerCase()} ${percent(strongest.confidence)}`
          : ""}
        .{graph.truncated ? " The neighbourhood was truncated at the node limit." : ""}
      </p>
      <GraphLegend nodeTypes={nodeTypes} edgeTypes={edgeTypes} />
      {graph.edges.length === 0 ? (
        <p className="text-sm text-muted">No relationships above the confidence threshold.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Relationships in this neighbourhood</caption>
            <thead>
              <tr>
                <th scope="col" className="border-b border-border bg-surface-secondary px-4 py-2 text-xs font-medium text-muted">
                  From
                </th>
                <th scope="col" className="border-b border-border bg-surface-secondary px-4 py-2 text-xs font-medium text-muted">
                  Relationship
                </th>
                <th scope="col" className="border-b border-border bg-surface-secondary px-4 py-2 text-xs font-medium text-muted">
                  To
                </th>
                <th scope="col" className="border-b border-border bg-surface-secondary px-4 py-2 text-right text-xs font-medium text-muted">
                  Confidence
                </th>
              </tr>
            </thead>
            <tbody>
              {graph.edges.map((e, i) => {
                const from = byId.get(e.source);
                const to = byId.get(e.target);
                return (
                  <tr key={e.id ?? i} className={cn(e.confidence < 0.5 && "text-muted-strong")}>
                    <td className="row-density border-b border-border px-4">
                      <NodeCell node={from} fallback={label(e.source)} onSelect={onSelectNode} />
                    </td>
                    <td className="row-density border-b border-border px-4 font-mono text-xs">
                      {e.type}
                      {e.confidence < 0.5 ? <span className="ml-1 font-sans text-muted">(weak)</span> : null}
                    </td>
                    <td className="row-density border-b border-border px-4">
                      <NodeCell node={to} fallback={label(e.target)} onSelect={onSelectNode} />
                    </td>
                    <td className="row-density border-b border-border px-4 text-right font-mono tabular text-xs">
                      {percent(e.confidence)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function NodeCell({
  node,
  fallback,
  onSelect,
}: {
  node: EntitySummary | undefined;
  fallback: string;
  onSelect?: (n: EntitySummary) => void;
}) {
  if (!node) return <span className="font-mono text-xs">{fallback}</span>;
  const inner = (
    <>
      <NodeSwatch type={node.type} />
      <span className="break-all font-mono text-xs">{node.label}</span>
    </>
  );
  if (!onSelect) return <span className="flex items-center gap-2">{inner}</span>;
  return (
    <button
      type="button"
      onClick={() => onSelect(node)}
      className="flex items-center gap-2 rounded-sm text-left hover:underline"
      title={`Set ${node.label} as root`}
    >
      {inner}
    </button>
  );
}
