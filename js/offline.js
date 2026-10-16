// HTTPS (or localhost) is required. Portable file:// downloads are self-contained.
if (window.isSecureContext && 'serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./tasks-sw.js', { updateViaCache: 'none' })
        .catch(error => console.warn('Taskimatic offline setup failed:', error));
}

// Offer installation once per browser. Skip portable copies and installed windows.
(() => {
    const isIOS = /iPhone|iPod|iPad/.test(navigator.userAgent)
        || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isAndroid = /Android/i.test(navigator.userAgent);
    if ((!isIOS && !isAndroid) || !window.isSecureContext || location.protocol === 'file:') return;
    const seenKey = 'taskimatic-install-guide-seen';
    const isInstalled = () => navigator.standalone === true
        || ['standalone', 'fullscreen', 'minimal-ui'].some(mode => window.matchMedia(`(display-mode: ${mode})`).matches);
    let deferredPrompt = null;
    let guide = null;
    let installButton = null;
    let timer;
    const markSeen = () => {
        try { localStorage.setItem(seenKey, 'true'); return true; }
        catch { return false; }
    };
    const dismiss = () => { guide?.remove(); guide = null; installButton = null; };
    window.addEventListener('beforeinstallprompt', event => {
        // Keep installation user initiated, including after our one-time offer.
        event.preventDefault();
        deferredPrompt = event;
        if (installButton) installButton.hidden = false;
    });
    window.addEventListener('appinstalled', () => {
        markSeen();
        clearTimeout(timer);
        deferredPrompt = null;
        dismiss();
    });
    if (isInstalled()) { markSeen(); return; }
    try { if (localStorage.getItem(seenKey)) return; }
    catch { return; } // Without durable storage we cannot promise a one-time offer.
    const showGuide = () => {
        try { if (isInstalled() || localStorage.getItem(seenKey)) return; }
        catch { return; }
        if (!markSeen()) return;
        guide = document.createElement('section');
        guide.className = 'phone-install-guide';
        guide.setAttribute('aria-labelledby', 'phone-install-title');
        guide.innerHTML = `
            <h2 id="phone-install-title">${escapeHTML(t('ui.text.keepTaskimaticOnYourPhone'))}</h2>
            <p>${escapeHTML(t('ui.text.openYourTasksStraightFromYourHomeScreen'))}</p>
            <p>${isIOS
                ? t('ui.text.tapShareThenAddToHomeScreenAndAddIfTheOptionIsMissingOpenThisPageInSafariAndTryAgain')
                : t('ui.text.openYourBrowserSMenuAndChooseInstallAppOrAddToHomeScreenThenConfirmIfTheOptionIsMissi')}</p>
            <div class="phone-install-actions">
                <button type="button" class="phone-install-button" hidden>${escapeHTML(t('ui.text.installApp'))}</button>
                <button type="button" class="phone-install-dismiss">${escapeHTML(t('ui.text.gotIt'))}</button>
            </div>`;
        installButton = guide.querySelector('.phone-install-button');
        installButton.hidden = !deferredPrompt;
        installButton.addEventListener('click', async () => {
            const prompt = deferredPrompt;
            if (!prompt) return;
            deferredPrompt = null;
            installButton.hidden = true;
            try {
                await prompt.prompt();
                const choice = await prompt.userChoice;
                if (choice.outcome === 'accepted') dismiss();
            } catch { /* The manual instructions remain available. */ }
        });
        guide.querySelector('.phone-install-dismiss').addEventListener('click', dismiss);
        document.body.append(guide);
    };
    const scheduleGuide = () => {
        window.i18n.ready.then(() => { timer = setTimeout(showGuide, 2000); });
    };
    if (document.readyState === 'complete') scheduleGuide();
    else window.addEventListener('load', scheduleGuide, { once: true });
})();
