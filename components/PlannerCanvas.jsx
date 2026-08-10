'use client';

import { useEffect, useRef, useState } from 'react';
import {
  dist,
  applyOrthoAndSnap,
  tryMergeWall,
  splitIntersectedWalls,
  findRoomAtPoint,
  splitPolygonWithLine,
  getOpeningCanvasCoords,
  getPolygonCentroid,
  getPolygonAreaM2,
  fmtComma,
  parseInputNumber,
  SEARCH_BOX_LONG,
  SEARCH_BOX_SHORT
} from '../lib/Geometry';

export default function PlannerCanvas({
  state, setState,
  mode, setMode,
  drawPoints, setDrawPoints,
  selected, setSelected,
  movingBgId, setMovingBgId,
  bgPixelCache, magneticOn,
  scheduleSave,
  activeTab,
  activeJobId,
  setActiveJobId
}) {
  const svgRef = useRef(null);
  const worldRef = useRef(null);
  const canvasWrapRef = useRef(null);

  // Muis / snap state (refs zodat we niet te vaak re-renderen tijdens move)
  const mousePtRef = useRef(null);
  const rawMousePtRef = useRef(null);
  const isSnappedRef = useRef(false);

  // Pannen (alleen rechtermuisknop)
  const isPanningRef = useRef(false);
  const panStartScreenRef = useRef(null);
  const panStartViewRef = useRef(null);

  // Background slepen
  const bgDragStartRef = useRef(null);

  // Opening slepen
  const dragOpeningRef = useRef(null);

  // Voor hover-ruimte in zone-mode
  const [hoveredRoomPoly, setHoveredRoomPoly] = useState(null);

  // Force re-render van preview (alleen wanneer nodig)
  const [, forceRender] = useState(0);

  function uid() {
    return 'id' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  }

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  /** Donkerder maken van een hex-kleur (amount 0..1). Zone-fill blijft zichtbaar. */
  function darkenHex(hex, amount = 0.35) {
    if (!hex || typeof hex !== 'string') return hex;
    let h = hex.replace('#', '');
    if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
    if (h.length !== 6) return hex;
    const num = parseInt(h, 16);
    let r = (num >> 16) & 255;
    let g = (num >> 8) & 255;
    let b = num & 255;
    r = Math.max(0, Math.round(r * (1 - amount)));
    g = Math.max(0, Math.round(g * (1 - amount)));
    b = Math.max(0, Math.round(b * (1 - amount)));
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }

  /**
   * Zoekt een gesloten ruimte rond een punt.
   * Probeert het exacte punt + een klein raster van offsets,
   * zodat kleine gaten / snap-afwijkingen minder streng zijn.
   * Geeft null terug als er geen (binnen)ruimte gevonden wordt.
   */
  function findRoomNearPoint(pt, walls) {
    if (!findRoomAtPoint || !walls || walls.length < 3) return null;

    // Eerst exact proberen
    let poly = findRoomAtPoint(pt, walls);
    if (poly && poly.length >= 3) return poly;

    // Kleine offsets (in world units). 8–20 px is meestal genoeg bij normale zoom.
    const offsets = [
      [6, 0], [-6, 0], [0, 6], [0, -6],
      [10, 0], [-10, 0], [0, 10], [0, -10],
      [8, 8], [8, -8], [-8, 8], [-8, -8],
      [14, 0], [-14, 0], [0, 14], [0, -14]
    ];

    for (const [dx, dy] of offsets) {
      poly = findRoomAtPoint({ x: pt.x + dx, y: pt.y + dy }, walls);
      if (poly && poly.length >= 3) return poly;
    }
    return null;
  }

  // ─── Oude, stabiele coördinaten-logica ───────────────────────────────────
  function screenSpaceFromEvent(evt) {
    const pt = svgRef.current.createSVGPoint();
    pt.x = evt.clientX;
    pt.y = evt.clientY;
    const ctm = svgRef.current.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const p = pt.matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  }

  function worldFromScreenSpace(sp) {
    return {
      x: (sp.x - state.view.pan.x) / state.view.zoom,
      y: (sp.y - state.view.pan.y) / state.view.zoom
    };
  }

  // ─── Mouse handlers ──────────────────────────────────────────────────────
  function onMouseDown(evt) {
    const screenPt = screenSpaceFromEvent(evt);

    // Rechtermuisknop → pannen
    if (evt.button === 2) {
      isPanningRef.current = true;
      panStartScreenRef.current = screenPt;
      panStartViewRef.current = { x: state.view.pan.x, y: state.view.pan.y };
      if (canvasWrapRef.current) canvasWrapRef.current.style.cursor = 'grabbing';
      return;
    }

    if (evt.button !== 0) return;

    // Background verplaatsen
    if (movingBgId) {
      const bg = state.backgrounds.find((b) => b.id === movingBgId);
      if (bg) {
        bgDragStartRef.current = {
          screen: screenPt,
          bgX: bg.x,
          bgY: bg.y
        };
      }
      return;
    }
  }

  function onMouseMove(evt) {
    const screenPt = screenSpaceFromEvent(evt);

    // Pannen
    if (isPanningRef.current && panStartScreenRef.current) {
      const dx = screenPt.x - panStartScreenRef.current.x;
      const dy = screenPt.y - panStartScreenRef.current.y;
      setState((prev) => ({
        ...prev,
        view: {
          ...prev.view,
          pan: {
            x: panStartViewRef.current.x + dx,
            y: panStartViewRef.current.y + dy
          }
        }
      }));
      return;
    }

    // Background slepen
    if (movingBgId && bgDragStartRef.current) {
      const bg = state.backgrounds.find((b) => b.id === movingBgId);
      if (bg) {
        const dx = (screenPt.x - bgDragStartRef.current.screen.x) / state.view.zoom;
        const dy = (screenPt.y - bgDragStartRef.current.screen.y) / state.view.zoom;
        setState((prev) => ({
          ...prev,
          backgrounds: prev.backgrounds.map((b) =>
            b.id === movingBgId
              ? { ...b, x: bgDragStartRef.current.bgX + dx, y: bgDragStartRef.current.bgY + dy }
              : b
          )
        }));
      }
      return;
    }

    // Opening slepen
    if (dragOpeningRef.current) {
      const { wallId, openingId } = dragOpeningRef.current;
      const wall = state.walls.find((w) => w.id === wallId);
      if (wall) {
        const raw = worldFromScreenSpace(screenPt);
        const wLen = Math.hypot(wall.x2 - wall.x1, wall.y2 - wall.y1);
        if (wLen > 0) {
          const proj =
            ((raw.x - wall.x1) * (wall.x2 - wall.x1) + (raw.y - wall.y1) * (wall.y2 - wall.y1)) /
            (wLen * wLen);
          const newRatio = Math.max(0.05, Math.min(0.95, proj));
          setState((prev) => ({
            ...prev,
            walls: prev.walls.map((w) => {
              if (w.id !== wallId) return w;
              return {
                ...w,
                openings: (w.openings || []).map((op) =>
                  op.id === openingId ? { ...op, offsetRatio: newRatio } : op
                )
              };
            })
          }));
        }
      }
      return;
    }

    // Preview + snap tijdens tekenen (wall / zone / cut)
    if ((mode === 'wall' || mode === 'zone' || mode === 'cut') && drawPoints.length > 0) {
      const raw = worldFromScreenSpace(screenPt);
      rawMousePtRef.current = raw;

      const { pt, isSnapped } = applyOrthoAndSnap(
        raw,
        mode,
        drawPoints,
        state.walls,
        state.view.zoom,
        state.backgrounds,
        bgPixelCache,
        magneticOn
      );
      mousePtRef.current = pt;
      isSnappedRef.current = isSnapped;
      forceRender((n) => n + 1);
    }

    // Hover-ruimte in zone-mode (probeer meerdere punten voor tolerantie)
    if (mode === 'zone') {
      const raw = worldFromScreenSpace(screenPt);
      const roomPoly = findRoomNearPoint(raw, state.walls);
      setHoveredRoomPoly(roomPoly);
    } else if (hoveredRoomPoly) {
      setHoveredRoomPoly(null);
    }
  }

  function onMouseUp(evt) {
    if (evt.button === 2 && isPanningRef.current) {
      isPanningRef.current = false;
      panStartScreenRef.current = null;
      if (canvasWrapRef.current) canvasWrapRef.current.style.cursor = '';
      scheduleSave();
      return;
    }

    if (isPanningRef.current) {
      isPanningRef.current = false;
      panStartScreenRef.current = null;
      if (canvasWrapRef.current) canvasWrapRef.current.style.cursor = '';
      scheduleSave();
    }

    if (movingBgId && bgDragStartRef.current) {
      bgDragStartRef.current = null;
      scheduleSave();
    }

    if (dragOpeningRef.current) {
      dragOpeningRef.current = null;
      scheduleSave();
    }
  }

  function onWheel(evt) {
    evt.preventDefault();
    const screenPt = screenSpaceFromEvent(evt);
    const oldZoom = state.view.zoom;
    const factor = evt.deltaY < 0 ? 1.12 : 1 / 1.12;
    const newZoom = clamp(oldZoom * factor, 0.2, 6);
    const worldPt = worldFromScreenSpace(screenPt);

    setState((prev) => ({
      ...prev,
      view: {
        zoom: newZoom,
        pan: {
          x: screenPt.x - worldPt.x * newZoom,
          y: screenPt.y - worldPt.y * newZoom
        }
      }
    }));
    scheduleSave();
  }

  // Escape
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (drawPoints.length > 0) {
          setDrawPoints([]);
        } else {
          setMode('select');
          if (setSelected) setSelected(null);
        }
        mousePtRef.current = null;
        rawMousePtRef.current = null;
        isSnappedRef.current = false;
        setHoveredRoomPoly(null);
        forceRender((n) => n + 1);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [drawPoints, setDrawPoints, setMode, setSelected]);

  // ─── Click handlers ──────────────────────────────────────────────────────
  function onClick(evt) {
    if (isPanningRef.current || movingBgId || dragOpeningRef.current) return;

    const screenPt = screenSpaceFromEvent(evt);
    const raw = worldFromScreenSpace(screenPt);

    // ── Zone-mode: automatische ruimtedetectie ──
    if (mode === 'zone') {
      const roomPoly = findRoomNearPoint(raw, state.walls);
      if (roomPoly && roomPoly.length >= 3) {
        const newCounter = (state.zoneCounter || 0) + 1;
        const newZone = {
          id: uid(),
          name: 'Ruimte ' + newCounter,
          points: roomPoly,
          color: '#E8E2D5',
          opacity: 0.35, // lichter zodat plattegrond + muren zichtbaar blijven
          lengthStr: '',
          heightStr: '',
          notes: '',
          jobs: []
        };
        setState((prev) => ({
          ...prev,
          zoneCounter: newCounter,
          zones: [...(prev.zones || []), newZone]
        }));
        setSelected({ items: [{ type: 'zone', id: newZone.id }] });
        scheduleSave();
      }
      return;
    }

    // ── Cut-mode: snijd zone(s) doormidden ──
    if (mode === 'cut') {
      const { pt: snapped } = applyOrthoAndSnap(
        raw,
        mode,
        drawPoints,
        state.walls,
        state.view.zoom,
        state.backgrounds,
        bgPixelCache,
        magneticOn
      );

      if (drawPoints.length === 0) {
        setDrawPoints([snapped]);
      } else {
        const p1 = drawPoints[0];
        const p2 = snapped;
        // Negeer te korte kniplijnen
        if (Math.hypot(p2.x - p1.x, p2.y - p1.y) < 2) {
          setDrawPoints([]);
          return;
        }

        let cutApplied = false;
        const newZones = [];

        (state.zones || []).forEach((z) => {
          if (z.points && z.points.length >= 3) {
            const splitRes = splitPolygonWithLine(z.points, p1, p2);
            if (splitRes && splitRes.length === 2) {
              cutApplied = true;
              newZones.push({ ...z, points: splitRes[0] });
              newZones.push({
                ...z,
                id: uid(),
                name: `${z.name} (Deel 2)`,
                points: splitRes[1]
              });
              return; // deze zone is gesplitst
            }
          }
          newZones.push(z);
        });

        if (cutApplied) {
          setState((prev) => ({ ...prev, zones: newZones }));
          scheduleSave();
          setDrawPoints([]);
          setMode('select');
        } else {
          // Geen zone geraakt: reset alleen de lijn, blijf in cut-mode
          setDrawPoints([]);
        }
      }
      return;
    }

    // ── Wall-mode ──
    if (mode === 'wall') {
      const { pt: snapped } = applyOrthoAndSnap(
        raw,
        mode,
        drawPoints,
        state.walls,
        state.view.zoom,
        state.backgrounds,
        bgPixelCache,
        magneticOn
      );

      if (drawPoints.length > 0) {
        const prevPt = drawPoints[drawPoints.length - 1];
        setState((prev) => {
          const newCounter = (prev.wallCounter || 0) + 1;
          const newWall = {
            id: uid(),
            label: 'Muur ' + newCounter,
            x1: prevPt.x,
            y1: prevPt.y,
            x2: snapped.x,
            y2: snapped.y,
            type: 'Binnenmuur',
            thickness: 12,
            lengthStr: '',
            heightStr: '',
            openings: [],
            notes: '',
            jobs: []
          };

          // Diepe kopie zodat we veilig kunnen muteren
          let wallsCopy = prev.walls.map((w) => ({
            ...w,
            openings: w.openings ? [...w.openings] : []
          }));

          if (!tryMergeWall(newWall, wallsCopy)) {
            wallsCopy.push(newWall);
          }
          splitIntersectedWalls(newWall, wallsCopy, uid);

          return {
            ...prev,
            wallCounter: newCounter,
            walls: wallsCopy
          };
        });
        scheduleSave();
      }
      setDrawPoints([...drawPoints, snapped]);
      return;
    }

    // ── Select-mode: leeg klikken deselecteert ──
    if (mode === 'select') {
      setSelected(null);
    }
  }

  // ─── Render helpers ──────────────────────────────────────────────────────
  // Unified selection helpers
  const selItems = selected?.items || (
    selected?.type === 'wall'
      ? (selected.ids || [selected.id]).filter(Boolean).map((id) => ({ type: 'wall', id }))
      : selected?.type === 'zone'
        ? [{ type: 'zone', id: selected.id }]
        : selected?.type === 'opening'
          ? [{ type: 'opening', id: selected.id, wallId: selected.wallId }]
          : []
  );
  const selectedWallIds = selItems.filter((i) => i.type === 'wall').map((i) => i.id);
  const selectedZoneIds = selItems.filter((i) => i.type === 'zone').map((i) => i.id);
  const selectedOpeningIds = selItems.filter((i) => i.type === 'opening').map((i) => i.id);

  function toggleSelect(item, isCtrl) {
    // Single-select zet job-highlight uit
    if (!isCtrl && setActiveJobId) setActiveJobId(null);
    setSelected((prev) => {
      const prevItems = prev?.items || (
        prev?.type === 'wall'
          ? (prev.ids || [prev.id]).filter(Boolean).map((id) => ({ type: 'wall', id }))
          : prev?.type === 'zone'
            ? [{ type: 'zone', id: prev.id }]
            : prev?.type === 'opening'
              ? [{ type: 'opening', id: prev.id, wallId: prev.wallId }]
              : []
      );
      if (!isCtrl) return { items: [item] };
      const exists = prevItems.some((p) => p.type === item.type && p.id === item.id);
      const next = exists
        ? prevItems.filter((p) => !(p.type === item.type && p.id === item.id))
        : [...prevItems, item];
      return next.length ? { items: next } : null;
    });
  }

  const sortedWalls = [...(state.walls || [])].sort((a, b) => {
    const aSel = selectedWallIds.includes(a.id) ? 1 : 0;
    const bSel = selectedWallIds.includes(b.id) ? 1 : 0;
    return aSel - bSel;
  });

  // Preview-punten
  const previewPt = mousePtRef.current;
  const rawMouse = rawMousePtRef.current;
  const isSnapped = isSnappedRef.current;

  return (
    <div className="vp-canvaswrap" ref={canvasWrapRef}>
      <svg
        ref={svgRef}
        viewBox="0 0 1200 800"
        preserveAspectRatio="xMidYMid meet"
        onContextMenu={(e) => e.preventDefault()}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onClick={onClick}
        onWheel={onWheel}
      >
        <g
          ref={worldRef}
          transform={`translate(${state.view.pan.x},${state.view.pan.y}) scale(${state.view.zoom})`}
        >
          {/* Achtergrond-catcher */}
          <rect x={-6000} y={-6000} width={12000} height={12000} fill="#0F2A43" />

          {/* Grid */}
          <g opacity={0.5}>
            {Array.from({ length: 201 }, (_, i) => {
              const g = -4000 + i * 40;
              return (
                <g key={g}>
                  <line
                    x1={g}
                    y1={-4000}
                    x2={g}
                    y2={4000}
                    stroke="rgba(255,255,255,0.04)"
                    strokeWidth={1 / state.view.zoom}
                  />
                  <line
                    x1={-4000}
                    y1={g}
                    x2={4000}
                    y2={g}
                    stroke="rgba(255,255,255,0.04)"
                    strokeWidth={1 / state.view.zoom}
                  />
                </g>
              );
            })}
          </g>

          {/* 1. Achtergronden */}
          {(state.backgrounds || []).map((bg) => (
            <g key={bg.id}>
              <image
                href={bg.dataUrl}
                x={bg.x}
                y={bg.y}
                width={bg.width}
                height={bg.height}
                preserveAspectRatio="none"
                opacity={1}
                style={{
                  cursor: movingBgId === bg.id ? 'move' : 'default',
                  outline: movingBgId === bg.id ? '2px dashed #FFB347' : 'none',
                  pointerEvents: movingBgId === bg.id ? 'auto' : 'none'
                }}
              />
              <text
                x={bg.x + 4}
                y={bg.y - 6}
                fill="#9FC2D8"
                fontSize={12 / state.view.zoom}
                style={{ pointerEvents: 'none' }}
              >
                {bg.name}
              </text>
            </g>
          ))}

          {/* 2. Zones / Ruimtes */}
          {(state.zones || []).map((z) => {
            if (!z.points || z.points.length < 3) return null;
            const isSel = selectedZoneIds.includes(z.id);
            const ptsStr = z.points.map((p) => `${p.x},${p.y}`).join(' ');
            const centroid = getPolygonCentroid ? getPolygonCentroid(z.points) : null;
            const calculatedM2 = getPolygonAreaM2
              ? getPolygonAreaM2(z.points, state.walls)
              : 0;
            const manualLen = parseInputNumber ? parseInputNumber(z.lengthStr) : 0;
            const manualH = parseInputNumber ? parseInputNumber(z.heightStr) : 0;
            const manualM2 = manualLen * manualH;
            const displayM2 = manualM2 > 0 ? manualM2 : calculatedM2;

            const jobHighlight = activeJobId && (z.jobs || []).includes(activeJobId);
            const baseColor = z.color || '#E8E2D5';
            // Default: alle zones donkerder. Heldere kleur alleen bij selectie of job-highlight.
            // fillOpacity blijft altijd de zone-eigen waarde.
            const isBright = isSel || jobHighlight;
            const fillColor = isBright ? baseColor : darkenHex(baseColor, 0.32);
            const strokeColor = isSel ? '#FFB347' : (jobHighlight ? darkenHex(baseColor, 0.15) : darkenHex(baseColor, 0.5));

            return (
              <g key={z.id}>
                <polygon
                  points={ptsStr}
                  fill={fillColor}
                  fillOpacity={z.opacity != null ? z.opacity : 0.35}
                  stroke={strokeColor}
                  strokeWidth={(isSel || jobHighlight ? 2.8 : 1.5) / state.view.zoom}
                  style={{ cursor: 'pointer' }}
                  onMouseDown={(e) => {
                    if (e.button === 0) e.stopPropagation();
                  }}
                  onClick={(e) => {
                    if (mode === 'select') {
                      e.stopPropagation();
                      toggleSelect({ type: 'zone', id: z.id }, e.ctrlKey || e.metaKey);
                    }
                  }}
                />
                {centroid && (
                  <g
                    transform={`translate(${centroid.x},${centroid.y})`}
                    style={{ pointerEvents: 'none' }}
                  >
                    <text
                      x={0}
                      y={-4}
                      fill="#000000"
                      fontSize={13 / state.view.zoom}
                      fontWeight="bold"
                      textAnchor="middle"
                      stroke="#FFFFFF"
                      strokeWidth={3 / state.view.zoom}
                      paintOrder="stroke"
                    >
                      {z.name}
                    </text>
                    {fmtComma && (
                      <text
                        x={0}
                        y={12 / state.view.zoom}
                        fill="#000000"
                        fontSize={11 / state.view.zoom}
                        textAnchor="middle"
                        stroke="#FFFFFF"
                        strokeWidth={3 / state.view.zoom}
                        paintOrder="stroke"
                      >
                        {`${fmtComma(displayM2)} m²`}
                      </text>
                    )}
                  </g>
                )}
              </g>
            );
          })}

          {/* Hover-ruimte in zone-mode */}
          {mode === 'zone' && hoveredRoomPoly && hoveredRoomPoly.length >= 3 && (
            <polygon
              points={hoveredRoomPoly.map((p) => `${p.x},${p.y}`).join(' ')}
              fill="#38BDF8"
              fillOpacity={0.35}
              stroke="#38BDF8"
              strokeWidth={2 / state.view.zoom}
              strokeDasharray={`${4 / state.view.zoom} ${4 / state.view.zoom}`}
              style={{ pointerEvents: 'none' }}
            />
          )}

          {/* 3. Muren + Openingen */}
          {sortedWalls.map((w) => {
            const isSel = selectedWallIds.includes(w.id);
            const thick = w.thickness || 12;

            return (
              <g key={w.id}>
                {/* Onzichtbare klik-zone */}
                <line
                  x1={w.x1}
                  y1={w.y1}
                  x2={w.x2}
                  y2={w.y2}
                  stroke="transparent"
                  strokeWidth={Math.max(thick, 16 / state.view.zoom)}
                  style={{ cursor: 'pointer' }}
                  onMouseDown={(e) => {
                    if (e.button === 0) e.stopPropagation();
                  }}
                  onClick={(e) => {
                    if (mode === 'select') {
                      e.stopPropagation();
                      toggleSelect({ type: 'wall', id: w.id }, e.ctrlKey || e.metaKey);
                    } else if (mode === 'door' || mode === 'window') {
                      e.stopPropagation();
                      const newCounter = (state.openingCounter || 0) + 1;
                      const isDoor = mode === 'door';
                      const rawClick = worldFromScreenSpace(screenSpaceFromEvent(e));
                      const wLen = Math.hypot(w.x2 - w.x1, w.y2 - w.y1);
                      let ratio = 0.5;
                      if (wLen > 0) {
                        const proj =
                          ((rawClick.x - w.x1) * (w.x2 - w.x1) +
                            (rawClick.y - w.y1) * (w.y2 - w.y1)) /
                          (wLen * wLen);
                        ratio = Math.max(0.1, Math.min(0.9, proj));
                      }
                      const newOp = {
                        id: uid(),
                        wallId: w.id,
                        label: (isDoor ? 'Deur ' : 'Raam ') + newCounter,
                        type: mode,
                        offsetRatio: ratio,
                        widthStr: isDoor ? '0,90' : '1,20',
                        heightStr: isDoor ? '2,10' : '1,50',
                        flipSide: false,
                        flipHand: false,
                        jobs: []
                      };
                      setState((prev) => ({
                        ...prev,
                        openingCounter: newCounter,
                        walls: prev.walls.map((wallItem) => {
                          if (wallItem.id !== w.id) return wallItem;
                          return {
                            ...wallItem,
                            openings: [...(wallItem.openings || []), newOp]
                          };
                        })
                      }));
                      setSelected({ items: [{ type: 'opening', id: newOp.id, wallId: w.id }] });
                      scheduleSave();
                      setMode('select');
                    }
                  }}
                />

                {/* Zichtbare muurlijn */}
                <line
                  x1={w.x1}
                  y1={w.y1}
                  x2={w.x2}
                  y2={w.y2}
                  stroke={(() => {
                    if (isSel) return '#FFB347';
                    if (activeJobId && (w.jobs || []).includes(activeJobId)) {
                      const job = (state.jobs || []).find((j) => j.id === activeJobId);
                      return job?.color || '#F97316';
                    }
                    return w.type === 'Buitengevel' ? '#E8F1F8' : '#9FC2D8';
                  })()}
                  strokeWidth={
                    activeJobId && (w.jobs || []).includes(activeJobId)
                      ? thick + 4
                      : thick
                  }
                  strokeLinecap="square"
                  style={{ pointerEvents: 'none' }}
                />

                {/* Openingen (deuren & ramen) */}
                {(w.openings || []).map((op) => {
                  if (!getOpeningCanvasCoords) return null;
                  const coords = getOpeningCanvasCoords(w, op);
                  if (!coords) return null;

                  const { startPt, endPt, centerPt, opWidthPx, nx, ny } = coords;
                  const isOpSel = selectedOpeningIds.includes(op.id);
                  const opJobHighlight = activeJobId && (op.jobs || []).includes(activeJobId);
                  const sideMult = op.flipSide ? -1 : 1;
                  const handMult = op.flipHand ? -1 : 1;
                  const hingePt = op.flipHand ? endPt : startPt;
                  const leafEnd = {
                    x: hingePt.x + nx * sideMult * opWidthPx,
                    y: hingePt.y + ny * sideMult * opWidthPx
                  };
                  const sweepFlag = sideMult * handMult > 0 ? 1 : 0;
                  const targetPt = op.flipHand ? startPt : endPt;
                  const gOffset = thick / 4;

                  return (
                    <g key={op.id}>
                      {/* Muur-sparing */}
                      <line
                        x1={startPt.x}
                        y1={startPt.y}
                        x2={endPt.x}
                        y2={endPt.y}
                        stroke="#FFFFFF"
                        strokeWidth={thick + 1}
                        strokeLinecap="butt"
                        style={{ pointerEvents: 'none' }}
                      />

                      {/* Deur-visualisatie */}
                      {op.type === 'door' && (
                        <>
                          <line
                            x1={startPt.x - (nx * thick) / 2}
                            y1={startPt.y - (ny * thick) / 2}
                            x2={startPt.x + (nx * thick) / 2}
                            y2={startPt.y + (ny * thick) / 2}
                            stroke="#1E6E7A"
                            strokeWidth={2}
                          />
                          <line
                            x1={endPt.x - (nx * thick) / 2}
                            y1={endPt.y - (ny * thick) / 2}
                            x2={endPt.x + (nx * thick) / 2}
                            y2={endPt.y + (ny * thick) / 2}
                            stroke="#1E6E7A"
                            strokeWidth={2}
                          />
                          <line
                            x1={hingePt.x}
                            y1={hingePt.y}
                            x2={leafEnd.x}
                            y2={leafEnd.y}
                            stroke={isOpSel ? '#FFB347' : '#1E6E7A'}
                            strokeWidth={3}
                          />
                          <path
                            d={`M ${leafEnd.x} ${leafEnd.y} A ${opWidthPx} ${opWidthPx} 0 0 ${sweepFlag} ${targetPt.x} ${targetPt.y}`}
                            fill="none"
                            stroke={isOpSel ? '#FFB347' : '#94A3B8'}
                            strokeWidth={1.5}
                            strokeDasharray="3 3"
                          />
                        </>
                      )}

                      {/* Raam-visualisatie */}
                      {op.type === 'window' && (
                        <>
                          <line
                            x1={startPt.x + nx * gOffset}
                            y1={startPt.y + ny * gOffset}
                            x2={endPt.x + nx * gOffset}
                            y2={endPt.y + ny * gOffset}
                            stroke={isOpSel ? '#FFB347' : '#38BDF8'}
                            strokeWidth={2}
                          />
                          <line
                            x1={startPt.x - nx * gOffset}
                            y1={startPt.y - ny * gOffset}
                            x2={endPt.x - nx * gOffset}
                            y2={endPt.y - ny * gOffset}
                            stroke={isOpSel ? '#FFB347' : '#38BDF8'}
                            strokeWidth={2}
                          />
                        </>
                      )}

                      {/* Klik-zone opening */}
                      <line
                        x1={startPt.x}
                        y1={startPt.y}
                        x2={endPt.x}
                        y2={endPt.y}
                        stroke="transparent"
                        strokeWidth={Math.max(thick, 20 / state.view.zoom)}
                        style={{ cursor: 'pointer' }}
                        onClick={(e) => {
                          if (mode === 'select') {
                            e.stopPropagation();
                            toggleSelect(
                              { type: 'opening', id: op.id, wallId: w.id },
                              e.ctrlKey || e.metaKey
                            );
                          }
                        }}
                      />

                      {/* Sleep-bolletje bij selectie */}
                      {isOpSel && (
                        <circle
                          cx={centerPt.x}
                          cy={centerPt.y}
                          r={7 / state.view.zoom}
                          fill="#FFB347"
                          stroke="#FFFFFF"
                          strokeWidth={2}
                          style={{ cursor: 'grab' }}
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            dragOpeningRef.current = {
                              wallId: w.id,
                              openingId: op.id
                            };
                          }}
                        />
                      )}
                    </g>
                  );
                })}
              </g>
            );
          })}

          {/* 4. Preview: snijlijn (cut) */}
          {mode === 'cut' && drawPoints.length === 1 && previewPt && (
            <line
              x1={drawPoints[0].x}
              y1={drawPoints[0].y}
              x2={previewPt.x}
              y2={previewPt.y}
              stroke="#EF4444"
              strokeWidth={2 / state.view.zoom}
              strokeDasharray={`${5 / state.view.zoom} ${5 / state.view.zoom}`}
              style={{ pointerEvents: 'none' }}
            />
          )}

          {/* 5. Preview: muur tekenen + zoekvak */}
          {mode === 'wall' && drawPoints.length > 0 && previewPt && rawMouse && (
            <>
              <line
                x1={drawPoints[drawPoints.length - 1].x}
                y1={drawPoints[drawPoints.length - 1].y}
                x2={previewPt.x}
                y2={previewPt.y}
                stroke="#FFB347"
                strokeWidth={12}
                strokeLinecap="square"
                style={{ pointerEvents: 'none' }}
              />

              {/* Zoekvak (ortho/snap feedback) */}
              {(() => {
                const last = drawPoints[drawPoints.length - 1];
                const dx = Math.abs(rawMouse.x - last.x);
                const dy = Math.abs(rawMouse.y - last.y);
                const isHoriz = dx >= dy;
                const boxW = isHoriz ? (SEARCH_BOX_LONG || 40) : (SEARCH_BOX_SHORT || 10);
                const boxH = isHoriz ? (SEARCH_BOX_SHORT || 10) : (SEARCH_BOX_LONG || 40);
                return (
                  <rect
                    x={rawMouse.x - boxW / 2}
                    y={rawMouse.y - boxH / 2}
                    width={boxW}
                    height={boxH}
                    fill={
                      isSnapped
                        ? 'rgba(0, 229, 255, 0.12)'
                        : 'rgba(255, 255, 255, 0.04)'
                    }
                    stroke={isSnapped ? '#00E5FF' : 'rgba(255, 255, 255, 0.35)'}
                    strokeWidth={(isSnapped ? 1.8 : 1) / state.view.zoom}
                    strokeDasharray={isSnapped ? 'none' : '3,3'}
                    style={{ pointerEvents: 'none' }}
                  />
                );
              })()}

              {isSnapped && (
                <circle
                  cx={previewPt.x}
                  cy={previewPt.y}
                  r={7 / state.view.zoom}
                  fill="rgba(0, 229, 255, 0.4)"
                  stroke="#00E5FF"
                  strokeWidth={2 / state.view.zoom}
                  style={{ pointerEvents: 'none' }}
                />
              )}
            </>
          )}

          {/* Tekenpunten */}
          {(mode === 'wall' || mode === 'cut') &&
            drawPoints.map((p, i) => (
              <circle
                key={i}
                cx={p.x}
                cy={p.y}
                r={5 / state.view.zoom}
                fill="#FFB347"
                style={{ pointerEvents: 'none' }}
              />
            ))}
        </g>
      </svg>
    </div>
  );
}