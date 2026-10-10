import type { MapData, MapObj } from "../game/mapdata";
import { edgesOf, newId, type Canvas, type GNode, type Graph } from "./story-graph";

export interface MapBinding { map: string; obj: MapObj; field: "text" | "bark"; value: string }

/** Explicitly select the interaction entry for this person on this map only. */
export function dialogueEntryBindings(canvas: Canvas, section: string, maps: MapData[], names: Record<string, string>): MapBinding[] {
  const scope = canvas.scope;
  if (!scope || !canvas.nodes.some((n) => n.type === "start" && n.sec === section)) return [];
  return (maps.find((m) => m.id === scope.map)?.objects ?? [])
    .filter((obj) => obj.type === "npc" && names[obj.kind ?? ""] === scope.person)
    .map((obj) => ({ map: scope.map, obj, field: "text", value: section }));
}

/** Split reachable dialogue into independent person/map canvases. Existing section
 * IDs survive in the first branch, so references from events keep working.
 * The caller saves the returned bindings together with the script and layout. */
export function syncMapCanvases(graph: Graph, maps: MapData[], names: Record<string, string>) {
  const bindings: MapBinding[] = [];
  let changed = false;
  const original = graph.canvases.slice();
  const owner = new Map<string, Canvas>();
  const nodes = new Map<string, GNode>();
  const sections = new Map<string, GNode>();
  for (const c of original) for (const n of c.nodes) {
    owner.set(n.id, c);
    nodes.set(n.id, n);
    if (n.sec) sections.set(n.sec, n);
  }
  const used = new Set(sections.keys());
  const freshSection = (base: string) => {
    let id = base, i = 2;
    while (used.has(id)) id = `${base}_${i++}`;
    used.add(id);
    return id;
  };
  const claimed = new Set<string>();
  const people = new Set(maps.flatMap((m) => m.objects.filter((o) => o.type === "npc").map((o) => names[o.kind ?? ""]).filter(Boolean)));
  for (const person of people) {
    const locations = maps.filter((m) => m.objects.some((o) => o.type === "npc" && names[o.kind ?? ""] === person));
    const sources = original.filter((c) => c.kind === "person" && (c.scope?.person ?? c.name) === person);
    for (const map of locations) {
      const npcs = map.objects.filter((o) => o.type === "npc" && names[o.kind ?? ""] === person);
      let branch = graph.canvases.find((c) => c.scope?.person === person && c.scope.map === map.id);
      if (!branch) {
        const base = `${person} · ${map.id}`;
        let name = base, i = 2;
        while (graph.canvases.some((c) => c.name === name)) name = `${base} · ${i++}`;
        branch = { name, kind: "person", scope: { person, map: map.id }, nodes: [] };
        graph.canvases.push(branch);
        changed = true;
      }
      const home = branch;
      const needsText = (obj: MapObj) => !sections.has(obj.text ?? "");
      const requests: { obj: MapObj; field: "text" | "bark"; root: GNode }[] = [];
      for (const obj of npcs) for (const field of ["text", "bark"] as const) {
        const root = sections.get(obj[field] ?? "");
        if (root && owner.get(root.id) !== home) requests.push({ obj, field, root });
      }
      // A newly placed, unbound NPC starts from this person's existing dialogue.
      const starts = sources.flatMap((c) => c.nodes).filter((n) => n.type === "start");
      const defaultRoot = starts.find((n) => maps.some((m) => m.objects.some((o) => o.type === "npc" && names[o.kind ?? ""] === person && o.text === n.sec))) ??
        starts.find((n) => !maps.some((m) => m.objects.some((o) => o.bark === n.sec)));
      for (const obj of npcs) if (needsText(obj) && defaultRoot && !home.nodes.some((n) => n.type === "start")) {
        requests.push({ obj, field: "text", root: defaultRoot });
      }
      const selected = new Map<string, GNode>();
      const allowed = new Set(requests.map((r) => owner.get(r.root.id)));
      for (const c of sources) allowed.add(c);
      const queue = requests.map((r) => r.root);
      while (queue.length) {
        const n = queue.pop()!;
        if (selected.has(n.id) || owner.get(n.id) === home) continue;
        selected.set(n.id, n);
        for (const e of edgesOf(n)) {
          const next = e.to && nodes.get(e.to);
          if (next) queue.push(next);
        }
        if (n.type === "jump" && n.target) {
          const next = sections.get(n.target);
          if (next && allowed.has(owner.get(next.id))) queue.push(next);
        }
      }
      const ids = new Map<string, string>(), secs = new Map<string, string>();
      for (const n of selected.values()) {
        const c = owner.get(n.id)!;
        const reuse = !c.scope && c.kind === "person" && c.name === person && !claimed.has(n.id);
        ids.set(n.id, reuse ? n.id : newId());
        if (n.sec) secs.set(n.sec, reuse ? n.sec : freshSection(`${n.sec}_${map.id}`));
        if (reuse) claimed.add(n.id);
      }
      for (const n of selected.values()) {
        const copy = structuredClone(n);
        copy.id = ids.get(n.id)!;
        if (n.sec) copy.sec = secs.get(n.sec);
        if (n.next) copy.next = ids.get(n.next) ?? n.next;
        if (n.yes) copy.yes = ids.get(n.yes) ?? n.yes;
        for (const opt of copy.options ?? []) if (opt.to) opt.to = ids.get(opt.to) ?? opt.to;
        if (n.target) copy.target = secs.get(n.target) ?? n.target;
        home.nodes.push(copy);
        changed = true;
      }
      for (const r of requests) {
        const value = secs.get(r.root.sec!)!;
        if (value !== r.obj[r.field]) bindings.push({ map: map.id, obj: r.obj, field: r.field, value });
      }
      // Keep a blank branch editable even if this person has no script yet.
      const textRequest = requests.find((r) => r.field === "text");
      const barkSections = new Set(npcs.map((o) => secs.get(o.bark ?? "") ?? o.bark));
      let entry = textRequest ? secs.get(textRequest.root.sec!) : home.nodes.find((n) => n.type === "start" &&
        !barkSections.has(n.sec))?.sec;
      if (!entry && npcs.some(needsText)) {
        entry = freshSection(`${npcs[0].kind ?? "talk"}_${map.id}`);
        home.nodes.push({ id: newId(), key: "", type: "start", sec: entry, title: "对话开始", x: 40, y: 40, placed: false, src: [] });
        changed = true;
      }
      if (entry) for (const obj of npcs) if (needsText(obj) && !requests.some((r) => r.obj === obj && r.field === "text")) {
        bindings.push({ map: map.id, obj, field: "text", value: entry });
      }
    }
  }
  if (!changed && !bindings.length) return { changed: false, bindings };
  const emptied = new Set<Canvas>();
  for (const c of original) {
    const hadNodes = c.nodes.length > 0;
    c.nodes = c.nodes.filter((n) => !claimed.has(n.id));
    if (hadNodes && !c.nodes.length && !c.scope) emptied.add(c);
  }
  graph.canvases = graph.canvases.filter((c) => !emptied.has(c));

  // Loose nodes left in the original canvas may still point into a moved branch.
  // Make those edges explicit cross-canvas jumps before serializing.
  const located = new Map(graph.canvases.flatMap((c) => c.nodes.map((n) => [n.id, { c, n }] as const)));
  for (const c of graph.canvases) for (const n of [...c.nodes]) {
    const ref = (id: string | null | undefined) => {
      const target = id && located.get(id);
      if (!target || target.c === c) return id;
      if (target.n.type === "end" || target.n.type === "jump") {
        const terminal = { ...structuredClone(target.n), id: newId(), key: "" };
        delete terminal.sec;
        c.nodes.push(terminal);
        return terminal.id;
      }
      target.n.sec ??= freshSection("map_part");
      const jump: GNode = { id: newId(), type: "jump", target: target.n.sec, key: "", x: n.x + 300, y: n.y, placed: false, src: [] };
      c.nodes.push(jump);
      return jump.id;
    };
    n.next = ref(n.next);
    n.yes = ref(n.yes);
    for (const opt of n.options ?? []) opt.to = ref(opt.to) ?? null;
  }
  return { changed: true, bindings };
}
