'use client';

import { useEffect, useRef, useState } from 'react';
import { idbGet, idbSet } from '../lib/db';
import { parseInputNumber, normalizeInputString, fmtComma, splitPolygonWithLine } from '../lib/Geometry';
import PlannerCanvas from './PlannerCanvas';
import './Planner.css';

const COLOR_PRESETS = [
  '#E8E2D5', // Warm neutraal / Woonkamer
  '#CDE3EF', // Fris blauw / Badkamer
  '#D5E8D4', // Zacht groen / Keuken
  '#FFE6CC', // Warm oranje / Entree
  '#E1D5E7', // Lila / Slaapkamer
  '#FFF2CC'  // Lichtgeel / Berging
];

const JOB_COLORS = [
  '#F97316', // oranje
  '#3B82F6', // blauw
  '#22C55E', // groen
  '#A855F7', // paars
  '#EF4444', // rood
  '#EAB308', // geel
  '#14B8A6', // teal
  '#EC4899'  // roze
];

export default function Planner() {
  const [state, setState] = useState({
    wallCounter: 0,
    zoneCounter: 0,
    bgCounter: 0,
    openingCounter: 0,
    jobCounter: 0,
    backgrounds: [],
    walls: [],
    zones: [],
    jobs: [], // { id, name, color, priceType: 'fixed'|'per_m2'|'per_m1'|'per_piece', price: number, notes }
    view: { pan: { x: 0, y: 0 }, zoom: 1 }
  });

  const [activeTab, setActiveTab] = useState('algemeen'); // 'algemeen' | 'build'
  const [mode, setMode] = useState('select');
  const [drawPoints, setDrawPoints] = useState([]);
  const [selected, setSelected] = useState(null);
  const [movingBgId, setMovingBgId] = useState(null);
  const [magneticOn, setMagneticOn] = useState(true);
  const [saveState, setSaveState] = useState('opgeslagen');
  const [activeJobId, setActiveJobId] = useState(null); // voor visuele highlight van een klus
  // Neon (hoofdproject) koppeling
  const [syncMsg, setSyncMsg] = useState('');
  const neonProjectRef = useRef(null); // { id, token } | null — koppeling met het hoofdproject in Neon

  const bgPixelCache = useRef({});
  const saveTimer = useRef(null);

  function uid() { return 'id' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }

  const stateRef = useRef(state);
  stateRef.current = state;

  function scheduleSave() {
    setSaveState('opslaan...');
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const snapshot = stateRef.current;
      try {
        // Altijd lokaal cachen
        await idbSet('project', JSON.stringify(snapshot));
        // En naar Neon als dit apparaat al aan het hoofdproject gekoppeld is
        const neon = neonProjectRef.current;
        if (neon?.id && neon?.token) {
          const res = await fetch('/api/project', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: neon.id, token: neon.token, data: snapshot })
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || 'Opslaan naar Neon mislukt');
          }
        }
        setSaveState('opgeslagen');
      } catch (e) {
        console.error(e);
        setSaveState('opslaan mislukt');
      }
    }, 500);
  }

  /**
   * Eenmalige migratie/import: upload de huidige lokale data (IndexedDB-state)
   * naar Neon en stel deze in als hoofdproject.
   * - Al gekoppeld aan een Neon-project? Dan wordt dat project bijgewerkt.
   * - Nog niet gekoppeld? Dan wordt een nieuw project aangemaakt; omdat de
   *   server zonder id/token altijd het meest recent bijgewerkte project
   *   teruggeeft (zie /api/project GET), wordt dit meteen het hoofdproject.
   */
  async function migrateToNeon() {
    setSyncMsg('Uploaden naar Neon…');
    try {
      const neon = neonProjectRef.current;
      if (neon?.id && neon?.token) {
        const res = await fetch('/api/project', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: neon.id, token: neon.token, data: stateRef.current })
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'Bijwerken mislukt');
        }
      } else {
        const res = await fetch('/api/project/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: stateRef.current })
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Migratie mislukt');
        neonProjectRef.current = { id: json.id, token: json.token };
        localStorage.setItem('vp_neon_project', JSON.stringify(neonProjectRef.current));
      }
      setSyncMsg('Hoofdproject ingesteld in Neon ✓');
      setTimeout(() => setSyncMsg(''), 3000);
    } catch (e) {
      console.error(e);
      setSyncMsg(e.message || 'Migratie mislukt – is DATABASE_URL gezet?');
      setTimeout(() => setSyncMsg(''), 4000);
    }
  }

  /** Download huidige state als JSON (jouw IndexedDB-huis). */
  function downloadBackup() {
    const blob = new Blob([JSON.stringify(stateRef.current, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `verbouw-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    setShareMsg('Backup gedownload');
    setTimeout(() => setShareMsg(''), 2000);
  }

  /** Herstel uit JSON → state + IndexedDB (+ cloud als deellink actief). */
  function restoreBackupFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const loaded = normalizeLoaded(JSON.parse(e.target.result));
        setState(loaded);
        stateRef.current = loaded;
        (loaded.backgrounds || []).forEach(buildBgPixelCache);
        await idbSet('project', JSON.stringify(loaded));
        const neon = neonProjectRef.current;
        if (neon?.id && neon?.token) {
          const res = await fetch('/api/project', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: neon.id, token: neon.token, data: loaded })
          });
          if (!res.ok) console.warn('Neon-update na restore mislukt');
        }
        setSyncMsg('Backup hersteld');
        setTimeout(() => setSyncMsg(''), 2500);
        scheduleSave();
      } catch (err) {
        console.error(err);
        alert('Ongeldig backup-bestand');
      }
    };
    reader.readAsText(file);
  }

  // ─── Job helpers ───────────────────────────────────────────────────────
  const [jobInput, setJobInput] = useState('');
  const [expandedJobId, setExpandedJobId] = useState(null);
  const [expandedItemKey, setExpandedItemKey] = useState(null); // 'wall:id' | 'zone:id' | 'opening:id'
  // Categorieën in Alle items: standaard ingeklapt
  const [expandedCats, setExpandedCats] = useState({ walls: false, doors: false, windows: false, zones: false });

  function openCategoryForItem(type, openingType) {
    setExpandedCats((prev) => {
      const next = { ...prev };
      if (type === 'wall') next.walls = true;
      else if (type === 'zone') next.zones = true;
      else if (type === 'opening') {
        if (openingType === 'door') next.doors = true;
        else next.windows = true;
      }
      return next;
    });
  }

  function getWallNetArea(wall) {
    const len = parseInputNumber(wall.lengthStr);
    const h = parseInputNumber(wall.heightStr);
    if (!len || !h) return { gross: 0, net: 0, openings: [] };
    const gross = len * h;
    const openings = (wall.openings || []).map((op) => {
      const ow = parseInputNumber(op.widthStr);
      const oh = parseInputNumber(op.heightStr);
      return { id: op.id, label: op.label, type: op.type, area: ow * oh, w: ow, h: oh };
    });
    const openArea = openings.reduce((s, o) => s + o.area, 0);
    return { gross, net: Math.max(0, gross - openArea), openings };
  }

  function getWallLength(wall) {
    return parseInputNumber(wall.lengthStr) || 0;
  }

  function getZoneArea(zone) {
    const len = parseInputNumber(zone.lengthStr);
    const w = parseInputNumber(zone.heightStr); // heightStr = breedte in de UI
    return len * w;
  }

  function normalizeSelection(sel) {
    if (!sel) return [];
    if (sel.items) return sel.items;
    // legacy format
    if (sel.type === 'wall') {
      return (sel.ids || [sel.id]).filter(Boolean).map((id) => ({ type: 'wall', id }));
    }
    if (sel.type === 'zone') return [{ type: 'zone', id: sel.id }];
    if (sel.type === 'opening') return [{ type: 'opening', id: sel.id, wallId: sel.wallId }];
    return [];
  }

  function getSelectedItems() {
    const items = normalizeSelection(selected);
    const result = [];
    items.forEach((it) => {
      if (it.type === 'wall') {
        const w = state.walls.find((x) => x.id === it.id);
        if (w) result.push({ type: 'wall', item: w });
      } else if (it.type === 'zone') {
        const z = state.zones.find((x) => x.id === it.id);
        if (z) result.push({ type: 'zone', item: z });
      } else if (it.type === 'opening') {
        const wall = state.walls.find((w) => w.id === it.wallId);
        if (!wall) return;
        const op = (wall.openings || []).find((o) => o.id === it.id);
        if (op) result.push({ type: 'opening', item: op, wall });
      }
    });
    return result;
  }

  function selectSingleItem(type, id, wallId) {
    const item = type === 'opening' ? { type, id, wallId } : { type, id };
    setActiveJobId(null); // single-select zet job-highlight uit
    setSelected({ items: [item] });
    setExpandedItemKey(`${type}:${id}`);
  }

  function getJobStats(jobId) {
    let netM2 = 0;
    let grossM2 = 0;
    let m1 = 0;
    let itemCount = 0;
    const linked = [];

    state.walls.forEach((w) => {
      if ((w.jobs || []).includes(jobId)) {
        const { gross, net, openings } = getWallNetArea(w);
        netM2 += net;
        grossM2 += gross;
        m1 += getWallLength(w);
        itemCount += 1;
        linked.push({ type: 'wall', id: w.id, label: w.label, net, gross, openings, length: getWallLength(w) });
      }
      (w.openings || []).forEach((op) => {
        if ((op.jobs || []).includes(jobId)) {
          itemCount += 1;
          linked.push({ type: 'opening', id: op.id, wallId: w.id, label: op.label, openingType: op.type });
        }
      });
    });

    state.zones.forEach((z) => {
      if ((z.jobs || []).includes(jobId)) {
        const area = getZoneArea(z);
        netM2 += area;
        itemCount += 1;
        linked.push({ type: 'zone', id: z.id, label: z.name, area });
      }
    });

    return { netM2, grossM2, m1, itemCount, linked };
  }

  function calcJobCost(job, stats) {
    const price = parseFloat(job.price) || 0;
    if (!price) return null;
    if (job.priceType === 'fixed') return price;
    if (job.priceType === 'per_m2') return price * stats.netM2;
    if (job.priceType === 'per_m1') return price * stats.m1;
    if (job.priceType === 'per_piece') return price * stats.itemCount;
    return null;
  }

  function findOrCreateJob(name) {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const existing = (state.jobs || []).find(
      (j) => j.name.toLowerCase() === trimmed.toLowerCase()
    );
    if (existing) return existing;

    const newCounter = (state.jobCounter || 0) + 1;
    const color = JOB_COLORS[(newCounter - 1) % JOB_COLORS.length];
    const newJob = {
      id: uid(),
      name: trimmed,
      color,
      priceType: 'per_m2',
      price: '',
      notes: ''
    };
    setState((prev) => ({
      ...prev,
      jobCounter: newCounter,
      jobs: [...(prev.jobs || []), newJob]
    }));
    return newJob;
  }

  function assignJobToSelection(jobId) {
    const items = getSelectedItems();
    if (items.length === 0) return;

    setState((prev) => {
      const walls = prev.walls.map((w) => {
        let changed = false;
        let openings = w.openings;
        // wall zelf
        const wallSel = items.find((it) => it.type === 'wall' && it.item.id === w.id);
        let jobs = w.jobs || [];
        if (wallSel && !jobs.includes(jobId)) {
          jobs = [...jobs, jobId];
          changed = true;
        }
        // openings op deze muur
        if (openings) {
          openings = openings.map((op) => {
            const opSel = items.find((it) => it.type === 'opening' && it.item.id === op.id);
            if (opSel && !(op.jobs || []).includes(jobId)) {
              changed = true;
              return { ...op, jobs: [...(op.jobs || []), jobId] };
            }
            return op;
          });
        }
        if (changed) return { ...w, jobs, openings };
        return w;
      });

      const zones = prev.zones.map((z) => {
        const zoneSel = items.find((it) => it.type === 'zone' && it.item.id === z.id);
        if (zoneSel && !(z.jobs || []).includes(jobId)) {
          return { ...z, jobs: [...(z.jobs || []), jobId] };
        }
        return z;
      });

      return { ...prev, walls, zones };
    });
    scheduleSave();
  }

  function unassignJobFromItem(jobId, type, id, wallId) {
    setState((prev) => {
      if (type === 'wall') {
        return {
          ...prev,
          walls: prev.walls.map((w) =>
            w.id === id ? { ...w, jobs: (w.jobs || []).filter((j) => j !== jobId) } : w
          )
        };
      }
      if (type === 'zone') {
        return {
          ...prev,
          zones: prev.zones.map((z) =>
            z.id === id ? { ...z, jobs: (z.jobs || []).filter((j) => j !== jobId) } : z
          )
        };
      }
      if (type === 'opening') {
        return {
          ...prev,
          walls: prev.walls.map((w) => {
            if (w.id !== wallId) return w;
            return {
              ...w,
              openings: (w.openings || []).map((op) =>
                op.id === id ? { ...op, jobs: (op.jobs || []).filter((j) => j !== jobId) } : op
              )
            };
          })
        };
      }
      return prev;
    });
    scheduleSave();
  }

  function unassignJobFromSelection(jobId) {
    const items = getSelectedItems();
    if (items.length === 0) return;
    const wallIds = new Set(items.filter((it) => it.type === 'wall').map((it) => it.item.id));
    const zoneIds = new Set(items.filter((it) => it.type === 'zone').map((it) => it.item.id));
    const openingIds = new Set(items.filter((it) => it.type === 'opening').map((it) => it.item.id));

    setState((prev) => ({
      ...prev,
      walls: prev.walls.map((w) => {
        let jobs = w.jobs || [];
        let openings = w.openings;
        if (wallIds.has(w.id)) jobs = jobs.filter((j) => j !== jobId);
        if (openings) {
          openings = openings.map((op) =>
            openingIds.has(op.id)
              ? { ...op, jobs: (op.jobs || []).filter((j) => j !== jobId) }
              : op
          );
        }
        return { ...w, jobs, openings };
      }),
      zones: prev.zones.map((z) =>
        zoneIds.has(z.id) ? { ...z, jobs: (z.jobs || []).filter((j) => j !== jobId) } : z
      )
    }));
    scheduleSave();
  }

  function handleJobAssign() {
    const name = jobInput.trim();
    if (!name || !selected) return;
    // Zoek of maak job (synchroon via huidige state, async setState voor nieuw)
    const existing = (state.jobs || []).find(
      (j) => j.name.toLowerCase() === name.toLowerCase()
    );
    if (existing) {
      assignJobToSelection(existing.id);
      setJobInput('');
      return;
    }
    // Nieuwe job
    const newCounter = (state.jobCounter || 0) + 1;
    const color = JOB_COLORS[(newCounter - 1) % JOB_COLORS.length];
    const newJob = {
      id: uid(),
      name,
      color,
      priceType: 'per_m2',
      price: '',
      notes: ''
    };
    setState((prev) => {
      const withJob = {
        ...prev,
        jobCounter: newCounter,
        jobs: [...(prev.jobs || []), newJob]
      };
      // Direct toewijzen in dezelfde update
      const items = getSelectedItems();
      const walls = withJob.walls.map((w) => {
        let jobs = w.jobs || [];
        let openings = w.openings;
        const wallSel = items.find((it) => it.type === 'wall' && it.item.id === w.id);
        if (wallSel && !jobs.includes(newJob.id)) jobs = [...jobs, newJob.id];
        if (openings) {
          openings = openings.map((op) => {
            const opSel = items.find((it) => it.type === 'opening' && it.item.id === op.id);
            if (opSel && !(op.jobs || []).includes(newJob.id)) {
              return { ...op, jobs: [...(op.jobs || []), newJob.id] };
            }
            return op;
          });
        }
        return { ...w, jobs, openings };
      });
      const zones = withJob.zones.map((z) => {
        const zoneSel = items.find((it) => it.type === 'zone' && it.item.id === z.id);
        if (zoneSel && !(z.jobs || []).includes(newJob.id)) {
          return { ...z, jobs: [...(z.jobs || []), newJob.id] };
        }
        return z;
      });
      return { ...withJob, walls, zones };
    });
    setJobInput('');
    scheduleSave();
  }

  function deleteJob(jobId) {
    setState((prev) => ({
      ...prev,
      jobs: (prev.jobs || []).filter((j) => j.id !== jobId),
      walls: prev.walls.map((w) => ({
        ...w,
        jobs: (w.jobs || []).filter((j) => j !== jobId),
        openings: (w.openings || []).map((op) => ({
          ...op,
          jobs: (op.jobs || []).filter((j) => j !== jobId)
        }))
      })),
      zones: prev.zones.map((z) => ({
        ...z,
        jobs: (z.jobs || []).filter((j) => j !== jobId)
      }))
    }));
    if (activeJobId === jobId) setActiveJobId(null);
    if (expandedJobId === jobId) setExpandedJobId(null);
    scheduleSave();
  }

  function updateJob(jobId, patch) {
    setState((prev) => ({
      ...prev,
      jobs: (prev.jobs || []).map((j) => (j.id === jobId ? { ...j, ...patch } : j))
    }));
    scheduleSave();
  }

  // Jobs die al aan de huidige selectie hangen
  function getJobsOnSelection() {
    const items = getSelectedItems();
    if (items.length === 0) return [];
    const sets = items.map((it) => new Set(it.item.jobs || []));
    // Intersection: jobs die op ALLE geselecteerde items zitten
    if (sets.length === 0) return [];
    let inter = sets[0];
    for (let i = 1; i < sets.length; i++) {
      inter = new Set([...inter].filter((x) => sets[i].has(x)));
    }
    return (state.jobs || []).filter((j) => inter.has(j.id));
  }

  // Suggesties voor autocomplete
  function getJobSuggestions() {
    const q = jobInput.trim().toLowerCase();
    if (!q) return (state.jobs || []).slice(0, 8);
    return (state.jobs || []).filter((j) => j.name.toLowerCase().includes(q)).slice(0, 8);
  }

  // Sync expandedItemKey voor het "geselecteerd item"-boxje bovenaan Alle items
  useEffect(() => {
    const items = normalizeSelection(selected);
    if (items.length === 1) {
      setExpandedItemKey(`${items[0].type}:${items[0].id}`);
    } else {
      setExpandedItemKey(null);
    }
  }, [selected]);

  function normalizeLoaded(loaded) {
    if (!loaded.view) loaded.view = { pan: { x: 0, y: 0 }, zoom: 1 };
    if (!loaded.jobs) loaded.jobs = [];
    if (!loaded.jobCounter) loaded.jobCounter = 0;
    (loaded.walls || []).forEach((w) => { if (!w.jobs) w.jobs = []; });
    (loaded.zones || []).forEach((z) => { if (!z.jobs) z.jobs = []; });
    (loaded.walls || []).forEach((w) => {
      (w.openings || []).forEach((op) => { if (!op.jobs) op.jobs = []; });
    });
    return loaded;
  }

  // Laden: Neon-hoofdproject eerst (zie /api/project GET zonder id/token),
  // anders lokale IndexedDB-fallback.
  useEffect(() => {
    async function load() {
      // Eerder gekoppeld hoofdproject? Onthoud id/token voor gerichte updates.
      try {
        const stored = localStorage.getItem('vp_neon_project');
        if (stored) {
          const parsed = JSON.parse(stored);
          if (parsed?.id && parsed?.token) neonProjectRef.current = parsed;
        }
      } catch (_) {}

      try {
        setSaveState('laden…');
        const neon = neonProjectRef.current;
        const url = neon?.id && neon?.token
          ? `/api/project?id=${encodeURIComponent(neon.id)}&token=${encodeURIComponent(neon.token)}`
          : '/api/project'; // geen params → server geeft het meest recente (hoofd)project
        const res = await fetch(url);
        if (res.ok) {
          const json = await res.json();
          const loaded = normalizeLoaded(json.data || {});
          setState(loaded);
          stateRef.current = loaded;
          (loaded.backgrounds || []).forEach(buildBgPixelCache);
          neonProjectRef.current = { id: json.id, token: json.token };
          localStorage.setItem('vp_neon_project', JSON.stringify(neonProjectRef.current));
          await idbSet('project', JSON.stringify(loaded));
          setSaveState('opgeslagen');
          return;
        }
      } catch (e) {
        console.error('Neon laden mislukt', e);
      }

      // Fallback: lokale IndexedDB (nog geen hoofdproject in Neon)
      const val = await idbGet('project');
      if (val) {
        try {
          const loaded = normalizeLoaded(JSON.parse(val));
          setState(loaded);
          stateRef.current = loaded;
          (loaded.backgrounds || []).forEach(buildBgPixelCache);
        } catch (e) {}
      }
      setSaveState('opgeslagen');
    }

    load();
  }, []);

  function buildBgPixelCache(bg) {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      try {
        bgPixelCache.current[bg.id] = { natW: img.width, natH: img.height, data: ctx.getImageData(0, 0, c.width, c.height).data };
      } catch (e) { bgPixelCache.current[bg.id] = null; }
    };
    img.src = bg.dataUrl;
  }

  function addBackgroundFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const maxW = 900;
        const scaleF = Math.min(1, maxW / img.width);
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scaleF);
        c.height = Math.round(img.height * scaleF);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        const dataUrl = c.toDataURL('image/jpeg', 0.75);

        const newCounter = state.bgCounter + 1;
        let x = 0;
        if (state.backgrounds.length > 0) {
          x = Math.max(...state.backgrounds.map((b) => b.x + b.width)) + 60;
        }
        const bg = { id: uid(), name: 'Plattegrond ' + newCounter, dataUrl, x, y: 0, width: 700, height: 700 * (img.height / img.width), opacity: 1 };
        buildBgPixelCache(bg);
        setState((prev) => ({ ...prev, bgCounter: newCounter, backgrounds: [...prev.backgrounds, bg] }));
        scheduleSave();
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  function addOpeningToWall(wallId, type) {
    const wall = state.walls.find((w) => w.id === wallId);
    if (!wall) return;

    if (!wall.openings) wall.openings = [];
    const newCounter = state.openingCounter + 1;
    const isDoor = type === 'door';

    const newOp = {
      id: uid(),
      wallId: wall.id,
      label: (isDoor ? 'Deur ' : 'Raam ') + newCounter,
      type,
      offsetRatio: 0.5,
      widthStr: isDoor ? '0,90' : '1,20',
      heightStr: isDoor ? '2,10' : '1,50',
      flipSide: false,
      flipHand: false,
      jobs: []
    };

    wall.openings.push(newOp);
    setState({ ...state, openingCounter: newCounter });
    setSelected({ items: [{ type: 'opening', id: newOp.id, wallId: wall.id }] });
    scheduleSave();
  }

  return (
    <div className="vp-root">
      {/* Toolbar */}
      <div className="vp-toolbar">
        {/* Tabs */}
        <button
          className={`vp-btn ${activeTab === 'algemeen' ? 'active' : ''}`}
          onClick={() => { setActiveTab('algemeen'); setMode('select'); setDrawPoints([]); setMovingBgId(null); }}
        >
          📋 Algemeen
        </button>
        <button
          className={`vp-btn ${activeTab === 'build' ? 'active' : ''}`}
          onClick={() => setActiveTab('build')}
        >
          📐 Build
        </button>

        <div className="vp-sep" />

        {/* Build-tools alleen zichtbaar in Build-tab */}
        {activeTab === 'build' && (
          <>
            {[
              { id: 'select', label: 'Selecteren' },
              { id: 'wall', label: 'Muur tekenen' },
              { id: 'zone', label: 'Ruimte tekenen' },
              { id: 'cut', label: 'Ruimte splitsen (Cut)' },
              { id: 'door', label: '+ Deur' },
              { id: 'window', label: '+ Raam' }
            ].map((btn) => (
              <button
                key={btn.id}
                className={`vp-btn ${mode === btn.id ? 'active' : ''}`}
                onClick={() => { setMode(btn.id); setDrawPoints([]); }}
              >
                {btn.label}
              </button>
            ))}

            {mode === 'wall' && drawPoints.length > 0 && (
              <button className="vp-btn" onClick={() => setDrawPoints([])}>Muurketen afronden</button>
            )}
            {mode === 'cut' && drawPoints.length > 0 && (
              <button className="vp-btn" onClick={() => setDrawPoints([])}>Annuleer snede</button>
            )}

            <button
              className={`vp-btn ${magneticOn ? 'active' : ''}`}
              onClick={() => setMagneticOn(!magneticOn)}
            >
              Magnetisch snappen
            </button>
            <div className="vp-sep" />

            <label className="vp-btn">
              + Plattegrond
              <input
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={(e) => { if (e.target.files[0]) addBackgroundFile(e.target.files[0]); }}
              />
            </label>
            <div className="vp-sep" />
          </>
        )}

        <span className="vp-label">Zoom {Math.round(state.view.zoom * 100)}%</span>
        <button
          className="vp-btn"
          onClick={() => setState((p) => ({ ...p, view: { pan: { x: 0, y: 0 }, zoom: 1 } }))}
        >
          Zoom reset
        </button>
        <div className="vp-sep" />

        <button
          className="vp-btn danger"
          onClick={() => {
            if (prompt('Typ WISSEN om alles te verwijderen') === 'WISSEN') {
              setState({
                wallCounter: 0, zoneCounter: 0, bgCounter: 0, openingCounter: 0, jobCounter: 0,
                backgrounds: [], walls: [], zones: [], jobs: [],
                view: { pan: { x: 0, y: 0 }, zoom: 1 }
              });
              setSelected(null);
              setActiveJobId(null);
              scheduleSave();
            }
          }}
        >
          Alles wissen
        </button>
        <div className="vp-sep" />
        <button className="vp-btn" onClick={downloadBackup} title="Download je project als JSON">
          ⬇ Backup
        </button>
        <label className="vp-btn" title="Herstel project uit JSON-bestand">
          ⬆ Herstel
          <input
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={(e) => {
              if (e.target.files?.[0]) restoreBackupFile(e.target.files[0]);
              e.target.value = '';
            }}
          />
        </label>
        <button
          className="vp-btn"
          onClick={migrateToNeon}
          title="Upload je huidige lokale data naar Neon en stel in als hoofdproject"
        >
          ☁️ Migreer naar Neon
        </button>
        {syncMsg && <span className="vp-label" style={{ color: '#7dd3fc' }}>{syncMsg}</span>}
        <span
          title={neonProjectRef.current ? 'Gekoppeld aan het hoofdproject in Neon' : 'Nog niet gemigreerd – lokaal'}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            marginLeft: 4,
            fontSize: 12,
            color: '#9FC2D8'
          }}
        >
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: neonProjectRef.current ? '#22c55e' : '#4b5563'
            }}
          />
          {neonProjectRef.current ? 'Neon' : 'lokaal'}
        </span>
        <span className="vp-savestate">{saveState}</span>
      </div>

      {/* Body */}
      <div className="vp-body">
        <PlannerCanvas
          state={state} setState={setState}
          mode={activeTab === 'algemeen' ? 'select' : mode}
          setMode={setMode}
          drawPoints={drawPoints} setDrawPoints={setDrawPoints}
          selected={selected} setSelected={setSelected}
          movingBgId={movingBgId} setMovingBgId={setMovingBgId}
          bgPixelCache={bgPixelCache.current} magneticOn={magneticOn}
          scheduleSave={scheduleSave}
          activeTab={activeTab}
          activeJobId={activeJobId}
          setActiveJobId={setActiveJobId}
        />

        {/* Zijpanelen */}
        {activeTab === 'algemeen' && (
          <>
            {/* Panel 1: Klussen */}
            <div className="vp-panel">
              <h3>Klussen & Nacalculatie</h3>

              {/* Selectie-indicator */}
              <div style={{ fontSize: '12.5px', color: '#6B675C', marginBottom: '12px', padding: '8px 10px', background: '#EAE7DC', borderRadius: '6px' }}>
                {(() => {
                  const items = getSelectedItems();
                  if (items.length === 0) return 'Niets geselecteerd – klik objecten (Ctrl+klik = multi, ook mix)';
                  const walls = items.filter((i) => i.type === 'wall').length;
                  const zones = items.filter((i) => i.type === 'zone').length;
                  const ops = items.filter((i) => i.type === 'opening').length;
                  const parts = [];
                  if (walls) parts.push(`${walls} muur${walls > 1 ? 'en' : ''}`);
                  if (zones) parts.push(`${zones} ruimte${zones > 1 ? 's' : ''}`);
                  if (ops) parts.push(`${ops} opening${ops > 1 ? 'en' : ''}`);
                  return parts.join(' + ') + ' geselecteerd';
                })()}
              </div>

              {/* Job Assigner */}
              <div className="vp-field" style={{ position: 'relative' }}>
                <label>Klus toewijzen</label>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <input
                    type="text"
                    placeholder="Typ klusnaam (bijv. Stucen)…"
                    value={jobInput}
                    disabled={!selected}
                    style={{ opacity: selected ? 1 : 0.5, flex: 1 }}
                    onChange={(e) => setJobInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleJobAssign();
                      }
                    }}
                  />
                  <button
                    className="vp-btn"
                    style={{ background: selected && jobInput.trim() ? '#1E6E7A' : undefined, color: selected && jobInput.trim() ? '#fff' : undefined, borderColor: selected && jobInput.trim() ? '#1E6E7A' : undefined }}
                    disabled={!selected || !jobInput.trim()}
                    onClick={handleJobAssign}
                  >
                    Koppel
                  </button>
                </div>

                {/* Suggesties */}
                {selected && jobInput.trim() && getJobSuggestions().length > 0 && (
                  <div style={{
                    position: 'absolute', left: 0, right: 0, top: '100%', zIndex: 10,
                    background: '#fff', border: '1px solid #D6D2C6', borderRadius: '6px',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.12)', maxHeight: '160px', overflowY: 'auto'
                  }}>
                    {getJobSuggestions().map((j) => (
                      <div
                        key={j.id}
                        style={{ padding: '7px 10px', cursor: 'pointer', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px' }}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          setJobInput(j.name);
                          assignJobToSelection(j.id);
                          setJobInput('');
                        }}
                      >
                        <span style={{ width: 10, height: 10, borderRadius: 2, background: j.color, flexShrink: 0 }} />
                        {j.name}
                      </div>
                    ))}
                  </div>
                )}

                {/* Badges van klussen op huidige selectie */}
                {selected && getJobsOnSelection().length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' }}>
                    {getJobsOnSelection().map((j) => (
                      <span
                        key={j.id}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: '4px',
                          background: j.color + '22', border: `1px solid ${j.color}`,
                          color: '#1B2733', fontSize: '12px', padding: '3px 8px', borderRadius: '12px'
                        }}
                      >
                        {j.name}
                        <button
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#B34848', fontSize: '14px', lineHeight: 1, padding: 0 }}
                          onClick={() => unassignJobFromSelection(j.id)}
                          title="Ontkoppelen"
                        >
                          ✕
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Live Dashboard */}
              <div style={{ marginTop: '18px' }}>
                <h3 style={{ fontSize: '14px', marginBottom: '10px' }}>Overzicht klussen</h3>
                {(state.jobs || []).length === 0 ? (
                  <p className="vp-empty">Nog geen klussen. Selecteer objecten en wijs een klus toe.</p>
                ) : (
                  (state.jobs || []).map((job) => {
                    const stats = getJobStats(job.id);
                    const cost = calcJobCost(job, stats);
                    const isExpanded = expandedJobId === job.id;
                    const isHighlighted = activeJobId === job.id;

                    return (
                      <div
                        key={job.id}
                        className="vp-opening-card"
                        style={{
                          borderLeft: '4px solid ' + job.color,
                          outline: isHighlighted ? ('2px solid ' + job.color) : 'none',
                          marginBottom: '10px'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span
                            style={{ width: 12, height: 12, borderRadius: 3, background: job.color, flexShrink: 0 }}
                          />
                          <strong style={{ flex: 1, fontSize: '13.5px' }}>{job.name}</strong>
                          <button
                            className="vp-btn"
                            style={{ padding: '3px 7px', fontSize: '11px' }}
                            onClick={() => setActiveJobId(isHighlighted ? null : job.id)}
                          >
                            {isHighlighted ? '● Highlight' : 'Highlight'}
                          </button>
                          <button
                            className="vp-btn"
                            style={{ padding: '3px 7px', fontSize: '11px' }}
                            onClick={() => setExpandedJobId(isExpanded ? null : job.id)}
                          >
                            {isExpanded ? '▲' : '▼'}
                          </button>
                        </div>

                        {isExpanded && (
                          <div style={{ marginTop: '10px' }}>
                            <div className="vp-metric-list" style={{ marginTop: 0 }}>
                              <div className="vp-metric-item">
                                <span>Netto oppervlakte</span>
                                <span>{fmtComma(stats.netM2)} m²</span>
                              </div>
                              <div className="vp-metric-item">
                                <span>Strekkende meters</span>
                                <span>{fmtComma(stats.m1)} m¹</span>
                              </div>
                              <div className="vp-metric-item">
                                <span>Aantal objecten</span>
                                <span>{stats.itemCount}</span>
                              </div>
                              {cost != null && (
                                <div className="vp-metric-item net">
                                  <span>Geschatte kosten</span>
                                  <span>€ {fmtComma(cost, 0)}</span>
                                </div>
                              )}
                            </div>

                            <div style={{ display: 'flex', gap: '6px', marginTop: '8px', alignItems: 'center' }}>
                              <select
                                value={job.priceType || 'per_m2'}
                                onChange={(e) => updateJob(job.id, { priceType: e.target.value })}
                                style={{ fontSize: '12px', padding: '4px 6px', borderRadius: 5, border: '1px solid #D6D2C6', flex: 1 }}
                              >
                                <option value="fixed">Vast bedrag</option>
                                <option value="per_m2">€ / m²</option>
                                <option value="per_m1">€ / m¹</option>
                                <option value="per_piece">€ / stuk</option>
                              </select>
                              <input
                                type="text"
                                placeholder="Prijs"
                                value={job.price ?? ''}
                                onChange={(e) => updateJob(job.id, { price: e.target.value.replace('.', ',') })}
                                style={{ width: 70, fontSize: '12px', padding: '4px 6px', borderRadius: 5, border: '1px solid #D6D2C6' }}
                              />
                            </div>

                            <div style={{ marginTop: '10px', fontSize: '12px' }}>
                              {stats.linked.length === 0 && (
                                <p style={{ color: '#9ca3af' }}>Nog geen objecten gekoppeld.</p>
                              )}
                              {stats.linked.map((lnk) => (
                                <div
                                  key={lnk.type + lnk.id}
                                  style={{
                                    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
                                    padding: '6px 0', borderBottom: '1px solid #E2DFD4', gap: '8px'
                                  }}
                                >
                                  <div
                                    style={{ flex: 1, cursor: 'pointer' }}
                                    onClick={() => selectSingleItem(lnk.type, lnk.id, lnk.wallId)}
                                    title="Selecteer op plattegrond"
                                  >
                                    <div style={{ fontWeight: 500 }}>
                                      {lnk.type === 'wall' && '🧱 '}
                                      {lnk.type === 'zone' && '▢ '}
                                      {lnk.type === 'opening' && (lnk.openingType === 'door' ? '🚪 ' : '🪟 ')}
                                      {lnk.label}
                                    </div>
                                    {lnk.type === 'wall' && (
                                      <div style={{ color: '#6B675C', fontSize: '11px', marginTop: 2 }}>
                                        Bruto {fmtComma(lnk.gross)} m²
                                        {(lnk.openings || []).map((o) => (
                                          <span key={o.id}> − {o.label} {fmtComma(o.area)} m²</span>
                                        ))}
                                        {' = '}
                                        <strong>Netto {fmtComma(lnk.net)} m²</strong>
                                        {lnk.length > 0 && <> · {fmtComma(lnk.length)} m¹</>}
                                      </div>
                                    )}
                                    {lnk.type === 'zone' && (
                                      <div style={{ color: '#6B675C', fontSize: '11px', marginTop: 2 }}>
                                        {fmtComma(lnk.area)} m²
                                      </div>
                                    )}
                                  </div>
                                  <button
                                    style={{ background: 'none', border: 'none', color: '#B34848', cursor: 'pointer', fontSize: '13px', padding: 0 }}
                                    onClick={() => unassignJobFromItem(job.id, lnk.type, lnk.id, lnk.wallId)}
                                    title="Ontkoppelen"
                                  >
                                    ✕
                                  </button>
                                </div>
                              ))}
                            </div>

                            <button
                              className="vp-deletebtn"
                              style={{ marginTop: '10px' }}
                              onClick={() => { if (confirm('Klus "' + job.name + '" verwijderen?')) deleteJob(job.id); }}
                            >
                              Klus verwijderen
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Panel 2: Alle items */}
            <div className="vp-panel">
              <h3>Alle items</h3>
              <p style={{ fontSize: '11.5px', color: '#6B675C', marginBottom: '12px' }}>
                Klik om te selecteren en eigenschappen te zien
              </p>

              {/* Geselecteerd item bovenaan (alleen bij single-select) */}
              {(() => {
                const items = getSelectedItems();
                if (items.length !== 1) return null;
                const { type, item, wall } = items[0];

                if (type === 'wall') {
                  const { net, gross } = getWallNetArea(item);
                  return (
                    <div className="vp-opening-card" style={{ marginBottom: 14, outline: '2px solid #FFB347' }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: '#6B675C', marginBottom: 6 }}>GESELECTEERD · MUUR</div>
                      <div className="vp-field">
                        <label>Naam</label>
                        <input type="text" value={item.label || ''} onChange={(e) => { item.label = e.target.value; setState({ ...state }); scheduleSave(); }} />
                      </div>
                      <div className="vp-field">
                        <label>Type</label>
                        <select value={item.type || ''} onChange={(e) => { item.type = e.target.value; setState({ ...state }); scheduleSave(); }}>
                          <option value="Buitengevel">Buitengevel</option>
                          <option value="Binnenmuur">Binnenmuur</option>
                          <option value="Scheidingswand">Scheidingswand</option>
                        </select>
                      </div>
                      <div className="vp-field">
                        <label>Lengte (m)</label>
                        <input type="text" value={item.lengthStr || ''} onChange={(e) => { item.lengthStr = normalizeInputString(e.target.value); setState({ ...state }); scheduleSave(); }} />
                      </div>
                      <div className="vp-field">
                        <label>Hoogte (m)</label>
                        <input type="text" value={item.heightStr || ''} onChange={(e) => { item.heightStr = normalizeInputString(e.target.value); setState({ ...state }); scheduleSave(); }} />
                      </div>
                      <div className="vp-metric-list">
                        <div className="vp-metric-item"><span>Bruto</span><span>{fmtComma(gross)} m²</span></div>
                        {(item.openings || []).map((op) => {
                          const a = parseInputNumber(op.widthStr) * parseInputNumber(op.heightStr);
                          return (
                            <div key={op.id} className="vp-metric-item" style={{ fontSize: 11, color: '#9ca3af' }}>
                              <span>− {op.label}</span><span>−{fmtComma(a)} m²</span>
                            </div>
                          );
                        })}
                        <div className="vp-metric-item net"><span>Netto</span><span>{fmtComma(net)} m²</span></div>
                      </div>
                    </div>
                  );
                }

                if (type === 'zone') {
                  const area = getZoneArea(item);
                  return (
                    <div className="vp-opening-card" style={{ marginBottom: 14, outline: '2px solid #FFB347' }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: '#6B675C', marginBottom: 6 }}>GESELECTEERD · RUIMTE</div>
                      <div className="vp-field">
                        <label>Naam</label>
                        <input type="text" value={item.name || ''} onChange={(e) => { item.name = e.target.value; setState({ ...state }); scheduleSave(); }} />
                      </div>
                      <div className="vp-field">
                        <label>Lengte (m)</label>
                        <input type="text" value={item.lengthStr || ''} onChange={(e) => { item.lengthStr = normalizeInputString(e.target.value); setState({ ...state }); scheduleSave(); }} />
                      </div>
                      <div className="vp-field">
                        <label>Breedte (m)</label>
                        <input type="text" value={item.heightStr || ''} onChange={(e) => { item.heightStr = normalizeInputString(e.target.value); setState({ ...state }); scheduleSave(); }} />
                      </div>
                      <div className="vp-metric-list">
                        <div className="vp-metric-item net"><span>Oppervlakte</span><span>{fmtComma(area)} m²</span></div>
                      </div>
                    </div>
                  );
                }

                if (type === 'opening') {
                  return (
                    <div className="vp-opening-card" style={{ marginBottom: 14, outline: '2px solid #FFB347' }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: '#6B675C', marginBottom: 6 }}>
                        GESELECTEERD · {item.type === 'door' ? 'DEUR' : 'RAAM'}
                      </div>
                      <div className="vp-field">
                        <label>Naam</label>
                        <input type="text" value={item.label || ''} onChange={(e) => { item.label = e.target.value; setState({ ...state }); scheduleSave(); }} />
                      </div>
                      <div className="vp-field">
                        <label>Breedte (m)</label>
                        <input type="text" value={item.widthStr || ''} onChange={(e) => { item.widthStr = normalizeInputString(e.target.value); setState({ ...state }); scheduleSave(); }} />
                      </div>
                      <div className="vp-field">
                        <label>Hoogte (m)</label>
                        <input type="text" value={item.heightStr || ''} onChange={(e) => { item.heightStr = normalizeInputString(e.target.value); setState({ ...state }); scheduleSave(); }} />
                      </div>
                    </div>
                  );
                }
                return null;
              })()}

              {/* Muren */}
              <div style={{ marginBottom: '14px' }}>
                <div
                  style={{ fontSize: '11px', fontWeight: 600, color: '#6B675C', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
                  onClick={() => setExpandedCats((p) => ({ ...p, walls: !p.walls }))}
                >
                  <span>{expandedCats.walls ? '▼' : '▶'}</span>
                  Muren ({state.walls.length})
                </div>
                {expandedCats.walls && state.walls.length === 0 && <p className="vp-empty" style={{ paddingTop: 0 }}>Geen muren</p>}
                {expandedCats.walls && state.walls.map((w) => {
                  const key = `wall:${w.id}`;
                  const isOpen = expandedItemKey === key;
                  const isSel = normalizeSelection(selected).some((i) => i.type === 'wall' && i.id === w.id);
                  const { net, gross } = getWallNetArea(w);
                  return (
                    <div
                      key={w.id}
                      id={`item-wall-${w.id}`}
                      className="vp-opening-card"
                      style={{
                        marginBottom: 6,
                        outline: isSel ? '2px solid #FFB347' : 'none',
                        cursor: 'pointer'
                      }}
                    >
                      <div
                        style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                        onClick={() => {
                          if (isOpen) {
                            setExpandedItemKey(null);
                          } else {
                            selectSingleItem('wall', w.id);
                          }
                        }}
                      >
                        <span style={{ fontSize: 12 }}>{isOpen ? '▼' : '▶'}</span>
                        <strong style={{ flex: 1, fontSize: 13 }}>{w.label || 'Muur'}</strong>
                        <span style={{ fontSize: 11, color: '#6B675C' }}>
                          {gross > 0 ? `${fmtComma(net)} m²` : '—'}
                        </span>
                      </div>
                      {isOpen && (
                        <div style={{ marginTop: 8, borderTop: '1px solid #E2DFD4', paddingTop: 8 }} onClick={(e) => e.stopPropagation()}>
                          <div className="vp-field">
                            <label>Naam</label>
                            <input type="text" value={w.label || ''} onChange={(e) => { w.label = e.target.value; setState({ ...state }); scheduleSave(); }} />
                          </div>
                          <div className="vp-field">
                            <label>Type</label>
                            <select value={w.type || ''} onChange={(e) => { w.type = e.target.value; setState({ ...state }); scheduleSave(); }}>
                              <option value="Buitengevel">Buitengevel</option>
                              <option value="Binnenmuur">Binnenmuur</option>
                              <option value="Scheidingswand">Scheidingswand</option>
                            </select>
                          </div>
                          <div className="vp-field">
                            <label>Lengte (m)</label>
                            <input type="text" value={w.lengthStr || ''} onChange={(e) => { w.lengthStr = normalizeInputString(e.target.value); setState({ ...state }); scheduleSave(); }} />
                          </div>
                          <div className="vp-field">
                            <label>Hoogte (m)</label>
                            <input type="text" value={w.heightStr || ''} onChange={(e) => { w.heightStr = normalizeInputString(e.target.value); setState({ ...state }); scheduleSave(); }} />
                          </div>
                          <div className="vp-metric-list">
                            <div className="vp-metric-item"><span>Bruto</span><span>{fmtComma(gross)} m²</span></div>
                            {(w.openings || []).map((op) => {
                              const a = parseInputNumber(op.widthStr) * parseInputNumber(op.heightStr);
                              return (
                                <div key={op.id} className="vp-metric-item" style={{ fontSize: 11, color: '#9ca3af' }}>
                                  <span>− {op.label}</span><span>−{fmtComma(a)} m²</span>
                                </div>
                              );
                            })}
                            <div className="vp-metric-item net"><span>Netto</span><span>{fmtComma(net)} m²</span></div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Deuren */}
              <div style={{ marginBottom: '14px' }}>
                <div
                  style={{ fontSize: '11px', fontWeight: 600, color: '#6B675C', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
                  onClick={() => setExpandedCats((p) => ({ ...p, doors: !p.doors }))}
                >
                  <span>{expandedCats.doors ? '▼' : '▶'}</span>
                  Deuren ({state.walls.reduce((n, w) => n + (w.openings || []).filter((o) => o.type === 'door').length, 0)})
                </div>
                {expandedCats.doors && state.walls.flatMap((w) =>
                  (w.openings || []).filter((o) => o.type === 'door').map((op) => {
                    const key = `opening:${op.id}`;
                    const isOpen = expandedItemKey === key;
                    const isSel = normalizeSelection(selected).some((i) => i.type === 'opening' && i.id === op.id);
                    return (
                      <div key={op.id} id={`item-opening-${op.id}`} className="vp-opening-card" style={{ marginBottom: 6, outline: isSel ? '2px solid #FFB347' : 'none', cursor: 'pointer' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }} onClick={() => isOpen ? setExpandedItemKey(null) : selectSingleItem('opening', op.id, w.id)}>
                          <span style={{ fontSize: 12 }}>{isOpen ? '▼' : '▶'}</span>
                          <strong style={{ flex: 1, fontSize: 13 }}>{op.label}</strong>
                          <span style={{ fontSize: 11, color: '#6B675C' }}>{op.widthStr || '—'}×{op.heightStr || '—'} m</span>
                        </div>
                        {isOpen && (
                          <div style={{ marginTop: 8, borderTop: '1px solid #E2DFD4', paddingTop: 8 }} onClick={(e) => e.stopPropagation()}>
                            <div className="vp-field">
                              <label>Naam</label>
                              <input type="text" value={op.label || ''} onChange={(e) => { op.label = e.target.value; setState({ ...state }); scheduleSave(); }} />
                            </div>
                            <div className="vp-field">
                              <label>Breedte (m)</label>
                              <input type="text" value={op.widthStr || ''} onChange={(e) => { op.widthStr = normalizeInputString(e.target.value); setState({ ...state }); scheduleSave(); }} />
                            </div>
                            <div className="vp-field">
                              <label>Hoogte (m)</label>
                              <input type="text" value={op.heightStr || ''} onChange={(e) => { op.heightStr = normalizeInputString(e.target.value); setState({ ...state }); scheduleSave(); }} />
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              {/* Ramen */}
              <div style={{ marginBottom: '14px' }}>
                <div
                  style={{ fontSize: '11px', fontWeight: 600, color: '#6B675C', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
                  onClick={() => setExpandedCats((p) => ({ ...p, windows: !p.windows }))}
                >
                  <span>{expandedCats.windows ? '▼' : '▶'}</span>
                  Ramen ({state.walls.reduce((n, w) => n + (w.openings || []).filter((o) => o.type === 'window').length, 0)})
                </div>
                {expandedCats.windows && state.walls.flatMap((w) =>
                  (w.openings || []).filter((o) => o.type === 'window').map((op) => {
                    const key = `opening:${op.id}`;
                    const isOpen = expandedItemKey === key;
                    const isSel = normalizeSelection(selected).some((i) => i.type === 'opening' && i.id === op.id);
                    return (
                      <div key={op.id} id={`item-opening-${op.id}`} className="vp-opening-card" style={{ marginBottom: 6, outline: isSel ? '2px solid #FFB347' : 'none', cursor: 'pointer' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }} onClick={() => isOpen ? setExpandedItemKey(null) : selectSingleItem('opening', op.id, w.id)}>
                          <span style={{ fontSize: 12 }}>{isOpen ? '▼' : '▶'}</span>
                          <strong style={{ flex: 1, fontSize: 13 }}>{op.label}</strong>
                          <span style={{ fontSize: 11, color: '#6B675C' }}>{op.widthStr || '—'}×{op.heightStr || '—'} m</span>
                        </div>
                        {isOpen && (
                          <div style={{ marginTop: 8, borderTop: '1px solid #E2DFD4', paddingTop: 8 }} onClick={(e) => e.stopPropagation()}>
                            <div className="vp-field">
                              <label>Naam</label>
                              <input type="text" value={op.label || ''} onChange={(e) => { op.label = e.target.value; setState({ ...state }); scheduleSave(); }} />
                            </div>
                            <div className="vp-field">
                              <label>Breedte (m)</label>
                              <input type="text" value={op.widthStr || ''} onChange={(e) => { op.widthStr = normalizeInputString(e.target.value); setState({ ...state }); scheduleSave(); }} />
                            </div>
                            <div className="vp-field">
                              <label>Hoogte (m)</label>
                              <input type="text" value={op.heightStr || ''} onChange={(e) => { op.heightStr = normalizeInputString(e.target.value); setState({ ...state }); scheduleSave(); }} />
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              {/* Ruimtes */}
              <div style={{ marginBottom: '14px' }}>
                <div
                  style={{ fontSize: '11px', fontWeight: 600, color: '#6B675C', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
                  onClick={() => setExpandedCats((p) => ({ ...p, zones: !p.zones }))}
                >
                  <span>{expandedCats.zones ? '▼' : '▶'}</span>
                  Ruimtes ({state.zones.length})
                </div>
                {expandedCats.zones && state.zones.length === 0 && <p className="vp-empty" style={{ paddingTop: 0 }}>Geen ruimtes</p>}
                {expandedCats.zones && state.zones.map((z) => {
                  const key = `zone:${z.id}`;
                  const isOpen = expandedItemKey === key;
                  const isSel = normalizeSelection(selected).some((i) => i.type === 'zone' && i.id === z.id);
                  const area = getZoneArea(z);
                  return (
                    <div key={z.id} id={`item-zone-${z.id}`} className="vp-opening-card" style={{ marginBottom: 6, outline: isSel ? '2px solid #FFB347' : 'none', cursor: 'pointer' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }} onClick={() => isOpen ? setExpandedItemKey(null) : selectSingleItem('zone', z.id)}>
                        <span style={{ fontSize: 12 }}>{isOpen ? '▼' : '▶'}</span>
                        <span style={{ width: 10, height: 10, borderRadius: 2, background: z.color || '#E8E2D5', flexShrink: 0 }} />
                        <strong style={{ flex: 1, fontSize: 13 }}>{z.name || 'Ruimte'}</strong>
                        <span style={{ fontSize: 11, color: '#6B675C' }}>{area > 0 ? `${fmtComma(area)} m²` : '—'}</span>
                      </div>
                      {isOpen && (
                        <div style={{ marginTop: 8, borderTop: '1px solid #E2DFD4', paddingTop: 8 }} onClick={(e) => e.stopPropagation()}>
                          <div className="vp-field">
                            <label>Naam</label>
                            <input type="text" value={z.name || ''} onChange={(e) => { z.name = e.target.value; setState({ ...state }); scheduleSave(); }} />
                          </div>
                          <div className="vp-field">
                            <label>Lengte (m)</label>
                            <input type="text" value={z.lengthStr || ''} onChange={(e) => { z.lengthStr = normalizeInputString(e.target.value); setState({ ...state }); scheduleSave(); }} />
                          </div>
                          <div className="vp-field">
                            <label>Breedte (m)</label>
                            <input type="text" value={z.heightStr || ''} onChange={(e) => { z.heightStr = normalizeInputString(e.target.value); setState({ ...state }); scheduleSave(); }} />
                          </div>
                          <div className="vp-metric-list">
                            <div className="vp-metric-item net"><span>Oppervlakte</span><span>{fmtComma(area)} m²</span></div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {/* ─── TAB: BUILD ─── */}
        {activeTab === 'build' && (
          <div className="vp-panel">
              {!selected && (
                <div>
                  <h3>Plattegronden</h3>
                  {state.backgrounds.length === 0 && <p style={{ fontSize: '13px', color: '#9ca3af' }}>Nog geen plattegronden geladen.</p>}
                  {state.backgrounds.map((bg) => (
                    <div key={bg.id} className="vp-opening-card">
                      <input type="text" value={bg.name} onChange={(e) => { bg.name = e.target.value; setState({ ...state }); scheduleSave(); }} />
                      <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
                        <button className="del" style={{ color: '#1E6E7A' }} onClick={() => setMovingBgId(movingBgId === bg.id ? null : bg.id)}>
                          {movingBgId === bg.id ? 'Stop verplaatsen' : 'Verplaatsen'}
                        </button>
                        <button className="del" onClick={() => { setState({ ...state, backgrounds: state.backgrounds.filter((b) => b.id !== bg.id) }); scheduleSave(); }}>
                          Verwijderen
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

          {/* MUUR GESELECTEERD */}
          {(() => {
            const selItems = normalizeSelection(selected);
            const wallIds = selItems.filter((i) => i.type === 'wall').map((i) => i.id);
            // Alleen muur-properties tonen als er uitsluitend muren geselecteerd zijn
            if (wallIds.length === 0 || selItems.some((i) => i.type !== 'wall')) return null;
            const selectedIds = wallIds;
            const selectedWalls = state.walls.filter((x) => selectedIds.includes(x.id));
            if (selectedWalls.length === 0) return null;

            const isMulti = selectedWalls.length > 1;
            const firstW = selectedWalls[0];

            const commonLabel = selectedWalls.every((w) => w.label === firstW.label) ? firstW.label : '';
            const commonType = selectedWalls.every((w) => w.type === firstW.type) ? firstW.type : '';
            const commonLength = selectedWalls.every((w) => w.lengthStr === firstW.lengthStr) ? (firstW.lengthStr || '') : '';
            const commonHeight = selectedWalls.every((w) => w.heightStr === firstW.heightStr) ? (firstW.heightStr || '') : '';
            const commonThickness = selectedWalls.every((w) => w.thickness === firstW.thickness) ? (firstW.thickness ?? '') : '';

            // Netto vs Bruto oppervlakte berekening
            const lenVal = parseInputNumber(firstW.lengthStr);
            const heightVal = parseInputNumber(firstW.heightStr);
            const grossArea = lenVal * heightVal;

            const openings = firstW.openings || [];
            let totalOpeningsArea = 0;
            const openingsList = openings.map((op) => {
              const opW = parseInputNumber(op.widthStr);
              const opH = parseInputNumber(op.heightStr);
              const opArea = opW * opH;
              totalOpeningsArea += opArea;
              return { label: op.label, type: op.type, area: opArea, w: opW, h: opH };
            });

            const netArea = Math.max(0, grossArea - totalOpeningsArea);
            const hasValues = firstW.lengthStr && firstW.heightStr && lenVal > 0 && heightVal > 0;

            return (
              <div>
                {!isMulti && (
                  <div className="vp-field">
                    <label>Naam muur</label>
                    <input
                      type="text"
                      value={commonLabel}
                      onChange={(e) => {
                        firstW.label = e.target.value;
                        setState({ ...state });
                        scheduleSave();
                      }}
                    />
                  </div>
                )}

                <h3>{isMulti ? `${selectedWalls.length} muren geselecteerd` : firstW.label}</h3>

                <div className="vp-field">
                  <label>Type</label>
                  <select
                    value={commonType}
                    onChange={(e) => {
                      const val = e.target.value;
                      selectedWalls.forEach((w) => { w.type = val; });
                      setState({ ...state });
                      scheduleSave();
                    }}
                  >
                    {!commonType && <option value="">-- Selecteer type --</option>}
                    <option value="Buitengevel">Buitengevel</option>
                    <option value="Binnenmuur">Binnenmuur</option>
                    <option value="Scheidingswand">Scheidingswand</option>
                  </select>
                </div>

                <div className="vp-field">
                  <label>Lengte (m)</label>
                  <input
                    type="text"
                    placeholder="bijv. 3,5"
                    value={commonLength}
                    onChange={(e) => {
                      const val = normalizeInputString(e.target.value);
                      selectedWalls.forEach((w) => { w.lengthStr = val; });
                      setState({ ...state });
                      scheduleSave();
                    }}
                  />
                </div>

                <div className="vp-field">
                  <label>Hoogte (m)</label>
                  <input
                    type="text"
                    placeholder="bijv. 2,6"
                    value={commonHeight}
                    onChange={(e) => {
                      const val = normalizeInputString(e.target.value);
                      selectedWalls.forEach((w) => { w.heightStr = val; });
                      setState({ ...state });
                      scheduleSave();
                    }}
                  />
                </div>

                <div className="vp-field">
                  <label>Muurdikte (px):</label>
                  <input
                    type="number"
                    placeholder="bijv. 12"
                    value={commonThickness}
                    onChange={(e) => {
                      const raw = e.target.value;
                      const val = raw === '' ? '' : parseFloat(raw);
                      selectedWalls.forEach((w) => { w.thickness = val; });
                      setState({ ...state });
                      scheduleSave();
                    }}
                  />
                </div>

                {!isMulti && (
                  <>
                    <div style={{ display: 'flex', gap: '8px', marginTop: '12px', marginBottom: '12px' }}>
                      <button className="vp-btn" onClick={() => addOpeningToWall(firstW.id, 'door')}>+ Deur toevoegen</button>
                      <button className="vp-btn" onClick={() => addOpeningToWall(firstW.id, 'window')}>+ Raam toevoegen</button>
                    </div>

                    <div className="vp-metric-list">
                      <div className="vp-metric-item">
                        <span>Bruto oppervlakte:</span>
                        <span>{hasValues ? `${fmtComma(grossArea)} m²` : '⚠️ Vul in'}</span>
                      </div>

                      {openingsList.map((item, idx) => (
                        <div key={idx} className="vp-metric-item" style={{ fontSize: '11px', color: '#9ca3af' }}>
                          <span>- {item.label} ({fmtComma(item.w)}×{fmtComma(item.h)}m):</span>
                          <span>-{fmtComma(item.area)} m²</span>
                        </div>
                      ))}

                      <div className="vp-metric-item net">
                        <span>Netto oppervlakte:</span>
                        <span>{hasValues ? `${fmtComma(netArea)} m²` : '⚠️ Vul in'}</span>
                      </div>
                    </div>
                  </>
                )}

                <button
                  className="vp-deletebtn"
                  onClick={() => {
                    setState({ ...state, walls: state.walls.filter((x) => !selectedIds.includes(x.id)) });
                    setSelected(null);
                    scheduleSave();
                  }}
                >
                  {isMulti ? 'Geselecteerde muren verwijderen' : 'Muur verwijderen'}
                </button>
              </div>
            );
          })()}

          {/* RUIMTE / ZONE GESELECTEERD */}
          {(() => {
            const selItems = normalizeSelection(selected);
            if (selItems.length !== 1 || selItems[0].type !== 'zone') return null;
            const z = state.zones.find((x) => x.id === selItems[0].id);
            if (!z) return null;

            const lenVal = parseInputNumber(z.lengthStr);
            const heightVal = parseInputNumber(z.heightStr);
            const hasValues = z.lengthStr && z.heightStr && lenVal > 0 && heightVal > 0;
            const m2Val = lenVal * heightVal;

            return (
              <div>
                <div className="vp-field">
                  <label>Naam ruimte</label>
                  <input
                    type="text"
                    value={z.name || ''}
                    onChange={(e) => {
                      z.name = e.target.value;
                      setState({ ...state });
                      scheduleSave();
                    }}
                  />
                </div>

                <div className="vp-field">
                  <label>Kleur van de ruimte</label>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <input
                      type="color"
                      value={z.color || '#E8E2D5'}
                      onChange={(e) => {
                        z.color = e.target.value;
                        setState({ ...state });
                        scheduleSave();
                      }}
                      style={{ width: '36px', height: '32px', cursor: 'pointer', border: 'none', background: 'none' }}
                    />
                    <span style={{ fontSize: '12px', color: '#9ca3af' }}>Kies kleur</span>
                  </div>
                  <div className="vp-swatch-grid">
                    {COLOR_PRESETS.map((hex) => (
                      <div
                        key={hex}
                        className={`vp-swatch ${(z.color || '#E8E2D5') === hex ? 'active' : ''}`}
                        style={{ backgroundColor: hex }}
                        onClick={() => {
                          z.color = hex;
                          setState({ ...state });
                          scheduleSave();
                        }}
                      />
                    ))}
                  </div>
                </div>

                <div className="vp-field">
                  <label>Transparantie: {Math.round((z.opacity ?? 0.45) * 100)}%</label>
                  <input
                    type="range"
                    min="0.1"
                    max="1.0"
                    step="0.05"
                    value={z.opacity ?? 0.45}
                    onChange={(e) => {
                      z.opacity = parseFloat(e.target.value);
                      setState({ ...state });
                      scheduleSave();
                    }}
                  />
                </div>

                <div className="vp-field">
                  <label>Lengte (m)</label>
                  <input
                    type="text"
                    placeholder="bijv. 4,0"
                    value={z.lengthStr || ''}
                    onChange={(e) => {
                      z.lengthStr = normalizeInputString(e.target.value);
                      setState({ ...state });
                      scheduleSave();
                    }}
                  />
                </div>

                <div className="vp-field">
                  <label>Hoogte / Breedte (m)</label>
                  <input
                    type="text"
                    placeholder="bijv. 2,6"
                    value={z.heightStr || ''}
                    onChange={(e) => {
                      z.heightStr = normalizeInputString(e.target.value);
                      setState({ ...state });
                      scheduleSave();
                    }}
                  />
                </div>

                <div className="vp-metric-row">
                  <div className="vp-metric">
                    <div className="k">Oppervlakte</div>
                    <div className="v" style={{ color: hasValues ? '#EAF8F5' : '#FFB347' }}>
                      {hasValues ? `${fmtComma(m2Val)} m²` : '⚠️ Vul in'}
                    </div>
                  </div>
                </div>

                <button
                  className="vp-btn"
                  style={{ width: '100%', marginTop: '10px' }}
                  onClick={() => {
                    setMode('cut');
                    setDrawPoints([]);
                  }}
                >
                  ✂️ Deze ruimte splitsen (Cut)
                </button>

                <button className="vp-deletebtn" onClick={() => { setState({ ...state, zones: state.zones.filter((x) => x.id !== z.id) }); setSelected(null); scheduleSave(); }}>Ruimte verwijderen</button>
              </div>
            );
          })()}

          {/* RAAM / DEUR GESELECTEERD */}
          {(() => {
            const selItems = normalizeSelection(selected);
            if (selItems.length !== 1 || selItems[0].type !== 'opening') return null;
            const wall = state.walls.find((w) => w.id === selItems[0].wallId);
            if (!wall || !wall.openings) return null;
            const op = wall.openings.find((o) => o.id === selItems[0].id);
            if (!op) return null;

            return (
              <div>
                <div className="vp-field">
                  <label>Naam item</label>
                  <input
                    type="text"
                    value={op.label || ''}
                    onChange={(e) => {
                      op.label = e.target.value;
                      setState({ ...state });
                      scheduleSave();
                    }}
                  />
                </div>

                <h3>{op.label}</h3>

                <div className="vp-field">
                  <label>Type</label>
                  <select
                    value={op.type}
                    onChange={(e) => {
                      op.type = e.target.value;
                      setState({ ...state });
                      scheduleSave();
                    }}
                  >
                    <option value="door">Deur</option>
                    <option value="window">Raam</option>
                  </select>
                </div>

                <div className="vp-field">
                  <label>Breedte (m)</label>
                  <input
                    type="text"
                    value={op.widthStr || ''}
                    onChange={(e) => {
                      op.widthStr = normalizeInputString(e.target.value);
                      setState({ ...state });
                      scheduleSave();
                    }}
                  />
                </div>

                <div className="vp-field">
                  <label>Hoogte (m)</label>
                  <input
                    type="text"
                    value={op.heightStr || ''}
                    onChange={(e) => {
                      op.heightStr = normalizeInputString(e.target.value);
                      setState({ ...state });
                      scheduleSave();
                    }}
                  />
                </div>

                {op.type === 'door' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '10px' }}>
                    <button className="vp-btn" onClick={() => { op.flipHand = !op.flipHand; setState({ ...state }); scheduleSave(); }}>
                      🔄 Draairichting omklappen (L/R)
                    </button>
                    <button className="vp-btn" onClick={() => { op.flipSide = !op.flipSide; setState({ ...state }); scheduleSave(); }}>
                      🔄 Zijde omklappen (Binnen/Buiten)
                    </button>
                  </div>
                )}

                <button
                  className="vp-deletebtn"
                  onClick={() => {
                    wall.openings = wall.openings.filter((o) => o.id !== op.id);
                    setSelected(null);
                    scheduleSave();
                  }}
                >
                  Verwijderen
                </button>
              </div>
            );
          })()}
          </div>
        )}
      </div>
    </div>
  );
}