/**
 * LOGIC FRETE — Rastreio Motorista Ao Vivo (tracking v2)
 * Foreground + Wake Lock + auto-retoma. Sem lib nova, sem custo extra.
 * Realtime local: motorista envia a cada 15s/30m; ADM lê via polling de 15s.
 *
 * Premissa aceita (PWA): rastreio só com app aberto em 1º plano e tela ligada.
 * Minimizar/apagar = pausa (navegador suspende o GPS). Wake Lock impede a tela
 * de apagar; NÃO é rastreio em background.
 */
(function () {
  'use strict';

  // ---- Constantes (mesmos números do PRD) ----
  var INTENT_KEY = 'lf_tracking_intent';   // 1 = motorista quer compartilhar
  var CONSENT_KEY = 'lf_tracking_consent'; // espelho local do consentimento LGPD
  var LAYER_KEY = 'lf_driver_layer';       // camada Motoristas ON/OFF (ADM)
  var SEND_MS = 15000;          // envio a cada 15s
  var MIN_DIST_M = 30;          // ...ou a cada 30m
  var HEARTBEAT_MS = 60000;     // parado >5min: 1 ping/min
  var STOPPED_MS = 5 * 60 * 1000;
  var ONLINE_MS = 2 * 60 * 1000; // ADM: verde <2min, cinza acima
  var POLL_ADM_MS = 15000;
  var RETRY_MS = 30000;          // retry do auto-start (dados ainda carregando)
  var MAX_ACCURACY = 100;

  // ---- Helpers ----
  function $(id) { return document.getElementById(id); }
  function hasSM() { return typeof StorageManager !== 'undefined'; }
  function hasMap() { return typeof MapService !== 'undefined' && MapService.map; }
  function roleOf(u) { return String((u && u.role) || '').toLowerCase(); }
  function isMotorista(u) { return roleOf(u) === 'motorista'; }
  function isAdmin(u) {
    var r = roleOf(u);
    return r === 'master' || r === 'gerente' || r === 'admin';
  }
  function todayStr() {
    var n = new Date();
    return n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-' + String(n.getDate()).padStart(2, '0');
  }
  function distM(a, b, c, d) {
    var R = 6371000, p = Math.PI / 180;
    var s1 = Math.sin((c - a) * p / 2), s2 = Math.sin((d - b) * p / 2);
    var h = s1 * s1 + Math.cos(a * p) * Math.cos(c * p) * s2 * s2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function agoText(ts) {
    if (!ts) return 'nunca';
    var s = Math.max(0, Math.round((Date.now() - new Date(ts).getTime()) / 1000));
    if (s < 5) return 'agora';
    if (s < 60) return 'há ' + s + 's';
    var m = Math.floor(s / 60);
    if (m < 60) return 'há ' + m + 'min';
    return 'há ' + Math.floor(m / 60) + 'h';
  }
  // Toast próprio (o showToast do app.js não é global)
  function trackToast(msg) {
    var c = $('lfTrackToasts');
    if (!c) {
      c = document.createElement('div');
      c.id = 'lfTrackToasts';
      document.body.appendChild(c);
    }
    var t = document.createElement('div');
    t.className = 'lf-toast';
    t.textContent = msg;
    c.appendChild(t);
    setTimeout(function () { t.classList.add('out'); setTimeout(function () { t.remove(); }, 400); }, 4500);
  }

  // ================= MOTORISTA: TrackingService =================
  var TrackingService = {
    sharing: false,
    watchId: null,
    wakeLock: null,
    lastSentAt: 0,
    lastSentPos: null,
    stoppedSince: 0,
    routeId: null,
    weakWarned: false,
    retryTimer: null,
    chipTimer: null,
    sessionDismissed: false,

    getIntent: function () {
      try { return localStorage.getItem(INTENT_KEY) === '1' ? 1 : 0; } catch (e) { return 0; }
    },
    setIntent: function (v) {
      try { localStorage.setItem(INTENT_KEY, v ? '1' : '0'); } catch (e) {}
    },
    consentGranted: function () {
      try { return localStorage.getItem(CONSENT_KEY) === '1'; } catch (e) { return false; }
    },
    setConsentLocal: function (v) {
      try { localStorage.setItem(CONSENT_KEY, v ? '1' : '0'); } catch (e) {}
    },

    // Rota de hoje do motorista (planned/active, driverId = ele ou homônimo)
    findTodayRoute: function (user) {
      if (!hasSM() || !user) return null;
      var today = todayStr();
      var routes = StorageManager.getRoutes() || [];
      var ids = [String(user.id)];
      try {
        var all = (StorageManager.getDrivers() || []).concat(StorageManager.getUsers() || []);
        all.forEach(function (d) {
          if (d && d.name && user.name && String(d.name).trim().toLowerCase() === String(user.name).trim().toLowerCase()) {
            ids.push(String(d.id));
          }
        });
      } catch (e) {}
      for (var i = 0; i < routes.length; i++) {
        var r = routes[i];
        if (!r || !r.date) continue;
        if (String(r.date).slice(0, 10) !== today) continue;
        if (r.status !== 'planned' && r.status !== 'active') continue;
        if (ids.indexOf(String(r.driverId)) !== -1) return r;
      }
      return null;
    },

    // Chamado pelo checkAuth() pós-login, no boot com sessão e ao voltar pra aba
    onAuth: function (user) {
      if (!user) { this.stop('logout', true); this.hideAll(); return; }
      if (!isMotorista(user)) return; // ADM: nada a iniciar (só a camada do mapa, via polling)
      if (this.sharing) return;
      if (this.getIntent() === 1 && this.consentGranted()) {
        this.tryStart(user);
      } else if (!this.sessionDismissed) {
        this.showBanner();
      }
    },

    scheduleRetry: function () {
      var self = this;
      if (this.retryTimer) return;
      this.retryTimer = setTimeout(function () {
        self.retryTimer = null;
        if (self.sharing || self.getIntent() !== 1) return;
        var u = hasSM() ? StorageManager.getCurrentUser() : null;
        if (u && isMotorista(u) && self.consentGranted()) self.tryStart(u);
      }, RETRY_MS);
    },

    tryStart: function (user) {
      user = user || (hasSM() ? StorageManager.getCurrentUser() : null);
      if (!user || !isMotorista(user) || this.sharing) return false;
      if (this.getIntent() !== 1 || !this.consentGranted()) return false;
      if (!('geolocation' in navigator)) { trackToast('Este aparelho não tem GPS.'); return false; }
      var route = this.findTodayRoute(user);
      if (!route) { this.scheduleRetry(); return false; } // sem rota hoje: não inicia
      this.routeId = route.id;
      var self = this;
      try {
        this.watchId = navigator.geolocation.watchPosition(
          function (p) { self.onPos(p); },
          function (e) { self.onErr(e); },
          { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
        );
      } catch (e) { trackToast('Não foi possível ativar o GPS.'); return false; }
      this.sharing = true;
      this.lastSentAt = 0;
      this.requestWakeLock();
      this.showChip();
      this.hideBanner();
      if (hasSM()) StorageManager.setSharing(true).catch(function () {});
      return true;
    },

    onPos: function (pos) {
      if (!this.sharing || !pos || !pos.coords) return;
      var c = pos.coords;
      if (!isFinite(c.latitude) || !isFinite(c.longitude) || (c.latitude === 0 && c.longitude === 0)) return;
      if (c.accuracy && c.accuracy > MAX_ACCURACY) {
        if (!this.weakWarned) { this.weakWarned = true; trackToast('Sinal de GPS fraco — precisão acima de 100m, aguardando melhorar.'); }
        return;
      }
      var now = Date.now();
      var d = this.lastSentPos ? distM(this.lastSentPos.lat, this.lastSentPos.lng, c.latitude, c.longitude) : 9999;
      var speed = (c.speed !== null && c.speed !== undefined) ? Number(c.speed) : null;
      if (d < MIN_DIST_M && (speed === null || speed < 1)) {
        if (!this.stoppedSince) this.stoppedSince = now;
      } else {
        this.stoppedSince = 0;
      }
      var elapsed = now - this.lastSentAt;
      var economy = this.stoppedSince && (now - this.stoppedSince > STOPPED_MS);
      var due = (!this.lastSentAt) || d > MIN_DIST_M || elapsed >= (economy ? HEARTBEAT_MS : SEND_MS);
      if (!due) return;
      var self = this;
      var u = hasSM() ? StorageManager.getCurrentUser() : null;
      var r = (u && this.findTodayRoute(u)) || null;
      if (r) this.routeId = r.id;
      var payload = {
        lat: c.latitude, lng: c.longitude,
        accuracy: c.accuracy != null ? Math.round(c.accuracy) : null,
        speed: speed, heading: (c.heading !== null && c.heading !== undefined) ? Number(c.heading) : null,
        route_id: this.routeId
      };
      if (hasSM()) {
        StorageManager.sendDriverLocation(payload).then(function () {
          self.lastSentAt = Date.now();
          self.lastSentPos = { lat: c.latitude, lng: c.longitude };
        }).catch(function () {});
      }
    },

    onErr: function (e) {
      if (!this.sharing) return;
      if (e && e.code === 1) { // PERMISSION_DENIED
        this.revokeByPermission();
      } else if (e && e.code === 2) {
        trackToast('GPS indisponível no momento. Tentando novamente…');
      }
    },

    revokeByPermission: function () {
      this.stop('denied', true);
      this.setIntent(0);
      this.setConsentLocal(false);
      if (hasSM()) StorageManager.saveTrackConsent(false).catch(function () {});
      this.showBlocked();
    },

    stop: function (_reason, silent) {
      var was = this.sharing;
      if (this.watchId !== null) { try { navigator.geolocation.clearWatch(this.watchId); } catch (e) {} this.watchId = null; }
      this.releaseWakeLock();
      this.sharing = false;
      this.lastSentAt = 0;
      this.lastSentPos = null;
      this.stoppedSince = 0;
      this.hideChip();
      if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
      if (was && hasSM()) {
        this.setIntent(0);
        StorageManager.setSharing(false).catch(function () {});
        if (!silent) trackToast('Compartilhamento de localização parado.');
      }
    },

    // ---- Wake Lock ----
    requestWakeLock: function () {
      if (!('wakeLock' in navigator)) return; // falha silenciosa sem suporte
      var self = this;
      try {
        navigator.wakeLock.request('screen').then(function (lock) {
          self.wakeLock = lock;
          lock.addEventListener('release', function () {
            self.wakeLock = null;
            if (self.sharing) self.requestWakeLock(); // re-tenta se ainda compartilhando
          });
        }).catch(function () {});
      } catch (e) {}
    },
    releaseWakeLock: function () {
      if (this.wakeLock) { try { this.wakeLock.release(); } catch (e) {} this.wakeLock = null; }
    },

    // ---- UI: banner / chip / modal ----
    showBanner: function () {
      if ($('lfTrackBanner') || this.sharing) return;
      var b = document.createElement('div');
      b.id = 'lfTrackBanner';
      b.innerHTML = '<span class="lf-b-ico">📍</span>' +
        '<span class="lf-b-txt">Ativar localização para o ADM acompanhar sua rota?</span>' +
        '<button class="lf-b-btn primary" id="lfBYes">Ativar</button>' +
        '<button class="lf-b-btn" id="lfBNo">Agora não</button>';
      document.body.appendChild(b);
      $('lfBYes').addEventListener('click', function () { TrackingService.flowActivate(); });
      $('lfBNo').addEventListener('click', function () {
        TrackingService.sessionDismissed = true;
        TrackingService.hideBanner();
      });
    },
    hideBanner: function () { var b = $('lfTrackBanner'); if (b) b.remove(); },
    showBlocked: function () {
      this.hideBanner();
      if ($('lfTrackBanner')) return;
      var b = document.createElement('div');
      b.id = 'lfTrackBanner';
      b.className = 'warn';
      b.innerHTML = '<span class="lf-b-ico">📍</span>' +
        '<span class="lf-b-txt"><strong>Localização bloqueada.</strong> Como ativar: cadeado ao lado do endereço &gt; Localização &gt; Permitir.</span>' +
        '<button class="lf-b-btn primary" id="lfBRe">Reativar</button>';
      document.body.appendChild(b);
      $('lfBRe').addEventListener('click', function () {
        TrackingService.hideBanner();
        TrackingService.flowActivate();
      });
    },
    hideAll: function () { this.hideBanner(); this.hideChip(); var m = $('lfTrackModal'); if (m) m.remove(); },

    flowActivate: function () {
      var self = this;
      if (!('geolocation' in navigator)) { trackToast('Este aparelho não tem GPS.'); return; }
      var proceed = function () { self.showConsent(); };
      try {
        if (navigator.permissions && navigator.permissions.query) {
          navigator.permissions.query({ name: 'geolocation' }).then(function (st) {
            if (st.state === 'denied') self.showBlocked();
            else proceed();
          }).catch(proceed);
        } else proceed();
      } catch (e) { proceed(); }
    },

    showConsent: function () {
      if ($('lfTrackModal')) return;
      var m = document.createElement('div');
      m.id = 'lfTrackModal';
      m.innerHTML = '<div class="lf-m-box">' +
        '<h3>📍 Compartilhar localização</h3>' +
        '<ul>' +
        '<li><strong>Finalidade:</strong> permitir que o ADM acompanhe sua posição <strong>somente durante a rota de hoje</strong>.</li>' +
        '<li><strong>Quando:</strong> apenas com o app aberto e a tela ligada. Fechou ou apagou, pausa sozinho.</li>' +
        '<li><strong>Retenção:</strong> guardamos só a <strong>última posição</strong> (sem histórico de 30 dias acumulado).</li>' +
        '<li><strong>Revogação:</strong> 1 clique em <strong>Parar</strong> no chip verde, a qualquer momento.</li>' +
        '</ul>' +
        '<div class="lf-m-actions">' +
        '<button class="lf-b-btn" id="lfMCancel">Fechar</button>' +
        '<button class="lf-b-btn primary" id="lfMOk">Concordo, compartilhar</button>' +
        '</div></div>';
      document.body.appendChild(m);
      $('lfMCancel').addEventListener('click', function () { m.remove(); });
      $('lfMOk').addEventListener('click', function () {
        m.remove();
        TrackingService.grantConsent();
      });
    },

    grantConsent: function () {
      var self = this;
      var done = function () {
        self.setConsentLocal(true);
        self.setIntent(1);
        self.sessionDismissed = false;
        var u = hasSM() ? StorageManager.getCurrentUser() : null;
        if (!self.tryStart(u)) {
          // Sem rota hoje: mantém intent/consent e avisa (auto-inicia quando houver rota)
          self.scheduleRetry();
          trackToast('Tudo certo! O compartilhamento inicia sozinho quando houver rota para você hoje.');
        }
      };
      if (hasSM()) StorageManager.saveTrackConsent(true).then(done).catch(done);
      else done();
    },

    showChip: function () {
      var chip = $('lfTrackChip');
      if (!chip) {
        chip = document.createElement('div');
        chip.id = 'lfTrackChip';
        chip.innerHTML = '<span class="lf-dot"></span><span id="lfChipTxt">Compartilhando</span>' +
          '<button id="lfChipStop">Parar</button>';
        document.body.appendChild(chip);
        $('lfChipStop').addEventListener('click', function () {
          TrackingService.stop('toggle');
          trackToast('Compartilhamento de localização parado.');
        });
      }
      chip.style.display = 'flex';
      var self = this;
      if (this.chipTimer) clearInterval(this.chipTimer);
      this.chipTimer = setInterval(function () { self.tickChip(); }, 5000);
      this.tickChip();
    },
    tickChip: function () {
      var t = $('lfChipTxt');
      if (!t) return;
      if (!this.sharing) { this.hideChip(); return; }
      t.textContent = 'Compartilhando • ' + agoText(this.lastSentAt || Date.now());
      // Sem rota hoje no meio do dia: para sozinho (RF5)
      if (hasSM()) {
        var u = StorageManager.getCurrentUser();
        if (u && isMotorista(u) && !this.findTodayRoute(u)) {
          this.stop('no-route');
          trackToast('Sem rota para hoje: compartilhamento parado.');
        }
      }
    },
    hideChip: function () {
      var c = $('lfTrackChip');
      if (c) c.style.display = 'none';
      if (this.chipTimer) { clearInterval(this.chipTimer); this.chipTimer = null; }
    }
  };

  // ================= ADM: camada Motoristas no mapa =================
  function currentUser() {
    try {
      if (typeof window.appPermissions !== 'undefined' && window.appPermissions && window.appPermissions.currentUser) {
        return window.appPermissions.currentUser;
      }
    } catch (e) {}
    return hasSM() ? StorageManager.getCurrentUser() : null;
  }
  function mapVisible() {
    var el = $('map');
    if (!el || el.style.display === 'none' || !el.offsetParent) return false;
    return true;
  }

  function extendMap() {
    if (typeof MapService === 'undefined' || MapService._trackExt) return;
    MapService._trackExt = true;
    MapService.driverMarkers = {};
    MapService.driverLayerOn = (function () {
      try { return localStorage.getItem(LAYER_KEY) !== '0'; } catch (e) { return true; }
    })();

    MapService.setDriverLayer = function (on) {
      this.driverLayerOn = !!on;
      try { localStorage.setItem(LAYER_KEY, on ? '1' : '0'); } catch (e) {}
      if (!on) this.clearDriverMarkers();
      else this.refreshDriverLayer();
      var btn = $('lfDriverLayerBtn');
      if (btn) btn.classList.toggle('off', !on);
    };

    MapService.clearDriverMarkers = function () {
      var self = this;
      Object.keys(this.driverMarkers).forEach(function (id) {
        try { self.driverMarkers[id].remove(); } catch (e) {}
      });
      this.driverMarkers = {};
    };

    MapService.upsertDriverMarker = function (loc) {
      if (!this.map || !loc || !isFinite(Number(loc.lat)) || !isFinite(Number(loc.lng))) return;
      if (Number(loc.lat) === 0 && Number(loc.lng) === 0) return; // sem posição válida
      var id = String(loc.driver_id);
      var updated = new Date(loc.updated_at).getTime();
      var online = !!loc.is_sharing && (Date.now() - updated < ONLINE_MS);
      var name = loc.driver_name || 'Motorista';
      var speedKmh = (loc.speed !== null && loc.speed !== undefined && isFinite(Number(loc.speed)))
        ? Math.round(Number(loc.speed) * 3.6) : null;
      var statusTxt = !loc.is_sharing ? 'compartilhamento pausado'
        : (online ? 'online • ' + agoText(loc.updated_at) : 'offline ' + agoText(loc.updated_at));
      var popupHtml = '<div class="lf-pop">' +
        '<strong>' + escapeHtml(name) + '</strong><br>' +
        'Rota: ' + escapeHtml(loc.route_name || '—') + '<br>' +
        'Vel: ' + (speedKmh !== null ? speedKmh + ' km/h' : '—') + ' • ' + statusTxt + '<br>' +
        '<button onclick="window._centerDriver(' + Number(loc.lat) + ',' + Number(loc.lng) + ')">Centralizar</button> ' +
        '<a href="https://www.google.com/maps?q=' + Number(loc.lat) + ',' + Number(loc.lng) + '" target="_blank" rel="noopener">GMaps</a>' +
        '</div>';

      var mk = this.driverMarkers[id];
      if (mk) {
        try { mk.setLngLat([Number(loc.lng), Number(loc.lat)]); } catch (e) {}
        if (mk.getElement) {
          var box = mk.getElement().querySelector('.driver-marker');
          if (box) box.className = 'driver-marker ' + (online ? 'online' : 'offline');
        }
        if (mk.getPopup) { try { mk.getPopup().setHTML(popupHtml); } catch (e) {} }
        return;
      }
      var el = document.createElement('div');
      el.innerHTML = '<div class="driver-marker ' + (online ? 'online' : 'offline') + '">' +
        '<div class="dm-pin">🚚</div><div class="dm-label">' + escapeHtml(name) + '</div></div>';
      try {
        var marker = new maplibregl.Marker({ element: el.firstChild })
          .setLngLat([Number(loc.lng), Number(loc.lat)])
          .setPopup(new maplibregl.Popup({ offset: 25 }).setHTML(popupHtml))
          .addTo(this.map);
        this.driverMarkers[id] = marker;
      } catch (e) {}
    };

    MapService.refreshDriverLayer = function () {
      var self = this;
      if (!hasSM() || !this.map) return Promise.resolve();
      return StorageManager.getDriverLocations().then(function (rows) {
        if (!self.driverLayerOn) return;
        (rows || []).forEach(function (loc) { self.upsertDriverMarker(loc); });
        var btn = $('lfDriverLayerBtn');
        if (btn) {
          var n = (rows || []).filter(function (l) { return l.is_sharing; }).length;
          btn.innerHTML = '🚚 Motoristas (' + n + ')';
        }
      }).catch(function () {});
    };
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  window._centerDriver = function (lat, lng) {
    if (typeof MapService !== 'undefined' && MapService.map) {
      MapService.map.flyTo({ center: [Number(lng), Number(lat)], zoom: 15 });
    }
  };

  function ensureLayerButton() {
    if ($('lfDriverLayerBtn')) return;
    var overlay = $('mapControlsOverlay');
    if (!overlay) return;
    var u = currentUser();
    if (!u || !isAdmin(u)) return;
    var btn = document.createElement('button');
    btn.id = 'lfDriverLayerBtn';
    btn.className = 'btn-icon theme-btn lf-layer-btn';
    btn.title = 'Motoristas no mapa (ON/OFF)';
    btn.innerHTML = '🚚 Motoristas';
    btn.addEventListener('click', function () {
      MapService.setDriverLayer(!MapService.driverLayerOn);
    });
    overlay.insertBefore(btn, overlay.firstChild);
    if (!MapService.driverLayerOn) btn.classList.add('off');
  }

  // Polling ADM: 15s, só com mapa visível + admin + camada ON
  function admTick() {
    extendMap();
    ensureLayerButton();
    if (typeof MapService === 'undefined' || !MapService.map) return;
    var u = currentUser();
    if (!u || !isAdmin(u)) return;
    if (!MapService.driverLayerOn || !mapVisible()) return;
    MapService.refreshDriverLayer();
  }

  // ---- Boot ----
  function boot() {
    extendMap();
    if (hasSM()) {
      var u = StorageManager.getCurrentUser();
      if (u) TrackingService.onAuth(u);
    }
    // Auto-retoma ao voltar pra aba (qualquer tela) + wake lock de volta
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState !== 'visible') return;
      if (TrackingService.sharing) TrackingService.requestWakeLock();
      if (hasSM()) {
        var u2 = StorageManager.getCurrentUser();
        if (u2) TrackingService.onAuth(u2);
      }
    });
    setInterval(admTick, POLL_ADM_MS);
    setTimeout(admTick, 5000);
  }

  window.TrackingService = TrackingService;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
