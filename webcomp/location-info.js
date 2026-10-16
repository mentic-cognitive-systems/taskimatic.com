/**
 * LocationInfo Web Component (<location-info>)
 * Displays network location, IP details, and browser environment information.
 * Can fetch data from node.php, receive JSON attributes/properties, or operate in standalone client-side fallback mode.
 *
 * Usage:
 *   <location-info src="node.php?format=json" auto-fetch></location-info>
 *   <location-info data='{"ip":"127.0.0.1", ...}'></location-info>
 *   <location-info auto-fetch></location-info> <!-- Pure client-side mode -->
 */

class LocationInfo extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._data = null;
    this._loading = false;
    this._error = null;
    this._timer = null;
  }

  static get observedAttributes() {
    return ['src', 'data', 'auto-fetch', 'refresh-interval'];
  }

  get src() {
    return this.getAttribute('src');
  }

  set src(val) {
    if (val) {
      this.setAttribute('src', val);
    } else {
      this.removeAttribute('src');
    }
  }

  get data() {
    return this._data;
  }

  set data(val) {
    this._data = typeof val === 'string' ? JSON.parse(val) : val;
    this._error = null;
    this.render();
  }

  get autoFetch() {
    return this.hasAttribute('auto-fetch');
  }

  set autoFetch(val) {
    if (val) {
      this.setAttribute('auto-fetch', '');
    } else {
      this.removeAttribute('auto-fetch');
    }
  }

  get refreshInterval() {
    return parseInt(this.getAttribute('refresh-interval') || '0', 10);
  }

  connectedCallback() {
    // Read initial data attribute if present
    const dataAttr = this.getAttribute('data');
    if (dataAttr && !this._data) {
      try {
        this._data = JSON.parse(dataAttr);
      } catch (e) {
        console.warn('LocationInfo: Invalid JSON in data attribute', e);
      }
    }

    // Determine if we should auto fetch
    if (this.src || this.autoFetch || (!this._data && !dataAttr)) {
      this.refresh();
    } else {
      this.render();
    }

    // Start timer for continuous live time & percentage over calculation
    this._timer = setInterval(() => {
      this.updateYearProgress();
    }, 1000);
  }

  disconnectedCallback() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue === newValue) return;

    if (name === 'data' && newValue) {
      try {
        this._data = JSON.parse(newValue);
        this._error = null;
        this.render();
      } catch (e) {
        console.warn('LocationInfo: Invalid data attribute change', e);
      }
    } else if (name === 'src' && newValue && this.isConnected) {
      this.refresh();
    }
  }

  /**
   * Fetch data from endpoint or fallback to client-side detection
   */
  async refresh() {
    const targetUrl = this.src || 'node.php?format=json';
    this._loading = true;
    this._error = null;
    this.render();

    try {
      const response = await fetch(targetUrl, {
        headers: { 'Accept': 'application/json' }
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const text = await response.text();
      this._data = JSON.parse(text);
      this._error = null;
    } catch (err) {
      console.warn(`LocationInfo: Fetching from ${targetUrl} failed. Falling back to client-side detection.`, err);
      // Client-side fallback mode
      this._data = await this.buildClientFallbackData();
    } finally {
      this._loading = false;
      this.render();
    }
  }

  /**
   * Build client-side fallback location & device telemetry
   */
  async buildClientFallbackData() {
    let geo = { status: 'fail' };
    let ip = 'Local Client';

    // Attempt direct public IP & Geo lookup via public API if backend is unavailable
    try {
      const res = await fetch('https://ip-api.com/json/?fields=status,country,countryCode,region,regionName,city,zip,lat,lon,timezone,isp,org,as,query', { mode: 'cors' });
      if (res.ok) {
        const json = await res.json();
        if (json && json.status === 'success') {
          geo = json;
          ip = json.query || ip;
        }
      }
    } catch (_) {
      // Ignore public API fetch errors
    }

    return {
      ip: ip,
      isp: geo.isp || geo.org || 'Local Network',
      connection: 'direct',
      hostname: location.hostname || 'localhost',
      user_agent: navigator.userAgent,
      language: navigator.language || 'en-US',
      geo: geo,
      referrer: document.referrer || 'direct',
      ssl_protocol: location.protocol === 'https:' ? 'TLS/SSL' : 'None',
      port: location.port || (location.protocol === 'https:' ? '443' : '80'),
      accept: 'text/html,application/xhtml+xml,application/json',
      protocol: location.protocol ? location.protocol.toUpperCase().replace(':', '') : 'HTTP',
      request_time: new Date().toISOString(),
      timestamp: Math.floor(Date.now() / 1000)
    };
  }

  /**
   * Detect device type from user agent
   */
  detectDevice(userAgent) {
    const ua = userAgent || navigator.userAgent || '';
    if (/mobile|iphone|ipod|android.*mobile|windows phone|blackberry/i.test(ua)) {
      return { type: 'Phone', icon: '📱' };
    }
    if (/ipad|tablet|android(?!.*mobile)/i.test(ua)) {
      return { type: 'Tablet', icon: '📋' };
    }
    return { type: 'Desktop', icon: '💻' };
  }

  /**
   * Detect operating system from user agent
   */
  detectOS(userAgent) {
    const ua = userAgent || navigator.userAgent || '';
    if (/Windows NT/i.test(ua)) return { name: 'Windows', icon: '🪟' };
    if (/iPhone|iPad|iOS/i.test(ua)) return { name: 'iOS', icon: '👁️‍🗨️' };
    if (/Mac OS X|Macintosh/i.test(ua)) return { name: 'macOS', icon: '🍎' };
    if (/Android/i.test(ua)) return { name: 'Android', icon: '🤖' };
    if (/Linux/i.test(ua)) return { name: 'Linux', icon: '🐧' };
    return { name: 'Unknown OS', icon: '❓' };
  }

  /**
   * Detect browser from user agent
   */
  detectBrowser(userAgent) {
    const ua = userAgent || navigator.userAgent || '';
    if (/Edg\//i.test(ua)) return { name: 'Edge', icon: '📐' };
    if (/OPR\//i.test(ua)) return { name: 'Opera', icon: '🎭' };
    if (/Chrome\//i.test(ua)) return { name: 'Chrome', icon: '🌈' };
    if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) return { name: 'Safari', icon: '🧭' };
    if (/Firefox\//i.test(ua)) return { name: 'Firefox', icon: '🦊' };
    return { name: 'Browser', icon: '🌐' };
  }

  /**
   * Parse Accept-Language string
   */
  parseAcceptLanguage(str) {
    if (!str || typeof str !== 'string') return [];
    return str.split(',').map(part => {
      const [tagRaw, qRaw] = part.trim().split(';');
      const q = qRaw && qRaw.trim().startsWith('q=') ? parseFloat(qRaw.trim().slice(2)) : 1.0;
      const tag = (tagRaw || '').trim();
      return { tag, q };
    }).filter(x => x.tag).sort((a, b) => b.q - a.q);
  }

  /**
   * Get human-readable language label
   */
  languageLabel(tag) {
    const [langPart, regionPart] = tag.split('-');
    const langNames = {
      en: 'English', zh: 'Chinese', es: 'Spanish', fr: 'French', de: 'German',
      ar: 'Arabic', he: 'Hebrew', pt: 'Portuguese', it: 'Italian', ja: 'Japanese',
      ko: 'Korean', ru: 'Russian'
    };
    const regionNames = {
      US: 'United States', GB: 'United Kingdom', CN: 'China', TW: 'Taiwan',
      HK: 'Hong Kong', CA: 'Canada', AU: 'Australia', MX: 'Mexico', ES: 'Spain',
      DE: 'Germany', FR: 'France', IL: 'Israel', BR: 'Brazil'
    };
    const lname = langNames[langPart?.toLowerCase()] || tag;
    if (regionPart) {
      const rname = regionNames[regionPart.toUpperCase()] || regionPart;
      return `${lname} (${rname})`;
    }
    return lname;
  }

  /**
   * Get country flag emoji from country code
   */
  flagFromCountryCode(cc) {
    try {
      if (!cc || cc.length !== 2) return '';
      return cc
        .toUpperCase()
        .split('')
        .map(ch => String.fromCodePoint(127397 + ch.charCodeAt(0)))
        .join('');
    } catch (_) {
      return '';
    }
  }

  /**
   * Extract root domain for favicon lookup
   */
  getRootDomain(hostname) {
    if (!hostname) return '';
    const parts = hostname.split('.').filter(Boolean);
    if (parts.length <= 2) return hostname;
    return parts.slice(-2).join('.');
  }

  /**
   * Calculate year progress dynamically
   */
  getYearProgress() {
    const now = new Date();
    const year = now.getFullYear();
    const startOfYear = new Date(year, 0, 1, 0, 0, 0, 0);
    const startOfNextYear = new Date(year + 1, 0, 1, 0, 0, 0, 0);
    const totalMs = startOfNextYear - startOfYear;
    const elapsedMs = now - startOfYear;
    const percentOver = (elapsedMs / totalMs) * 100;
    const msPerDay = 24 * 60 * 60 * 1000;
    const daysLeft = Math.floor((startOfNextYear - now) / msPerDay);

    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

    const dayName = dayNames[now.getDay()];
    const monthName = monthNames[now.getMonth()];

    const pad2 = n => n < 10 ? '0' + n : '' + n;
    const to12h = h => {
      const am = h < 12;
      const hh = h % 12 || 12;
      return { hh, am };
    };

    const t12 = to12h(now.getHours());
    const timeStr = `${t12.hh}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}${t12.am ? 'AM' : 'PM'}`;
    const prettyLine = `As of this moment, ${timeStr} on ${dayName} ${monthName} ${now.getDate()} ${year}, there are ${daysLeft} days left in the year and it is ${percentOver.toFixed(12)}% over.`;

    return { percentOver, prettyLine };
  }

  /**
   * Update only the live year-progress section without full DOM teardown
   */
  updateYearProgress() {
    if (this._loading || !this.shadowRoot) return;
    const textEl = this.shadowRoot.querySelector('.year-text');
    const circleEl = this.shadowRoot.querySelector('.progress-circle');

    if (textEl && circleEl) {
      const { percentOver, prettyLine } = this.getYearProgress();
      const r = 28;
      const c = 2 * Math.PI * r;
      const sweep = (percentOver / 100) * c;
      textEl.textContent = prettyLine;
      circleEl.setAttribute('stroke-dasharray', `${sweep} ${c}`);
    }
  }

  /**
   * HTML escape helper
   */
  esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  /**
   * Main render function
   */
  render() {
    if (!this.shadowRoot) return;

    if (this._loading) {
      this.shadowRoot.innerHTML = `
        <style>
          :host { display: block; font-family: Arial, sans-serif; color: #e6f0ff; }
          .loading-box {
            display: flex; flex-direction: column; align-items: center; justify-content: center;
            padding: 40px 20px; text-align: center; gap: 12px; opacity: 0.9;
          }
          .spinner {
            width: 32px; height: 32px; border: 3px solid rgba(255,255,255,0.2);
            border-top-color: #9cf; border-radius: 50%; animation: spin 0.8s linear infinite;
          }
          @keyframes spin { to { transform: rotate(360deg); } }
        </style>
        <div class="loading-box">
          <div class="spinner"></div>
          <div>Locating node in cyberspace...</div>
        </div>
      `;
      return;
    }

    const data = this._data || {};

    // Parse nested geo JSON if string
    let geo = data.geo;
    if (typeof geo === 'string') {
      try {
        geo = JSON.parse(geo);
      } catch (_) {
        geo = {};
      }
    }
    geo = geo || {};

    const userAgent = data.user_agent || data.userAgent || navigator.userAgent || '';
    const dev = this.detectDevice(userAgent);
    const os = this.detectOS(userAgent);
    const br = this.detectBrowser(userAgent);

    const ip = data.ip || geo.query || 'Unknown';
    const isp = data.isp || geo.isp || data.org || geo.org || '—';
    const connection = data.connection || 'direct';
    const host = data.hostname || '—';
    const acceptList = this.parseAcceptLanguage(data.language || data.accept);
    const ref = data.referrer || document.referrer || '—';
    const ssl = data.ssl_protocol || data.sslProtocol || '—';
    const port = data.port || '—';
    const protocol = data.protocol || (location.protocol ? location.protocol.toUpperCase().replace(':', '') : '—');
    const reqTime = data.request_time || data.requestTime || new Date().toISOString();
    const ts = data.timestamp ? new Date(data.timestamp * 1000).toISOString() : '—';

    const city = geo.city || '—';
    const region = geo.regionName || geo.region || '—';
    const country = geo.country || '—';
    const countryCode = geo.countryCode || geo.country_code || null;
    const flag = this.flagFromCountryCode(countryCode);
    const zip = geo.zip || '—';
    const tz = geo.timezone || '—';
    const lat = geo.lat;
    const lon = geo.lon;
    const hasCoord = typeof lat === 'number' && typeof lon === 'number';
    const mapsHref = hasCoord ? `https://maps.google.com/?q=${encodeURIComponent(lat + "," + lon)}` : null;

    const { percentOver, prettyLine } = this.getYearProgress();

    const r = 28;
    const c = 2 * Math.PI * r;
    const sweep = (percentOver / 100) * c;

    const infoCards = [
      ['Host', host],
      ['Connection', connection],
      ['Protocol', protocol],
      ['Port', port],
      ['Timezone', tz],
      ['Referrer', ref],
      ['Requested', reqTime],
      ['Timestamp', ts],
    ];

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          color: var(--location-text-color, #e6f0ff);
        }
        .container {
          width: 100%;
          box-sizing: border-box;
        }
        .card-row {
          display: flex;
          gap: 12px;
          align-items: stretch;
          flex-wrap: wrap;
          margin-bottom: 12px;
        }
        .card {
          flex: 1 1 240px;
          background: var(--location-card-bg, rgba(255, 255, 255, 0.06));
          border: 1px solid var(--location-card-border, rgba(255, 255, 255, 0.15));
          border-radius: 10px;
          padding: 12px;
          box-sizing: border-box;
          backdrop-filter: blur(8px);
        }
        .card-label {
          font-size: 11px;
          text-transform: uppercase;
          opacity: 0.8;
          letter-spacing: 0.5px;
          margin-bottom: 4px;
        }
        .card-value {
          font-size: 18px;
          font-weight: 700;
          letter-spacing: 0.5px;
        }
        .card-subvalue {
          font-size: 12px;
          opacity: 0.75;
          margin-top: 4px;
        }
        .location-value {
          font-size: 16px;
          font-weight: 600;
          letter-spacing: 0.3px;
        }
        .location-country {
          font-size: 12px;
          opacity: 0.85;
          display: flex;
          align-items: center;
          gap: 6px;
          margin-top: 4px;
        }
        .grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          gap: 12px;
        }
        .grid-card {
          background: var(--location-grid-bg, rgba(255, 255, 255, 0.04));
          border: 1px solid var(--location-grid-border, rgba(255, 255, 255, 0.12));
          border-radius: 10px;
          padding: 10px 12px;
        }
        .grid-label {
          font-size: 11px;
          opacity: 0.75;
          letter-spacing: 0.4px;
          margin-bottom: 2px;
        }
        .grid-value {
          font-size: 13px;
          word-break: break-word;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .grid-value img {
          border-radius: 4px;
          background: #fff;
        }
        .env-value {
          font-size: 15px;
          letter-spacing: 0.3px;
          display: flex;
          gap: 8px;
          align-items: center;
          margin-top: 2px;
        }
        .separator {
          opacity: 0.5;
        }
        .emoji {
          font-size: 16px;
        }
        .section-box {
          margin-top: 12px;
          background: var(--location-section-bg, rgba(255, 255, 255, 0.03));
          border: 1px solid var(--location-section-border, rgba(255, 255, 255, 0.1));
          border-radius: 10px;
          padding: 12px;
        }
        .section-box ol {
          margin: 4px 0 0 0;
          padding-left: 18px;
          font-size: 13px;
          line-height: 1.5;
        }
        .ua-text {
          font-size: 12px;
          line-height: 1.4;
          opacity: 0.9;
          font-family: monospace;
          word-break: break-all;
        }
        .year-progress {
          margin-top: 14px;
          display: flex;
          align-items: center;
          gap: 14px;
          background: var(--location-progress-bg, rgba(255, 255, 255, 0.03));
          border: 1px solid var(--location-progress-border, rgba(255, 255, 255, 0.1));
          border-radius: 10px;
          padding: 12px;
        }
        .year-text {
          font-size: 12px;
          line-height: 1.45;
          opacity: 0.95;
          flex: 1;
        }
        a {
          color: var(--location-link-color, #9cf);
          text-decoration: none;
        }
        a:hover {
          text-decoration: underline;
        }
      </style>
      <div class="container">
        <div class="card-row">
          <div class="card">
            <div class="card-label">Your IP</div>
            <div class="card-value">${this.esc(ip)}</div>
            <div class="card-subvalue">${this.esc(isp)}</div>
          </div>
          <div class="card">
            <div class="card-label">Location</div>
            <div class="location-value">${this.esc(city)}, ${this.esc(region)}</div>
            <div class="location-country">
              ${flag ? `<span class="emoji">${flag}</span>` : ''}
              <span>${this.esc(country)} ${this.esc(zip)}</span>
            </div>
            ${hasCoord ? `<div style="margin-top:6px;"><a href="${mapsHref}" target="_blank" rel="noopener">Open in Maps (${lat.toFixed(4)}, ${lon.toFixed(4)})</a></div>` : ''}
          </div>
          <div class="card">
            <div class="card-label">Environment</div>
            <div class="env-value">
              <span class="emoji" title="Device">${dev.icon}</span><span>${this.esc(dev.type)}</span>
              <span class="separator">•</span>
              <span class="emoji" title="OS">${os.icon}</span><span>${this.esc(os.name)}</span>
              <span class="separator">•</span>
              <span class="emoji" title="Browser">${br.icon}</span><span>${this.esc(br.name)}</span>
            </div>
          </div>
        </div>

        <div class="grid">
          ${infoCards.map(([k, v]) => `
            <div class="grid-card">
              <div class="grid-label">${this.esc(k)}</div>
              <div class="grid-value">
                ${k === 'Host' && host && host !== '—' ? `<img src="https://icons.duckduckgo.com/ip3/${this.esc(this.getRootDomain(host))}.ico" alt="favicon" width="16" height="16" onerror="this.style.display='none'">` : ''}
                <span>${this.esc(v)}</span>
              </div>
            </div>
          `).join('')}
        </div>

        ${acceptList.length > 0 ? `
          <div class="section-box">
            <div class="card-label">Language Preferences (highest first)</div>
            <ol>
              ${acceptList.map((item, idx) => {
                const label = this.languageLabel(item.tag);
                const weight = item.q.toFixed(2).replace(/\.00$/, '');
                const note = idx === 0 ? 'preferred' : ('q=' + weight);
                return `<li><span>${this.esc(label)}</span> <span style="opacity:0.8">(${this.esc(item.tag)}; ${this.esc(note)})</span></li>`;
              }).join('')}
            </ol>
          </div>
        ` : ''}

        <div class="section-box">
          <div class="card-label">User Agent</div>
          <div class="ua-text">${this.esc(userAgent)}</div>
        </div>

        <div class="year-progress">
          <svg width="64" height="64" viewBox="0 0 64 64" aria-hidden="true" style="flex-shrink:0;">
            <circle cx="32" cy="32" r="${r}" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="8" />
            <circle class="progress-circle" cx="32" cy="32" r="${r}" fill="none" stroke="#9cf" stroke-width="8"
              stroke-linecap="round"
              stroke-dasharray="${sweep} ${c}"
              transform="rotate(-90 32 32)" />
          </svg>
          <div class="year-text">${this.esc(prettyLine)}</div>
        </div>
      </div>
    `;
  }
}

// Define custom element if not already defined
if (!customElements.get('location-info')) {
  customElements.define('location-info', LocationInfo);
}

// Export for module support
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { LocationInfo };
}
