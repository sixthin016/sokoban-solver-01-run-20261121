// Sokoban solver — make.fun sokoban-solver-01-run-20261121.
//
// A level is a hallway with independent rooms off it: a box pushed out of a
// room through its door can never be pushed back, so the push-optimal total
// is the sum of the rooms' optima. This program solves each room on its own,
// push-optimally, with A* over pushes (a state is the boxes plus the
// player's reachable region), then stitches the rooms together with the
// player's walks along the hallway. Pure and deterministic: no clock, no
// randomness, fixed iteration orders, so two runs write the same bytes.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// [dx, dy, walk letter, push letter]
const DIRS = [
  [0, -1, 'u', 'U'],
  [0, 1, 'd', 'D'],
  [-1, 0, 'l', 'L'],
  [1, 0, 'r', 'R'],
];

type Grid = {
  w: number;
  h: number;
  wall: Uint8Array;
  goals: number[];
  boxes: number[];
  player: number;
};

function parse(text: string): Grid {
  const rows = text.split('\n').filter((r) => r.length > 0);
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const wall = new Uint8Array(w * h).fill(1);
  const goals: number[] = [];
  const boxes: number[] = [];
  let player = -1;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      const i = y * w + x;
      if (ch === '#') continue;
      wall[i] = 0;
      if (ch === '.' || ch === '*' || ch === '+') goals.push(i);
      if (ch === '$' || ch === '*') boxes.push(i);
      if (ch === '@' || ch === '+') player = i;
    }
  });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) wall[y * w + x] = 1;
    }
  }
  return { w, h, wall, goals, boxes: boxes.sort((a, b) => a - b), player };
}

// The rooms: connected components of floor off the hallway row (the row the
// player starts on). Each room opens onto the hallway through one door cell.
type Room = { cells: number[]; inRoom: Uint8Array; door: number; hall: number };

function roomsOf(g: Grid): Room[] {
  const hy = Math.floor(g.player / g.w);
  const seen = new Uint8Array(g.w * g.h);
  const rooms: Room[] = [];
  for (let i = 0; i < g.w * g.h; i++) {
    if (g.wall[i] || Math.floor(i / g.w) === hy || seen[i]) continue;
    const cells: number[] = [];
    const stack = [i];
    seen[i] = 1;
    while (stack.length > 0) {
      const c = stack.pop()!;
      cells.push(c);
      for (const [dx, dy] of DIRS) {
        const q = c + dy * g.w + dx;
        if (q < 0 || q >= g.w * g.h || g.wall[q] || Math.floor(q / g.w) === hy || seen[q]) continue;
        seen[q] = 1;
        stack.push(q);
      }
    }
    cells.sort((a, b) => a - b);
    const inRoom = new Uint8Array(g.w * g.h);
    for (const c of cells) inRoom[c] = 1;
    // A door is a room cell whose vertical neighbour on the hallway row is floor.
    let door = -1;
    let hall = -1;
    for (const c of cells) {
      for (const ny of [Math.floor(c / g.w) - 1, Math.floor(c / g.w) + 1]) {
        if (ny !== hy) continue;
        const hc = ny * g.w + (c % g.w);
        if (!g.wall[hc]) {
          door = c;
          hall = hc;
        }
      }
    }
    if (door >= 0) rooms.push({ cells, inRoom, door, hall });
  }
  rooms.sort((a, b) => a.door - b.door);
  return rooms;
}

// Squares from which a box can still be pushed onto some goal, by pulling
// boxes back from the goals over open floor (other boxes ignored). A box on
// any other square is dead: no push sequence saves it.
function liveCells(g: Grid, inRoom: Uint8Array, goals: number[]): Uint8Array {
  const live = new Uint8Array(g.w * g.h);
  const q = goals.slice();
  for (const x of goals) live[x] = 1;
  for (let i = 0; i < q.length; i++) {
    const x = q[i]!;
    for (const [dx, dy] of DIRS) {
      const d = dy * g.w + dx;
      const y = x - d; // the box would be pulled from y onto x
      const s = y - d; // the player must stand on s to pull it
      if (inRoom[y] && inRoom[s] && !live[y]) {
        live[y] = 1;
        q.push(y);
      }
    }
  }
  return live;
}

// Walking distances from each goal over the room's floor (walls only).
function goalDistances(g: Grid, inRoom: Uint8Array, goals: number[]): Int32Array[] {
  return goals.map((goal) => {
    const dist = new Int32Array(g.w * g.h).fill(-1);
    const q = [goal];
    dist[goal] = 0;
    for (let i = 0; i < q.length; i++) {
      const c = q[i]!;
      for (const [dx, dy] of DIRS) {
        const n = c + dy * g.w + dx;
        if (inRoom[n] && dist[n] < 0) {
          dist[n] = dist[c]! + 1;
          q.push(n);
        }
      }
    }
    return dist;
  });
}

// Fewest pushes still needed, at least: the cheapest way to match every box
// to a distinct goal by walking distance. Each push moves one box one square,
// so this never overestimates — A* with it stays push-optimal.
function heuristic(boxes: number[], dists: Int32Array[]): number {
  const n = boxes.length;
  const m = dists.length;
  if (n === 0) return 0;
  if (n > m) return Infinity;
  // Cost matrix box i -> goal j; Infinity where unreachable.
  const cost: number[][] = boxes.map((b) => dists.map((d) => (d[b]! < 0 ? Infinity : d[b]!)));
  if (n <= 5) {
    let best = Infinity;
    const used = new Array(m).fill(false);
    const go = (i: number, sum: number): void => {
      if (sum >= best) return;
      if (i === n) {
        best = sum;
        return;
      }
      for (let j = 0; j < m; j++) {
        if (used[j] || cost[i]![j] === Infinity) continue;
        used[j] = true;
        go(i + 1, sum + cost[i]![j]!);
        used[j] = false;
      }
    };
    go(0, 0);
    return best;
  }
  // Many boxes: the sum of each box's nearest goal (weaker, still admissible).
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const row = cost[i]!;
    let mn = Infinity;
    for (let j = 0; j < m; j++) if (row[j]! < mn) mn = row[j]!;
    if (mn === Infinity) return Infinity;
    sum += mn;
  }
  return sum;
}

// A frozen 2x2 block (walls and boxes only, a box among them off its goal)
// can never be undone. Only blocks holding the box just pushed can be new.
function frozenAt(
  g: Grid,
  occupied: Uint8Array,
  goalSet: Uint8Array,
  t: number,
): boolean {
  const tx = t % g.w;
  const ty = Math.floor(t / g.w);
  for (const [ox, oy] of [
    [0, 0],
    [-1, 0],
    [0, -1],
    [-1, -1],
  ]) {
    const x0 = tx + ox;
    const y0 = ty + oy;
    if (x0 < 0 || y0 < 0 || x0 + 1 >= g.w || y0 + 1 >= g.h) continue;
    let boxOff = false;
    let allFull = true;
    for (let yy = y0; yy <= y0 + 1; yy++) {
      for (let xx = x0; xx <= x0 + 1; xx++) {
        const c = yy * g.w + xx;
        if (occupied[c]) {
          if (!goalSet[c]) boxOff = true;
        } else if (!g.wall[c]) {
          allFull = false;
        }
      }
    }
    if (allFull && boxOff) return true;
  }
  return false;
}

type Push = { from: number; dir: number };

// Push-optimal A* over one room (player starts on its door cell). Returns the
// pushes in order, or null. `greedy` orders by the estimate alone: not
// optimal, but a fallback that still finds a solution when A* runs out of
// budget. Budgets count expansions, never the clock, so runs are identical.
function searchRoom(
  g: Grid,
  room: Room,
  boxes0: number[],
  goals: number[],
  budget: number,
  greedy: boolean,
): Push[] | null {
  const { w } = g;
  const { inRoom } = room;
  // The board the player walks on: the room plus the hallway square outside
  // its door (a box can sit on the door itself, and the first push then
  // shoves it back inside from out here). Boxes themselves never leave the
  // room: their targets stay inside it.
  const inBoard = inRoom.slice();
  inBoard[room.hall] = 1;
  const goalSet = new Uint8Array(w * g.h);
  for (const x of goals) goalSet[x] = 1;
  const live = liveCells(g, inBoard, goals);
  const dists = goalDistances(g, inBoard, goals);
  const solved = (bs: number[]): boolean => bs.every((b) => goalSet[b] === 1);

  // The player's reachable region from `from` around `occupied` boxes:
  // its cells and its lowest square. A fresh list per call: a later call
  // must not disturb the region an earlier one returned.
  const regionMark = new Uint32Array(w * g.h);
  let stamp = 0;
  const region = (from: number, occupied: Uint8Array): { low: number; cells: number[] } => {
    stamp++;
    let low = from;
    const cells = [from];
    regionMark[from] = stamp;
    for (let i = 0; i < cells.length; i++) {
      const p = cells[i]!;
      if (p < low) low = p;
      for (const [dx, dy] of DIRS) {
        const q = p + dy * w + dx;
        if (inBoard[q] && !occupied[q] && regionMark[q] !== stamp) {
          regionMark[q] = stamp;
          cells.push(q);
        }
      }
    }
    return { low, cells };
  };

  const sBoxes: number[][] = [boxes0.slice().sort((a, b) => a - b)];
  const sPlayer: number[] = [room.hall];
  const sParent: number[] = [-1];
  const sFrom: number[] = [-1];
  const sDir: number[] = [-1];
  const sG: number[] = [0];
  const best = new Map<string, number>();
  const keyOf = (bs: number[], low: number): string => bs.join(',') + '|' + low;

  // Binary heap on [f, sequence, state], smallest first; the sequence breaks
  // ties in insertion order, so the search is fully deterministic.
  const heap: [number, number, number][] = [];
  let seq = 0;
  const heapLess = (a: [number, number, number], b: [number, number, number]): boolean =>
    a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
  const heapPush = (e: [number, number, number]): void => {
    let i = heap.length;
    heap.push(e);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!heapLess(heap[i]!, heap[p]!)) break;
      const tmp = heap[i]!;
      heap[i] = heap[p]!;
      heap[p] = tmp;
      i = p;
    }
  };
  const heapPop = (): [number, number, number] => {
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      for (let i = 0; ; ) {
        let c = 2 * i + 1;
        if (c >= heap.length) break;
        if (c + 1 < heap.length && heapLess(heap[c + 1]!, heap[c]!)) c++;
        if (!heapLess(heap[c]!, heap[i]!)) break;
        const tmp = heap[i]!;
        heap[i] = heap[c]!;
        heap[c] = tmp;
        i = c;
      }
    }
    return top;
  };

  const h0 = heuristic(sBoxes[0]!, dists);
  if (h0 === Infinity) return null;
  best.set(keyOf(sBoxes[0]!, region(room.hall, (() => {
    const o = new Uint8Array(w * g.h);
    for (const b of sBoxes[0]!) o[b] = 1;
    return o;
  })()).low), 0);
  heapPush([greedy ? h0 : h0, seq++, 0]);

  let expanded = 0;
  while (heap.length > 0) {
    const [, , s] = heapPop();
    const bs = sBoxes[s]!;
    const player = sPlayer[s]!;
    const gg = sG[s]!;
    const occupied = new Uint8Array(w * g.h);
    for (const b of bs) occupied[b] = 1;
    const reg = region(player, occupied);
    const low = reg.low;
    const inRegion = new Uint8Array(w * g.h);
    for (const c of reg.cells) inRegion[c] = 1;
    if (best.get(keyOf(bs, low)) !== s) continue;
    if (solved(bs)) {
      const pushes: Push[] = [];
      for (let t = s; t > 0; t = sParent[t]!) pushes.push({ from: sFrom[t]!, dir: sDir[t]! });
      pushes.reverse();
      return pushes;
    }
    if (++expanded > budget) return null;
    for (let bi = 0; bi < bs.length; bi++) {
      const b = bs[bi]!;
      for (let k = 0; k < 4; k++) {
        const [dx, dy] = DIRS[k]!;
        const d = dy * w + dx;
        const stance = b - d;
        const target = b + d;
        if (!inRoom[target] || occupied[target]) continue;
        if (!inBoard[stance] || occupied[stance] || !inRegion[stance]) continue;
        if (!live[target] && !goalSet[target]) continue;
        const nb = bs.slice();
        nb[bi] = target;
        nb.sort((a, b2) => a - b2);
        const nOccupied = new Uint8Array(w * g.h);
        for (const x of nb) nOccupied[x] = 1;
        if (frozenAt(g, nOccupied, goalSet, target)) continue;
        const nLow = region(b, nOccupied).low;
        const key = keyOf(nb, nLow);
        const seenState = best.get(key);
        if (seenState !== undefined && sG[seenState]! <= gg + 1) continue;
        const h = heuristic(nb, dists);
        if (h === Infinity) continue;
        const t = sBoxes.length;
        sBoxes.push(nb);
        sPlayer.push(b);
        sParent.push(s);
        sFrom.push(b);
        sDir.push(k);
        sG.push(gg + 1);
        best.set(key, t);
        heapPush([greedy ? h : gg + 1 + h, seq++, t]);
      }
    }
  }
  return null;
}

// Solve one room push-optimally (A* first, greedy fallback on a budget).
function solveRoomPushes(g: Grid, room: Room, boxes: number[], goals: number[]): Push[] | null {
  if (boxes.every((b) => goals.includes(b))) return [];
  const optimal = searchRoom(g, room, boxes, goals, 300_000, false);
  if (optimal !== null) return optimal;
  return searchRoom(g, room, boxes, goals, 300_000, true);
}

// The player's shortest walk from `from` to `to` around walls and `boxes`
// (boxes never move on a walk), as move letters, or null. Fixed neighbour
// order keeps it deterministic.
function walkPath(g: Grid, boxes: number[], from: number, to: number): string | null {
  if (from === to) return '';
  const occupied = new Uint8Array(g.w * g.h);
  for (const b of boxes) occupied[b] = 1;
  const prev = new Int32Array(g.w * g.h).fill(-2);
  const prevDir = new Int8Array(g.w * g.h);
  prev[from] = -1;
  const q = [from];
  for (let i = 0; i < q.length; i++) {
    const c = q[i]!;
    for (let k = 0; k < 4; k++) {
      const [dx, dy] = DIRS[k]!;
      const n = c + dy * g.w + dx;
      if (g.wall[n] || occupied[n] || prev[n] !== -2) continue;
      prev[n] = c;
      prevDir[n] = k;
      if (n === to) {
        let out = '';
        for (let t = n; t !== from; t = prev[t]!) out = DIRS[prevDir[t]!]![2] + out;
        return out;
      }
      q.push(n);
    }
  }
  return null;
}

function solveLevel(text: string): string {
  const g = parse(text);
  const rooms = roomsOf(g);
  // The rooms that still need work, in door order.
  const todo = rooms.filter((room) => {
    const bs = g.boxes.filter((b) => room.inRoom[b]);
    const gs = g.goals.filter((x) => room.inRoom[x]);
    return bs.length > 0 && !bs.every((b) => gs.includes(b));
  });
  let moves = '';
  let player = g.player;
  const boxes = g.boxes.slice();
  for (let ri = 0; ri < todo.length; ri++) {
    const room = todo[ri]!;
    const rBoxes = boxes.filter((b) => room.inRoom[b]);
    const rGoals = g.goals.filter((x) => room.inRoom[x]);
    const pushes = solveRoomPushes(g, room, rBoxes, rGoals);
    if (pushes === null) return '';
    // Play the room's pushes, walking between them. The walks route the
    // player in through the door, out again and along the hallway to the
    // next room on their own: a box can sit on the door itself, so the
    // first push may start from the hallway square outside it.
    for (const p of pushes) {
      const [dx, dy2] = DIRS[p.dir]!;
      const d = dy2 * g.w + dx;
      const stance = p.from - d;
      const path = walkPath(g, boxes, player, stance);
      if (path === null) return '';
      moves += path;
      player = stance;
      moves += DIRS[p.dir]![3];
      const at = boxes.indexOf(p.from);
      boxes[at] = p.from + d;
      player = p.from;
    }
  }
  return moves;
}

for (const id of readdirSync(I).sort()) {
  const moves = solveLevel(readFileSync(join(I, id, 'level.txt'), 'utf8'));
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'solution.txt'), `${moves}\n`);
}
