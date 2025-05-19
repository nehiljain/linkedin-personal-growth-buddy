// background.js
// Service worker for LinkedIn Comment Tracker extension (Webpack build)
 
chrome.runtime.onInstalled.addListener(() => {
  console.log('LinkedIn Comment Tracker background service worker installed.');
}); 