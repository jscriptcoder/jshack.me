(async () => { let quiet = 0, prev = '';
  for (let i = 0; i < 100; i++) { await new Promise(r => setTimeout(r, 250));
    const t = document.body.innerText.replace(/\d\d:\d\d:\d\d/g, 'T');
    const cut = t.lastIndexOf('\nWLAN0');
    const term = (cut < 0 ? t : t.slice(0, cut)).split('\n').map((line) => line.trim()).filter((line) => line !== '');
    const promptLine = term.at(-2) ?? '';
    const key = term.slice(0, -1).join('\n');
    quiet = (key === prev && /[#$>:]$/.test(promptLine)) ? quiet + 1 : 0; prev = key;
    if (quiet >= 4) return 'prompt'; }
  return 'TIMEOUT'; })()
