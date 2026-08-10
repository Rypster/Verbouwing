var DB_NAME = 'verbouw-planner';
var STORE = 'kv';
var dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise(function (resolve, reject) {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB niet beschikbaar'));
      return;
    }
    var req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = function () {
      var db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'key' });
      }
    };
    req.onsuccess = function () { resolve(req.result); };
    req.onerror = function () { reject(req.error); };
  });
  return dbPromise;
}

export function idbGet(key) {
  return openDb().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(STORE, 'readonly');
      var req = tx.objectStore(STORE).get(key);
      req.onsuccess = function () {
        resolve(req.result ? req.result.value : null);
      };
      req.onerror = function () { reject(req.error); };
    });
  });
}

export function idbSet(key, value) {
  return openDb().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ key: key, value: value });
      tx.oncomplete = function () { resolve(true); };
      tx.onerror = function () { reject(tx.error); };
    });
  });
}

export function idbDelete(key) {
  return openDb().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = function () { resolve(true); };
      tx.onerror = function () { reject(tx.error); };
    });
  });
}

export function idbListKeys(prefix) {
  return openDb().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(STORE, 'readonly');
      var req = tx.objectStore(STORE).getAllKeys();
      req.onsuccess = function () {
        var keys = req.result || [];
        resolve(prefix ? keys.filter(function (k) { return k.indexOf(prefix) === 0; }) : keys);
      };
      req.onerror = function () { reject(req.error); };
    });
  });
}

export function idbGetAll() {
  return openDb().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(STORE, 'readonly');
      var req = tx.objectStore(STORE).getAll();
      req.onsuccess = function () { resolve(req.result || []); };
      req.onerror = function () { reject(req.error); };
    });
  });
}