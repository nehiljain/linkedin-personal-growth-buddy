export function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('CommentTrackerDB', 2);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('comments')) {
        db.createObjectStore('comments', { keyPath: 'id', autoIncrement: true });
        console.log('[LinkedIn Comment Tracker][IDB] Created object store: comments');
      }
      if (!db.objectStoreNames.contains('user')) {
        db.createObjectStore('user', { keyPath: 'key' });
        console.log('[LinkedIn Comment Tracker][IDB] Created object store: user');
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      const stores = Array.from(db.objectStoreNames);
      if (!stores.includes('comments') || !stores.includes('user')) {
        db.close();
        console.log('[LinkedIn Comment Tracker][IDB] Missing store, bumping version to force upgrade');
        const req2 = indexedDB.open('CommentTrackerDB', db.version + 1);
        req2.onupgradeneeded = (event) => {
          const db2 = event.target.result;
          if (!db2.objectStoreNames.contains('comments')) {
            db2.createObjectStore('comments', { keyPath: 'id', autoIncrement: true });
            console.log('[LinkedIn Comment Tracker][IDB] Created object store: comments (upgrade)');
          }
          if (!db2.objectStoreNames.contains('user')) {
            db2.createObjectStore('user', { keyPath: 'key' });
            console.log('[LinkedIn Comment Tracker][IDB] Created object store: user (upgrade)');
          }
        };
        req2.onsuccess = () => {
          console.log('[LinkedIn Comment Tracker][IDB] DB upgrade complete');
          resolve(req2.result);
        };
        req2.onerror = () => {
          console.error('[LinkedIn Comment Tracker][IDB] Error during DB upgrade', req2.error);
          reject(req2.error);
        };
      } else {
        console.log('[LinkedIn Comment Tracker][IDB] DB opened successfully');
        resolve(db);
      }
    };
    request.onerror = () => {
      console.error('[LinkedIn Comment Tracker][IDB] Error opening DB', request.error);
      reject(request.error);
    };
  });
}

export async function addComment(comment) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('comments', 'readwrite');
    tx.objectStore('comments').add({ ...comment, synced: false });
    tx.oncomplete = () => {
      console.log('[LinkedIn Comment Tracker][IDB] Comment added:', comment);
      resolve();
    };
    tx.onerror = (e) => {
      console.error('[LinkedIn Comment Tracker][IDB] Error adding comment', e);
      reject(e);
    };
  });
}

export async function getUnsyncedComments() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('comments', 'readonly');
    const store = tx.objectStore('comments');
    const request = store.getAll();
    request.onsuccess = () => {
      const unsynced = request.result.filter(c => !c.synced);
      console.log('[LinkedIn Comment Tracker][IDB] getUnsyncedComments:', unsynced);
      resolve(unsynced);
    };
    request.onerror = (e) => {
      console.error('[LinkedIn Comment Tracker][IDB] Error getting unsynced comments', e);
      reject(e);
    };
  });
}

export async function markCommentsSynced(ids) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('comments', 'readwrite');
    const store = tx.objectStore('comments');
    ids.forEach(id => {
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const comment = getReq.result;
        if (comment) {
          comment.synced = true;
          store.put(comment);
          console.log('[LinkedIn Comment Tracker][IDB] Marked comment as synced:', comment);
        }
      };
    });
    tx.oncomplete = () => {
      console.log('[LinkedIn Comment Tracker][IDB] markCommentsSynced complete for ids:', ids);
      resolve();
    };
    tx.onerror = (e) => {
      console.error('[LinkedIn Comment Tracker][IDB] Error marking comments synced', e);
      reject(e);
    };
  });
}

export async function deleteSyncedComments() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('comments', 'readwrite');
    const store = tx.objectStore('comments');
    const getAllReq = store.getAll();
    getAllReq.onsuccess = () => {
      getAllReq.result.forEach(comment => {
        if (comment.synced) {
          store.delete(comment.id);
          console.log('[LinkedIn Comment Tracker][IDB] Deleted synced comment:', comment);
        }
      });
      tx.oncomplete = () => {
        console.log('[LinkedIn Comment Tracker][IDB] deleteSyncedComments complete');
        resolve();
      };
    };
    getAllReq.onerror = (e) => {
      console.error('[LinkedIn Comment Tracker][IDB] Error deleting synced comments', e);
      reject(e);
    };
  });
}

export async function setLoggedInUser(user) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('user', 'readwrite');
    tx.objectStore('user').put({ key: 'loggedInUser', ...user });
    tx.oncomplete = () => {
      console.log('[LinkedIn Comment Tracker][IDB] Set logged in user:', user);
      resolve();
    };
    tx.onerror = (e) => {
      console.error('[LinkedIn Comment Tracker][IDB] Error setting logged in user', e);
      reject(e);
    };
  });
}

export async function getLoggedInUser() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('user', 'readonly');
    const store = tx.objectStore('user');
    const request = store.get('loggedInUser');
    request.onsuccess = () => {
      console.log('[LinkedIn Comment Tracker][IDB] getLoggedInUser:', request.result || null);
      resolve(request.result || null);
    };
    request.onerror = (e) => {
      console.error('[LinkedIn Comment Tracker][IDB] Error getting logged in user', e);
      reject(e);
    };
  });
}

// Returns true if userA and userB are different (by profile if both present, else by name)
export function isDifferentUser(userA, userB) {
  if (!userA || !userB) return true;
  const aProfile = userA.profile ? userA.profile.trim() : '';
  const bProfile = userB.profile ? userB.profile.trim() : '';
  if (aProfile && bProfile) {
    return aProfile !== bProfile;
  }
  const aName = userA.name ? userA.name.trim() : '';
  const bName = userB.name ? userB.name.trim() : '';
  return aName !== bName;
}

// Sets or updates the logged-in user in IndexedDB only if different or cache is empty
export async function setOrUpdateLoggedInUser(user) {
  if (!user || (!user.name && !user.profile)) return;
  const cachedUser = await getLoggedInUser();
  if (!cachedUser || isDifferentUser(cachedUser, user)) {
    await setLoggedInUser({
      name: user.name || '',
      profile: user.profile || ''
    });
    console.log('[LinkedIn Comment Tracker][IDB] setOrUpdateLoggedInUser: updated user:', user);
  } else {
    console.log('[LinkedIn Comment Tracker][IDB] setOrUpdateLoggedInUser: user unchanged');
  }
}
