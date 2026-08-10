import React, { useState, useEffect, useRef, useCallback } from 'react';

// IndexedDB hulpmethoden voor lokale opslag
function openIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('VloerPlannerDB', 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('store')) {
        db.createObjectStore('store');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key) {
  try {
    const db = await openIDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('store', 'readonly');
      const store = tx.objectStore('store');
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.error('IDB Get fout:', e);
    return null;
  }
}

async function idbSet(key, val) {
  try {
    const db = await openIDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('store', 'readwrite');
      const store = tx.objectStore('store');
      const req = store.put(val, key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.error('IDB Set fout:', e);
  }
}

function normalizeLoaded(data) {
  if (!data || typeof data !== 'object') return { elements: [], backgrounds: [] };
  return {
    elements: Array.isArray(data.elements) ? data.elements : [],
    backgrounds: Array.isArray(data.backgrounds) ? data.backgrounds : [],
    ...data,
  };
}

export default function Planner() {
  const [state, setState] = useState({
    elements: [],
    backgrounds: [],
  });
  const [saveState, setSaveState] = useState('opgeslagen');
  const [statusMsg, setStatusMsg] = useState('');
  const [, setCloudProject] = useState(null);

  // Gereedschap & Editor Status
  const [tool, setTool] = useState('select'); // 'select', 'wall', 'rect', 'erase'

  const stateRef = useRef(state);
  stateRef.current = state;

  const sessionIdRef = useRef('');

  const buildBgPixelCache = useCallback((bg) => {
    // Pixel cache helper
  }, []);

  // 1. Bij het laden: Eerst Neon DB proberen op te halen, anders lokale IndexedDB
  useEffect(() => {
    let sid = localStorage.getItem('vp_session');
    if (!sid) {
      sid = 's' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem('vp_session', sid);
    }
    sessionIdRef.current = sid;

    async function load() {
      try {
        setSaveState('laden…');
        // Probeer het meest recente project uit Neon DB op te halen
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
        console.error('Neon DB laden mislukt, valt terug op IndexedDB:', e);
      }

      // Fallback: Laad lokale IndexedDB als Neon DB leeg is of faalt
      const val = await idbGet('project');
      if (val) {
        try {
          const loaded = normalizeLoaded(JSON.parse(val));
          setState(loaded);
          (loaded.backgrounds || []).forEach(buildBgPixelCache);
        } catch (e) {
          console.error('Fout bij parsen van lokale data:', e);
        }
      }
      setSaveState('opgeslagen');
    }

    load();
  }, [buildBgPixelCache]);

  // Automatisch lokaal opslaan in IndexedDB bij wijzigingen
  useEffect(() => {
    if (!state) return;
    setSaveState('opslaan…');
    const timer = setTimeout(async () => {
      await idbSet('project', JSON.stringify(state));
      setSaveState('opgeslagen');
    }, 500);
    return () => clearTimeout(timer);
  }, [state]);

  // Direct de huidige lokale tekening exporteren/opslaan in Neon DB
  async function migrateIndexedDBToNeon() {
    setStatusMsg('Data overzetten naar Neon DB...');
    try {
      const res = await fetch('/api/project/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: stateRef.current })
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Migratie mislukt');

      const cloud = { id: json.id, token: json.token };
      setCloudProject(cloud);
      localStorage.setItem('vp_cloud', JSON.stringify(cloud));

      setStatusMsg('✅ Succesvol geïmporteerd in Neon DB!');
      setTimeout(() => setStatusMsg(''), 4000);
    } catch (e) {
      console.error('Migratie fout:', e);
      setStatusMsg('❌ Fout: ' + e.message);
      setTimeout(() => setStatusMsg(''), 5000);
    }
  }

  // JSON Backup Exporteren
  const handleExportJSON = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(state, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `plattegrond_backup_${new Date().toISOString().slice(0, 10)}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  // JSON Backup Importeren
  const handleImportJSON = (e) => {
    const fileReader = new FileReader();
    if (e.target.files && e.target.files[0]) {
      fileReader.readAsText(e.target.files[0], 'UTF-8');
      fileReader.onload = (event) => {
        try {
          const parsed = JSON.parse(event.target.result);
          const loaded = normalizeLoaded(parsed);
          setState(loaded);
          setStatusMsg('✅ Backup succesvol ingeladen!');
          setTimeout(() => setStatusMsg(''), 3000);
        } catch (err) {
          alert('Ongeldig JSON bestand');
        }
      };
    }
  };

  // Het ontwerp wissen
  const handleClear = () => {
    if (confirm('Weet je zeker dat je het hele ontwerp wilt wissen?')) {
      setState({ elements: [], backgrounds: [] });
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', fontFamily: 'sans-serif' }}>
      {/* Bovenbalk / Toolbar */}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 20px',
          backgroundColor: '#f8f9fa',
          borderBottom: '1px solid #ddd',
          gap: '10px',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          <h1 style={{ margin: 0, fontSize: '1.2rem', color: '#333' }}>VloerPlanner</h1>
          <span style={{ fontSize: '0.85rem', color: '#666', fontStyle: 'italic' }}>
            Status: {saveState}
          </span>
        </div>

        {/* Actieknoppen */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button
            onClick={migrateIndexedDBToNeon}
            style={{
              background: '#1E6E7A',
              color: '#fff',
              border: 'none',
              padding: '8px 14px',
              borderRadius: '4px',
              cursor: 'pointer',
              fontWeight: 'bold',
            }}
            title="Zet je lokale IndexedDB tekening eenmalig over naar Neon DB"
          >
            ⚡ Exporteer naar Neon DB
          </button>

          <button
            onClick={handleExportJSON}
            style={{
              background: '#f0f0f0',
              border: '1px solid #ccc',
              padding: '8px 12px',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            💾 JSON Backup
          </button>

          <label
            style={{
              background: '#f0f0f0',
              border: '1px solid #ccc',
              padding: '8px 12px',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            📂 Herstel JSON
            <input type="file" accept=".json" onChange={handleImportJSON} style={{ display: 'none' }} />
          </label>

          <button
            onClick={handleClear}
            style={{
              background: '#d9534f',
              color: '#fff',
              border: 'none',
              padding: '8px 12px',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            🗑️ Wissen
          </button>
        </div>
      </header>

      {/* Meldingenbalk */}
      {statusMsg && (
        <div
          style={{
            backgroundColor: '#e3f2fd',
            color: '#0d47a1',
            padding: '8px 16px',
            textAlign: 'center',
            fontSize: '0.9rem',
            borderBottom: '1px solid #bbdefb',
          }}
        >
          {statusMsg}
        </div>
      )}

      {/* Hoofddeel: Zijbalk + Werkveld */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Zijbalk Gereedschap */}
        <aside
          style={{
            width: '200px',
            backgroundColor: '#f1f3f5',
            borderRight: '1px solid #ddd',
            padding: '15px',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
          }}
        >
          <h3 style={{ margin: '0 0 10px 0', fontSize: '1rem' }}>Gereedschap</h3>

          <button
            onClick={() => setTool('select')}
            style={{
              padding: '10px',
              backgroundColor: tool === 'select' ? '#0070f3' : '#fff',
              color: tool === 'select' ? '#fff' : '#333',
              border: '1px solid #ccc',
              borderRadius: '4px',
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            🖐️ Selecteer / Verplaats
          </button>

          <button
            onClick={() => setTool('wall')}
            style={{
              padding: '10px',
              backgroundColor: tool === 'wall' ? '#0070f3' : '#fff',
              color: tool === 'wall' ? '#fff' : '#333',
              border: '1px solid #ccc',
              borderRadius: '4px',
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            🧱 Muur Tekenen
          </button>

          <button
            onClick={() => setTool('rect')}
            style={{
              padding: '10px',
              backgroundColor: tool === 'rect' ? '#0070f3' : '#fff',
              color: tool === 'rect' ? '#fff' : '#333',
              border: '1px solid #ccc',
              borderRadius: '4px',
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            🔲 Rechthoek
          </button>

          <button
            onClick={() => setTool('erase')}
            style={{
              padding: '10px',
              backgroundColor: tool === 'erase' ? '#0070f3' : '#fff',
              color: tool === 'erase' ? '#fff' : '#333',
              border: '1px solid #ccc',
              borderRadius: '4px',
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            🧹 Gum
          </button>
        </aside>

        {/* SVG Canvas Werkveld */}
        <main style={{ flex: 1, position: 'relative', backgroundColor: '#fafafa', overflow: 'hidden' }}>
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              display: 'flex',
              alignItems: 'center',
              justify: 'center',
            }}
          >
            <svg
              width="100%"
              height="100%"
              style={{ backgroundColor: '#ffffff', cursor: tool === 'select' ? 'default' : 'crosshair' }}
            >
              <defs>
                <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
                  <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#e5e5e5" strokeWidth="1" />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#grid)" />

              {/* Elementen tekenen */}
              {state.elements.map((el, index) => {
                if (el.type === 'rect') {
                  return (
                    <rect
                      key={el.id || index}
                      x={el.x}
                      y={el.y}
                      width={el.width}
                      height={el.height}
                      fill={el.fill || '#ccc'}
                      stroke="#333"
                      strokeWidth="2"
                    />
                  );
                }
                if (el.type === 'wall') {
                  return (
                    <line
                      key={el.id || index}
                      x1={el.x1}
                      y1={el.y1}
                      x2={el.x2}
                      y2={el.y2}
                      stroke="#333"
                      strokeWidth="8"
                    />
                  );
                }
                return null;
              })}
            </svg>
          </div>
        </main>
      </div>
    </div>
  );
}
