(() => {
  let lastIdentity = null;

  async function requestGrades(force = false) {
    let response;
    try {
      response = await chrome.runtime.sendMessage({
        type: 'getGrades',
        identity: lastIdentity,
        force,
      });
    } catch (err) {
      response = { ok: false, error: String(err?.message ?? err) };
    }
    document.dispatchEvent(
      new CustomEvent('m3105:grades', { detail: JSON.stringify(response) }),
    );
  }

  document.addEventListener('m3105:hello', (event) => {
    try {
      lastIdentity = JSON.parse(event.detail)?.identity ?? null;
    } catch {
      lastIdentity = null;
    }
    requestGrades();
  });

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.settings || changes.cache) requestGrades();
  });
})();
