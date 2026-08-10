'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';

// --- DATABASE UTILS (INDEXEDDB FALLBACK) ---
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('VloerPlannerDB', 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('data')) {
        db.createObjectStore('data');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('data', 'readonly');
      const store = tx.objectStore('data');
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    return null;
  }
}

async function idbSet(key, val) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('data', 'readwrite');
      const store = tx.objectStore('data');
      const req = store.put(val, key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (e) {}
}

const DEFAULT_STATE = {
  activeFloor: 'BG',
  floors: ['BG', '1e Verdieping', '2e Verdieping'],
  scale: 50, // 50px = 1 meter
  gridSize: 0.5, // 0.5 meter
  walls: [],
  spaces: [],
  furniture: [],
  backgrounds: [],
  annotations: []
};

function normalizeLoaded(data) {
  if (!data) return DEFAULT_STATE;
  return {
    ...DEFAULT_STATE,
    ...data,
    floors: data.floors && data.floors.length ? data.floors : DEFAULT_STATE.floors,
    walls: data.walls || [],
    spaces: data.spaces || [],
    furniture: data.furniture || [],
    backgrounds: data.backgrounds || [],
    annotations: data.annotations || []
  };
}

export default function Planner() {
  const [state, setState] = useState(DEFAULT_STATE);
  const [saveState, setSaveState] = useState('opgeslagen');
  const [statusMsg, setStatusMsg] = useState('');
  const [cloudProject, setCloudProject] = useState(null);

  const stateRef = useRef(state);
  stateRef.current = state;

  const bgPixelCache = useRef({});
  const autoSaveTimer = useRef(null);

  const buildBgPixelCache = useCallback((bg) => {
    if (!bg || !bg.src || bgPixelCache.current[bg.id]) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const cvs = document.createElement('canvas');
      cvs.width = img.naturalWidth;
      cvs.height = img.naturalHeight;
      const ctx = cvs.getContext('2d');
      ctx.drawImage(img, 0, 0);
      try {
        bgPixelCache.current[bg.id] = {
          ctx,
          w: img.naturalWidth,
          h: img.naturalHeight
        };
      } catch (e) {}
    };
    img.src = bg.src;
  }, []);

  // --- AUTOMATISCH OPSLAAN (NEON DB + INDEXEDDB) ---
  const triggerAutoSave = useCallback(() => {
    setSaveState('opslaan…');
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);

    autoSaveTimer.current = setTimeout(async () => {
      const currentData = stateRef.current;
      
      // Always save locally to IndexedDB as instant backup
      await idbSet('project', JSON.stringify(currentData));

      // Save to Neon DB
      const cp = cloudProject || JSON.parse(localStorage.getItem('vp_cloud') || 'null');
      if (cp && cp.id && cp.token) {
        try {
          const res = await fetch('/api/project/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: cp.id,
              token: cp.token,
              data: currentData
            })
          });
          if (res.ok) {
            setSaveState('opgeslagen');
            return;
          }
        } catch (e) {
          console.error('Opslaan naar Neon DB mislukt:', e);
        }
      }
      setSaveState('lokaal opgeslagen');
    }, 1200);
  }, [cloudProject]);

  // Handle state updates wrapper
  const updateState = useCallback((updater) => {
    setState((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      triggerAutoSave();
      return next;
    });
  }, [triggerAutoSave]);

  // --- INITIAL LOAD ---
  useEffect(() => {
    async function load() {
      setSaveState('laden…');

      try {
        // Probeer het nieuwste project uit Neon DB op te halen
        const res = await fetch('/api/project');
        if (res.ok) {
          const json = await res.json();
          if (json.data && Object.keys(json.data).length > 0) {
            const loaded = normalizeLoaded(json.data);
            setState(loaded);
            (loaded.backgrounds || []).forEach(buildBgPixelCache);
            
            if (json.id && json.token) {
              const cloud = { id: json.id, token: json.token };
              setCloudProject(cloud);
              localStorage.setItem('vp_cloud', JSON.stringify(cloud));
            }
            await idbSet('project', JSON.stringify(loaded));
            setSaveState('opgeslagen');
            return;
          }
        }
      } catch (e) {
        console.error('Geen verbinding met DB, terugvallen op IndexedDB:', e);
      }

      // Fallback: Als DB leeg/faalt, laad lokaal uit IndexedDB
      const val = await idbGet('project');
      if (val) {
        try {
          const loaded = normalizeLoaded(JSON.parse(val));
          setState(loaded);
          (loaded.backgrounds || []).forEach(buildBgPixelCache);
        } catch (e) {}
      }
      setSaveState('opgeslagen');
    }

    load();
  }, [buildBgPixelCache]);

  // --- MIGRATIE / EXPORT NAAR NEON DB ---
  const handleMigrateToNeon = async () => {
    setStatusMsg('Data overzetten naar Neon DB...');
    try {
      const res = await fetch('/api/project/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: stateRef.current })
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Aanmaken mislukt');

      const cloud = { id: json.id, token: json.token };
      setCloudProject(cloud);
      localStorage.setItem('vp_cloud', JSON.stringify(cloud));

      setStatusMsg('✅ Succesvol geïmporteerd naar Neon DB!');
      setSaveState('opgeslagen');
      setTimeout(() => setStatusMsg(''), 4000);
    } catch (e) {
      console.error(e);
      setStatusMsg('❌ Import mislukt: ' + e.message);
    }
  };

  // --- BACKUP DOWNLOADEN (.JSON) ---
  const handleDownloadBackup = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `vloerplanner_backup_${new Date().toISOString().slice(0,10)}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  return (
    <div className="planner-container" style={{ display: 'flex', flexDirection: 'column', height: '100vh', fontFamily: 'sans-serif' }}>
      
      {/* HEADER BAR */}
      <header style={{
        display: 'flex',
        alignItems: 'center',
        justify: 'space-between',
        padding: '10px 20px',
        background: '#1f2937',
        color: '#fff'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          <h1 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 'bold' }}>Vloerplanner</h1>
          <span style={{
            fontSize: '0.8rem',
            padding: '2px 8px',
            borderRadius: '4px',
            background: saveState === 'opgeslagen' ? '#10b981' : '#f59e0b',
            color: '#fff'
          }}>
            {saveState}
          </span>
          {statusMsg && <span style={{ fontSize: '0.85rem', color: '#60a5fa' }}>{statusMsg}</span>}
        </div>

        {/* ACTIE KNOPPEN: BACKUP & IMPORTEER */}
        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            onClick={handleDownloadBackup}
            style={{
              background: '#374151',
              color: '#fff',
              border: '1px solid #4b5563',
              padding: '6px 12px',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '0.85rem'
            }}
            title="Download een lokale .json backup op je computer"
          >
            💾 Backup
          </button>

          <button
            onClick={handleMigrateToNeon}
            style={{
              background: '#2563eb',
              color: '#fff',
              border: 'none',
              padding: '6px 12px',
              borderRadius: '4px',
              cursor: 'pointer',
              fontWeight: 'bold',
              fontSize: '0.85rem'
            }}
            title="Sla je huidige lokale stand direct op als hoofdtekening in Neon DB"
          >
            ⚡ Importeer naar DB
          </button>
        </div>
      </header>

      {/* VERDIEPINGEN SELECTIE */}
      <div style={{ padding: '8px 20px', background: '#f3f4f6', borderBottom: '1px solid #e5e7eb', display: 'flex', gap: '8px' }}>
        {state.floors.map((floor) => (
          <button
            key={floor}
            onClick={() => updateState((s) => ({ ...s, activeFloor: floor }))}
            style={{
              padding: '5px 12px',
              borderRadius: '4px',
              border: '1px solid #ccc',
              background: state.activeFloor === floor ? '#2563eb' : '#fff',
              color: state.activeFloor === floor ? '#fff' : '#333',
              cursor: 'pointer'
            }}
          >
            {floor}
          </button>
        ))}
      </div>

      {/* CANVAS WORKSPACE AREA */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden', background: '#fafafa' }}>
        {/* Hier bevindt zich het teken-canvas van de planner */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#9ca3af' }}>
          [ Vloerplanner Tekengebied - Verdieping: {state.activeFloor} ]
        </div>
      </div>

    </div>
  );
}
