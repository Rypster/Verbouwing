export const SEARCH_BOX_LONG = 40;  
export const SEARCH_BOX_SHORT = 10; 

export function dist(x1, y1, x2, y2) {
  return Math.sqrt((x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1));
}

export function fmtComma(n, decimals = 2) {
  if (n === null || n === undefined || isNaN(n) || n === '') return '';
  return Number(n).toFixed(decimals).replace('.', ',');
}

export function parseInputNumber(val) {
  if (val === null || val === undefined) return 0;
  const normalized = String(val).replace(',', '.');
  const parsed = parseFloat(normalized);
  return isNaN(parsed) ? 0 : parsed;
}

export function normalizeInputString(str) {
  if (typeof str !== 'string') return str;
  return str.replace('.', ',');
}

export function allWallEndpoints(walls) {
  const pts = [];
  walls.forEach((w) => {
    pts.push({ x: w.x1, y: w.y1 });
    pts.push({ x: w.x2, y: w.y2 });
  });
  return pts;
}

export function snapToEndpoint(pt, walls, zoom) {
  const threshold = 16 / zoom;
  const pts = allWallEndpoints(walls);
  for (let i = 0; i < pts.length; i++) {
    if (dist(pt.x, pt.y, pts[i].x, pts[i].y) < threshold) {
      return { x: pts[i].x, y: pts[i].y };
    }
  }
  return pt;
}

export function magneticSnap(rawPt, backgrounds, bgPixelCache, magneticOn, isDrawingHorizontal, isDrawingVertical) {
  if (!magneticOn) return { pt: rawPt, isSnapped: false };

  for (let i = 0; i < backgrounds.length; i++) {
    const bg = backgrounds[i];
    if (rawPt.x < bg.x || rawPt.x > bg.x + bg.width || rawPt.y < bg.y || rawPt.y > bg.y + bg.height) continue;
    const cache = bgPixelCache[bg.id];
    if (!cache || !cache.data) continue;

    const scaleX = cache.natW / bg.width;
    const scaleY = cache.natH / bg.height;

    let boxWidth = SEARCH_BOX_LONG;
    let boxHeight = SEARCH_BOX_LONG;

    if (isDrawingHorizontal) {
      boxWidth = SEARCH_BOX_LONG;   
      boxHeight = SEARCH_BOX_SHORT; 
    } else if (isDrawingVertical) {
      boxWidth = SEARCH_BOX_SHORT; 
      boxHeight = SEARCH_BOX_LONG;  
    }

    const localX = Math.round((rawPt.x - bg.x) * scaleX);
    const localY = Math.round((rawPt.y - bg.y) * scaleY);

    const radX = Math.round((boxWidth / 2) * scaleX);
    const radY = Math.round((boxHeight / 2) * scaleY);

    const getLum = (lx, ly) => {
      if (lx < 0 || lx >= cache.natW || ly < 0 || ly >= cache.natH) return 255;
      const idx = (ly * cache.natW + lx) * 4;
      return 0.299 * cache.data[idx] + 0.587 * cache.data[idx + 1] + 0.114 * cache.data[idx + 2];
    };

    let pt = { ...rawPt };
    let isSnapped = false;

    if (isDrawingHorizontal) {
      let sumX = 0, weightX = 0;
      for (let dx = -radX; dx <= radX; dx++) {
        const px = localX + dx;
        for (let dy = -radY; dy <= radY; dy += 2) {
          const py = localY + dy;
          const lum = getLum(px, py);
          if (lum < 130) {
            const w = 255 - lum;
            sumX += px * w;
            weightX += w;
          }
        }
      }

      if (weightX > 40) {
        const snappedLocalX = sumX / weightX;
        pt.x = bg.x + snappedLocalX / scaleX;
        isSnapped = true;
      }
    } else if (isDrawingVertical) {
      let sumY = 0, weightY = 0;
      for (let dy = -radY; dy <= radY; dy++) {
        const py = localY + dy;
        for (let dx = -radX; dx <= radX; dx += 2) {
          const px = localX + dx;
          const lum = getLum(px, py);
          if (lum < 130) {
            const w = 255 - lum;
            sumY += py * w;
            weightY += w;
          }
        }
      }

      if (weightY > 40) {
        const snappedLocalY = sumY / weightY;
        pt.y = bg.y + snappedLocalY / scaleY;
        isSnapped = true;
      }
    }

    return { pt, isSnapped };
  }

  return { pt: rawPt, isSnapped: false };
}

export function snapToWallEdge(pt, walls, zoom, isDrawingHorizontal, isDrawingVertical) {
  let snappedPt = { ...pt };
  let minDistance = (SEARCH_BOX_LONG / 2) / zoom;
  let didSnap = false;

  walls.forEach((w) => {
    const wallThick = w.thickness || 12;
    const halfThick = wallThick / 2;

    const isWallHorizontal = Math.abs(w.y2 - w.y1) < 0.1;
    const isWallVertical = Math.abs(w.x2 - w.x1) < 0.1;

    if (isDrawingHorizontal && isWallVertical) {
      const minY = Math.min(w.y1, w.y2) - halfThick;
      const maxY = Math.max(w.y1, w.y2) + halfThick;
      if (pt.y >= minY && pt.y <= maxY) {
        const targets = [w.x1 - halfThick, w.x1, w.x1 + halfThick];
        targets.forEach((targetX) => {
          const d = Math.abs(pt.x - targetX);
          if (d < minDistance) {
            snappedPt.x = targetX;
            minDistance = d;
            didSnap = true;
          }
        });
      }
    }

    if (isDrawingVertical && isWallHorizontal) {
      const minX = Math.min(w.x1, w.x2) - halfThick;
      const maxX = Math.max(w.x1, w.x2) + halfThick;
      if (pt.x >= minX && pt.x <= maxX) {
        const targets = [w.y1 - halfThick, w.y1, w.y1 + halfThick];
        targets.forEach((targetY) => {
          const d = Math.abs(pt.y - targetY);
          if (d < minDistance) {
            snappedPt.y = targetY;
            minDistance = d;
            didSnap = true;
          }
        });
      }
    }
  });

  return { pt: snappedPt, isSnapped: didSnap };
}

export function applyOrthoAndSnap(rawPt, mode, drawPoints, walls, zoom, backgrounds, bgPixelCache, magneticOn) {
  let isDrawingHorizontal = false;
  let isDrawingVertical = false;

  if ((mode === 'wall' || mode === 'zone' || mode === 'cut') && drawPoints.length > 0) {
    const prev = drawPoints[drawPoints.length - 1];
    const dx = Math.abs(rawPt.x - prev.x);
    const dy = Math.abs(rawPt.y - prev.y);

    if (dx >= dy) isDrawingHorizontal = true;
    else isDrawingVertical = true;
  }

  const magRes = magneticSnap(rawPt, backgrounds, bgPixelCache, magneticOn, isDrawingHorizontal, isDrawingVertical);
  let pt = magRes.pt;
  let isSnapped = magRes.isSnapped;

  const edgeRes = snapToWallEdge(pt, walls, zoom, isDrawingHorizontal, isDrawingVertical);
  if (edgeRes.isSnapped) {
    pt = edgeRes.pt;
    isSnapped = true;
  }

  const endPt = snapToEndpoint(pt, walls, zoom);
  if (dist(pt.x, pt.y, endPt.x, endPt.y) < 16 / zoom) {
    pt = endPt;
    isSnapped = true;
  }

  if ((mode === 'wall' || mode === 'zone' || mode === 'cut') && drawPoints.length > 0) {
    const prev = drawPoints[drawPoints.length - 1];
    if (isDrawingHorizontal) {
      pt.y = prev.y;
    } else if (isDrawingVertical) {
      pt.x = prev.x;
    }
  }

  return { pt, isSnapped };
}

export function tryMergeWall(newWall, walls) {
  const eps = 0.5;
  for (let i = 0; i < walls.length; i++) {
    const w = walls[i];
    const isWCollinear = Math.abs((w.x2 - w.x1) * (newWall.y2 - newWall.y1) - (w.y2 - w.y1) * (newWall.x2 - newWall.x1)) < eps;
    const isNewCollinear = Math.abs((newWall.x2 - newWall.x1) * (w.y2 - w.y1) - (newWall.y2 - newWall.y1) * (w.x2 - w.x1)) < eps;

    if (isWCollinear && isNewCollinear && w.type === newWall.type) {
      if (dist(w.x2, w.y2, newWall.x1, newWall.y1) < eps) { w.x2 = newWall.x2; w.y2 = newWall.y2; return true; }
      if (dist(w.x1, w.y1, newWall.x2, newWall.y2) < eps) { w.x1 = newWall.x1; w.y1 = newWall.y1; return true; }
      if (dist(w.x1, w.y1, newWall.x1, newWall.y1) < eps) { w.x1 = newWall.x2; w.y1 = newWall.y2; return true; }
      if (dist(w.x2, w.y2, newWall.x2, newWall.y2) < eps) { w.x2 = newWall.x1; w.y2 = newWall.y1; return true; }
    }
  }
  return false;
}

export function splitIntersectedWalls(newWall, walls, uid) {
  const eps = 0.5;
  const checkPts = [
    { x: newWall.x1, y: newWall.y1 },
    { x: newWall.x2, y: newWall.y2 }
  ];

  for (let p of checkPts) {
    for (let i = 0; i < walls.length; i++) {
      const w = walls[i];
      if (w.id === newWall.id) continue;

      const isHorizontal = Math.abs(w.y1 - w.y2) < eps;
      const isVertical = Math.abs(w.x1 - w.x2) < eps;

      if (isHorizontal) {
        const minX = Math.min(w.x1, w.x2);
        const maxX = Math.max(w.x1, w.x2);

        if (Math.abs(p.y - w.y1) < eps && p.x > minX + eps && p.x < maxX - eps) {
          const originalX2 = w.x2;
          const originalY2 = w.y2;

          w.x2 = p.x;
          w.y2 = p.y;

          const secondHalf = {
            ...w,
            id: uid(),
            x1: p.x, y1: p.y,
            x2: originalX2, y2: originalY2,
            openings: []
          };
          walls.push(secondHalf);
          break;
        }
      } else if (isVertical) {
        const minY = Math.min(w.y1, w.y2);
        const maxY = Math.max(w.y1, w.y2);

        if (Math.abs(p.x - w.x1) < eps && p.y > minY + eps && p.y < maxY - eps) {
          const originalX2 = w.x2;
          const originalY2 = w.y2;

          w.x2 = p.x;
          w.y2 = p.y;

          const secondHalf = {
            ...w,
            id: uid(),
            x1: p.x, y1: p.y,
            x2: originalX2, y2: originalY2,
            openings: []
          };
          walls.push(secondHalf);
          break;
        }
      }
    }
  }
}

export function pointInPoly(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const intersect = ((yi > pt.y) !== (yj > pt.y)) &&
      (pt.x < (xj - xi) * (pt.y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

export function findRoomAtPoint(pt, walls) {
  if (!walls || walls.length === 0) return null;

  // Ruimere tolerantie: eindpunten die dicht bij elkaar liggen worden samengevoegd.
  // 4 was te streng; kleine teken-/snap-afwijkingen braken dan hele kamers.
  const eps = 12.0;

  // ── 1. Alle eindpunten verzamelen ──────────────────────────────────────
  const rawPts = [];
  walls.forEach((w) => {
    if (Math.hypot(w.x2 - w.x1, w.y2 - w.y1) < 1) return;
    rawPts.push({ x: w.x1, y: w.y1 });
    rawPts.push({ x: w.x2, y: w.y2 });
  });
  if (rawPts.length < 3) return null;

  // ── 2. Vertex-clustering met union-find (order-onafhankelijk) ──────────
  const parent = rawPts.map((_, i) => i);
  function find(i) {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  }
  function unite(a, b) {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }

  for (let i = 0; i < rawPts.length; i++) {
    for (let j = i + 1; j < rawPts.length; j++) {
      if (Math.hypot(rawPts[i].x - rawPts[j].x, rawPts[i].y - rawPts[j].y) < eps) {
        unite(i, j);
      }
    }
  }

  // Representatieve vertex per cluster = gemiddelde van de punten in de cluster
  const clusterSum = new Map();
  rawPts.forEach((p, i) => {
    const r = find(i);
    if (!clusterSum.has(r)) clusterSum.set(r, { x: 0, y: 0, count: 0 });
    const s = clusterSum.get(r);
    s.x += p.x;
    s.y += p.y;
    s.count += 1;
  });

  const rootToIdx = new Map();
  const vertices = [];
  clusterSum.forEach((s, root) => {
    rootToIdx.set(root, vertices.length);
    vertices.push({ x: s.x / s.count, y: s.y / s.count });
  });

  function getVertexIdx(p) {
    let best = -1;
    let bestD = eps;
    for (let i = 0; i < rawPts.length; i++) {
      const d = Math.hypot(rawPts[i].x - p.x, rawPts[i].y - p.y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best === -1) return -1;
    return rootToIdx.get(find(best));
  }

  // ── 3. Half-edges opbouwen ─────────────────────────────────────────────
  const edges = [];
  walls.forEach((w) => {
    if (Math.hypot(w.x2 - w.x1, w.y2 - w.y1) < 1) return;
    const u = getVertexIdx({ x: w.x1, y: w.y1 });
    const v = getVertexIdx({ x: w.x2, y: w.y2 });
    if (u < 0 || v < 0 || u === v) return;

    const angleUV = Math.atan2(vertices[v].y - vertices[u].y, vertices[v].x - vertices[u].x);
    const angleVU = Math.atan2(vertices[u].y - vertices[v].y, vertices[u].x - vertices[v].x);

    edges.push({ u, v, angle: angleUV, twinIdx: -1, next: null });
    edges.push({ u: v, v: u, angle: angleVU, twinIdx: -1, next: null });
  });

  if (edges.length === 0) return null;

  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      if (edges[i].u === edges[j].v && edges[i].v === edges[j].u) {
        edges[i].twinIdx = j;
        edges[j].twinIdx = i;
      }
    }
  }

  const outgoing = Array.from({ length: vertices.length }, () => []);
  edges.forEach((e, idx) => {
    outgoing[e.u].push(idx);
  });
  outgoing.forEach((eIndices) => {
    eIndices.sort((a, b) => edges[a].angle - edges[b].angle);
  });

  for (let u = 0; u < vertices.length; u++) {
    const outList = outgoing[u];
    for (let i = 0; i < outList.length; i++) {
      const eIdx = outList[i];
      const twinIdx = edges[eIdx].twinIdx;
      if (twinIdx === -1) continue;

      const v = edges[eIdx].v;
      const vOutList = outgoing[v];
      const twinPos = vOutList.indexOf(twinIdx);
      if (twinPos !== -1) {
        const nextEdgeIdx = vOutList[(twinPos - 1 + vOutList.length) % vOutList.length];
        edges[eIdx].next = nextEdgeIdx;
      }
    }
  }

  // ── 4. Faces (cycli) zoeken ────────────────────────────────────────────
  const faces = [];
  const visited = new Set();

  edges.forEach((e, startIdx) => {
    if (visited.has(startIdx) || e.next === null) return;

    const cycle = [];
    let curr = startIdx;
    let valid = true;

    while (!visited.has(curr)) {
      visited.add(curr);
      cycle.push(curr);
      curr = edges[curr].next;
      if (curr === null || cycle.length > edges.length) {
        valid = false;
        break;
      }
    }

    if (valid && curr === startIdx && cycle.length >= 3) {
      const poly = cycle.map((eIdx) => vertices[edges[eIdx].u]);

      let area = 0;
      for (let i = 0; i < poly.length; i++) {
        const j = (i + 1) % poly.length;
        area += poly[i].x * poly[j].y - poly[j].x * poly[i].y;
      }
      area = area / 2;

      // Negeer microscopische faces; kleinste face die pt bevat = de kamer
      if (Math.abs(area) > 50) {
        if (pointInPoly(pt, poly)) {
          faces.push({ poly, absArea: Math.abs(area) });
        }
      }
    }
  });

  if (faces.length === 0) return null;

  faces.sort((a, b) => a.absArea - b.absArea);
  return faces[0].poly;
}

export function lineIntersection(p1, p2, p3, p4) {
  const denom = (p4.y - p3.y) * (p2.x - p1.x) - (p4.x - p3.x) * (p2.y - p1.y);
  if (Math.abs(denom) < 1e-6) return null;

  const ua = ((p4.x - p3.x) * (p1.y - p3.y) - (p4.y - p3.y) * (p1.x - p3.x)) / denom;
  const ub = ((p2.x - p1.x) * (p1.y - p3.y) - (p2.y - p1.y) * (p1.x - p3.x)) / denom;

  if (ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1) {
    return {
      x: p1.x + ua * (p2.x - p1.x),
      y: p1.y + ua * (p2.y - p1.y),
      ua,
      ub
    };
  }
  return null;
}

export function splitPolygonWithLine(poly, p1, p2) {
  // Verleng de kniplijn ver in beide richtingen, zodat twee klikken
  // *binnen* de zone toch de randen raken (segment-intersectie faalde eerder).
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return null;
  const ux = dx / len;
  const uy = dy / len;
  const EXT = 100000;
  const a = { x: p1.x - ux * EXT, y: p1.y - uy * EXT };
  const b = { x: p2.x + ux * EXT, y: p2.y + uy * EXT };

  const intersections = [];
  const N = poly.length;

  for (let i = 0; i < N; i++) {
    const edgeStart = poly[i];
    const edgeEnd = poly[(i + 1) % N];
    const hit = lineIntersection(a, b, edgeStart, edgeEnd);
    if (hit) {
      intersections.push({
        edgeIdx: i,
        point: { x: hit.x, y: hit.y },
        ua: hit.ua,
        ub: hit.ub
      });
    }
  }

  if (intersections.length < 2) return null;

  // Sorteer langs de kniplijn; pak de twee snijpunten die het dichtst
  // bij het midden van de gebruikersklicks liggen (de "koorde" door de zone).
  intersections.sort((x, y) => x.ua - y.ua);

  // Projecteer het midden van p1-p2 op de verlengde lijn-parameter
  // ua=0 → a, ua=1 → b. Midden van p1-p2 zit ongeveer op ua = 0.5
  // na de EXT-verlenging is dat niet exact 0.5, dus zoek de twee
  // opeenvolgende snijpunten waartussen het klik-midden valt.
  const midX = (p1.x + p2.x) / 2;
  const midY = (p1.y + p2.y) / 2;
  // Parameter van midden t.o.v. a→b
  const midUa = ((midX - a.x) * ux + (midY - a.y) * uy) / (2 * EXT + len);

  let hit1 = null;
  let hit2 = null;
  for (let i = 0; i < intersections.length - 1; i++) {
    if (intersections[i].ua <= midUa && intersections[i + 1].ua >= midUa) {
      hit1 = intersections[i];
      hit2 = intersections[i + 1];
      break;
    }
  }
  // Fallback: eerste twee (werkt bij convexe zones met precies 2 snijpunten)
  if (!hit1 || !hit2) {
    hit1 = intersections[0];
    hit2 = intersections[1];
  }

  let idx1 = hit1.edgeIdx;
  let pt1 = hit1.point;
  let idx2 = hit2.edgeIdx;
  let pt2 = hit2.point;

  if (idx1 > idx2) {
    [idx1, idx2] = [idx2, idx1];
    [pt1, pt2] = [pt2, pt1];
  }

  // Zelfde edge twee keer geraakt → ongeldige split
  if (idx1 === idx2) return null;

  const poly1 = [];
  for (let i = 0; i <= idx1; i++) poly1.push(poly[i]);
  poly1.push(pt1);
  poly1.push(pt2);
  for (let i = idx2 + 1; i < N; i++) poly1.push(poly[i]);

  const poly2 = [pt1];
  for (let i = idx1 + 1; i <= idx2; i++) poly2.push(poly[i]);
  poly2.push(pt2);

  const clean = (p) => {
    const res = [];
    for (let i = 0; i < p.length; i++) {
      const next = p[(i + 1) % p.length];
      if (dist(p[i].x, p[i].y, next.x, next.y) > 0.5) {
        res.push(p[i]);
      }
    }
    return res;
  };

  const clean1 = clean(poly1);
  const clean2 = clean(poly2);

  if (clean1.length >= 3 && clean2.length >= 3) {
    return [clean1, clean2];
  }
  return null;
}

export function getWallVectorAndNormal(wall) {
  const dx = wall.x2 - wall.x1;
  const dy = wall.y2 - wall.y1;
  const len = Math.hypot(dx, dy);
  if (len === 0) return { dx: 0, dy: 0, len: 0, ux: 1, uy: 0, nx: 0, ny: 1 };
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;
  return { dx, dy, len, ux, uy, nx, ny };
}

/** Vaste schaal voor openingen (deuren/ramen): pixels per meter.
 *  Afgeleid van Muur 27: 7 m ≈ 420 px → 60 px/m.
 *  Alleen widthStr bepaalt de visuele breedte; muur-lengthStr speelt geen rol meer.
 */
export const OPENING_PX_PER_METER = 60;

export function getOpeningCanvasCoords(wall, opening) {
  const { len, ux, uy, nx, ny } = getWallVectorAndNormal(wall);
  if (len === 0) return null;

  const scale = OPENING_PX_PER_METER;

  const opWidthM = parseInputNumber(opening.widthStr) || 0.9;
  const opWidthPx = Math.min(opWidthM * scale, len * 0.95);
  const halfWidthPx = opWidthPx / 2;

  const centerDist = (opening.offsetRatio ?? 0.5) * len;
  const startDist = Math.max(0, Math.min(len - opWidthPx, centerDist - halfWidthPx));
  const endDist = startDist + opWidthPx;

  const startPt = { x: wall.x1 + ux * startDist, y: wall.y1 + uy * startDist };
  const endPt = { x: wall.x1 + ux * endDist, y: wall.y1 + uy * endDist };
  const centerPt = { x: (startPt.x + endPt.x) / 2, y: (startPt.y + endPt.y) / 2 };

  return { startPt, endPt, centerPt, opWidthPx, scale, ux, uy, nx, ny, len };
}

export function getPolygonCentroid(poly) {
  if (!poly || poly.length === 0) return { x: 0, y: 0 };
  if (poly.length === 1) return { x: poly[0].x, y: poly[0].y };
  if (poly.length === 2) {
    return { x: (poly[0].x + poly[1].x) / 2, y: (poly[0].y + poly[1].y) / 2 };
  }

  // Echt vlaktezwaartepunt (area-weighted), niet het gemiddelde van de hoekpunten.
  // Bij L-vormen e.d. blijft dit veel vaker in het "midden" van de ruimte.
  let area2 = 0; // 2 * signed area
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    const cross = poly[i].x * poly[j].y - poly[j].x * poly[i].y;
    area2 += cross;
    cx += (poly[i].x + poly[j].x) * cross;
    cy += (poly[i].y + poly[j].y) * cross;
  }

  if (Math.abs(area2) < 1e-8) {
    // Degeneraat: val terug op gemiddelde van hoekpunten
    let sx = 0, sy = 0;
    poly.forEach((p) => { sx += p.x; sy += p.y; });
    return { x: sx / poly.length, y: sy / poly.length };
  }

  const inv = 1 / (3 * area2); // = 1/(6A) * 2 omdat area2 = 2A
  cx *= inv;
  cy *= inv;

  // Als het zwaartepunt per ongeluk buiten de poly valt (concave),
  // zoek een punt binnen de poly in de buurt.
  if (!pointInPoly({ x: cx, y: cy }, poly)) {
    // Probeer iets naar het midden van de bounding box te trekken
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    poly.forEach((p) => {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    });
    const bx = (minX + maxX) / 2;
    const by = (minY + maxY) / 2;
    // Sample een paar punten tussen centroid en bbox-midden
    for (let t = 0; t <= 1.001; t += 0.15) {
      const tx = cx + (bx - cx) * t;
      const ty = cy + (by - cy) * t;
      if (pointInPoly({ x: tx, y: ty }, poly)) {
        return { x: tx, y: ty };
      }
    }
    // Laatste redmiddel: eerste hoekpunt dat "binnen" is (altijd)
    // of bbox-midden als die binnen is
    if (pointInPoly({ x: bx, y: by }, poly)) return { x: bx, y: by };
  }

  return { x: cx, y: cy };
}

export function getPolygonAreaM2(poly, walls) {
  let areaPx = 0;
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    areaPx += (poly[i].x * poly[j].y - poly[j].x * poly[i].y);
  }
  areaPx = Math.abs(areaPx) / 2;

  let totalScale = 0, count = 0;
  walls.forEach((w) => {
    const wLenPx = Math.hypot(w.x2 - w.x1, w.y2 - w.y1);
    const wLenM = parseInputNumber(w.lengthStr);
    if (wLenPx > 0 && wLenM > 0) {
      totalScale += (wLenPx / wLenM);
      count++;
    }
  });

  const scale = count > 0 ? (totalScale / count) : 50;
  return areaPx / (scale * scale);
}