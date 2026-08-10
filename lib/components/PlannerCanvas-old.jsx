'use client';

import { useEffect, useRef } from 'react';
import { dist, applyOrthoAndSnap, tryMergeWall, splitIntersectedWalls, SEARCH_BOX_LONG, SEARCH_BOX_SHORT } from '../lib/Geometry';

export default function PlannerCanvas({
  state, setState, mode, setMode, drawPoints, setDrawPoints,
  selected, setSelected, movingBgId, setMovingBgId, bgPixelCache, magneticOn, scheduleSave
}) {
  const svgRef = useRef(null);
  const worldRef = useRef(null);
  const canvasWrapRef = useRef(null);
  const mousePtRef = useRef(null);
  const rawMousePtRef = useRef(null);
  const isSnappedRef = useRef(false);
  
  const isPanningRef = useRef(false);
  const panStartScreenRef = useRef(null);
  const panStartViewRef = useRef(null);
  const bgDragStartRef = useRef(null);

  function uid() { return 'id' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function screenSpaceFromEvent(evt) {
    const pt = svgRef.current.createSVGPoint();
    pt.x = evt.clientX; pt.y = evt.clientY;
    const ctm = svgRef.current.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const p = pt.matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  }

  function worldFromScreenSpace(sp) {
    return { x: (sp.x - state.view.pan.x) / state.view.zoom, y: (sp.y - state.view.pan.y) / state.view.zoom };
  }

  function onMouseDown(evt) {
    const screenPt = screenSpaceFromEvent(evt);
    if (evt.button === 2) {
      isPanningRef.current = true;
      panStartScreenRef.current = screenPt;
      panStartViewRef.current = { x: state.view.pan.x, y: state.view.pan.y };
      canvasWrapRef.current.style.cursor = 'grabbing';
      return;
    }
    if (evt.button !== 0) return;

    if (movingBgId) {
      const bg = state.backgrounds.find((b) => b.id === movingBgId);
      if (bg) bgDragStartRef.current = { screen: screenPt, bgX: bg.x, bgY: bg.y };
    }
  }

  function onMouseMove(evt) {
    const screenPt = screenSpaceFromEvent(evt);

    if (isPanningRef.current && panStartScreenRef.current) {
      const dx = screenPt.x - panStartScreenRef.current.x;
      const dy = screenPt.y - panStartScreenRef.current.y;
      setState((prev) => ({
        ...prev,
        view: { ...prev.view, pan: { x: panStartViewRef.current.x + dx, y: panStartViewRef.current.y + dy } }
      }));
      return;
    }

    if (movingBgId && bgDragStartRef.current) {
      const bg = state.backgrounds.find((b) => b.id === movingBgId);
      if (bg) {
        const dx = (screenPt.x - bgDragStartRef.current.screen.x) / state.view.zoom;
        const dy = (screenPt.y - bgDragStartRef.current.screen.y) / state.view.zoom;
        bg.x = bgDragStartRef.current.bgX + dx;
        bg.y = bgDragStartRef.current.bgY + dy;
        setState({ ...state });
      }
      return;
    }

    if ((mode === 'wall' || mode === 'zone') && drawPoints.length > 0) {
      const raw = worldFromScreenSpace(screenPt);
      rawMousePtRef.current = raw;

      const { pt, isSnapped } = applyOrthoAndSnap(raw, mode, drawPoints, state.walls, state.view.zoom, state.backgrounds, bgPixelCache, magneticOn);
      mousePtRef.current = pt;
      isSnappedRef.current = isSnapped;
      renderWorld();
    }
  }

  function onMouseUp(evt) {
    if (evt.button === 2 && isPanningRef.current) {
      isPanningRef.current = false;
      panStartScreenRef.current = null;
      canvasWrapRef.current.style.cursor = '';
      scheduleSave();
      return;
    }
    if (isPanningRef.current) {
      isPanningRef.current = false;
      panStartScreenRef.current = null;
      canvasWrapRef.current.style.cursor = '';
      scheduleSave();
    }
    if (movingBgId && bgDragStartRef.current) {
      bgDragStartRef.current = null;
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
        pan: { x: screenPt.x - worldPt.x * newZoom, y: screenPt.y - worldPt.y * newZoom }
      }
    }));
    scheduleSave();
  }

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
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [drawPoints, setDrawPoints, setMode, setSelected]);

  function onClick(evt) {
    if (isPanningRef.current || movingBgId) return;

    if (mode === 'select') {
      setSelected(null);
      return;
    }

    const raw = worldFromScreenSpace(screenSpaceFromEvent(evt));
if (mode === 'wall') {
      const { pt: snapped } = applyOrthoAndSnap(raw, mode, drawPoints, state.walls, state.view.zoom, state.backgrounds, bgPixelCache, magneticOn);

      if (drawPoints.length > 0) {
        const prev = drawPoints[drawPoints.length - 1];
        const newCounter = state.wallCounter + 1;
        const newWall = { 
          id: uid(), 
          label: 'Muur ' + newCounter, 
          x1: prev.x, y1: prev.y, 
          x2: snapped.x, y2: snapped.y, 
          type: 'Binnenmuur', 
          thickness: 12, 
          lengthStr: '3,0', 
          heightStr: '2,6', 
          notes: '' 
        };
        
        if (!tryMergeWall(newWall, state.walls)) {
          state.walls.push(newWall);
        }

        // AUTOMATISCH SPLITSEN BIJ T-SPLITSING
        splitIntersectedWalls(newWall, state.walls, uid);

        state.wallCounter = newCounter;
        scheduleSave();
      }
      setDrawPoints([...drawPoints, snapped]);
    } else if (mode === 'zone') {
      const { pt: snapped } = applyOrthoAndSnap(raw, mode, drawPoints, state.walls, state.view.zoom, state.backgrounds, bgPixelCache, magneticOn);
      if (drawPoints.length >= 3 && dist(snapped.x, snapped.y, drawPoints[0].x, drawPoints[0].y) < 16 / state.view.zoom) {
        return;
      }
      setDrawPoints([...drawPoints, snapped]);
    }
  }

  useEffect(() => {
    renderWorld();
  }, [state, mode, drawPoints, selected, movingBgId]);

  function renderWorld() {
    if (!worldRef.current) return;
    const svgNS = 'http://www.w3.org/2000/svg';
    const world = worldRef.current;
    world.innerHTML = '';
    world.setAttribute('transform', `translate(${state.view.pan.x},${state.view.pan.y}) scale(${state.view.zoom})`);

    const el = (tag, attrs) => {
      const e = document.createElementNS(svgNS, tag);
      for (const k in attrs) e.setAttribute(k, attrs[k]);
      return e;
    };

    const catcher = el('rect', { x: -6000, y: -6000, width: 12000, height: 12000, fill: '#0F2A43' });
    world.appendChild(catcher);

    const grid = el('g', { opacity: 0.5 });
    for (let gx = -4000; gx <= 4000; gx += 40) grid.appendChild(el('line', { x1: gx, y1: -4000, x2: gx, y2: 4000, stroke: 'rgba(255,255,255,0.04)', 'stroke-width': 1 / state.view.zoom }));
    for (let gy = -4000; gy <= 4000; gy += 40) grid.appendChild(el('line', { x1: -4000, y1: gy, x2: 4000, y2: gy, stroke: 'rgba(255,255,255,0.04)', 'stroke-width': 1 / state.view.zoom }));
    world.appendChild(grid);

    // Achtergronden
    state.backgrounds.forEach((bg) => {
      const img = el('image', { 
        x: bg.x, y: bg.y, width: bg.width, height: bg.height, 
        preserveAspectRatio: 'none', 
        opacity: 1, 
        style: movingBgId === bg.id ? 'cursor:move;outline:2px dashed #FFB347' : '' 
      });
      img.setAttributeNS('http://www.w3.org/1999/xlink', 'href', bg.dataUrl);
      if (movingBgId === bg.id) img.addEventListener('mousedown', (e) => { e.stopPropagation(); onMouseDown(e); });
      world.appendChild(img);
      const label = el('text', { x: bg.x + 4, y: bg.y - 6, fill: '#9FC2D8', 'font-size': 12 / state.view.zoom, style: 'pointer-events:none' });
      label.textContent = bg.name;
      world.appendChild(label);
    });

    // Zones
    state.zones.forEach((z) => {
      const pointsStr = z.points.map((p) => p.x + ',' + p.y).join(' ');
      const isSel = selected && selected.type === 'zone' && selected.id === z.id;
      const poly = el('polygon', {
        points: pointsStr,
        fill: isSel ? 'rgba(255,179,71,0.28)' : 'rgba(56,189,178,0.18)',
        stroke: isSel ? '#FFB347' : '#38BDB2',
        'stroke-width': (isSel ? 2.5 : 1.5) / state.view.zoom,
        style: 'cursor:pointer'
      });
      poly.addEventListener('mousedown', (e) => { if (e.button === 0) e.stopPropagation(); });
      poly.addEventListener('click', (e) => { if (mode === 'select') { e.stopPropagation(); setSelected({ type: 'zone', id: z.id }); } });
      world.appendChild(poly);
      const cx = z.points.reduce((s, p) => s + p.x, 0) / z.points.length;
      const cy = z.points.reduce((s, p) => s + p.y, 0) / z.points.length;
      const txt = el('text', { x: cx, y: cy, 'text-anchor': 'middle', fill: '#EAF8F5', 'font-size': 13 / state.view.zoom, style: 'pointer-events:none' });
      txt.textContent = z.name;
      world.appendChild(txt);
    });

// Muren (met ondersteuning voor Multi-selectie & Z-Index sortering)
    const selectedIds = selected && selected.type === 'wall' ? (selected.ids || [selected.id]) : [];

    // Sorteer de muren zodat geselecteerde muren als LAATSTE worden getekend (bovenop)
    const sortedWalls = [...state.walls].sort((a, b) => {
      const aSel = selectedIds.includes(a.id) ? 1 : 0;
      const bSel = selectedIds.includes(b.id) ? 1 : 0;
      return aSel - bSel; // Niet-geselecteerd eerst (0), geselecteerd laatst (1)
    });

    sortedWalls.forEach((w) => {
      const isSel = selectedIds.includes(w.id);
      const thick = w.thickness || 12;

      // Onzichtbare klik-zone
      const hit = el('line', { 
        x1: w.x1, y1: w.y1, 
        x2: w.x2, y2: w.y2, 
        stroke: 'transparent', 
        'stroke-width': Math.max(thick, 16 / state.view.zoom), 
        style: 'cursor:pointer' 
      });

      hit.addEventListener('mousedown', (e) => { if (e.button === 0) e.stopPropagation(); });
      hit.addEventListener('click', (e) => { 
        if (mode === 'select') { 
          e.stopPropagation(); 
          const isCtrl = e.ctrlKey || e.metaKey;
          setSelected((prev) => {
            if (isCtrl && prev && prev.type === 'wall') {
              const currentIds = prev.ids || [prev.id];
              const exists = currentIds.includes(w.id);
              const newIds = exists ? currentIds.filter((id) => id !== w.id) : [...currentIds, w.id];
              if (newIds.length === 0) return null;
              return { type: 'wall', ids: newIds, id: newIds[0] };
            }
            return { type: 'wall', ids: [w.id], id: w.id };
          });
        } 
      });
      world.appendChild(hit);

      // Zichtbare muurlijn
      const visLine = el('line', { 
        x1: w.x1, y1: w.y1, 
        x2: w.x2, y2: w.y2, 
        stroke: isSel ? '#FFB347' : (w.type === 'Buitengevel' ? '#E8F1F8' : '#9FC2D8'), 
        'stroke-width': thick, 
        'stroke-linecap': 'square', 
        style: 'pointer-events:none' 
      });
      world.appendChild(visLine);
    });

    // Preview-lijn + RECHTHOEKIG ZOEKVAK
    if ((mode === 'wall' || mode === 'zone') && drawPoints.length > 0) {
      const chainPts = drawPoints.slice();
      const last = chainPts[chainPts.length - 1];

      if (mousePtRef.current && rawMousePtRef.current) {
        const preview = mousePtRef.current;
        const rawMouse = rawMousePtRef.current;

        const dx = Math.abs(rawMouse.x - last.x);
        const dy = Math.abs(rawMouse.y - last.y);
        const isHoriz = dx >= dy;

        const boxW = isHoriz ? SEARCH_BOX_LONG : SEARCH_BOX_SHORT; // 40 bij horiz, 10 bij vert
        const boxH = isHoriz ? SEARCH_BOX_SHORT : SEARCH_BOX_LONG; // 10 bij horiz, 40 bij vert

        world.appendChild(el('line', {
          x1: last.x, y1: last.y,
          x2: preview.x, y2: preview.y,
          stroke: '#FFB347',
          'stroke-width': 12,
          'stroke-linecap': 'square'
        }));

        const isSnapped = isSnappedRef.current;

        world.appendChild(el('rect', {
          x: rawMouse.x - boxW / 2,
          y: rawMouse.y - boxH / 2,
          width: boxW,
          height: boxH,
          fill: isSnapped ? 'rgba(0, 229, 255, 0.12)' : 'rgba(255, 255, 255, 0.04)',
          stroke: isSnapped ? '#00E5FF' : 'rgba(255, 255, 255, 0.35)',
          'stroke-width': (isSnapped ? 1.8 : 1) / state.view.zoom,
          'stroke-dasharray': isSnapped ? 'none' : '3,3',
          style: 'pointer-events:none'
        }));

        if (isSnapped) {
          world.appendChild(el('circle', {
            cx: preview.x, cy: preview.y,
            r: 7 / state.view.zoom,
            fill: 'rgba(0, 229, 255, 0.4)',
            stroke: '#00E5FF',
            'stroke-width': 2 / state.view.zoom,
            style: 'pointer-events:none'
          }));
        }
      }

      chainPts.forEach((p) => {
        world.appendChild(el('circle', { cx: p.x, cy: p.y, r: 5 / state.view.zoom, fill: '#FFB347' }));
      });
    }
  }

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
        <g ref={worldRef}></g>
      </svg>
    </div>
  );
}