import { STORAGE_KEYS } from './config.js';

const LEGACY_SETTINGS_KEYS = Object.freeze([
  STORAGE_KEYS.apiKey,
  STORAGE_KEYS.userName,
  STORAGE_KEYS.userBio,
  STORAGE_KEYS.resumeBase64,
  STORAGE_KEYS.resumeFileName
]);

function callStorageArea(area, method, argument) {
  if (!area || typeof area[method] !== 'function') {
    return Promise.reject(new Error('Chrome storage area is unavailable: ' + method));
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      const lastError = globalThis.chrome?.runtime?.lastError;
      if (lastError) reject(new Error(lastError.message));
      else resolve(value);
    };

    let returned;
    try {
      if (method === 'clear') returned = area[method](finish);
      else returned = area[method](argument, finish);
    } catch (error) {
      reject(error);
      return;
    }

    if (returned && typeof returned.then === 'function') {
      returned.then(finish, reject);
    } else if (returned !== undefined) {
      finish(returned);
    }
  });
}

export function createStorage({ localArea, sessionArea } = {}) {
  const local = localArea;
  const session = sessionArea || null;

  const localGet = (keys) => callStorageArea(local, 'get', keys);
  const localSet = (items) => callStorageArea(local, 'set', items);
  const localRemove = (keys) => callStorageArea(local, 'remove', keys);
  const localClear = () => callStorageArea(local, 'clear');
  const sessionGet = (keys) => callStorageArea(session, 'get', keys);
  const sessionSet = (items) => callStorageArea(session, 'set', items);
  const sessionRemove = (keys) => callStorageArea(session, 'remove', keys);

  return Object.freeze({
    getLocal: localGet,
    setLocal: localSet,
    removeLocal: localRemove,
    getSession: sessionGet,
    setSession: sessionSet,
    removeSession: sessionRemove,
    async getSettings() {
      const values = await localGet(LEGACY_SETTINGS_KEYS);
      return {
        userApiKey: values[STORAGE_KEYS.apiKey] || '',
        userName: values[STORAGE_KEYS.userName] || '',
        userBio: values[STORAGE_KEYS.userBio] || '',
        resumeBase64: values[STORAGE_KEYS.resumeBase64] || '',
        resumeFileName: values[STORAGE_KEYS.resumeFileName] || ''
      };
    },
    async setSettings(settings) {
      const values = {};
      for (const key of LEGACY_SETTINGS_KEYS) {
        if (Object.prototype.hasOwnProperty.call(settings, key)) values[key] = settings[key];
      }
      return localSet(values);
    },
    async getMemoryCard() {
      const values = await localGet(STORAGE_KEYS.memoryCard);
      return values[STORAGE_KEYS.memoryCard] || null;
    },
    async setMemoryCard(card) {
      return localSet({ [STORAGE_KEYS.memoryCard]: card });
    },
    async clearLegacyResume() {
      return localRemove([STORAGE_KEYS.resumeBase64, STORAGE_KEYS.resumeFileName]);
    },
    async clearAllData() {
      await localClear();
      if (session) await callStorageArea(session, 'clear');
    }
  });
}

export function createChromeStorage() {
  const extensionChrome = globalThis.chrome;
  if (!extensionChrome?.storage?.local) {
    throw new Error('Chrome extension storage is unavailable.');
  }
  return createStorage({
    localArea: extensionChrome.storage.local,
    sessionArea: extensionChrome.storage.session
  });
}
