export interface Node {
  id: string;
  x: number;
  y: number;
  congestion: number; // 0 to 1
  isBlocked: boolean;
}

export function heuristic(a: Node, b: Node): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

export function aStar(
  startId: string,
  endId: string,
  nodes: Map<string, Node>,
  gridSize: number
): string[] | null {
  const start = nodes.get(startId);
  const end = nodes.get(endId);

  if (!start || !end) return null;

  const openSet: string[] = [startId];
  const cameFrom: Map<string, string> = new Map();

  const gScore: Map<string, number> = new Map();
  nodes.forEach((_, id) => gScore.set(id, Infinity));
  gScore.set(startId, 0);

  const fScore: Map<string, number> = new Map();
  nodes.forEach((_, id) => fScore.set(id, Infinity));
  fScore.set(startId, heuristic(start, end));

  while (openSet.length > 0) {
    // Get node in openSet with lowest fScore
    let currentId = openSet[0];
    let lowestF = fScore.get(currentId) || Infinity;
    let currentIndex = 0;

    for (let i = 1; i < openSet.length; i++) {
      const score = fScore.get(openSet[i]) || Infinity;
      if (score < lowestF) {
        lowestF = score;
        currentId = openSet[i];
        currentIndex = i;
      }
    }

    if (currentId === endId) {
      const path = [currentId];
      while (cameFrom.has(currentId)) {
        currentId = cameFrom.get(currentId)!;
        path.unshift(currentId);
      }
      return path;
    }

    openSet.splice(currentIndex, 1);
    const current = nodes.get(currentId)!;

    // Neighbors (Up, Down, Left, Right)
    const neighbors = [
      { x: current.x + 1, y: current.y },
      { x: current.x - 1, y: current.y },
      { x: current.x, y: current.y + 1 },
      { x: current.x, y: current.y - 1 },
    ]
      .filter((n) => n.x >= 0 && n.x < gridSize && n.y >= 0 && n.y < gridSize)
      .map((n) => `${n.x}-${n.y}`)
      .filter((id) => {
        const node = nodes.get(id);
        return node && !node.isBlocked;
      });

    for (const neighborId of neighbors) {
      const neighbor = nodes.get(neighborId)!;
      // Weight = 1 (distance) + congestion * 5 (penalty)
      const weight = 1 + neighbor.congestion * 5;
      const tentativeGScore = (gScore.get(currentId) || Infinity) + weight;

      if (tentativeGScore < (gScore.get(neighborId) || Infinity)) {
        cameFrom.set(neighborId, currentId);
        gScore.set(neighborId, tentativeGScore);
        fScore.set(neighborId, tentativeGScore + heuristic(neighbor, end));
        if (!openSet.includes(neighborId)) {
          openSet.push(neighborId);
        }
      }
    }
  }

  return null;
}
