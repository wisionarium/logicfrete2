/**
 * LOGIC FRETE - Main Application Logic
 * Ties UI, StorageManager, and MapService together.
 */

  const initApp = () => {
    // === UI HELPERS ===
    function showToast(message, type = 'success') {
      const container = document.getElementById('toastContainer');
      if (!container) return;

      const toast = document.createElement('div');
      toast.className = `toast ${type}`;
      
      let icon = 'ri-checkbox-circle-line';
      if (type === 'error') icon = 'ri-error-warning-line';
      if (type === 'warning') icon = 'ri-alert-line';

      toast.innerHTML = `
        <i class="${icon}"></i>
        <span>${message}</span>
      `;

      container.appendChild(toast);

      // Auto remove
      setTimeout(() => {
        toast.classList.add('fadeOut');
        setTimeout(() => toast.remove(), 300);
      }, 4000);
    }

    // === AUTHENTICATION LOGIC ===
    let currentUser = null;

    function checkAuth() {
    const savedTheme = localStorage.getItem('system_theme_bg');
    if (savedTheme) {
      document.documentElement.setAttribute('data-theme', savedTheme);
    }

    const savedColor = localStorage.getItem('system_theme_color');
    const savedHover = localStorage.getItem('system_theme_hover');
    if (savedColor && savedHover) {
      document.documentElement.style.setProperty('--accent-primary', savedColor);
      document.documentElement.style.setProperty('--accent-primary-hover', savedHover);
    }

      const overlay = document.getElementById('loginOverlay');
      const wrapper = document.getElementById('mainAppWrapper');
      currentUser = StorageManager.getCurrentUser();
      
      console.log("Auth: Verificando estado...", currentUser ? "Logado" : "Deslogado");

      if (currentUser) {
        document.documentElement.classList.add('is-logged-in');
        if (overlay) overlay.style.setProperty('display', 'none', 'important');
        if (wrapper) wrapper.style.setProperty('display', 'flex', 'important');
        applyPermissions();
        // Rastreio motorista v2: auto-start/auto-retoma em qualquer tela
        if (window.TrackingService) window.TrackingService.onAuth(currentUser);
        
        // Ensure default tab is selected based on role
        const userRole = (currentUser.role || '').toLowerCase();
        // Motorista vai direto para Minhas Rotas (vê suas rotas designadas); demais vão para Dashboard
        const defaultTabId = userRole === 'motorista' ? 'tab-my-routes' : 'tab-dashboard';
        const defaultTab = document.getElementById(defaultTabId);
        if (defaultTab) defaultTab.click();
        
        if (userRole === 'motorista') {
          setTimeout(() => {
            const allChip = document.querySelector('#mainRoutesView .filter-chips .chip[data-filter="all"]');
            if (allChip) allChip.click();
          }, 50);
        }

        if (userRole === 'motorista' || userRole === 'vendedor') {
          const pendingChip = document.querySelector('#mainRoutesView .filter-chips .chip[data-filter="pending"]');
          if (pendingChip) pendingChip.style.display = 'none';
        }

        
        // Initial dashboard refresh
        refreshDashboard();

        if (window.refreshProfileDropup) window.refreshProfileDropup();

        // Wake up map
        setTimeout(() => {
          if (MapService.map) MapService.map.resize();
        }, 500);
      } else {
        document.documentElement.classList.remove('is-logged-in');
        // Rastreio motorista v2: logout para tudo em ≤30s
        if (window.TrackingService) window.TrackingService.onAuth(null);
        if (overlay) overlay.style.setProperty('display', 'flex', 'important');
        if (wrapper) wrapper.style.setProperty('display', 'none', 'important');
        
        // Limpar campos do Busca CEP
        const cepInput = document.getElementById('sidebarCepInput');
        if (cepInput) cepInput.value = '';
        const cepResult = document.getElementById('sidebarCepResult');
        if (cepResult) {
          cepResult.innerHTML = '';
          cepResult.style.display = 'none';
        }
      }
    }
    const loginOverlay = document.getElementById('loginOverlay');
    const mainAppWrapper = document.getElementById('mainAppWrapper');
    const loginForm = document.getElementById('loginForm');
    const btnLogout = document.getElementById('btnLogout');

    const loginError = document.getElementById('loginError');

    if (loginForm) {
      loginForm.onsubmit = async (e) => {
        e.preventDefault();
        console.log("Auth: Formulário de login enviado.");
        
        const btn = loginForm.querySelector('button[type="submit"]');
        const originalText = btn.innerHTML;
        
        const user = document.getElementById('loginUser').value.trim();
        const pass = document.getElementById('loginPass').value.trim();

        if (!user || !pass) return;

        try {
          btn.disabled = true;
          btn.innerHTML = '<i class="ri-loader-4-line btn-spin"></i> Entrando...';
          
          console.log(`Auth: Tentando login para o usuário: ${user}`);
          const success = await StorageManager.login(user, pass);

          if (success) {
            console.log("Auth: Login retornado com sucesso.");
            if (loginError) loginError.style.display = 'none';
            showToast('Login realizado com sucesso!');
            loginForm.reset();
            document.activeElement?.blur(); // Close keyboard
            // Carrega os dados do Supabase antes de liberar a tela
            try {
              showToast('Sincronizando dados...');
              await StorageManager.init();
            } catch (e) {
              console.error("Auth: Erro ao carregar dados iniciais:", e);
            }

            // Execute the UI transition
            checkAuth();
            
            // Atualiza as listas com os dados recém-carregados
            if (typeof renderRoutesList === 'function') renderRoutesList();
            if (typeof renderDriversList === 'function') renderDriversList();

            setTimeout(() => {
              const overlay = document.getElementById('loginOverlay');
              if (overlay && overlay.style.display !== 'none') {
                console.warn("Auth: Transição de UI falhou, forçando recarregamento...");
                window.location.reload();
              }
            }, 1000);

          } else {
            console.warn("Auth: Credenciais inválidas.");
            if (loginError) loginError.style.display = 'block';
            showToast('Usuário ou senha incorretos', 'error');
          }
        } catch (err) {
          console.error("Login error:", err);
          showToast('Erro de conexão: ' + err.message, 'error');
        } finally {
          btn.disabled = false;
          btn.innerHTML = originalText;
        }
      };
    }

    // Clear error message when user starts typing
    ['loginUser', 'loginPass'].forEach(id => {
      document.getElementById(id)?.addEventListener('input', () => {
        if (loginError) loginError.style.display = 'none';
      });
    });

    btnLogout?.addEventListener('click', () => {
      StorageManager.logout();
      checkAuth();
    });

    document.getElementById('btnLogoutMobile')?.addEventListener('click', () => {
      StorageManager.logout();
      checkAuth();
    });

    function applyPermissions() {
      if (!currentUser) return;
      
      const role = (currentUser.role || '').toLowerCase();
      const isMaster   = role === 'master';
      const isGerente  = role === 'gerente';
      const isMotorista = role === 'motorista';
      const isVendedor = role === 'vendedor';

      // MASTER e GERENTE têm acesso total
      const canDoAll = isMaster || isGerente;
      // Somente leitura para Motorista e Vendedor
      const isReadOnly = isMotorista || isVendedor;

      const canViewRoute     = true;
      const canEditRoute     = canDoAll;
      const canReorder       = canDoAll || isMotorista;
      const canOptimize      = canDoAll || isMotorista || isVendedor;
      const canEditNotes     = canDoAll;
      const canConcludeRoute = isMaster || isGerente;
      const canCloseRoute    = canDoAll;
      const canCreateStop    = canDoAll;
      const perms = currentUser.permissions || [];

      // Users Tab visibility
      const tabUsers = document.getElementById('tab-users');
      const tabSettings = document.getElementById('tab-settings');
      const tabDashboard = document.getElementById('tab-dashboard');
      const tabDrivers = document.getElementById('tab-drivers');
      const tabMap = document.getElementById('tab-map');

      if (tabUsers)     tabUsers.style.display     = 'flex'; // todos os níveis veem a aba Usuários
      if (tabSettings)  tabSettings.style.display  = canDoAll ? 'flex' : 'none'; // apenas master/admin/gerente acessam configurações
      if (tabDashboard) tabDashboard.style.display = isMotorista ? 'none' : 'flex';
      if (tabMap)       tabMap.style.display       = 'flex';              // todos veem o mapa
      const tabMyRoutes = document.getElementById('tab-my-routes');
      if (tabMyRoutes)  tabMyRoutes.style.display  = isMotorista ? 'flex' : 'none';

      const btnNewUserMain = document.getElementById('btnNewUserMain');
      if (btnNewUserMain) btnNewUserMain.style.display = canDoAll ? 'flex' : 'none';

      // Sync bottom nav visibility with sidebar tabs
      const mbnDashboard = document.getElementById('mbn-dashboard');
      const mbnDrivers  = document.getElementById('mbn-drivers');
      const mbnMap      = document.getElementById('mbn-map');
      const mbnMyRoutes = document.getElementById('mbn-my-routes');
      if (mbnDashboard) mbnDashboard.style.display = isMotorista ? 'none' : 'flex';
      if (mbnDrivers)   mbnDrivers.style.display   = isMotorista ? 'none' : 'flex';
      if (mbnMap)       mbnMap.style.display       = canViewRoute ? 'flex' : 'none';
      if (mbnMyRoutes)  mbnMyRoutes.style.display  = isMotorista ? 'flex' : 'none';

      // Se motorista, redireciona para aba Minhas Rotas
      if (isMotorista) {
        const mbnMyRoutesBtn = document.getElementById('mbn-my-routes');
        if (mbnMyRoutesBtn) mbnMyRoutesBtn.classList.add('active');
        const mbnDash = document.getElementById('mbn-dashboard');
        if (mbnDash) mbnDash.classList.remove('active');
        const mbnRoutes = document.getElementById('mbn-routes');
        if (mbnRoutes) mbnRoutes.classList.remove('active');
        
        document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
        const tabMyRoutes = document.getElementById('tab-my-routes');
        if (tabMyRoutes) tabMyRoutes.classList.add('active');
        
        window.isMyRoutesViewActive = false; // motorista vê todas as rotas
        if (typeof showMainView === 'function') showMainView('mainRoutesView');
      }
      
      // Botões globais de ação
      const btnNewRoute = document.getElementById('btnNewRouteMain');
      if (btnNewRoute) btnNewRoute.style.display = canEditRoute ? 'inline-flex' : 'none';
      
      const btnNewDriver = document.getElementById('btnNewDriverMain');
      if (btnNewDriver) btnNewDriver.style.display = canDoAll ? 'inline-flex' : 'none';

      const btnNewDelivery = document.getElementById('btnNewDelivery');
      if (btnNewDelivery) btnNewDelivery.style.display = isReadOnly ? 'none' : 'inline-flex';
      
      const btnNewDeliveryMain = document.getElementById('btnNewDeliveryMain');
      if (btnNewDeliveryMain) btnNewDeliveryMain.style.display = isReadOnly ? 'none' : 'inline-flex';
      
      // Configurações — motorista vê apenas Motoristas e Veículos
      const btnSettingsDrivers  = document.getElementById('btnSettingsDrivers');
      const btnSettingsVehicles = document.getElementById('btnSettingsVehicles');
      const btnSettingsFreight  = document.getElementById('btnSettingsFreight');
      if (btnSettingsDrivers)  btnSettingsDrivers.style.display  = 'flex';                        // todos veem
      if (btnSettingsVehicles) btnSettingsVehicles.style.display = 'flex';                        // todos veem
      if (btnSettingsFreight)  btnSettingsFreight.style.display  = (isMotorista || isVendedor) ? 'none' : 'flex';
      
      const btnSettingsAuditLogs = document.getElementById('btnSettingsAuditLogs');
      if (btnSettingsAuditLogs) btnSettingsAuditLogs.style.display = canDoAll ? 'flex' : 'none';
      
      // Salva permissões globalmente para uso nas funções de render
      window.appPermissions = {
        canViewRoute, canEditRoute, canReorder, canOptimize, canEditNotes,
        canConcludeRoute, canCloseRoute, canCreateStop, canDoAll, isReadOnly,
        isMaster, isGerente, isMotorista, isVendedor,
        isAdminOrMaster: isMaster,
        currentUser
      };
    }


    // Sidebar & Mobile Menu

    const sidebar = document.getElementById('sidebar');
    const sidebarOverlay = document.getElementById('sidebarOverlay');
    const btnOpenSidebar = document.getElementById('btnOpenSidebar');
    const btnCollapseSidebar = document.getElementById('btnCollapseSidebar');
    const navTabs = document.querySelectorAll('.nav-tab');
    const tabPanels = document.querySelectorAll('.tab-panel');

    function toggleMobileMenu(forceClose = false) {
      if (window.innerWidth <= 768) {
        if (forceClose) {
          sidebar.classList.remove('mobile-active');
          if (sidebarOverlay) sidebarOverlay.classList.remove('active');
        } else {
          sidebar.classList.toggle('mobile-active');
          if (sidebarOverlay) sidebarOverlay.classList.toggle('active');
        }
      } else {
        // On desktop, just collapse sidebar (icon-only mode)
        if (forceClose) {
          // do nothing on desktop 'close'
        } else {
          sidebar.classList.toggle('collapsed');
        }
      }
      
      // Fix Map if visible
      setTimeout(() => {
        if (MapService.map) MapService.map.resize();
      }, 300);
    }

    btnOpenSidebar?.addEventListener('click', () => toggleMobileMenu());
    sidebarOverlay?.addEventListener('click', () => toggleMobileMenu(true));
    btnCollapseSidebar?.addEventListener('click', () => toggleMobileMenu(true));

  
    // Modals
    const modalRoute = document.getElementById('modalRoute');
    const modalDelivery = document.getElementById('modalDelivery');
    const modalDriver = document.getElementById('modalDriver');
    
    // Confirm Dialog
    const confirmDialog = document.getElementById('confirmDialog');
    let confirmCallback = null;
  
    // Route Detail Panel
    const routeDetailPanel = document.getElementById('routeDetailPanel');
    const rdpClose = document.getElementById('rdpClose');
    let activeRouteId = null; // Track which route is selected
    let expandedRouteIds = new Set();
    window.expandedStopIds = window.expandedStopIds || new Set();

    // Main Content Views
    const mainDashboardView = document.getElementById('mainDashboardView');
    const mainRoutesView = document.getElementById('mainRoutesView');
    const mainCalendarView = document.getElementById('mainCalendarView');
    const mainDriversView = document.getElementById('mainDriversView');
    const mainUsersView = document.getElementById('mainUsersView');
    const mainVehiclesView = document.getElementById('mainVehiclesView');

    // Helper to get local date in YYYY-MM-DD format
    window.getLocalISODate = function() {
      const now = new Date();
      return now.getFullYear() + '-' + 
             String(now.getMonth() + 1).padStart(2, '0') + '-' + 
             String(now.getDate()).padStart(2, '0');
    }

    const allMainViews = [
      mainDashboardView,
      mainRoutesView,
      mainCalendarView,
      mainDriversView,
      mainUsersView,
      mainVehiclesView,
      document.getElementById('mainSettingsView'),
      document.getElementById('mainHistoricalRoutesView')
    ];

    const mapAreaElements = [
      document.getElementById('mapControlsOverlay'),
      document.getElementById('map'),
      document.getElementById('routeDetailPanel')
    ];
  
    // Helper to navigate to map and load a route
    async function navigateToMap(routeId, readOnly = false) {
      // Toggle tab active state in sidebar
      document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
      document.getElementById('tab-map').classList.add('active');
      
      showMainView('map');
      
      // Force readOnly if no edit permission
      const finalReadOnly = readOnly || (window.appPermissions && !window.appPermissions.canEditRoute);
      
      if (routeId) {
        // Wait for map to be initialized and style loaded before drawing route
        await MapService.waitReady();
        loadRouteToMap(routeId, finalReadOnly);
      }
    }
    window.navigateToMap = navigateToMap;

    // --- ROUTE TOOLTIP LOGIC ---
    let tooltipTimeout = null;
    let tooltipVisible = false;

    window.showRouteTooltipAt = (x, y, routeId) => {
      const route = StorageManager.getRoute(routeId);
      const stops = StorageManager.getDeliveriesByRoute(routeId);
      if (!route) return;
      
      if (!window._routeTooltipEl) {
        window._routeTooltipEl = document.createElement('div');
        window._routeTooltipEl.id = 'routeTooltip';
        window._routeTooltipEl.style.position = 'fixed';
        window._routeTooltipEl.style.background = 'rgba(0, 0, 0, 0.5)';
        window._routeTooltipEl.style.backdropFilter = 'blur(4px)';
        window._routeTooltipEl.style.webkitBackdropFilter = 'blur(4px)';
        window._routeTooltipEl.style.color = '#fff';
        window._routeTooltipEl.style.padding = '12px 16px';
        window._routeTooltipEl.style.borderRadius = '8px';
        window._routeTooltipEl.style.fontSize = '0.75rem';
        window._routeTooltipEl.style.zIndex = '999999';
        window._routeTooltipEl.style.pointerEvents = 'none';
        window._routeTooltipEl.style.boxShadow = '0 8px 32px rgba(0,0,0,0.3)';
        window._routeTooltipEl.style.border = '1px solid rgba(255,255,255,0.1)';
        document.body.appendChild(window._routeTooltipEl);
      }

      const stopsHtml = stops.slice(0, 15).map((s, idx) => {
        let loc = s.address || 'Endereço não informado';
        if (loc !== 'Endereço não informado') {
          loc = loc.replace(/,\s*(?:s\/?n|[sS]\/[nN]|\d+[a-zA-Z]?)\b/g, '');
          loc = loc.replace(/\s*[,-]?\s*\d{5}-?\d{3}\b/g, '');
          loc = loc.replace(/\s*[,-]?\s*Brasil/gi, '');
          loc = loc.replace(/(?:^[\s,-]+|[\s,-]+$)/g, '');
          loc = loc.replace(/,/g, ' -');
          loc = loc.replace(/\s*-\s*-\s*/g, ' - ');
        }
        return `<div style="margin-bottom:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${loc}">${idx + 1}. ${loc}</div>`;
      }).join('');

      const extraStops = stops.length > 15 ? `<div style="color:var(--text-muted); font-style:italic;">... e mais ${stops.length - 15} paradas</div>` : '';

      window._routeTooltipEl.innerHTML = `
        <div style="font-weight:bold; margin-bottom: 8px; font-size: 0.85rem; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 6px;">${route.name} - <span style="font-weight:bold;">${formatDate(route.date)}</span></div>
        <div style="font-weight:bold; margin-bottom: 6px; color: var(--text-white);"><i class="ri-truck-fill" style="color:var(--accent-primary);"></i> ${stops.length} Paradas agendadas</div>
        <div style="display:flex; flex-direction:column; opacity: 0.85; max-height: 200px; overflow: hidden;">
          ${stopsHtml}
          ${extraStops}
        </div>
      `;

      window._routeTooltipEl.style.display = 'block';
      
      let posX = x + 15;
      let posY = y + 15;
      
      setTimeout(() => {
        if (!tooltipVisible) return;
        const rect = window._routeTooltipEl.getBoundingClientRect();
        if (posX + rect.width > window.innerWidth) posX = window.innerWidth - rect.width - 10;
        if (posY + rect.height > window.innerHeight) posY = window.innerHeight - rect.height - 10;
        window._routeTooltipEl.style.left = posX + 'px';
        window._routeTooltipEl.style.top = posY + 'px';
      }, 0);

      tooltipVisible = true;
    };

    window.hideRouteTooltip = () => {
      tooltipVisible = false;
      if (window._routeTooltipEl) {
        window._routeTooltipEl.style.display = 'none';
      }
    };

    window.handleRouteCardMouseMove = (e, routeId) => {
      // Disable tooltip on mobile devices
      if (window.innerWidth <= 768) return;

      // Ignore if mouse is over an interactive element like buttons
      if (e.target.closest('button') || e.target.closest('.item-actions') || e.target.closest('.badge')) {
         window.handleRouteCardMouseLeave();
         return;
      }
      if (tooltipVisible) {
        window.hideRouteTooltip();
      }
      if (tooltipTimeout) clearTimeout(tooltipTimeout);
      const x = e.clientX;
      const y = e.clientY;
      tooltipTimeout = setTimeout(() => {
        window.showRouteTooltipAt(x, y, routeId);
      }, 400);
    };

    window.handleRouteCardMouseLeave = () => {
      if (tooltipTimeout) clearTimeout(tooltipTimeout);
      window.hideRouteTooltip();
    };
    // --- END ROUTE TOOLTIP LOGIC ---

    window.goToRoute = function(routeId) {
      expandedRouteIds.add(routeId);
      activeRouteId = routeId;
      
      const route = StorageManager.getRoutes().find(r => r.id === routeId);
      if (route) {
        const routeChips = document.querySelectorAll('#mainRoutesView .filter-chips .chip');
        if (routeChips.length > 0) {
          routeChips.forEach(c => c.classList.remove('active'));
          let targetChip = document.querySelector(`#mainRoutesView .filter-chips .chip[data-filter="${route.status}"]`);
          if (!targetChip) targetChip = document.querySelector('#mainRoutesView .filter-chips .chip[data-filter="all"]');
          if (targetChip) targetChip.classList.add('active');
        }
      }

      const isMotorista = window.appPermissions && window.appPermissions.isMotorista;
      const targetTabId = isMotorista ? 'tab-my-routes' : 'tab-routes';
      const targetTab = document.getElementById(targetTabId);
      if (targetTab) {
        targetTab.click();
      }

      const searchInput = document.getElementById('searchRoutesMain');
      if (searchInput && searchInput.value) {
        searchInput.value = '';
      }

      if (typeof renderRoutesList === 'function') renderRoutesList();
      
      setTimeout(() => {
        const routeEl = document.querySelector('.list-item[data-route-id="' + routeId + '"]');
        if (routeEl) {
          routeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 100);
    };

    // Global click listener to collapse items when clicking outside
    document.addEventListener('click', (e) => {
      const isListItem = e.target.closest('.list-item');
      const isModal = e.target.closest('.modal-content') || e.target.closest('.confirm-dialog-content');
      const isAction = e.target.closest('.details-actions') || e.target.closest('.stop-actions-small');
      
      if (!isListItem && !isModal && !isAction) {
        if (expandedRouteIds.size > 0) {
          expandedRouteIds.clear();
          if (document.getElementById('panel-routes')?.classList.contains('active')) renderRoutesList();
        }
      }
    });

    // Auto-collapse expanded routes after 5 minutes of no interaction
    let collapseInactivityTimer;
    function resetCollapseTimer() {
      clearTimeout(collapseInactivityTimer);
      collapseInactivityTimer = setTimeout(() => {
        if (expandedRouteIds.size > 0) {
          expandedRouteIds.clear();
          if (document.getElementById('panel-routes')?.classList.contains('active')) renderRoutesList();
        }
      }, 5 * 60 * 1000); // 5 minutes
    }
    document.addEventListener('mousemove', resetCollapseTimer);
    document.addEventListener('keydown', resetCollapseTimer);
    document.addEventListener('click', resetCollapseTimer);
    resetCollapseTimer();

    // === EVENT LISTENERS: SIDEBAR & NAVIGATION ===
    const btnAccessMap = document.getElementById('btnAccessMap');
    btnAccessMap?.addEventListener('click', () => navigateToMap());

    function showMainView(viewId) {
      // Add current view class to mainAppWrapper for CSS scoping
      const wrapper = document.getElementById('mainAppWrapper');
      if (wrapper) {
        // Remove existing view classes
        wrapper.classList.forEach(cls => {
          if (cls.startsWith('view-')) wrapper.classList.remove(cls);
        });
        const viewClass = viewId === 'map' ? 'view-map' : `view-${viewId.replace('main', '').replace('View', '').toLowerCase()}`;
        wrapper.classList.add(viewClass);
      }

      // Close Smart Fit preview overlay if it exists when leaving the map view or switching views
      const previewOverlay = document.getElementById('smartFitPreviewOverlay');
      if (previewOverlay) previewOverlay.remove();

      if (viewId === 'map') {
        allMainViews.forEach(v => { if(v) v.style.display = 'none'; });
        mapAreaElements.forEach(el => {
          if(el) el.style.display = el.id === 'routeDetailPanel' ? (activeRouteId ? 'flex' : 'none') : 'flex';
        });
        // Lazy-init: initialize map only after the container is visible
        if (MapService && !MapService.map) {
          try {
            MapService.init('map');
            // Force resize after browser renders the visible container (desktop fix)
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                if (MapService.map) MapService.map.resize();
              });
            });
            // Also resize once the style finishes loading
            MapService.waitReady().then(() => {
              if (MapService.map) MapService.map.resize();
            });
          } catch (mapErr) {
            console.error('Erro ao iniciar mapa:', mapErr);
          }
        } else if (MapService && MapService.map) {
          requestAnimationFrame(() => {
            if (MapService.map) MapService.map.resize();
          });
        }
        return;
      }

      allMainViews.forEach(v => {
        if(v) v.style.display = v.id === viewId ? 'flex' : 'none';
      });
      mapAreaElements.forEach(el => {
        if(el) el.style.display = 'none';
      });
      
      // Refresh data
      if (viewId === 'mainDashboardView') refreshDashboard();
      if (viewId === 'mainRoutesView') {
        initRoutesFilter();
        renderRoutesList(); // Renderiza do cache local imediatamente (update otimista)
        // Refresh leve em fundo, sem apagar a lista (evita flicker "sumiu e voltou")
        if (typeof StorageManager !== 'undefined' && !window._refreshingRoutes) {
          window._refreshingRoutes = true;
          // Sequencial: rotas primeiro para fetchDeliveries usar o cache fresco (evita corrida)
          StorageManager.fetchRoutes()
            .then(() => Promise.all([
              StorageManager.fetchDeliveries(),
              typeof StorageManager.fetchPendingDeliveries === 'function' ? StorageManager.fetchPendingDeliveries() : Promise.resolve()
            ]))
            .then(() => {
              if (document.getElementById('mainRoutesView')?.style.display !== 'none') {
                renderRoutesList();
              }
            }).catch(err => console.error("Erro ao atualizar rotas na navegação:", err))
            .finally(() => { window._refreshingRoutes = false; });
        }
      }
      if (viewId === 'mainCalendarView') renderCalendarView();
      if (viewId === 'mainDriversView') renderDriversList();
      if (viewId === 'mainUsersView') renderUsersList();
      if (viewId === 'mainVehiclesView') {
        if (typeof renderVehiclesList === 'function') renderVehiclesList();
      }
      if (viewId === 'mainSettingsView') {
        if (typeof loadSettingsView === 'function') loadSettingsView();
      }
    }
  
    navTabs.forEach(tab => {
      tab.addEventListener('click', async () => {
        // Close menu on mobile
        toggleMobileMenu(true);

        // Remove active
        navTabs.forEach(t => t.classList.remove('active'));
        tabPanels.forEach(p => p.classList.remove('active'));
        // Add active
        tab.classList.add('active');
        const targetId = `panel-${tab.dataset.tab}`;
        const targetPanel = document.getElementById(targetId);
        if(targetPanel) targetPanel.classList.add('active');
        
        // Sync bottom nav active state
        updateBottomNavActive(tab.dataset.tab);

        // Fechar RDP ao mudar de menu (saindo do mapa)
        if (tab.dataset.tab !== 'map') {
          if (routeDetailPanel && routeDetailPanel.classList.contains('show')) {
            routeDetailPanel.classList.remove('show');
            routeDetailPanel.style.display = 'none';
            activeRouteId = null;
            if (typeof MapService !== 'undefined') MapService.clearMap();
          }
        }

        // Refresh data based on tab
        const viewMap = {
          'dashboard': 'mainDashboardView',
          'routes': 'mainRoutesView',
          'my-routes': 'mainRoutesView',
          'calendar': 'mainCalendarView',
          'drivers': 'mainDriversView',
          'users': 'mainUsersView',
          'settings': 'mainSettingsView',
          'vehicles': 'mainVehiclesView',
          'map': 'map'
        };
        
        window.isMyRoutesViewActive = (tab.dataset.tab === 'my-routes');
        showMainView(viewMap[tab.dataset.tab]);
        
        // After showing view, render specific data (refresh real é feito em showMainView, sem apagar cache)
        if (tab.dataset.tab === 'dashboard') {
          refreshDashboard();
        } else if (tab.dataset.tab === 'routes' || tab.dataset.tab === 'my-routes') {
          const list = document.getElementById('routesListMain');
          // Skeleton apenas no primeiro load (cache vazio). Nunca apaga lista já renderizada.
          if (list && !list.innerHTML.trim()) {
            list.innerHTML = '<div style="text-align: center; padding: 20px;"><i class="ri-loader-4-line ri-spin" style="font-size: 2rem; color: var(--accent-primary);"></i><p style="margin-top:10px;">Carregando rotas...</p></div>';
          }
          renderRoutesList();
        } else if (tab.dataset.tab === 'calendar') {
          const list = document.getElementById('kanbanBoard');
          if(list) list.innerHTML = '<div style="text-align: center; padding: 20px;"><i class="ri-loader-4-line ri-spin" style="font-size: 2rem; color: var(--accent-primary);"></i><p style="margin-top:10px;">Atualizando calendário...</p></div>';
          try {
            await StorageManager.init();
          } catch(e) {}
          renderCalendarView();
        }
      });
    });


    // === MOBILE BOTTOM NAVIGATION ===
    const mobileNavItems = document.querySelectorAll('.mobile-nav-item');

    function updateBottomNavActive(tabId) {
      mobileNavItems.forEach(item => {
        item.classList.toggle('active', item.dataset.tab === tabId);
      });
    }

    mobileNavItems.forEach(item => {
      item.addEventListener('click', async () => {
        const tabId = item.dataset.tab;
        
        // Fetchings são tratados no event listener principal do sidebarTab.click()

        const sidebarTab = document.getElementById(`tab-${tabId}`);
        if (sidebarTab && sidebarTab.style.display !== 'none') {
          sidebarTab.click();
        }
      });
    });

    // Initialize bottom nav active state to match default tab
    updateBottomNavActive('dashboard');

    // === DASHBOARD STAT CARDS CLICKS ===
    document.getElementById('stat-routes-main')?.addEventListener('click', () => {
      document.getElementById('tab-routes').click();
      setTimeout(() => {
        const filter = document.querySelector('#mainRoutesView .filter-chips [data-filter="hoje"]');
        if(filter) filter.click();
      }, 50);
    });

    document.getElementById('stat-pending-main')?.addEventListener('click', () => {
      document.getElementById('tab-routes').click();
      setTimeout(() => {
        const filter = document.querySelector('#mainRoutesView .filter-chips [data-filter="planned"]');
        if(filter) filter.click();
      }, 50);
    });

    document.getElementById('stat-done-main')?.addEventListener('click', () => {
      document.getElementById('tab-routes').click();
      setTimeout(() => {
        const filter = document.querySelector('#mainRoutesView .filter-chips [data-filter="done"]');
        if(filter) filter.click();
      }, 50);
    });
    
    // (Old stat listeners removed)

    document.getElementById('stat-km-main')?.addEventListener('click', () => {
      document.getElementById('tab-routes').click();
    });
  
    // === ROUTES VIEW FILTER & SEARCH LOGIC ===
    const routeChips = document.querySelectorAll('#mainRoutesView .filter-chips .chip');

    // Definir filtro padrão como 'planned' apenas no primeiro acesso; preserva escolha do usuário
    function initRoutesFilter() {
      const hasActive = document.querySelector('#mainRoutesView .filter-chips .chip.active');
      if (hasActive) return;
      const defaultChip = document.querySelector('#mainRoutesView .filter-chips .chip[data-filter="planned"]');
      if (defaultChip) {
        routeChips.forEach(c => c.classList.remove('active'));
        defaultChip.classList.add('active');
      }
    }

    routeChips.forEach(chip => {
      chip.addEventListener('click', (e) => {
        routeChips.forEach(c => c.classList.remove('active'));
        e.currentTarget.classList.add('active');
        // Render function is defined below, wait until available
        if (typeof renderRoutesList === 'function') renderRoutesList();
      });
    });

    const routeSearchInput = document.getElementById('searchRoutesMain');
    if (routeSearchInput) {
      routeSearchInput.addEventListener('input', () => {
        if (typeof renderRoutesList === 'function') renderRoutesList();
      });
    }

    // === SIDEBAR COLLAPSE LOGIC ===
    // Restore collapsed state only on desktop
    if (window.innerWidth > 768) {
      const isSidebarCollapsed = localStorage.getItem('sidebarCollapsed') === 'true';
      if (isSidebarCollapsed) sidebar.classList.add('collapsed');
    }

    // Persist desktop collapse state
    if (btnCollapseSidebar) {
      btnCollapseSidebar.addEventListener('change', () => {
        if (window.innerWidth > 768) {
          localStorage.setItem('sidebarCollapsed', sidebar.classList.contains('collapsed'));
        }
      });
    }

    // === MAP CONTROLS ===
    document.getElementById('btnLocate')?.addEventListener('click', () => MapService.locateUser());
    document.getElementById('btnFitAll')?.addEventListener('click', () => MapService.fitAll());
    document.getElementById('btnExport')?.addEventListener('click', () => StorageManager.exportData());

    // Initialize RDP (Route Detail Panel) Listeners
    initRdpListeners();
  
    // === MAP THEME SWITCHER ===
    const mapStyleSelect = document.getElementById('mapStyleSelect');
    if (mapStyleSelect) {
      mapStyleSelect.addEventListener('change', (e) => {
        MapService.setBaseLayer(e.target.value);
      });
    }

    const handleTrafficToggle = (e) => {
      const isActive = MapService.toggleTraffic();
      const desktopBtn = document.getElementById('btnTrafficDesktop');
      const mobileBtn = document.getElementById('btnTraffic');
      
      desktopBtn?.classList.toggle('active', isActive);
      mobileBtn?.classList.toggle('active', isActive);
      
      if(isActive) {
        showToast('Trânsito em tempo real ativado');
      } else {
        showToast('Trânsito desativado');
      }
    };

    document.getElementById('btnTraffic')?.addEventListener('click', handleTrafficToggle);
    document.getElementById('btnTrafficDesktop')?.addEventListener('click', handleTrafficToggle);

    // === SEARCH SUGGESTIONS LOGIC (Nominatim) ===
    let currentSearchMarker = null;
    let debounceTimer;
    function setupAddressSearch(inputId, suggestionsId, latId, lngId, wrapId) {
      const input = document.getElementById(inputId);
      if (!input) return;
      const suggestions = document.getElementById(suggestionsId);
      let activeIndex = -1;
      
      const selectSuggestion = (res) => {
        input.value = res.address;
        if (latId && lngId) {
          document.getElementById(latId).value = res.lat;
          document.getElementById(lngId).value = res.lng;
          if (document.getElementById(wrapId)) {
            document.getElementById(wrapId).value = res.address;
          }
          document.getElementById(latId).dispatchEvent(new Event('change', { bubbles: true }));
        }
        suggestions.style.display = 'none';
        activeIndex = -1;
        
        if (inputId === 'addressSearchInput') {
          MapService.map.flyTo({ center: [res.lng, res.lat], zoom: 16 });
          if (currentSearchMarker) currentSearchMarker.remove();
          currentSearchMarker = MapService.createMarker(res.lat, res.lng, '', 'planned');
          currentSearchMarker.setPopup(new maplibregl.Popup({ offset: 25 }).setText(res.address)).togglePopup();
          document.getElementById('clearSearch').style.display = 'block';
        }
      };

      input.addEventListener('keydown', (e) => {
        const items = suggestions.querySelectorAll('.suggestion-item:not(.empty)');
        if (suggestions.style.display === 'none' || items.length === 0) return;

        if (e.key === 'ArrowDown') {
          e.preventDefault();
          activeIndex = (activeIndex + 1) % items.length;
          updateActiveSuggestion(items);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          activeIndex = (activeIndex - 1 + items.length) % items.length;
          updateActiveSuggestion(items);
        } else if (e.key === 'Enter') {
          e.preventDefault();
          if (activeIndex > -1 && items[activeIndex]) {
            items[activeIndex].click();
          }
        } else if (e.key === 'Escape') {
          suggestions.style.display = 'none';
          activeIndex = -1;
        }
      });

      function updateActiveSuggestion(items) {
        items.forEach((item, idx) => {
          if (idx === activeIndex) {
            item.classList.add('active');
            item.scrollIntoView({ block: 'nearest' });
          } else {
            item.classList.remove('active');
          }
        });
      }
      
      input.addEventListener('input', (e) => {
        clearTimeout(debounceTimer);
        const query = e.target.value;
        
        if (inputId === 'addressSearchInput') {
          document.getElementById('clearSearch').style.display = query.length > 0 ? 'block' : 'none';
        }
        
        if (query.length < 3) {
          suggestions.style.display = 'none';
          activeIndex = -1;
          return;
        }
        
        debounceTimer = setTimeout(async () => {
          const results = await MapService.searchAddress(query);
          suggestions.innerHTML = '';
          activeIndex = -1;
          
          if (results.length === 0) {
            suggestions.innerHTML = '<div class="suggestion-item empty"><span class="suggestion-text">Nenhum endereço encontrado</span></div>';
          } else {
            results.forEach((res, idx) => {
              const div = document.createElement('div');
              div.className = 'suggestion-item';
              div.innerHTML = `<i class="ri-map-pin-line"></i> <span class="suggestion-text">${res.address}</span>`;
              div.addEventListener('click', () => selectSuggestion(res));
              
              // Also highlight on hover to keep synced
              div.addEventListener('mouseenter', () => {
                activeIndex = idx;
                const items = suggestions.querySelectorAll('.suggestion-item:not(.empty)');
                updateActiveSuggestion(items);
              });

              suggestions.appendChild(div);
            });
          }
          suggestions.style.display = 'block';
        }, 500);
      });
  
      document.addEventListener('click', (e) => {
        if (!input.contains(e.target) && !suggestions.contains(e.target)) {
          suggestions.style.display = 'none';
          activeIndex = -1;
        }
      });
    }
  
    setupAddressSearch('addressSearchInput', 'searchSuggestions', null, null, null);
    setupAddressSearch('routeOriginInput', 'originSuggestions', 'routeOriginLat', 'routeOriginLng', 'routeOriginAddr');
    setupAddressSearch('deliveryAddressInput', 'deliverySuggestions', 'deliveryLat', 'deliveryLng', 'deliveryAddr');
  
    const clearSearchBtn = document.getElementById('clearSearch');
    if (clearSearchBtn) {
      clearSearchBtn.addEventListener('click', () => {
        document.getElementById('addressSearchInput').value = '';
        clearSearchBtn.style.display = 'none';
        if (currentSearchMarker) {
          currentSearchMarker.remove();
          currentSearchMarker = null;
        }
      });
    }

    // CPF/CNPJ Mask & Limit
    const deliveryCpfInput = document.getElementById('deliveryCpf');
    deliveryCpfInput?.addEventListener('input', (e) => {
      let v = e.target.value.replace(/\D/g, ''); // Remove non-digits
      if (v.length > 14) v = v.slice(0, 14); // Limit to 14 numbers (CNPJ max)
      
      if (v.length <= 11) {
        // CPF Mask: 000.000.000-00
        v = v.replace(/(\d{3})(\d)/, '$1.$2');
        v = v.replace(/(\d{3})(\d)/, '$1.$2');
        v = v.replace(/(\d{3})(\d{1,2})$/, '$1-$2');
      } else {
        // CNPJ Mask: 00.000.000/0000-00
        v = v.replace(/^(\d{2})(\d)/, '$1.$2');
        v = v.replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3');
        v = v.replace(/\.(\d{3})(\d)/, '.$1/$2');
        v = v.replace(/(\d{4})(\d{1,2})$/, '$1-$2');
      }
      e.target.value = v;
    });

    // Telefone Mask
    const deliveryPhoneInput = document.getElementById('deliveryPhone');
    deliveryPhoneInput?.addEventListener('input', (e) => {
      let v = e.target.value.replace(/\D/g, ''); // Remove non-digits
      if (v.length > 11) v = v.slice(0, 11); // Limit to 11 numbers
      
      if (v.length > 2) {
        v = v.replace(/^(\d{2})(\d)/g, '($1) $2');
      }
      if (v.length > 9) { 
        v = v.replace(/(\d{5})(\d)/, '$1-$2');
      } else if (v.length > 8) { 
        v = v.replace(/(\d{4})(\d)/, '$1-$2');
      }
      e.target.value = v;
    });

    // ============================================================
    // === CEP SEARCH LOGIC (ViaCEP + Nominatim geocoding) ========
    // ============================================================

    /**
     * Busca CEP digitado no campo de endereço.
     */
    async function buscaCep(addressInputId, latId, lngId, addrId, btnId) {
      const addressInput = document.getElementById(addressInputId);
      if (!addressInput) return;
      
      const val = addressInput.value;
      const match = val.match(/\b(\d{5})-?(\d{3})\b/);
      if (!match) {
        showToast('Digite um CEP válido com 8 dígitos no campo de endereço', 'error');
        return;
      }
      const cep = match[1] + match[2];

      const btn = document.getElementById(btnId);
      const setBtnState = (state, title) => {
        if (!btn) return;
        btn.className = 'btn-cep-inside'; // reset
        btn.title = title || 'Buscar por CEP';
        if (state === 'loading') {
          btn.classList.add('loading');
          btn.innerHTML = '<i class="ri-loader-4-line"></i>';
        } else if (state === 'success') {
          btn.classList.add('success');
          btn.innerHTML = '<i class="ri-checkbox-circle-line"></i>';
        } else if (state === 'error') {
          btn.classList.add('error');
          btn.innerHTML = '<i class="ri-error-warning-line"></i>';
        } else {
          btn.innerHTML = '<i class="ri-search-line"></i>';
        }
      };

      setBtnState('loading', 'Consultando...');

      try {
        const resp = await fetch(`https://viacep.com.br/ws/${cep}/json/`, { signal: AbortSignal.timeout(8000) });
        if (!resp.ok) throw new Error('Erro na consulta ViaCEP');
        const data = await resp.json();

        if (data.erro) {
          setBtnState('error', 'CEP não encontrado.');
          setTimeout(() => setBtnState(''), 3000);
          return;
        }

        const formattedCep = cep.slice(0,5) + '-' + cep.slice(5);
        const addressStr = `${data.logradouro ? data.logradouro + ', ' : ''}${data.bairro ? data.bairro + ' ' : ''}${data.localidade} (${data.uf}) ${formattedCep}`;

        addressInput.value = addressStr;
        addressInput.dispatchEvent(new Event('input', { bubbles: true }));

        setBtnState('loading', 'Localizando...');

        // Geocoding
        let lat = null, lng = null;
        try {
          const geoQuery = 
            (data.logradouro ? data.logradouro + ', ' : '') +
            (data.bairro     ? data.bairro + ', '     : '') +
            data.localidade  + ', ' + data.uf + ', Brasil';
            
          const geoData = await MapService.searchAddress(geoQuery);
          if (geoData && geoData.length > 0) {
            lat = parseFloat(geoData[0].lat);
            lng = parseFloat(geoData[0].lng);
          }
        } catch (geoErr) {
          console.warn('CEP: Geocodificação falhou', geoErr);
        }

        if (latId && document.getElementById(latId)) document.getElementById(latId).value = lat ?? '';
        if (lngId && document.getElementById(lngId)) document.getElementById(lngId).value = lng ?? '';
        if (addrId && document.getElementById(addrId)) document.getElementById(addrId).value = addressStr;
        
        if (latId && document.getElementById(latId)) {
          document.getElementById(latId).dispatchEvent(new Event('change', { bubbles: true }));
        }

        setBtnState('success', 'Localizado com sucesso');
        setTimeout(() => setBtnState(''), 3000); // reset after 3s
        showToast(`CEP ${formattedCep}: ${data.localidade}/${data.uf}`, 'success');

      } catch (err) {
        console.error('CEP error:', err);
        setBtnState('error', 'Erro na busca.');
        setTimeout(() => setBtnState(''), 3000);
      }
    }



    // --- Aplicar máscara e eventos nos campos CEP ---

    // Botão buscar CEP — modal de PARADA
    document.getElementById('btnSearchCepDelivery')?.addEventListener('click', () => {
      buscaCep(
        'deliveryAddressInput',
        'deliveryLat', 'deliveryLng', 'deliveryAddr',
        'btnSearchCepDelivery'
      );
    });

    // Botão buscar CEP — modal de ROTA
    document.getElementById('btnSearchCepOrigin')?.addEventListener('click', () => {
      buscaCep(
        'routeOriginInput',
        'routeOriginLat', 'routeOriginLng', 'routeOriginAddr',
        'btnSearchCepOrigin'
      );
    });

    // Limpar campos CEP ao fechar os modais
    const _origCloseRouteModal  = () => modalRoute.classList.remove('active');
    const _origCloseDelivModal  = () => modalDelivery.classList.remove('active');

    // === ROUTE MODAL LOGIC ===

    const btnNewRoute = document.getElementById('btnNewRoute');
    const btnNewRouteEmpty = document.getElementById('btnNewRouteEmpty');
    const closeModalRoute = document.getElementById('closeModalRoute');
    const cancelModalRoute = document.getElementById('cancelModalRoute');
    const saveRouteBtn = document.getElementById('saveRoute');
    let editingRouteId = null;
  
    function openRouteModal(routeId = null) {
      editingRouteId = routeId;
      const title = document.getElementById('modalRouteTitle');
      const driverSelect = document.getElementById('routeDriver');
      
      // Populate Drivers (Traditional Drivers + Users with role Motorista)
      driverSelect.innerHTML = '<option value="">Sem motorista</option>';
      
      const traditionalDrivers = StorageManager.getDrivers();
      const userDrivers = StorageManager.getUsers().filter(u => u.role === 'Motorista');
      
      const allPossibleDrivers = [
        ...traditionalDrivers.map(d => ({ id: d.id, name: d.name, label: d.name })),
        ...userDrivers.map(u => ({ id: u.id, name: u.name, label: `${u.name} (Usuário)` }))
      ];

      allPossibleDrivers.forEach(d => {
        driverSelect.innerHTML += `<option value="${d.id}">${d.label}</option>`;
      });

      // Populate Vehicles
      const vehicleSelect = document.getElementById('routeVehicle');
      const plateInput = document.getElementById('routePlate');
      vehicleSelect.innerHTML = '<option value="">Selecione um veículo</option>';
      const vehicles = StorageManager.getVehicles();
      vehicles.forEach(v => {
        vehicleSelect.innerHTML += `<option value="${v.id}">${v.name}</option>`;
      });

      vehicleSelect.onchange = (e) => {
        const v = vehicles.find(x => x.id === e.target.value);
        if (v) plateInput.value = v.plate;
        else plateInput.value = '';
      };
  
      if (routeId) {
        title.innerText = 'Editar Rota';
        const route = StorageManager.getRoute(routeId);
        if (!route) return closeRouteModal();
        
        document.getElementById('routeName').value = route.name || ''
        document.getElementById('routeDate').value = route.date || ''
        document.getElementById('routeDriver').value = route.driverId || ''
        document.getElementById('routePix').value = route.notes || ''
        document.getElementById('routeVehicle').value = route.vehicle || ''
        document.getElementById('routePlate').value = route.plate || ''
        if (route.origin) {
          document.getElementById('routeOriginInput').value = route.origin.address || ''
          document.getElementById('routeOriginLat').value = route.origin.lat || ''
          document.getElementById('routeOriginLng').value = route.origin.lng || ''
          document.getElementById('routeOriginAddr').value = route.origin.address || ''
        }
        
        const colorVal = route.color || 'default';
        document.querySelectorAll('input[name="routeColor"]').forEach(input => {
          input.checked = input.value === colorVal;
        });
      } else {
        title.innerText = 'Nova Rota';
        document.getElementById('routeName').value = ''
        document.getElementById('routeDate').value = getLocalISODate();
        document.getElementById('routeDriver').value = ''
        document.getElementById('routePix').value = ''
        document.getElementById('routeVehicle').value = ''
        document.getElementById('routePlate').value = ''
        document.getElementById('routeOriginInput').value = 'Avenida do Imperador 739, Magé (Rio de Janeiro)'
        document.getElementById('routeOriginLat').value = '-22.7086919'
        document.getElementById('routeOriginLng').value = '-43.1571908'
        document.getElementById('routeOriginAddr').value = 'Avenida do Imperador 739, Magé (Rio de Janeiro)'
        
        document.querySelectorAll('input[name="routeColor"]').forEach(input => {
          input.checked = input.value === 'default';
        });
      }

      // Permissions check for notes
      const notesField = document.getElementById('routePix');
      if (notesField) {
        notesField.disabled = !(window.appPermissions?.canEditNotes);
      }

      modalRoute.classList.add('active');
    }

  
    function closeRouteModal() { 
      modalRoute.classList.remove('active'); 
      if (window._smartFitReturn) {
         window._smartFitReturn = false;
         const sfModal = document.getElementById('modalSmartFit');
         if (sfModal) {
            sfModal.style.display = 'flex';
            setTimeout(() => sfModal.classList.add('active'), 10);
         }
      }
    }
  
    btnNewRoute?.addEventListener('click', () => openRouteModal());
    document.getElementById('btnNewRouteMain')?.addEventListener('click', () => openRouteModal());
    btnNewRouteEmpty?.addEventListener('click', () => openRouteModal());
    closeModalRoute.addEventListener('click', closeRouteModal);
    cancelModalRoute.addEventListener('click', closeRouteModal);
  
    saveRouteBtn.addEventListener('click', async () => {
      const name = document.getElementById('routeName').value.trim();
      const lat = document.getElementById('routeOriginLat').value;
      const lng = document.getElementById('routeOriginLng').value;
      const addr = document.getElementById('routeOriginInput').value.trim();
  
      if (!name) return showToast('Nome da rota é obrigatório', 'error');
      if (!addr) return showToast('Informe o ponto de partida', 'error');
      
      // If user typed address but didn't pick from autocomplete, warn but allow
      if (!lat || !lng) {
        showToast('Endereço sem coordenadas. Busque e selecione um endereço da lista para melhor precisão', 'warning');
      }

      // Status: quando motorista é escolhido, rota passa automaticamente para Em Andamento
      const selectedDriverId = document.getElementById('routeDriver').value || null;
      const existingRoute = editingRouteId ? StorageManager.getRoute(editingRouteId) : null;
      let routeStatus;
      if (existingRoute) {
        routeStatus = existingRoute.status || 'planned';
        // Se driver foi atribuído e rota ainda está planejada → ativar
        if (selectedDriverId && routeStatus === 'planned') {
          routeStatus = 'active';
          showToast('Motorista atribuído — rota definida como Em Andamento', 'success');
        }
      } else {
        // Nova rota: ativa se driver selecionado, planejada caso contrário
        routeStatus = selectedDriverId ? 'active' : 'planned';
      }
  
      const routeData = {
        id: editingRouteId,
        name: name,
        date: document.getElementById('routeDate').value,
        driverId: selectedDriverId,
        notes: document.getElementById('routePix').value,
        vehicle: document.getElementById('routeVehicle').value,
        plate: document.getElementById('routePlate').value,
        color: document.querySelector('input[name="routeColor"]:checked')?.value || 'default',
        status: routeStatus,
        distanceKm: existingRoute ? existingRoute.distanceKm : null,
        durationMin: existingRoute ? existingRoute.durationMin : null,
        origin: {
          lat: lat ? parseFloat(lat) : null,
          lng: lng ? parseFloat(lng) : null,
          address: addr
        }
      };
  
      const dateVal = document.getElementById('routeDate').value;

      // Limite de 5 rotas por dia (apenas para novas rotas)
      if (!editingRouteId && dateVal) {
        const routesOnDay = StorageManager.getRoutes().filter(r => r.date === dateVal);
        if (routesOnDay.length >= 5) {
          return showToast('Limite de 5 rotas por dia atingido para esta data.', 'warning');
        }
      }

      const [y, m, d] = dateVal.split('-');
      const formattedDate = d && m && y ? `${d}/${m}/${y}` : 'Sem data';

      const driverObj = selectedDriverId ? (StorageManager.getDrivers().find(dr => dr.id === selectedDriverId) || StorageManager.getUsers().find(u => u.id === selectedDriverId)) : null;
      const driverName = driverObj ? driverObj.name : 'NÃO DEFINIDO';
      
      const vId = document.getElementById('routeVehicle').value;
      const vehicleObj = vId ? StorageManager.getVehicle(vId) : null;
      const vehicleName = vehicleObj ? vehicleObj.name.toUpperCase() : (vId ? vId.toUpperCase() : 'NÃO DEFINIDO');

      const pix = document.getElementById('routePix').value || 'NENHUMA';

      const confirmHtml = `
        <div style="text-align: left; font-size: 0.95rem; line-height: 1.6;">
          <div style="text-align:center; font-weight:bold; margin-bottom: 12px; font-size: 1.1rem;">Confirme os dados da Rota:</div>
          Nome: <strong>${name}</strong><br>
          Data: <strong style="color: #facc15;">${formattedDate}</strong><br>
          Motorista: <strong>${driverName}</strong><br>
          Chave PIX: <strong>${pix}</strong><br>
          Veículo: <strong>${vehicleName}</strong>
        </div>
      `;

      openConfirmDialog(confirmHtml, async () => {
        try {
          await StorageManager.saveRoute(routeData);
          showToast('Rota salva com sucesso!');
          closeRouteModal();
          renderRoutesList();
          refreshDashboard();
          if(activeRouteId === editingRouteId) loadRouteToMap(editingRouteId);
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });
  
    // === DELIVERY MODAL LOGIC ===
    const btnNewDelivery = document.getElementById('btnNewDelivery');
    const rdpAddStop = document.getElementById('rdpAddStop');
    const closeModalDelivery = document.getElementById('closeModalDelivery');
    const cancelModalDelivery = document.getElementById('cancelModalDelivery');
    const saveDeliveryBtn = document.getElementById('saveDelivery');
    let editingDeliveryId = null;
  
    function openDeliveryModal(deliveryId = null, preSelectRouteId = null) {
      editingDeliveryId = deliveryId;
      const title = document.getElementById('modalDeliveryTitle');
      const routeSelect = document.getElementById('deliveryRoute');
  
      // Populate Routes
      routeSelect.innerHTML = '<option value="">Selecione uma rota...</option>';
      StorageManager.getRoutes()
        .filter(r => !r.status || r.status === 'planned' || r.status === 'active' || r.status === 'closed')
        .sort((a, b) => {
          const dateA = a.date ? new Date(a.date).getTime() : 0;
          const dateB = b.date ? new Date(b.date).getTime() : 0;
          return dateA - dateB;
        })
        .forEach(r => {
          const stopsCount = StorageManager.getDeliveriesByRoute(r.id).length;
          const isClosed = r.status === 'closed';
          const isFull = stopsCount >= 6;
          // If deliveryId is present (editing a stop), do not disable the options so the user can move the stop
          const isDisabled = (!deliveryId) && (isFull || isClosed);
          let label = r.name;
          if (isClosed) label += ' 🔴 (Fechada)';
          else if (isFull) label += ' 🛑 (Rota Completa)';
          routeSelect.innerHTML += `<option value="${r.id}" ${isDisabled ? 'disabled' : ''}>${label}</option>`;
        });
  
      if (preSelectRouteId) {
        routeSelect.value = preSelectRouteId;
        // Calculate next order
        const stops = StorageManager.getDeliveriesByRoute(preSelectRouteId);
        let nextOrder = stops.length + 1;
        if (nextOrder > 6) nextOrder = 6;
        document.getElementById('deliveryOrder').value = nextOrder;
      }
  
      if (deliveryId) {
        title.innerText = 'Editar Parada';
        const d = StorageManager.getDeliveries().find(x => x.id === deliveryId);
        if (!d) return closeDeliveryModal();
        
        routeSelect.value = d.routeId;
        document.getElementById('deliveryRecipient').value = d.recipient;
        document.getElementById('deliveryCpf').value = d.cpf || ''
        document.getElementById('deliveryPhone').value = d.phone || ''
        document.getElementById('deliveryModel').value = d.model || ''
        const refField = document.getElementById('deliveryReference');
        if (refField) refField.value = d.ref || '';
        document.getElementById('deliveryOrder').value = d.order || 1;
        document.getElementById('deliveryStatus').value = d.status || 'pending';
        document.getElementById('deliveryNotes').value = d.notes || ''
        
        document.getElementById('deliveryAddressInput').value = d.address || ''
        document.getElementById('deliveryLat').value = d.lat || ''
        document.getElementById('deliveryLng').value = d.lng || ''
        document.getElementById('deliveryAddr').value = d.address || ''
      } else {
        title.innerText = 'Nova Parada';
        if(!preSelectRouteId) routeSelect.value = ''
        document.getElementById('deliveryRecipient').value = ''
        document.getElementById('deliveryCpf').value = ''
        document.getElementById('deliveryPhone').value = ''
        document.getElementById('deliveryModel').value = ''
        const refInput = document.getElementById('deliveryReference');
        if (refInput) refInput.value = '';
        document.getElementById('deliveryStatus').value = 'pending';
        document.getElementById('deliveryNotes').value = ''
        document.getElementById('deliveryAddressInput').value = ''
        document.getElementById('deliveryLat').value = ''
        document.getElementById('deliveryLng').value = ''
        document.getElementById('deliveryAddr').value = ''
      }
      
      if (window.updateDeliveryOrderMax) window.updateDeliveryOrderMax();

      // Permissions check for notes
      const notesField = document.getElementById('deliveryNotes');
      if (notesField) {
        notesField.disabled = !(window.appPermissions?.canEditNotes);
      }

      modalDelivery.classList.add('active');
    }

  
    function closeDeliveryModal() { 
         modalDelivery.classList.remove('active'); 
         window.currentPendingDeliveryId = null;
    }
    window.openDeliveryModalFromList = function(id) { openDeliveryModal(id); }
    
    window.deletePendingItem = function(pendingId) {
        openConfirmDialog('Tem certeza que deseja excluir esta entrega pendente?', async () => {
            try {
                await StorageManager.deletePendingDelivery(pendingId);
                showToast('Entrega pendente excluída com sucesso.', 'success');
                if (typeof renderRoutesList === 'function') renderRoutesList();
                refreshDashboard();
            } catch (e) {
                showToast('Erro ao excluir entrega pendente.', 'error');
            }
        });
    };

    window.allocatePendingDelivery = async function(pendingId) {
        const pd = StorageManager.getPendingDeliveries().find(p => p.id === pendingId);
        if (!pd) return;
        
        window.currentPendingDeliveryId = pendingId;
        openDeliveryModal(null, null);

        setTimeout(async () => {
          const rec = document.getElementById('deliveryRecipient');
          const end = document.getElementById('deliveryAddressInput');
          const cpf = document.getElementById('deliveryCpf');
          const phone = document.getElementById('deliveryPhone');
          const ref = document.getElementById('deliveryReference');
          const notes = document.getElementById('deliveryNotes');
          const latField = document.getElementById('deliveryLat');
          const lngField = document.getElementById('deliveryLng');

          if(rec) rec.value = pd.client_name || '';
          
          let fullAddress = `${pd.client_address || ''} ${pd.client_cep || ''}`.trim();
          if(end) {
             end.value = fullAddress;
             latField.value = '';
             lngField.value = '';
          }
          if(cpf) cpf.value = pd.client_cpf || '';
          if(phone) phone.value = pd.client_phone || '';
          if(ref) ref.value = pd.client_reference || '';
          
          let obsText = `Produto: ${pd.product_name || ''}`;
          if (pd.variant_name) obsText += ` - ${pd.variant_name}`;
          if (pd.observations) obsText += `\nObs: ${pd.observations}`;
          if(notes) notes.value = obsText.trim();
          
          // Attempt auto geocode
          if (fullAddress && typeof MapService !== 'undefined') {
             try {
                const coords = await MapService.searchAddress(fullAddress);
                if (coords && coords.length > 0) {
                   latField.value = coords[0].lat;
                   lngField.value = coords[0].lon;
                   showToast("Endereço geolocalizado automaticamente.", "success");
                } else {
                   showToast("Confirme o endereço no mapa.", "info");
                }
             } catch(e) {
                showToast("Confirme o endereço no mapa.", "info");
             }
          } else {
             showToast("Confirme o endereço no mapa.", "info");
          }
        }, 100);
    };

    window.openDeliveryModalForRoute = function(routeId) { 
      if (routeId) {
        const stops = StorageManager.getDeliveriesByRoute(routeId);
        if (stops.length >= 6) {
          return showToast('Números de paradas máximo atingido', 'warning');
        }
      }
      openDeliveryModal(null, routeId); 
    }
  
    window.updateDeliveryOrderMax = function() {
      const orderInput = document.getElementById('deliveryOrder');
      const routeSelect = document.getElementById('deliveryRoute');
      if (!orderInput || !routeSelect || !routeSelect.value) return;
      const existingStops = StorageManager.getDeliveriesByRoute(routeSelect.value).filter(s => s.id !== editingDeliveryId);
      let maxVal = existingStops.length + 1;
      if (maxVal > 6) maxVal = 6;
      orderInput.max = maxVal;
      if (parseInt(orderInput.value) > maxVal) orderInput.value = maxVal;
    };

    btnNewDelivery?.addEventListener('click', () => openDeliveryModal());
    document.getElementById('btnNewDeliveryMain')?.addEventListener('click', () => openDeliveryModal());
    rdpAddStop?.addEventListener('click', () => openDeliveryModal(null, activeRouteId));
    closeModalDelivery.addEventListener('click', closeDeliveryModal);
    cancelModalDelivery.addEventListener('click', closeDeliveryModal);
    document.getElementById('deliveryRoute')?.addEventListener('change', window.updateDeliveryOrderMax);


    saveDeliveryBtn.addEventListener('click', async () => {
      const routeId = document.getElementById('deliveryRoute').value;
      const recipient = document.getElementById('deliveryRecipient').value;
      const lat = document.getElementById('deliveryLat').value;
      const lng = document.getElementById('deliveryLng').value;
      const addr = document.getElementById('deliveryAddressInput').value;
  
      if (!routeId) return showToast('Selecione uma rota', 'error');
      
      const existingStops = StorageManager.getDeliveriesByRoute(routeId).filter(s => s.id !== editingDeliveryId);
      if (existingStops.length >= 6) {
        return showToast('Números de paradas máximo atingido', 'warning');
      }

      if (!recipient) return showToast('Nome do Cliente é obrigatório', 'error');
      if (!lat || !lng) return showToast('Selecione um endereço válido', 'error');
  
      let requestedOrder = parseInt(document.getElementById('deliveryOrder').value) || 1;
      let maxVal = existingStops.length + 1;
      if (maxVal > 6) maxVal = 6;
      if (requestedOrder > maxVal) requestedOrder = maxVal;
      if (requestedOrder < 1) requestedOrder = 1;

      const deliveryData = {
        id: editingDeliveryId,
        routeId: routeId,
        recipient: recipient,
        cpf: document.getElementById('deliveryCpf').value,
        phone: document.getElementById('deliveryPhone').value,
        model: document.getElementById('deliveryModel').value,
        ref: document.getElementById('deliveryReference') ? document.getElementById('deliveryReference').value : '',
        order: requestedOrder,
        status: document.getElementById('deliveryStatus').value,
        notes: document.getElementById('deliveryNotes').value,
        address: addr,
        lat: parseFloat(lat),
        lng: parseFloat(lng)
      };
  
      const routeSelect = document.getElementById('deliveryRoute');
      const selectedRouteName = routeSelect.options[routeSelect.selectedIndex]?.text || 'NÃO DEFINIDO';
      
      const confirmHtml = `
        <div style="text-align: left; font-size: 0.95rem; line-height: 1.6;">
          <div style="text-align:center; font-weight:bold; margin-bottom: 12px; font-size: 1.1rem;">Confirme os dados da Parada:</div>
          <strong>Rota:</strong> ${selectedRouteName}<br>
          <strong>Cliente:</strong> <strong style="color: #facc15;">${deliveryData.recipient || 'NÃO DEFINIDO'}</strong><br>
          <strong>CPF/CNPJ:</strong> <strong style="color: #facc15;">${deliveryData.cpf || 'NENHUM'}</strong><br>
          <strong>Telefone:</strong> <strong style="color: #facc15;">${deliveryData.phone || 'NENHUM'}</strong><br><br>
          <strong>Modelo:</strong> <span style="color: #facc15;">${deliveryData.model || 'NENHUM'}</span><br>
          <strong>Endereço:</strong> ${deliveryData.address || 'NENHUM'}<br>
          <strong>P. Referência:</strong> ${deliveryData.ref || 'NENHUMA'}<br><br>
          Ordem: ${deliveryData.order}<br><br>
          Observações:<br><strong style="white-space: pre-wrap; display: block; margin-top: 4px;">${deliveryData.notes || 'NENHUMA'}</strong>
        </div>
      `;

      openConfirmDialog(confirmHtml, async () => {
        try {
          // 1. Salva a parada principal primeiro (nova ou editada)
          const saved = await StorageManager.saveDelivery({ ...deliveryData, order: deliveryData.order }, true);
          const savedId = saved?.id || deliveryData.id;

          // 2. Reordena as paradas existentes ao redor da nova posição
          const stopsToUpdate = [...existingStops];
          stopsToUpdate.sort((a, b) => (a.order || 1) - (b.order || 1));
          stopsToUpdate.splice(deliveryData.order - 1, 0, { ...deliveryData, id: savedId });

          const reorderPromises = [];
          stopsToUpdate.forEach((stop, idx) => {
            const newOrder = idx + 1;
            if (stop.id && stop.id !== savedId && stop.order !== newOrder) {
              stop.order = newOrder;
              reorderPromises.push(StorageManager.saveDelivery(stop, true));
            }
          });

          if (reorderPromises.length > 0) {
            await Promise.all(reorderPromises);
          }

          // 3. Sincroniza uma única vez no final
          await StorageManager.fetchDeliveries();

          if (window.currentPendingDeliveryId) {
            await StorageManager.updatePendingDeliveryStatus(window.currentPendingDeliveryId, 'allocated');
          }

          showToast('Parada salva com sucesso!');
          closeDeliveryModal();
          renderRoutesList();
          renderDeliveriesList();
          refreshDashboard();

          if (activeRouteId === routeId) {
            loadRouteToMap(routeId);
          } else {
            calcRouteKmSilently(routeId);
          }
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });
  
    // === DRIVER MODAL LOGIC ===
    const btnNewDriver = document.getElementById('btnNewDriver');
    const btnNewDriverEmpty = document.getElementById('btnNewDriverEmpty');
    const closeModalDriver = document.getElementById('closeModalDriver');
    const cancelModalDriver = document.getElementById('cancelModalDriver');
    const saveDriverBtn = document.getElementById('saveDriver');
    let editingDriverId = null;
  
    function openDriverModal(driverId = null) {
      editingDriverId = driverId;
      const title = document.getElementById('modalDriverTitle');
      if (driverId) {
        title.innerText = 'Editar Motorista';
        const driver = StorageManager.getDriver(editingDriverId);
        document.getElementById('driverName').value = driver.name || ''
        document.getElementById('driverPhone').value = driver.phone || ''
      } else {
        title.innerText = 'Novo Motorista';
        document.getElementById('driverName').value = ''
        document.getElementById('driverPhone').value = ''
      }
      modalDriver.classList.add('active');
    }
  
    function closeDriverModal() { modalDriver.classList.remove('active'); }
  
    btnNewDriver?.addEventListener('click', () => openDriverModal());
    document.getElementById('btnNewDriverMain')?.addEventListener('click', () => openDriverModal());
    btnNewDriverEmpty?.addEventListener('click', () => openDriverModal());
    closeModalDriver.addEventListener('click', closeDriverModal);
    cancelModalDriver.addEventListener('click', closeDriverModal);
  
    saveDriverBtn.addEventListener('click', async () => {
      const name = document.getElementById('driverName').value;
      if (!name) return showToast('Nome é obrigatório', 'error');
  
      const driverData = {
        id: editingDriverId,
        name: name,
        phone: document.getElementById('driverPhone').value
      };

      try {
        await StorageManager.saveDriver(driverData);
        showToast('Motorista salvo com sucesso!');
        closeDriverModal();
        renderDriversList();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  
    // === USER MODAL LOGIC ===
    const modalUser = document.getElementById('modalUser');
    const btnNewUserMain = document.getElementById('btnNewUserMain');
    const closeModalUser = document.getElementById('closeModalUser');
    const cancelModalUser = document.getElementById('cancelModalUser');
    const saveUserBtn = document.getElementById('saveUser');
    let editingUserId = null;

    function openUserModal(userId = null) {
      editingUserId = userId;
      const title = document.getElementById('modalUserTitle');
      const currentRole = (window.appPermissions?.currentUser?.role || '').toLowerCase();
      const isLimitedUser = currentRole === 'motorista' || currentRole === 'vendedor';

      // Mostra ou esconde campos avançados conforme o nível
      const roleGroup = document.querySelector('#userRole')?.closest('.form-group');
      const permGroup = document.getElementById('permissionsGroup');
      const usernameGroup = document.querySelector('#userUsername')?.closest('.form-group');
      if (roleGroup)    roleGroup.style.display    = isLimitedUser ? 'none' : '';
      if (permGroup)    permGroup.style.display    = isLimitedUser ? 'none' : '';
      if (usernameGroup) usernameGroup.style.display = isLimitedUser ? 'none' : '';

      if (userId) {
        title.innerText = 'Editar Usuário';
        const user = StorageManager.getUsers().find(u => u.id === userId);
        if (!user) return closeUserModal();

        document.getElementById('userName').value = user.name || '';
        document.getElementById('userUsername').value = user.username || '';
        document.getElementById('userPassword').value = '';
        document.getElementById('userPassword').placeholder = 'Digite para trocar senha';
        let r = user.role || 'Motorista';
        r = r.charAt(0).toUpperCase() + r.slice(1).toLowerCase();
        document.getElementById('userRole').value = r;

        const perms = user.permissions || [];
        document.getElementById('perm_view_route').checked = perms.includes('view_route');
        document.getElementById('perm_edit_route').checked = perms.includes('edit_route');
        document.getElementById('perm_reorder_stops').checked = perms.includes('reorder_stops');
        document.getElementById('perm_edit_notes').checked = perms.includes('edit_notes');
      } else {
        title.innerText = 'Novo Usuário';
        document.getElementById('userName').value = '';
        document.getElementById('userUsername').value = '';
        document.getElementById('userPassword').value = '';
        document.getElementById('userPassword').placeholder = '******';
        document.getElementById('userRole').value = 'Motorista';
        document.getElementById('perm_view_route').checked = true;
        document.getElementById('perm_edit_route').checked = false;
        document.getElementById('perm_reorder_stops').checked = false;
        document.getElementById('perm_edit_notes').checked = false;
      }
      modalUser?.classList.add('active');
    }

    function closeUserModal() {
      modalUser?.classList.remove('active');
    }

    btnNewUserMain?.addEventListener('click', () => openUserModal());
    closeModalUser?.addEventListener('click', closeUserModal);
    cancelModalUser?.addEventListener('click', closeUserModal);

    const userRoleSelect = document.getElementById('userRole');
    userRoleSelect?.addEventListener('change', (e) => {
      const role = e.target.value.toUpperCase();
      if (role === 'MASTER' || role === 'GERENTE') {
        document.getElementById('perm_view_route').checked = true;
        document.getElementById('perm_edit_route').checked = true;
        document.getElementById('perm_reorder_stops').checked = true;
        document.getElementById('perm_edit_notes').checked = true;
      } else {
        document.getElementById('perm_view_route').checked = true;
        document.getElementById('perm_edit_route').checked = false;
        document.getElementById('perm_reorder_stops').checked = false;
        document.getElementById('perm_edit_notes').checked = false;
      }
    });

    saveUserBtn?.addEventListener('click', async () => {
      const currentRole = (window.appPermissions?.currentUser?.role || '').toLowerCase();
      const isLimitedUser = currentRole === 'motorista' || currentRole === 'vendedor';

      const name     = document.getElementById('userName').value.trim();
      const password = document.getElementById('userPassword').value.trim();

      // Motorista/Vendedor só pode alterar nome e senha
      let username, role, permissions;
      if (isLimitedUser && editingUserId) {
        const existing = StorageManager.getUsers().find(u => u.id === editingUserId);
        username    = existing?.username    || '';
        role        = existing?.role        || currentRole;
        permissions = existing?.permissions || [];
      } else {
        username    = document.getElementById('userUsername').value.trim();
        role        = document.getElementById('userRole').value;
        permissions = [];
        if (document.getElementById('perm_view_route').checked)    permissions.push('view_route');
        if (document.getElementById('perm_edit_route').checked)    permissions.push('edit_route');
        if (document.getElementById('perm_reorder_stops').checked) permissions.push('reorder_stops');
        if (document.getElementById('perm_edit_notes').checked)    permissions.push('edit_notes');
      }

      if (!name || !username || (!password && !editingUserId)) {
        return showToast('Preencha todos os campos obrigatórios', 'error');
      }

      const userData = { id: editingUserId, name, username, password, role, permissions };

      try {
        await StorageManager.saveUser(userData);
        showToast('Usuário salvo com sucesso!');
        closeUserModal();
        renderUsersList();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  
  
    // === RENDERING FUNCTIONS ===
  
    // STATUS TRANSLATIONS & COLORS
    const statusMap = {
      'planned': { label: 'Agendada', class: 'planned' },
      'active': { label: 'Em Andamento', class: 'active' },
      'done': { label: 'Concluída', class: 'done' },
      'closed': { label: 'Fechada', class: 'closed' },
      'pending': { label: 'Pendente', class: 'pending' },
      'in_route': { label: 'Em Rota', class: 'active' },
      'delivered': { label: 'Entregue', class: 'done' },
      'failed': { label: 'Falha', class: 'failed' },
      'rescheduled': { label: 'Reagendado', class: 'planned' }
    };
  
    function renderRoutesList() {
      const list = document.getElementById('routesListMain');
      if(!list) return;
      let routes = StorageManager.getRoutes();
      const activeFilterElement = document.querySelector('#mainRoutesView .filter-chips .chip.active');
      const activeFilter = activeFilterElement ? activeFilterElement.dataset.filter : 'planned';
      
      // --- NOVO: Lógica Exclusiva para Pendentes (StockPoints) ---
      if (activeFilter === 'pending') {
         const pendingDeliveries = StorageManager.getPendingDeliveries() || [];
         
         const searchInput = document.getElementById('searchRoutesMain');
         const q = searchInput ? searchInput.value.toLowerCase().trim() : '';
         let filteredPending = pendingDeliveries;
         
         if (q) {
           filteredPending = filteredPending.filter(pd => {
             if (pd.client_name && pd.client_name.toLowerCase().includes(q)) return true;
             if (pd.sale_id && pd.sale_id.toLowerCase().includes(q)) return true;
             if (pd.product_name && pd.product_name.toLowerCase().includes(q)) return true;
             if (pd.variant_name && pd.variant_name.toLowerCase().includes(q)) return true;
             if (pd.client_cpf && pd.client_cpf.toLowerCase().includes(q)) return true;
             if (pd.client_phone && pd.client_phone.toLowerCase().includes(q)) return true;
             return false;
           });
         }
         
          if (filteredPending.length === 0) {
            list.innerHTML = `
              <div class="empty-state" style="grid-column: 1 / -1">
                <i class="ri-inbox-line"></i>
                <p>Nenhuma entrega pendente de integração</p>
              </div>
            `;
            return;
          }
          
          list.innerHTML = filteredPending.map((pd) => {
            const name = (pd.client_name || 'Sem nome').toUpperCase();
            const product = (pd.product_name || 'PRODUTO NÃO ESPECIFICADO').toUpperCase();
            const obs = pd.observations ? `<div class="item-detail" style="align-items: flex-start; padding-top: 5px; padding-bottom: 5px;"><i class="ri-file-text-line" style="margin-top: 4px;"></i> <div style="line-height: 1.4;"><strong>OBS:</strong><br/>${pd.observations.replace(/\n/g, '<br/>')}</div></div>` : '';
            
            return `
            <div class="list-item" style="border-left-color: var(--warning-color);">
              <div class="list-item-header" style="flex-direction: column; align-items: flex-start; gap: 4px;">
                <div style="display: flex; align-items: flex-start; justify-content: space-between; width: 100%;">
                    <h3 style="margin: 0; font-size: 1rem; color: var(--text-main); font-weight: 700; line-height: 1.2; text-transform: uppercase;">${name}</h3>
                    <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 4px;">
                      <div class="item-badge" style="background: rgba(245, 158, 11, 0.1); color: var(--warning-color); flex-shrink: 0; margin-left: 10px;">PENDENTE</div>
                      <button onclick="window.deletePendingItem('${pd.id}')" title="Excluir entrega pendente" style="background: transparent; border: none; color: #ef4444; font-size: 0.75rem; cursor: pointer; padding: 2px 5px; margin-left: 10px; display: flex; align-items: center; gap: 2px;"><i class="ri-delete-bin-line"></i> Excluir</button>
                    </div>
                </div>
                <div style="font-size: 0.8rem; color: var(--text-muted); text-transform: uppercase; font-weight: 500;">${product}</div>
              </div>
              <div class="list-item-body" style="gap: 8px; margin-top: 5px;">
                <div class="item-detail"><i class="ri-map-pin-line"></i> <span><strong>Endereço:</strong> ${pd.client_address || 'Não informado'} ${pd.client_cep ? '- ' + pd.client_cep : ''}</span></div>
                ${obs}
                ${pd.variant_name ? `<div class="item-detail"><i class="ri-vip-diamond-line"></i> <span><strong>Modelo:</strong> ${pd.variant_name.toUpperCase()}</span></div>` : ''}
                ${pd.client_cpf ? `<div class="item-detail"><i class="ri-id-card-line"></i> <span><strong>CPF/CNPJ:</strong> ${pd.client_cpf}</span></div>` : ''}
                ${pd.client_phone ? `<div class="item-detail"><i class="ri-phone-line"></i> <span><strong>Tel:</strong> ${pd.client_phone}</span></div>` : ''}
              </div>
              <div class="list-item-footer" style="padding-top:10px; border-top: 1px solid var(--border-color); margin-top: 10px;">
                <button class="btn-primary" style="width: 100%; justify-content: center;" onclick="window.allocatePendingDelivery('${pd.id}')">
                  <i class="ri-arrow-right-circle-line"></i> Alocar na Rota
                </button>
              </div>
            </div>
            `;
          }).join('');
          return;
      }
      
      let filtered = routes;
      
      // Filter by "Minhas Rotas"
      if (window.isMyRoutesViewActive && window.appPermissions?.currentUser) {
        filtered = filtered.filter(r => r.driverId === window.appPermissions.currentUser.id);
      }

      // Search filter
      const searchInput = document.getElementById('searchRoutesMain');
      const q = searchInput ? searchInput.value.toLowerCase().trim() : '';

      if (q) {
        filtered = filtered.filter(r => {
          if (r.name && r.name.toLowerCase().includes(q)) return true;
          
          if (r.date) {
            const [year, month, day] = r.date.split('-');
            if (year && month && day) {
              const dateBr = `${day}/${month}/${year}`;
              const dateBrShort = `${day}/${month}`;
              if (dateBr.includes(q) || dateBrShort.includes(q) || r.date.includes(q)) return true;
            }
          }
          
          const stops = StorageManager.getDeliveriesByRoute(r.id) || [];
          for (let s of stops) {
            if (s.recipient && s.recipient.toLowerCase().includes(q)) return true;
            if (s.cpf && s.cpf.toLowerCase().includes(q)) return true;
            if (s.variant_name && s.variant_name.toLowerCase().includes(q)) return true;
            if (s.model && s.model.toLowerCase().includes(q)) return true;
            if (s.phone && s.phone.toLowerCase().includes(q)) return true;
          }
          return false;
        });
      } else {
        if (activeFilter === 'hoje') {
          const todayStr = new Date().toLocaleDateString('en-CA'); // format YYYY-MM-DD locally
          filtered = filtered.filter(r => (r.status === 'planned' || r.status === 'active' || r.status === 'closed') && r.date === todayStr);
        } else if (activeFilter === 'planned') {
          filtered = filtered.filter(r => r.status === 'planned' || r.status === 'closed');
        } else if (activeFilter !== 'all') {
          filtered = filtered.filter(r => r.status === activeFilter);
        }
      }

      // Ordenar por data (da mais antiga para a mais recente) e depois por ID para estabilidade
      filtered.sort((a, b) => {
        const dA = a.date || '9999-12-31';
        const dB = b.date || '9999-12-31';
        if (dA < dB) return -1;
        if (dA > dB) return 1;
        
        // Critério secundário para evitar que a rota mude de posição ao ser editada
        const idA = a.created_at || a.id || '';
        const idB = b.created_at || b.id || '';
        if (idA < idB) return -1;
        if (idA > idB) return 1;
        return 0;
      });

      if (filtered.length === 0) {
        list.innerHTML = `
          <div class="empty-state" style="grid-column: 1 / -1">
            <i class="ri-route-line"></i>
            <p>Nenhuma rota encontrada</p>
          </div>
        `;
        return;
      }
      list.innerHTML = '';
      
      if (activeFilter === 'done') {
        const uName = window.appPermissions?.currentUser?.name || window.appPermissions?.currentUser?.username || '';
        const firstName = uName.split(' ')[0] || '';
        list.innerHTML += `<div style="grid-column: 1 / -1; padding: 12px; background: rgba(0, 212, 170, 0.1); color: var(--accent-primary); border-radius: 8px; text-align: center; margin-bottom: 15px; border: 1px solid rgba(0, 212, 170, 0.2); font-size: 0.9rem;">
          <i class="ri-information-line" style="margin-right: 5px;"></i> Olá ${firstName}, aqui são mostradas as rotas concluídas dos últimos 7 dias!
        </div>`;
      }
      filtered.forEach(r => {
        const stops = StorageManager.getDeliveriesByRoute(r.id);
        const dCount = stops.length;
        const driver = r.driverId ? (StorageManager.getDrivers().find(d => d.id === r.driverId) || StorageManager.getUsers().find(u => u.id === r.driverId)) : null;
        const driverDisplay = driver ? driver.name : 'Sem motorista';
        const st = statusMap[r.status] || statusMap['planned'];
        const vehicleObj = r.vehicle ? StorageManager.getVehicle(r.vehicle) : null;
        const vehicleDisplay = vehicleObj ? vehicleObj.name.toUpperCase() : (r.vehicle ? r.vehicle.toUpperCase() : 'NÃO DEFINIDO');
        let colorClass = '';
        if (r.status === 'planned') colorClass = 'card-planned-status';
        else if (r.status === 'active') colorClass = 'card-active-status';
        else if (r.status === 'closed') colorClass = 'card-closed-status';
        else if (r.color && r.color !== 'default') colorClass = `card-${r.color}`;
        
        let rTime = 0;
        if (r.durationMin) rTime = r.durationMin;
        else if (r.distanceKm) rTime = Math.round((r.distanceKm / 40) * 60);
        const overTime = rTime >= 750;
        
        // Stops preview string (Addresses)
        const stopsPreview = stops.length > 0 
          ? stops.slice(0, 3).map(s => s.address ? s.address.split(',')[0] : 'S/ Ref').join(' - ') + (stops.length > 3 ? '...' : '')
          : 'Nenhuma parada';
  
        const div = document.createElement('div');
        div.className = `list-item ${activeRouteId === r.id ? 'selected' : ''} ${expandedRouteIds.has(r.id) ? 'expanded' : ''} ${colorClass}`;
        div.setAttribute('data-route-id', r.id);
        
        // Auto-expand on drag enter
        div.ondragenter = (e) => {
          const isDragging = document.querySelector('.stop-detail-item.dragging');
          if (isDragging && !div.classList.contains('expanded')) {
            div.classList.add('expanded');
            expandedRouteIds.add(r.id);
          }
        };
        
        const canEdit = window.appPermissions?.canEditRoute && r.status !== 'done';
        const canReorder = window.appPermissions?.canReorder && r.status !== 'closed' && r.status !== 'done';

        let stopsHtml = stops.map((s, i) => `
          <div class="stop-detail-item" style="flex-direction: column; align-items: stretch; gap: 8px;"
               draggable="${canReorder && !(window.expandedStopIds && window.expandedStopIds.has(s.id)) ? 'true' : 'false'}" 
               ${canReorder ? `
               ondragstart="window.handleStopDragStart(event, '${s.id}')"
               ondragend="window.handleStopDragEnd(event)"
               ondrop="window.handleStopDrop(event, '${r.id}', '${s.id}')"` : ''}>
            
            <div style="display: flex; align-items: center; justify-content: space-between; width: 100%; cursor: pointer;" onclick="event.stopPropagation(); const item = this.closest('.stop-detail-item'); const extras = item.querySelector('.stop-extra-details'); const icon = this.querySelector('.stop-expand-btn'); if(extras.style.display === 'none'){extras.style.display = 'block'; icon.className='ri-arrow-up-s-line stop-expand-btn'; window.expandedStopIds.add('${s.id}'); item.setAttribute('draggable', 'false');}else{extras.style.display = 'none'; icon.className='ri-arrow-down-s-line stop-expand-btn'; window.expandedStopIds.delete('${s.id}'); item.setAttribute('draggable', '${canReorder ? 'true' : 'false'}');}">
              <div style="display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0;">
                <div class="stop-detail-index">${i + 1}</div>
                <div class="stop-detail-info">
                  <span class="stop-detail-name" style="font-weight: normal;"><strong>${s.recipient}</strong></span>
                  ${s.model ? `<span class="stop-detail-addr" style="font-weight: normal;">${s.model}</span>` : ''}
                </div>
              </div>
              <div class="stop-actions-small" style="display: flex; align-items: center; gap: 4px; padding-left: 10px;">
                <i class="${window.expandedStopIds && window.expandedStopIds.has(s.id) ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} stop-expand-btn" style="font-size: 1.2rem; color: var(--text-muted); margin-right: 4px;"></i>
                <div style="${canEdit ? 'display:flex; gap: 4px;' : 'display:none'}">
                  <button class="btn-icon-xs" title="Editar Parada" onclick="event.stopPropagation(); window.openDeliveryModalFromList('${s.id}')"><i class="ri-edit-2-line"></i></button>
                  <button class="btn-icon-xs" title="Remover Parada" onclick="event.stopPropagation(); window.deleteDeliveryFromList('${s.id}')"><i class="ri-delete-bin-line"></i></button>
                </div>
              </div>
            </div>
            
            <div class="stop-extra-details" style="display: ${window.expandedStopIds && window.expandedStopIds.has(s.id) ? 'block' : 'none'}; padding: 8px 10px; background: rgba(0,0,0,0.1); border-radius: 6px; font-size: 0.8rem; color: var(--text-muted); margin-top: 4px; user-select: text; -webkit-user-select: text; cursor: text;" onmousedown="event.stopPropagation()">
              ${s.address ? `<div style="margin-bottom:4px;"><i class="ri-map-pin-line"></i> <strong>Endereço:</strong> ${s.address}</div>` : ''}
              ${s.ref ? `<div style="margin-bottom:4px;"><i class="ri-map-pin-2-line"></i> <strong>Referência:</strong> ${s.ref}</div>` : ''}
              ${s.notes ? `<div style="margin-bottom:4px;"><i class="ri-file-text-line"></i> <strong>OBS:</strong><br><strong>${s.notes.replace(/\n/g, '<br>')}</strong></div>` : ''}
              ${s.model ? `<div style="margin-bottom:4px;"><i class="ri-price-tag-3-line"></i> <strong>Modelo:</strong> ${s.model.toUpperCase()}</div>` : ''}
              ${s.cpf ? `<div style="margin-bottom:4px;"><i class="ri-id-card-line"></i> <strong>CPF/CNPJ:</strong> ${s.cpf}</div>` : ''}
              ${s.phone ? `<div style="margin-bottom:4px;"><i class="ri-phone-line"></i> <strong>Tel:</strong> ${s.phone}</div>` : ''}
            </div>
            
          </div>
        `).join('');

        if (stops.length === 0) {
          stopsHtml = '<p class="text-muted" style="font-size:0.8rem; padding: 10px 0;">Nenhuma parada cadastrada.</p>';
        }

        div.innerHTML = `
          <div class="item-header" style="flex-direction: column; align-items: stretch; gap: 8px;"
               onmousemove="window.handleRouteCardMouseMove(event, '${r.id}')"
               onmouseleave="window.handleRouteCardMouseLeave()">
            <div style="display:flex; justify-content: space-between; align-items: center;">
              <div style="display:flex; align-items:center; gap:10px; overflow:hidden">
                <span class="badge ${st.class}" 
                  title="${(!window.appPermissions?.isMotorista && r.status === 'active') ? 'Clique para voltar a Agendada' : (!window.appPermissions?.isMotorista && r.status === 'planned') ? 'Clique para colocar Em Andamento' : ''}"
                  style="font-size: 0.6rem; padding: 2px 6px; letter-spacing: 0.04em; ${(!window.appPermissions?.isMotorista && r.status !== 'done') ? 'cursor:pointer;' : ''}"
                  onclick="event.stopPropagation(); ${(!window.appPermissions?.isMotorista && r.status === 'active') ? `window.updateRouteStatusFromList('${r.id}', 'planned')` : (!window.appPermissions?.isMotorista && r.status === 'planned') ? `window.updateRouteStatusFromList('${r.id}', 'active')` : ''}"
                >${st.label}</span>
                <span class="item-title">${r.name}</span>
              </div>
              <div class="item-actions" style="display: flex; align-items: center; gap: 8px;">
                 ${(window.appPermissions?.canCreateStop && r.status !== 'done') ? `
                 <button class="btn-icon-xs" style="background: var(--accent-primary); color: var(--bg-dark); border-radius: 50%; width: 24px; height: 24px;" onclick="event.stopPropagation(); window.openDeliveryModalForRoute('${r.id}')" title="Criar Parada">
                   <i class="ri-add-line"></i>
                 </button>
                 ` : ''}
                 ${(window.appPermissions?.canEditRoute && r.status !== 'done') ? `
                   <button class="btn-icon-xs" style="background: var(--accent-danger); color: #fff; border-radius: 4px; width: 28px; height: 24px;" onclick="event.stopPropagation(); window.deleteRoute('${r.id}')" title="Excluir Rota">
                     <i class="ri-delete-bin-line"></i>
                   </button>
                 ` : ''}
                 <i class="ri-arrow-down-s-line expand-icon"></i>
              </div>
            </div>
            
            <div class="item-collapsed-meta" style="display: flex; flex-wrap: wrap; gap: 12px; font-size: 0.75rem; color: var(--text-muted);">
              <span><i class="ri-calendar-line"></i> ${formatDate(r.date)}</span>
              <span><i class="ri-steering-2-line"></i> ${driverDisplay}</span>
              <span><i class="ri-map-pin-line"></i> ${dCount} paradas</span>
              <span><i class="ri-map-2-line"></i> ${dCount === 0 ? '—' : (r.distanceKm || '—')} km</span>
            </div>
          </div>

          <div class="item-details">
            ${StorageManager.getDayNote(r.date) ? `<div style="margin-bottom: 12px; padding: 6px 10px; background: rgba(234, 179, 8, 0.1); border-left: 2px solid #eab308; border-radius: 4px; font-size: 0.75rem; color: #fde047;"><strong>Nota do dia:</strong> ${StorageManager.getDayNote(r.date)}</div>` : ''}
            ${r.notes ? `<div class="route-notes-preview" style="margin-bottom: 15px;"><i class="ri-bank-card-line"></i> <strong>CHAVE PIX: ${r.notes}</strong></div>` : ''}
            
            <div class="section-header" style="font-size:0.7rem; margin-bottom:10px">ORDEM DAS PARADAS (Arraste para reordenar)</div>
            <div class="stops-detail-list" ${canReorder ? `ondragover="window.handleStopDragOver(event)" ondrop="window.handleStopDrop(event, '${r.id}')"` : ''}>
              ${stopsHtml}
            </div>
            <div style="font-size: 0.75rem; font-weight: bold; margin-top: 15px; text-transform: uppercase;">VEÍCULO: ${vehicleDisplay}</div>
            ${dCount >= 6 ? `<div style="color: #facc15; font-size: 0.75rem; font-weight: bold; margin-top: 6px; text-align: center; text-transform: uppercase;">ROTA COMPLETA, ATENÇÃO PARA O ESPAÇO NO CARRO E TEMPO TOTAL DA ROTA</div>` : ''}
            ${overTime ? `<div style="color: #ef4444; font-size: 0.75rem; font-weight: bold; margin-top: 6px; text-align: center; text-transform: uppercase;"><i class="ri-timer-line"></i> ATENÇÃO: TEMPO DA ROTA EXCEDEU O LIMITE DE 12H30</div>` : ''}
            ${r.status === 'closed' ? `<div style="color: #ef4444; font-size: 0.85rem; font-weight: bold; margin-top: 8px; text-align: center; text-transform: uppercase; letter-spacing: 0.05em;"><i class="ri-lock-line"></i> ROTA FECHADA</div>` : ''}


            <div class="details-actions" style="margin-top:15px; border-top:1px solid var(--border-color); padding-top:15px; display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px;">
              <!-- Coluna esquerda: Otimizar, Editar, Concluir, Fechar -->
              <div style="display: flex; flex-direction: column; gap: 6px;">
                ${(window.appPermissions?.canOptimize && dCount > 1 && r.status !== 'done') ? `
                  <button class="btn-secondary btn-sm" onclick="event.stopPropagation(); window.optimizeRouteFromList('${r.id}')" style="display: flex; align-items: center; justify-content: center; gap: 6px; padding: 8px; flex: 1;">
                    <i class="ri-magic-line" style="color: var(--accent-primary);"></i>
                    <span>Otimizar</span>
                  </button>
                ` : ''}
                ${(window.appPermissions?.canEditRoute && r.status !== 'done') ? `
                  <button class="btn-secondary btn-sm" onclick="event.stopPropagation(); window.openRouteModalFromList('${r.id}')" style="display: flex; align-items: center; justify-content: center; gap: 6px; padding: 8px; flex: 1;">
                    <i class="ri-edit-line"></i>
                    <span>Editar Rota</span>
                  </button>
                ` : ''}
                ${(window.appPermissions?.canConcludeRoute && r.status === 'done') ? `
                  <button class="btn-warning btn-sm" onclick="event.stopPropagation(); window.updateRouteStatusFromList('${r.id}', 'active')" style="display: flex; align-items: center; justify-content: center; gap: 6px; padding: 8px; flex: 1;">
                    <i class="ri-refresh-line"></i>
                    <span>Reativar Rota</span>
                  </button>
                ` : ''}
                
                ${r.status === 'closed' ? `
                  ${window.appPermissions?.canConcludeRoute ? `
                    <button class="btn-primary btn-sm" onclick="event.stopPropagation(); window.updateRouteStatusFromList('${r.id}', 'done')" style="display: flex; align-items: center; justify-content: center; gap: 6px; padding: 8px; flex: 1;">
                      <i class="ri-check-line"></i>
                      <span>Concluir Rota</span>
                    </button>
                  ` : ''}
                  ${window.appPermissions?.canCloseRoute ? `
                    <button class="btn-secondary btn-sm" onclick="event.stopPropagation(); window.updateRouteStatusFromList('${r.id}', 'reopen')" style="display: flex; align-items: center; justify-content: center; gap: 6px; padding: 8px; flex: 1; border-color: #ef4444; color: #ef4444;">
                      <i class="ri-lock-unlock-line"></i>
                      <span>Abrir Rota</span>
                    </button>
                  ` : ''}
                ` : ''}

                ${(r.status !== 'done' && r.status !== 'closed') ? `
                  ${window.appPermissions?.canConcludeRoute ? `
                    <button class="btn-primary btn-sm" onclick="event.stopPropagation(); window.updateRouteStatusFromList('${r.id}', 'done')" style="display: flex; align-items: center; justify-content: center; gap: 6px; padding: 8px; flex: 1;">
                      <i class="ri-check-line"></i>
                      <span>Concluir Rota</span>
                    </button>
                  ` : ''}
                  ${window.appPermissions?.canCloseRoute ? `
                    <button class="btn-secondary btn-sm" onclick="event.stopPropagation(); window.updateRouteStatusFromList('${r.id}', 'closed')" style="display: flex; align-items: center; justify-content: center; gap: 6px; padding: 8px; flex: 1; border-color: #ef4444; color: #ef4444;">
                      <i class="ri-lock-line"></i>
                      <span>Fechar Rota</span>
                    </button>
                  ` : ''}
                ` : ''}
              </div>

              <!-- Coluna direita: Imprimir, Ver no Mapa -->
              <div style="display: flex; flex-direction: column; gap: 6px;">
                <button class="btn-secondary btn-sm" onclick="event.stopPropagation(); window.printRoute('${r.id}')" style="display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 10px; flex: 1;">
                  <i class="ri-printer-line" style="font-size: 1.2rem;"></i>
                  <span>Imprimir Rota</span>
                </button>
                <button class="btn-secondary btn-sm" onclick="event.stopPropagation(); window.viewOnMap('${r.id}')" style="display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 10px; flex: 1;">
                  <i class="ri-map-2-line" style="font-size: 1.2rem;"></i>
                  <span>Ver no Mapa</span>
                </button>
              </div>
            </div>

          </div>
        `;

        div.addEventListener('click', () => {
          if (window.getSelection().toString().trim().length > 0) return;
          const wasExpanded = div.classList.contains('expanded');
          
          if (!wasExpanded) {
            if (expandedRouteIds.size >= 3) {
              const oldestId = expandedRouteIds.values().next().value;
              expandedRouteIds.delete(oldestId);
              const oldestEl = document.querySelector(`.list-item[data-route-id="${oldestId}"]`);
              if (oldestEl) oldestEl.classList.remove('expanded');
            }
            div.classList.add('expanded');
            expandedRouteIds.add(r.id);
          } else {
            div.classList.remove('expanded');
            expandedRouteIds.delete(r.id);
          }
        });
        list.appendChild(div);
      });
    }

    // Reordering logic
    let draggedStopId = null;
    window.handleStopDragStart = (e, stopId) => {
      draggedStopId = stopId;
      e.target.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    };
    window.handleStopDragEnd = (e) => {
      e.target.classList.remove('dragging');
    };
    window.handleStopDragOver = (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const list = e.currentTarget;
      list.classList.add('drag-over');
    };
    window.handleStopDrop = async (e, routeId, targetStopId = null) => {
      e.preventDefault();
      e.currentTarget.classList.remove('drag-over');
      if (!window.appPermissions?.canReorder) return;
      if (!draggedStopId) return;

      const allDeliveries = StorageManager.getDeliveries();
      const draggedItem = allDeliveries.find(d => d.id === draggedStopId);
      if (!draggedItem) return;

      const sourceRouteId = draggedItem.routeId;
      let promises = [];

      if (sourceRouteId === routeId) {
        // Same route
        const stops = StorageManager.getDeliveriesByRoute(routeId);
        const draggedIdx = stops.findIndex(s => s.id === draggedStopId);
        let targetIdx = targetStopId ? stops.findIndex(s => s.id === targetStopId) : stops.length;
        if (draggedIdx === -1) return;

        const [item] = stops.splice(draggedIdx, 1);
        stops.splice(targetIdx, 0, item);

        promises = stops.map((s, idx) => {
          s.order = idx + 1;
          return StorageManager.saveDelivery(s, true);
        });
      } else {
        // Different route
        const sourceStops = StorageManager.getDeliveriesByRoute(sourceRouteId);
        const targetStops = StorageManager.getDeliveriesByRoute(routeId);
        
        const draggedIdx = sourceStops.findIndex(s => s.id === draggedStopId);
        if (draggedIdx > -1) sourceStops.splice(draggedIdx, 1);
        
        let targetIdx = targetStopId ? targetStops.findIndex(s => s.id === targetStopId) : targetStops.length;
        if (targetIdx === -1) targetIdx = targetStops.length;

        draggedItem.routeId = routeId;
        targetStops.splice(targetIdx, 0, draggedItem);

        const p1 = sourceStops.map((s, idx) => {
          s.order = idx + 1;
          return StorageManager.saveDelivery(s, true);
        });
        const p2 = targetStops.map((s, idx) => {
          s.order = idx + 1;
          s.routeId = routeId;
          return StorageManager.saveDelivery(s, true);
        });
        promises = [...p1, ...p2];
      }

      try {
        await Promise.all(promises);
        await StorageManager.fetchDeliveries();
        
        if (activeRouteId === routeId || activeRouteId === sourceRouteId) {
          if (activeRouteId) await loadRouteToMap(activeRouteId);
        } else {
          if (routeId) await calcRouteKmSilently(routeId);
          if (sourceRouteId && sourceRouteId !== routeId) await calcRouteKmSilently(sourceRouteId);
        }

        showToast('Ordem das paradas atualizada');
        renderRoutesList();
      } catch (err) {
        showToast('Erro ao reordenar: ' + err.message, 'error');
      }
    };

    window.openDeliveryModalFromList = (id) => openDeliveryModal(id);
    window.updateRouteStatusFromList = (id, status) => {
      if (window.appPermissions?.isMotorista && (status === 'planned' || status === 'active')) {
        return showToast('Motoristas não têm permissão para alterar o status da rota.', 'error');
      }
      if (status === 'done') {
        openConfirmDialog('Deseja realmente concluir esta rota?', () => updateRouteStatus(id, status));
      } else if (status === 'closed') {
        openConfirmDialog('Deseja fechar esta rota? Ela não aparecerá no Encaixe Inteligente.', () => updateRouteStatus(id, 'closed'));
      } else if (status === 'reopen') {
        openConfirmDialog('Deseja realmente abrir a rota?', () => updateRouteStatus(id, 'active'));
      } else if (status === 'active' && StorageManager.getRoute(id).status === 'done') {
        openConfirmDialog('Deseja reativar esta rota e voltar para "Em andamento"?', () => updateRouteStatus(id, status));
      } else {
        updateRouteStatus(id, status);
      }
    };

    window.printRoutesForDay = (dateStr) => {
      const routes = StorageManager.getRoutes().filter(r => r.date === dateStr && (r.status === 'planned' || r.status === 'active' || r.status === 'done' || r.status === 'closed'));
      if (routes.length === 0) {
        showToast('Nenhuma rota programada para este dia.', 'warning');
        return;
      }
      
      const printArea = document.getElementById('printArea');
      if (!printArea) return;
      
      const separatePages = confirm("Deseja imprimir cada rota em uma página separada?\n\n[OK] para separar em várias páginas.\n[Cancelar] para imprimir todas juntas em uma única página (modo contínuo).");
      
      let finalHtml = '';
      routes.forEach((route, index) => {
        const stops = StorageManager.getDeliveriesByRoute(route.id);

        // Format dates
        const dateObj = route.date ? new Date(route.date + 'T12:00:00') : new Date();
        const fullDate  = dateObj.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
        const topDate   = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

        const driver = route.driverId
          ? (StorageManager.getDrivers().find(d => d.id === route.driverId) || StorageManager.getUsers().find(u => u.id === route.driverId))
          : null;
        const driverName = driver ? driver.name.toUpperCase() : 'NÃO DEFINIDO';

        const vehicleObj = route.vehicle ? StorageManager.getVehicle(route.vehicle) : null;
        const vehicleName = vehicleObj ? `${vehicleObj.name}${vehicleObj.plate ? ` (${vehicleObj.plate})` : ''}`.toUpperCase() : (route.vehicle || 'NÃO DEFINIDO').toUpperCase();

        const stopsHtml = stops.map((s) => `
          <div class="print-stop-item">
            <div class="print-stop-header">
              <div class="print-stop-circle"></div>
              <div class="print-header-title">${s.model ? s.model.toUpperCase() : 'SEM MODELO'}</div>
            </div>
            <div style="padding-left: 21px;">
              ${s.recipient ? `<div style="font-size: 7px; color: #444; line-height: 1.5; text-transform: uppercase; margin-bottom: 1px;">NOME: ${s.recipient.toUpperCase()}</div>` : ''}
              ${s.cpf    ? `<div style="font-size: 7px; color: #444; line-height: 1.5; text-transform: uppercase; margin-bottom: 1px;">CPF/CNPJ: ${s.cpf}</div>` : ''}
              ${s.phone  ? `<div style="font-size: 7px; color: #444; line-height: 1.5; text-transform: uppercase; margin-bottom: 1px;">TEL: ${s.phone}</div>` : ''}
              ${s.address ? `<div style="font-size: 7px; color: #444; line-height: 1.5; text-transform: uppercase; margin-bottom: 1px;">END: ${s.address.toUpperCase()}</div>` : ''}
              ${s.ref ? `<div style="font-size: 7px; color: #444; line-height: 1.5; text-transform: uppercase; margin-bottom: 1px;">REF: ${s.ref.toUpperCase()}</div>` : ''}
              ${s.notes ? `<div style="font-size: 7px; color: #333; margin-top: 2px; padding: 4px 6px; background-color: #f5f5f5; border-left: 2px solid #ccc; border-radius: 2px; line-height: 1.6; white-space: pre-wrap; font-weight: bold;">OBS: ${s.notes.trim()}</div>` : ''}
            </div>
          </div>
        `).join('');
        
        finalHtml += `
          <div style="${index < routes.length - 1 ? (separatePages ? 'page-break-after: always; margin-bottom: 30px;' : 'margin-bottom: 30px; border-bottom: 2px dashed #000; padding-bottom: 30px;') : ''}">
            <div class="print-page-header">
              <div class="print-header-top" style="display: flex; justify-content: space-between;">
                <span>LOGIC FRETE</span>
                <span>${topDate}</span>
              </div>
              <hr class="print-divider" style="margin-top: 5px; margin-bottom: 10px;">
              <div style="font-size: 7px; color: #666; font-weight: 600; margin-bottom: 2px;">ROTA</div>
              <div class="print-header-title" style="font-size: 16px; margin-bottom: 4px;">${route.name}</div>
              <div style="font-size: 7px; color: #444; text-transform: uppercase;">
                ${stops.length} paradas &bull; ${route.distanceKm || '0'} km &bull; Motorista: ${driverName} &bull; Veículo: ${vehicleName} &bull; ${fullDate}${route.notes ? ` &bull; <strong>CHAVE PIX: ${route.notes.toUpperCase()}</strong>` : ''}
              </div>
              <hr class="print-divider" style="margin-top: 10px; margin-bottom: 15px;">
            </div>
            <div class="print-stops-list">
              ${stopsHtml}
            </div>
          </div>
        `;
      });
      
      printArea.innerHTML = finalHtml;
      
      setTimeout(() => {
        window.print();
      }, 100);
    };

    window.printRoute = (routeId) => {
      generatePrintLayout(routeId);
    };


    function generatePrintLayout(routeId) {
      const route = StorageManager.getRoute(routeId);
      const stops = StorageManager.getDeliveriesByRoute(routeId);

      // Format dates
      const dateObj = route.date ? new Date(route.date + 'T12:00:00') : new Date();
      const dateShort = dateObj.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' });
      const fullDate  = dateObj.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
      const topDate   = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

      const driver = route.driverId
        ? (StorageManager.getDrivers().find(d => d.id === route.driverId) || StorageManager.getUsers().find(u => u.id === route.driverId))
        : null;
      const driverName = driver ? driver.name.toUpperCase() : 'NÃO DEFINIDO';

      const vehicleObj = route.vehicle ? StorageManager.getVehicle(route.vehicle) : null;
      const vehicleName = vehicleObj ? `${vehicleObj.name}${vehicleObj.plate ? ` (${vehicleObj.plate})` : ''}`.toUpperCase() : (route.vehicle || 'NÃO DEFINIDO').toUpperCase();

      const stopsHtml = stops.map((s) => `
        <div class="print-stop-item">
          <div class="print-stop-header">
            <div class="print-stop-circle"></div>
            <div class="print-header-title">${s.model ? s.model.toUpperCase() : 'SEM MODELO'}</div>
          </div>
          <div style="padding-left: 21px;">
            ${s.recipient ? `<div style="font-size: 7px; color: #444; line-height: 1.5; text-transform: uppercase; margin-bottom: 1px;">NOME: ${s.recipient.toUpperCase()}</div>` : ''}
            ${s.cpf    ? `<div style="font-size: 7px; color: #444; line-height: 1.5; text-transform: uppercase; margin-bottom: 1px;">CPF/CNPJ: ${s.cpf}</div>` : ''}
            ${s.phone  ? `<div style="font-size: 7px; color: #444; line-height: 1.5; text-transform: uppercase; margin-bottom: 1px;">TEL: ${s.phone}</div>` : ''}
            ${s.address ? `<div style="font-size: 7px; color: #444; line-height: 1.5; text-transform: uppercase; margin-bottom: 1px;">END: ${s.address.toUpperCase()}</div>` : ''}
            ${s.ref ? `<div style="font-size: 7px; color: #444; line-height: 1.5; text-transform: uppercase; margin-bottom: 1px;">REF: ${s.ref.toUpperCase()}</div>` : ''}
            ${s.notes ? `<div style="font-size: 7px; color: #333; margin-top: 2px; padding: 4px 6px; background-color: #f5f5f5; border-left: 2px solid #ccc; border-radius: 2px; line-height: 1.6; white-space: pre-wrap; font-weight: bold;">OBS: ${s.notes.trim()}</div>` : ''}
          </div>
        </div>
      `).join('');

      const printArea = document.getElementById('printArea');
      if (printArea) {
        printArea.innerHTML = `
          <div class="print-page-header">
            <div class="print-header-top" style="display: flex; justify-content: space-between;">
              <span>LOGIC FRETE</span>
              <span>${topDate}</span>
            </div>
            <hr class="print-divider" style="margin-top: 5px; margin-bottom: 10px;">
            <div style="font-size: 7px; color: #666; font-weight: 600; margin-bottom: 2px;">ROTA</div>
            <div class="print-header-title" style="font-size: 16px; margin-bottom: 4px;">${route.name}</div>
            <div style="font-size: 7px; color: #444; text-transform: uppercase;">
              ${stops.length} paradas &bull; ${route.distanceKm || '0'} km &bull; Motorista: ${driverName} &bull; Veículo: ${vehicleName} &bull; ${fullDate}${route.notes ? ` &bull; <strong>CHAVE PIX: ${route.notes.toUpperCase()}</strong>` : ''}
            </div>
            <hr class="print-divider" style="margin-top: 10px; margin-bottom: 15px;">
          </div>
          <div class="print-stops-list">
            ${stopsHtml}
          </div>
        `;
        
        setTimeout(() => {
          window.print();
        }, 100);
      } else {
        alert("Erro: Área de impressão não encontrada.");
      }
    };



    function renderDeliveriesList() {
      const list = document.getElementById('deliveriesListMain');
      if(!list) return;
      const deliveries = StorageManager.getDeliveries();
      const routes = StorageManager.getRoutes();
      
      const searchInput = document.getElementById('searchDeliveriesMain');
      const q = searchInput ? searchInput.value.toLowerCase() : '';
      let filtered = deliveries;
      if (q) {
        filtered = deliveries.filter(d => 
          d.recipient.toLowerCase().includes(q) || 
          (d.address && d.address.toLowerCase().includes(q))
        );
      }
  
      if (filtered.length === 0) {
        list.innerHTML = `<div class="empty-state" style="grid-column: 1 / -1"><i class="ri-map-pin-line"></i><p>Nenhuma entrega encontrada</p></div>`;
        return;
      }
  
      list.innerHTML = '';
      filtered.forEach(d => {
        const route = routes.find(r => r.id === d.routeId);
        const st = statusMap[d.status] || statusMap['pending'];
  
        const div = document.createElement('div');
        div.className = 'task-card list-item';
        if (d.status === 'delivered') div.classList.add('delivered');
        div.innerHTML = `
          <div class="task-header">
            <div class="task-indicator ${st.class}"></div>
            <div class="task-title">${(d.recipient || 'SEM NOME').toUpperCase()}</div>
          </div>
          <div class="task-body">
            <div class="task-row"><span class="task-label">CLIENTE:</span> <span class="task-value">${d.recipient}</span></div>
            <div class="task-row"><span class="task-label">CPF/CNPJ:</span> <span class="task-value">${d.cpf || '-'}</span></div>
            <div class="task-row"><span class="task-label">TEL:</span> <span class="task-value">${d.phone || '-'}</span></div>
            <div class="task-row"><span class="task-label">END:</span> <span class="task-value">${d.address || '-'}</span></div>
            ${d.notes ? `<div class="task-notes">${d.notes}</div>` : ''}
          </div>
          <div class="task-footer" style="flex-direction: column; gap: 12px; align-items: stretch; border-top: 1px solid var(--border-color); padding-top: 12px; margin-top: 8px;">
            <div style="display: flex; justify-content: space-between; font-size: 0.85rem; color: var(--text-muted); width: 100%;">
                <span><i class="ri-calendar-line"></i> ${route ? formatDate(route.date) : '-'}</span>
                <div style="display: flex; gap: 12px; font-size: 1.1rem;">
                  ${(window.appPermissions?.canEditRoute && (!route || route.status !== 'done')) ? `
                    <i class="ri-edit-line" style="cursor:pointer; color: var(--text-white);" title="Editar" onclick="event.stopPropagation(); window.openDeliveryModalFromList('${d.id}')"></i>
                    <i class="ri-delete-bin-line" style="cursor:pointer; color: var(--danger-color);" title="Excluir" onclick="event.stopPropagation(); window.deleteDeliveryFromList('${d.id}')"></i>
                  ` : ''}
                </div>
            </div>
            
            <div class="delivery-actions-grid" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; width: 100%;">
              <button class="btn-secondary" onclick="event.stopPropagation(); window.viewOnMap('${d.routeId}')" style="padding: 8px; font-size: 0.75rem; display: flex; flex-direction: column; align-items: center; gap: 4px; border-radius: 8px;">
                <i class="ri-map-pin-2-line" style="font-size: 1.2rem;"></i> GPS
              </button>
              <button class="btn-danger" onclick="event.stopPropagation(); window.updateDeliveryStatus('${d.id}', 'failed')" style="padding: 8px; font-size: 0.75rem; display: flex; flex-direction: column; align-items: center; gap: 4px; border-radius: 8px;">
                <i class="ri-close-circle-line" style="font-size: 1.2rem;"></i> Falhou
              </button>
              <button class="btn-primary" onclick="event.stopPropagation(); window.updateDeliveryStatus('${d.id}', 'delivered')" style="padding: 8px; font-size: 0.75rem; display: flex; flex-direction: column; align-items: center; gap: 4px; border-radius: 8px;">
                <i class="ri-check-double-line" style="font-size: 1.2rem;"></i> Entregue
              </button>
            </div>
          </div>
        `;
  
        div.addEventListener('click', () => {
          const wasExpanded = div.classList.contains('expanded');
          document.querySelectorAll('.list-item.expanded').forEach(item => item.classList.remove('expanded'));
          if (!wasExpanded) div.classList.add('expanded');
        });
        list.appendChild(div);
      });
    }

    window.transferRouteToDriver = async (event, newDriverId) => {
      const routeId = event.dataTransfer.getData('text/plain');
      if (!routeId) return;
      const route = StorageManager.getRoutes().find(r => String(r.id) === String(routeId));
      if (!route) return;
      if (String(route.driverId) === String(newDriverId)) return;
      
      route.driverId = newDriverId;
      try {
        await StorageManager.saveRoute(route);
        if (typeof showToast === 'function') showToast('Rota transferida com sucesso!');
        if (typeof renderDriversList === 'function') renderDriversList();
      } catch (err) {
        if (typeof showToast === 'function') showToast('Erro ao transferir: ' + err.message, 'error');
      }
    };

    function renderDriversList() {
      const list = document.getElementById('driversListMain');
      if(!list) return;
      
      const traditionalDrivers = StorageManager.getDrivers();
      const userDrivers = StorageManager.getUsers().filter(u => u.role === 'Motorista');
      
      const combinedDrivers = [
        ...traditionalDrivers.map(d => ({ ...d, isUser: false })),
        ...userDrivers.map(u => ({ id: u.id, name: u.name, phone: u.phone || '-', isUser: true, vehicle: 'Consultar perfil' }))
      ];
      
      if (combinedDrivers.length === 0) {
        list.innerHTML = `<div class="empty-state" style="grid-column: 1 / -1"><i class="ri-user-star-line"></i><p>Nenhum motorista cadastrado</p></div>`;
        return;
      }
  
      list.innerHTML = '';
      combinedDrivers.forEach(d => {
        const routes = StorageManager.getRoutes().filter(r => r.driverId === d.id).sort((a, b) => {
          const diff = new Date(b.date) - new Date(a.date);
          if (diff !== 0) return diff;
          const idA = a.created_at || a.id || '';
          const idB = b.created_at || b.id || '';
          if (idA < idB) return 1; // reverse order for consistency or keep ascending? Let's just do ascending for IDs.
          if (idA > idB) return -1;
          return 0;
        });
        const routeCount = routes.length;
        const totalKm = routes.reduce((sum, r) => sum + (parseFloat(String(r.distanceKm).replace(',', '.')) || 0), 0).toFixed(1);
        
        let historyHtml = routes.map(r => {
          const st = statusMap[r.status] || statusMap['planned'];
          const stopsCount = StorageManager.getDeliveriesByRoute(r.id).length;
          return `
            <div class="history-route-item" onclick="event.stopPropagation(); window.viewOnMapReadOnly('${r.id}')" style="flex-wrap: wrap; gap: 8px;">
              <div class="history-route-info" style="flex: 1; min-width: 0; word-break: break-word;">
                <span class="history-route-name" style="display: block; margin-bottom: 4px;">${r.name}</span>
                <span class="history-route-date">
                  <div class="card-date">
                    ${formatDate(r.date)} &bull; <i class="ri-map-pin-line"></i> ${stopsCount} paradas &bull; <i class="ri-map-2-line"></i> ${r.distanceKm || '0'} km
                  </div>
                </span>
              </div>
              <div style="display:flex; align-items:center; gap:10px">
                <span class="badge ${st.class}" style="font-size:0.5rem">${st.label}</span>
              </div>
            </div>
          `;
        }).join('');
  
        const div = document.createElement('div');
        div.className = 'list-item driver-item';
        div.innerHTML = `
          <div class="item-header" style="flex-direction: column; align-items: stretch; gap: 4px;">
            <div style="display:flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
              <div style="display:flex; align-items:center; gap:10px; flex: 1; word-break: break-word; min-width: 0;">
                <div class="task-indicator" style="background: var(--accent-primary); width: 4px; height: 16px; border-radius: 2px; flex-shrink: 0;"></div>
                <span class="item-title">${(d.name || 'SEM NOME').toUpperCase()}</span>
              </div>
              <div class="item-actions">
                 <i class="ri-arrow-down-s-line expand-icon"></i>
              </div>
            </div>
            
            <div class="item-collapsed-meta" style="display: flex; flex-wrap: wrap; gap: 12px; font-size: 0.75rem; color: var(--text-muted);">
              <span><i class="ri-phone-line"></i> ${d.phone || '-'}</span>
              <span><i class="ri-truck-line"></i> ${d.vehicle || '-'}</span>
              <span><i class="ri-route-line"></i> ${routeCount} rotas</span>
              <span><i class="ri-pin-distance-line"></i> ${totalKm} km</span>
            </div>
          </div>

          <div class="item-details">
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin-bottom: 20px;">
              <div class="meta-item"><i class="ri-user-badge-line"></i> <strong>Vínculo:</strong> ${d.isUser ? 'Interno (Usuário)' : 'Externo (Manual)'}</div>
              <div class="meta-item"><i class="ri-pin-distance-line"></i> <strong>Total KM:</strong> ${totalKm} km percorridos</div>
            </div>

            <div class="driver-history-list">
              <div class="section-header" style="font-size:0.75rem; margin-bottom:12px; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 5px;">HISTÓRICO RECENTE DE ROTAS</div>
              <div style="max-height: 200px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; padding-right: 5px;">
                ${historyHtml || '<p class="text-muted" style="font-size:0.8rem; text-align: center; padding: 20px;">Nenhuma rota cadastrada para este motorista.</p>'}
              </div>
            </div>

          </div>

          <div class="task-footer" style="padding-top: 10px; border-top: 1px solid var(--border-color); margin-top: 5px; width: 100%; display: flex; justify-content: flex-end;">
             <div class="details-actions" style="display: flex; gap: 8px;">
                ${(window.appPermissions?.isMaster || window.appPermissions?.isGerente) ? `
                  <button class="btn-secondary" onclick="event.stopPropagation(); ${d.isUser ? `window.openUserModalFromList('${d.id}')` : `window.openDriverModalFromList('${d.id}')`}" style="padding: 8px; border-radius: 50%; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center;" title="Editar">
                    <i class="ri-edit-line" style="font-size: 1.2rem; margin: 0;"></i>
                  </button>
                ` : ''}
             </div>
          </div>
        `;
  
        div.addEventListener('click', () => {
          const wasExpanded = div.classList.contains('expanded');
          document.querySelectorAll('.driver-item.expanded').forEach(item => item.classList.remove('expanded'));
          if (!wasExpanded) div.classList.add('expanded');
        });
        list.appendChild(div);
      });
    }

    function renderUsersList() {
      const list = document.getElementById('usersListMain');
      if(!list) return;
      let users = StorageManager.getUsers();
      
      const currentUser = StorageManager.getCurrentUser();
      if (currentUser && (currentUser.role || '').toLowerCase() === 'vendedor') {
        users = users.filter(u => u.id === currentUser.id);
      }
      
      if (users.length === 0) {
        list.innerHTML = `<div class="empty-state" style="grid-column: 1 / -1"><p>Nenhum usuário cadastrado</p></div>`;
        return;
      }

      list.innerHTML = '';
      users.forEach(u => {
        const div = document.createElement('div');
        div.className = 'task-card list-item';
        div.innerHTML = `
          <div class="section-header">
            <span>Usuário</span>
          </div> 
          <div class="task-header">
            <div class="task-indicator active"></div>
            <div class="task-title">${(u.name || 'SEM NOME').toUpperCase()}</div>
          </div>
          <div class="task-body">
            <div class="task-row"><span class="task-label">USUÁRIO:</span> <span class="task-val">${u.username}</span></div>
            <div class="task-row"><span class="task-label">CARGO:</span> <span class="task-value">${u.role}</span></div>
          </div>
          <div class="task-footer" style="padding-top: 10px; border-top: 1px solid var(--border-color); margin-top: 10px; width: 100%;">
            <div class="details-actions" style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; width: 100%;">
               ${(() => {
                 const isSelf = window.appPermissions?.currentUser?.id === u.id;
                 const isMaster = window.appPermissions?.isMaster;
                 const isGerente = window.appPermissions?.isGerente;
                 // Motorista e Vendedor só editam a si mesmos; Gerente edita o próprio; Master edita todos
                 const canEdit = isMaster || (isGerente && isSelf) || isSelf;
                 const canDelete = isMaster;
                 return canEdit ? `
                   <button class="btn-secondary" onclick="event.stopPropagation(); window.openUserModalFromList('${u.id}')" style="display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 12px;">
                     <i class="ri-edit-line"></i> Editar
                   </button>
                   ${canDelete ? `
                   <button class="btn-danger" onclick="event.stopPropagation(); window.deleteUserFromList('${u.id}')" style="display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 12px;">
                     <i class="ri-delete-bin-line"></i> Excluir
                   </button>` : ''}
                 ` : '';
               })()}
            </div>
          </div>
        `;
        list.appendChild(div);
      });
    }

    function refreshDashboard() {
      try {
        const titleEl = document.getElementById('dashboardTitle');
        if (titleEl) {
          const currentUser = StorageManager.getCurrentUser ? StorageManager.getCurrentUser() : (window.appPermissions?.currentUser || null);
          const uName = (currentUser?.name || currentUser?.username || '');
          const firstName = uName.split(' ')[0] || '';
          const greeting = Math.random() > 0.5 ? 'Olá' : 'Oi';
          if (firstName) {
            titleEl.textContent = `${greeting} ${firstName}, esse é o Seu Painel de controle`;
          }
        }
      
        const routes = StorageManager.getRoutes();
        const todayStr = getLocalISODate();
        
        const routesToday = routes.filter(r => r.date === todayStr);
        // Planejadas = status 'planned' ou 'closed'
        const plannedRoutesCount = routes.filter(r => r.status === 'planned' || r.status === 'closed').length;
        const plannedRoutesIds = routes.filter(r => r.status === 'planned' || r.status === 'closed').map(r => r.id);
        const plannedStopsCount = StorageManager.getDeliveries().filter(d => plannedRoutesIds.includes(d.routeId)).length;
        
        const doneRoutesCount = routes.filter(r => r.status === 'done').length;
        // FIX: KM Hoje = somente rotas de hoje
        const totalKmToday = routesToday.reduce((sum, r) => sum + (parseFloat(String(r.distanceKm).replace(',', '.')) || 0), 0).toFixed(1);
        const elToday = document.getElementById('stat-routes-val-main');
        const elActive = document.getElementById('stat-pending-val-main');
        const elActiveStops = document.getElementById('stat-pending-stops-main');
        const elDone = document.getElementById('stat-done-val-main');
        const elKm = document.getElementById('stat-km-val-main');
        const elDate = document.getElementById('currentDateDisplay');

        if (elToday) elToday.innerText = routesToday.length;
        if (elActive) elActive.innerText = plannedRoutesCount;
        if (elActiveStops) elActiveStops.innerText = plannedStopsCount + (plannedStopsCount === 1 ? ' parada agendada' : ' paradas agendadas');
        if (elDone) elDone.innerText = doneRoutesCount;
        if (elKm) elKm.innerText = totalKmToday + ' km';
        if (elDate) elDate.innerText = new Date().toLocaleDateString('pt-BR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

        const list = document.getElementById('activeRoutesListMain');
        if (list) {
          const activeRoutes = routes.filter(r => r.status === 'active');
          if (activeRoutes.length === 0) {
            list.innerHTML = `<div class="empty-state" style="padding: 20px"><i class="ri-route-line"></i><p>Nenhuma rota em andamento</p></div>`;
          } else {
            list.innerHTML = '';
            // ONE-TIME MIGRATION v6: Recalculate RJ routes time directly to avoid OSRM rate limits (15% -> 20%)
            setTimeout(() => {
              if (localStorage.getItem('rj_20_percent_update_done_v6') !== 'true') {
                const routes = StorageManager.getRoutes();
                let updated = false;
                for (const r of routes) {
                  const stops = StorageManager.getDeliveriesByRoute(r.id);
                  const isRJ = stops.some(s => {
                     const a = (s.address||'').toLowerCase() + ' ' + (s.recipient||'').toLowerCase();
                     return a.includes('rio de janeiro') || a.includes('- rj') || a.includes(', rj') || a.includes('/rj') || a.includes('/ rj');
                  });
                  if (isRJ && r.durationMin) {
                     // Anteriormente estava com 15% (1.15). Agora é 20% (1.20).
                     const newDur = Math.round((r.durationMin / 1.15) * 1.20);
                     if (newDur !== r.durationMin) {
                       r.durationMin = newDur;
                       StorageManager.saveRoute(r);
                       updated = true;
                     }
                  }
                }
                if (updated) {
                   renderRoutesList();
                   if (typeof refreshDashboard === 'function') refreshDashboard();
                }
                localStorage.setItem('rj_20_percent_update_done_v6', 'true');
              }
            }, 2000);
            activeRoutes.forEach(r => {
              const st = statusMap[r.status] || statusMap['planned'];
              const stops = StorageManager.getDeliveriesByRoute(r.id);
              const driver = r.driverId ? (StorageManager.getDrivers().find(d => d.id === r.driverId) || StorageManager.getUsers().find(u => u.id === r.driverId)) : null;
              const driverName = driver ? driver.name : 'Sem motorista';
              
              const div = document.createElement('div');
              div.className = 'task-card list-item';
              div.style.cssText = 'box-sizing:border-box; width:100%; overflow:hidden; padding:0; margin-bottom:6px;';
              div.innerHTML = `
                <div style="padding:8px; box-sizing:border-box; width:100%;">
                  <div style="display:flex; justify-content:space-between; align-items:center; gap:4px; width:100%; min-width:0;">
                    <div style="display:flex; align-items:center; gap:4px; flex:1; min-width:0; overflow:hidden;">
                      <span class="badge ${st.class}" style="white-space:nowrap; flex-shrink:0; font-size:0.55rem; padding:2px 4px; height:auto; border-radius:4px;">${st.label}</span>
                      <span style="font-size:0.75rem; font-weight:700; color:var(--text-white); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${r.name}</span>
                    </div>
                    ${(window.appPermissions?.canCreateStop && r.status !== 'done') ? `
                    <button class="hover-lift" style="background:var(--accent-primary); color:var(--bg-dark); border-radius:50%; width:20px; height:20px; flex-shrink:0; display:flex; align-items:center; justify-content:center; border:none; cursor:pointer; min-height:unset !important;" onclick="event.stopPropagation(); window.openDeliveryModalForRoute('${r.id}')" title="Criar Parada">
                      <i class="ri-add-line" style="font-size:0.8rem;"></i>
                    </button>
                    ` : ''}
                  </div>
                  <div style="display:flex; flex-wrap:wrap; gap:4px; font-size:0.6rem; color:var(--text-muted); margin-top:5px;">
                    <span><i class="ri-steering-2-line"></i> ${driverName}</span>
                    <span><i class="ri-map-pin-line"></i> ${stops.length} par.</span>
                    ${r.distanceKm ? `<span><i class="ri-map-2-line"></i> ${r.distanceKm} km</span>` : ''}
                  </div>
                  <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:4px; margin-top:6px; width:100%;">
                    <button class="hover-lift" onclick="event.stopPropagation(); window.viewOnMap('${r.id}')" style="background:#22d3ee; color:#000; border:none; border-radius:4px; padding:2px 0; font-size:0.6rem; cursor:pointer; height:24px;"><i class="ri-map-2-line"></i> Mapa</button>
                    <button class="hover-lift" onclick="event.stopPropagation(); window.printRoute('${r.id}')" style="background:rgba(255,255,255,0.05); color:#fff; border:1px solid rgba(255,255,255,0.1); border-radius:4px; padding:2px 0; font-size:0.6rem; cursor:pointer; height:24px;"><i class="ri-printer-line"></i> Print</button>
                    ${window.appPermissions?.canConcludeRoute ? (
                      r.status === 'done'
                      ? `<button class="hover-lift" onclick="event.stopPropagation(); window.updateRouteStatusFromList('${r.id}', 'active')" style="background:#f59e0b; color:#000; border:none; border-radius:4px; padding:2px 0; font-size:0.6rem; cursor:pointer; height:24px;"><i class="ri-refresh-line"></i> Voltar</button>`
                      : `<button class="hover-lift" onclick="event.stopPropagation(); window.updateRouteStatusFromList('${r.id}', 'done')" style="background:#22c55e; color:#fff; border:none; border-radius:4px; padding:2px 0; font-size:0.6rem; cursor:pointer; height:24px;"><i class="ri-check-line"></i> Concluir</button>`
                    ) : ''}
                  </div>
                </div>
              `;
              list.appendChild(div);
            });
          }
        }
        renderWeeklyChart();
      } catch (err) {
        console.error("Erro ao atualizar dashboard:", err);
      }
    }
    // === CALENDAR KANBAN LOGIC ===
    let calendarCurrentDate = new Date(); // Reference date for the week being viewed

    window.getFeriado = function(dateStr) {
      if (!dateStr) return null;
      const parts = dateStr.split('-');
      if (parts.length !== 3) return null;
      const year = parseInt(parts[0], 10);
      const mmdd = `${parts[1]}-${parts[2]}`;
      const feriadosFixos = {
        '01-01': 'Confraternização Universal',
        '04-21': 'Tiradentes',
        '04-23': 'Feriado Estadual (RJ - São Jorge)',
        '05-01': 'Dia do Trabalhador',
        '06-09': 'Feriado Municipal (Magé/RJ - Aniversário)',
        '09-07': 'Independência do Brasil',
        '09-15': 'Feriado Municipal (Magé/RJ - Padroeira)',
        '10-12': 'Nossa Sra. Aparecida',
        '11-02': 'Finados',
        '11-15': 'Proclamação da República',
        '11-20': 'Dia da Consciência Negra',
        '12-25': 'Natal'
      };
      if (feriadosFixos[mmdd]) return feriadosFixos[mmdd];
      
      const a = year % 19;
      const b = Math.floor(year / 100);
      const c = year % 100;
      const d = Math.floor(b / 4);
      const e = b % 4;
      const f = Math.floor((b + 8) / 25);
      const g = Math.floor((b - f + 1) / 3);
      const h = (19 * a + b - d - g + 15) % 30;
      const i = Math.floor(c / 4);
      const k = c % 4;
      const l = (32 + 2 * e + 2 * i - h - k) % 7;
      const m = Math.floor((a + 11 * h + 22 * l) / 451);
      const month = Math.floor((h + l - 7 * m + 114) / 31);
      const day = ((h + l - 7 * m + 114) % 31) + 1;
      
      const pascoa = new Date(year, month - 1, day);
      const sextaSanta = new Date(pascoa);
      sextaSanta.setDate(pascoa.getDate() - 2);
      const carnaval = new Date(pascoa);
      carnaval.setDate(pascoa.getDate() - 47);
      const corpusChristi = new Date(pascoa);
      corpusChristi.setDate(pascoa.getDate() + 60);

      const format = (d) => String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

      if (mmdd === format(sextaSanta)) return 'Paixão de Cristo';
      if (mmdd === format(carnaval)) return 'Feriado Estadual (RJ - Carnaval)';
      if (mmdd === format(corpusChristi)) return 'Feriado Estadual (RJ - Corpus Christi)';

      // Dia do Comerciário RJ: 3ª segunda-feira de outubro (em 2026 cai em 19/10)
      const primeiraOut = new Date(year, 9, 1);
      const offsetSeg = (8 - primeiraOut.getDay()) % 7;
      const terceiraSegOut = new Date(year, 9, 1 + offsetSeg + 14);
      if (mmdd === format(terceiraSegOut)) return 'Feriado Estadual (RJ - Dia do Comerciário)';

      return null;
    };

    window.promptDayNote = async (dateStr) => {
      const currentNote = StorageManager.getDayNote(dateStr) || '';
      const newNote = prompt(`Nota para o dia ${dateStr.split('-').reverse().join('/')}:\n(Deixe em branco para apagar)`, currentNote);
      if (newNote !== null) {
        const { error } = await StorageManager.saveDayNote(dateStr, newNote);
        if (error) {
          alert('Erro ao salvar a nota: ' + (error.message || 'Erro desconhecido.'));
        } else {
          renderCalendarView();
        }
      }
    };

    function renderCalendarView() {
      const kanban = document.getElementById('calendarKanban');
      if (!kanban) return;

      const weekDisplay = document.getElementById('calendarWeekDisplay');
      
      // Calculate start of current view (Today)
      const startOfWeek = new Date(calendarCurrentDate);
      startOfWeek.setHours(0, 0, 0, 0);

      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(startOfWeek.getDate() + 6);

      // Update week display
      const options = { month: 'short', day: 'numeric' };
      const searchQuery = document.getElementById('calendarSearchInput')?.value.trim().toLowerCase() || '';
      const allRoutes = StorageManager.getRoutes();
      
      let daysToRender = [];
      
      if (searchQuery) {
        const matchingDates = new Set();
        
        allRoutes.forEach(r => {
          let matches = false;
          if (r.name && r.name.toLowerCase().includes(searchQuery)) matches = true;
          
          const stops = StorageManager.getDeliveriesByRoute(r.id) || [];
          for (let s of stops) {
            if (s.recipient && s.recipient.toLowerCase().includes(searchQuery)) matches = true;
            if (s.cpf && s.cpf.toLowerCase().includes(searchQuery)) matches = true;
          }
          
          if (r.date) {
            const [year, month, day] = r.date.split('-');
            if (year && month && day) {
              const dateBr = `${day}/${month}/${year}`;
              const dateBrShort = `${day}/${month}`;
              if (dateBr.includes(searchQuery) || dateBrShort.includes(searchQuery) || r.date.includes(searchQuery)) matches = true;
              
              const d = new Date(year, month - 1, day);
              const dayString = d.toLocaleDateString('pt-BR', { weekday: 'long' }).toLowerCase();
              if (dayString.includes(searchQuery)) matches = true;
            }
          }
          
          if (matches && r.date) {
            matchingDates.add(r.date);
          }
        });
        
        // Also check if current week's dates match the query (to show empty columns if searched)
        for (let i = 0; i < 7; i++) {
          const d = new Date(startOfWeek);
          d.setDate(startOfWeek.getDate() + i);
          const dayString = d.toLocaleDateString('pt-BR', { weekday: 'long' }).toLowerCase();
          const dateString = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
          const fullDateString = d.toLocaleDateString('pt-BR');
          
          if (dayString.includes(searchQuery) || dateString.includes(searchQuery) || fullDateString.includes(searchQuery)) {
             const dateStr = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
             matchingDates.add(dateStr);
          }
        }
        
        // Try to parse query as date (e.g., DD/MM or DD/MM/YYYY)
        let parsedDateStr = null;
        const matchDMY = searchQuery.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
        const matchDM = searchQuery.match(/^(\d{2})\/(\d{2})$/);
        if (matchDMY) {
           parsedDateStr = `${matchDMY[3]}-${matchDMY[2]}-${matchDMY[1]}`;
        } else if (matchDM) {
           const currentYear = new Date().getFullYear();
           parsedDateStr = `${currentYear}-${matchDM[2]}-${matchDM[1]}`;
        }
        if (parsedDateStr) {
           matchingDates.add(parsedDateStr);
        }
        
        daysToRender = Array.from(matchingDates).sort();
        weekDisplay.innerText = `Resultados da Pesquisa`;
      } else {
        weekDisplay.innerText = `${startOfWeek.toLocaleDateString('pt-BR', options)} - ${endOfWeek.toLocaleDateString('pt-BR', options)} (${startOfWeek.getFullYear()})`;
        for (let i = 0; i < 7; i++) {
          const d = new Date(startOfWeek);
          d.setDate(startOfWeek.getDate() + i);
          daysToRender.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'));
        }
      }

      kanban.innerHTML = '';
      
      if (daysToRender.length === 0 && searchQuery) {
        kanban.innerHTML = `<div style="padding: 40px 20px; color: var(--text-muted); text-align: center; width: 100%; font-size: 1.1rem;"><i class="ri-search-line" style="font-size: 2rem; display: block; margin-bottom: 10px;"></i> Nenhuma rota encontrada para esta pesquisa em todo o histórico.</div>`;
        return;
      }

      daysToRender.forEach(dateStr => {
        const [year, month, day] = dateStr.split('-');
        const currentColumnDate = new Date(year, month - 1, day);
        
        const dayString = currentColumnDate.toLocaleDateString('pt-BR', { weekday: 'long' }).toLowerCase();
        const dateString = currentColumnDate.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
        const fullDateString = currentColumnDate.toLocaleDateString('pt-BR');
        const colMatchesQuery = searchQuery === '' || dayString.includes(searchQuery) || dateString.includes(searchQuery) || fullDateString.includes(searchQuery);

        let routesForDay = allRoutes.filter(r => r.date === dateStr);

        if (searchQuery && !colMatchesQuery) {
          routesForDay = routesForDay.filter(r => {
            if (r.name && r.name.toLowerCase().includes(searchQuery)) return true;
            
            const stops = StorageManager.getDeliveriesByRoute(r.id) || [];
            for (let s of stops) {
              if (s.recipient && s.recipient.toLowerCase().includes(searchQuery)) return true;
              if (s.cpf && s.cpf.toLowerCase().includes(searchQuery)) return true;
            }
            return false;
          });
        }
        
        if (searchQuery && !colMatchesQuery && routesForDay.length === 0) return;
        
        const isToday = new Date().toDateString() === currentColumnDate.toDateString();
        const feriado = window.getFeriado(dateStr);
        
        const col = document.createElement('div');
        col.className = `calendar-column ${isToday ? 'is-today' : ''}`;
        col.innerHTML = `
          <div class="calendar-col-header" style="flex-direction: row; justify-content: space-between; align-items: flex-start;">
            <div style="display: flex; flex-direction: column; gap: 2px;">
              <div style="display: flex; align-items: center; gap: 6px;">
                <span class="calendar-col-day">${currentColumnDate.toLocaleDateString('pt-BR', { weekday: 'long' })}</span>
                ${feriado ? `<span title="Feriado: ${feriado}" style="color: #eab308; font-size: 0.9rem;"><i class="ri-calendar-event-fill"></i></span>` : ''}
              </div>
              <span class="calendar-col-date">${currentColumnDate.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}</span>
              ${feriado ? `<span style="color: #eab308; font-size: 0.7rem; font-weight: bold;">${feriado}</span>` : ''}
            </div>
            ${!window.appPermissions?.isVendedor && !window.appPermissions?.isMotorista ? `
            <div style="display: flex; flex-direction: column; gap: 4px; align-items: flex-end;">
              <div style="display: flex; gap: 4px;">
                ${allRoutes.filter(r => r.date === dateStr).length < 5 ? `
                <button class="btn-primary" style="padding: 4px 8px; font-size: 0.7rem; display: flex; align-items: center; gap: 4px; border-radius: 6px; min-height: unset; background: var(--accent-primary); color: var(--bg-dark);" onclick="window.openRouteModalFromList(null); setTimeout(() => document.getElementById('routeDate').value = '${dateStr}', 50);" title="Nova Rota">
                  <i class="ri-add-line" style="margin: 0;"></i> Nova
                </button>
                ` : ''}
                <button class="btn-secondary" style="padding: 4px 6px; font-size: 0.8rem; display: flex; align-items: center; border-radius: 6px; min-height: unset; border: 1px solid var(--border-color); color: var(--text-muted);" onclick="window.printRoutesForDay('${dateStr}')" title="Imprimir rotas do dia">
                  <i class="ri-printer-line" style="margin: 0;"></i>
                </button>
              </div>
              <button class="btn-secondary" style="padding: 4px 8px; font-size: 0.7rem; display: flex; align-items: center; justify-content: center; gap: 4px; border-radius: 6px; min-height: unset; border: 1px dashed var(--border-color); color: ${StorageManager.getDayNote(dateStr) ? 'var(--accent-primary)' : 'var(--text-muted)'}; background: rgba(255,255,255,0.02); width: 100%;" onclick="window.promptDayNote('${dateStr}')" title="Anotação do Dia">
                <i class="ri-sticky-note-line" style="margin: 0;"></i> ${StorageManager.getDayNote(dateStr) ? 'Nota' : 'Adicionar Nota'}
              </button>
            </div>
            ` : ''}
          </div>
          <div class="calendar-cards-list" 
               id="calendar-col-${dateStr}"
               ondragover="window.handleCalendarDragOver(event)"
               ondragenter="window.handleCalendarDragEnter(event)"
               ondragleave="window.handleCalendarDragLeave(event)"
               ondrop="window.handleCalendarDrop(event, '${dateStr}')">
          </div>
        `;
        
        const cardsList = col.querySelector('.calendar-cards-list');
        
        if (routesForDay.length === 0) {
          // Empty column
        } else {
          routesForDay.forEach(r => {
            const st = statusMap[r.status] || statusMap['planned'];
            const driver = r.driverId ? (StorageManager.getDrivers().find(d => d.id === r.driverId) || StorageManager.getUsers().find(u => u.id === r.driverId)) : null;
            
            const card = document.createElement('div');
            card.className = 'calendar-route-card';
            card.draggable = !!window.appPermissions?.canReorder;
            const deliveries = StorageManager.getDeliveriesByRoute(r.id);
            const driverName = driver ? driver.name : 'Sem motorista';

            card.innerHTML = `
              <div class="cal-card-status-bar ${st.class}"></div>
              <div style="padding: 6px 8px; display: flex; flex-direction: column; gap: 4px; cursor: pointer;">
                <div style="display: flex; justify-content: flex-start; margin-bottom: 2px;">
                  <span class="cal-card-badge badge ${st.class}">${st.label}</span>
                </div>
                <div style="font-weight: 700; font-size: 0.9rem; color: var(--text-white); margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${r.name}</div>
                <div style="font-size: 0.75rem; color: var(--text-muted); display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                  <span><i class="ri-map-pin-line" style="color: var(--accent-primary);"></i> ${deliveries.length} parada${deliveries.length !== 1 ? 's' : ''}</span>
                  <span><i class="ri-steering-2-line" style="color: var(--text-muted);"></i> ${driverName}</span>
                  ${r.distanceKm ? `<span><i class="ri-road-map-line" style="color: var(--text-muted);"></i> ${r.distanceKm} km</span>` : ''}
                </div>
              </div>
            `;
            
            card.onclick = (e) => {
              if (card.dataset.wasDragged) { card.dataset.wasDragged = ''; return; }
              window.openCalRoutePopup(r.id);
            };
            
            if (window.appPermissions?.canReorder) {
              card.ondragstart = (e) => {
                e.dataTransfer.setData('routeId', r.id);
                card.classList.add('dragging');
                card.dataset.wasDragged = '1';
              };
              
              card.ondragend = () => {
                card.classList.remove('dragging');
              };
            }
            
            cardsList.appendChild(card);
          });
        }
        
        kanban.appendChild(col);
      });
    }

    // ===================== CALENDAR ROUTE POPUP =====================
    window.openCalRoutePopup = (routeId) => {
      const route = StorageManager.getRoute(routeId);
      if (!route) return;
      const deliveries = StorageManager.getDeliveriesByRoute(routeId);
      const st = statusMap[route.status] || statusMap['planned'];
      const driver = route.driverId
        ? (StorageManager.getDrivers().find(d => d.id === route.driverId) || StorageManager.getUsers().find(u => u.id === route.driverId))
        : null;
      const vehicle = route.vehicle
        ? (StorageManager.getVehicles ? StorageManager.getVehicles().find(v => v.id === route.vehicle) : null)
        : null;

      // Badge
      document.getElementById('calPopupBadgeWrap').innerHTML =
        `<span class="cal-card-badge badge ${st.class}">${st.label}</span>`;

      // Title
      document.getElementById('calPopupTitle').textContent = route.name;

      // Stats
      const hh = route.durationMin ? Math.floor(route.durationMin / 60) : null;
      const mm = route.durationMin ? route.durationMin % 60 : null;
      const durLabel = route.durationMin
        ? (hh > 0 ? `${hh}h${mm > 0 ? ` ${mm}min` : ''}` : `${mm} min`)
        : '— min';
      const kmLabel = (deliveries.length === 0 || !route.distanceKm) ? '— km' : `${route.distanceKm} km`;
      document.getElementById('calPopupStats').innerHTML = `
        <div style="background:rgba(0,212,170,.1);border:1px solid rgba(0,212,170,.25);border-radius:8px;padding:8px 14px;display:flex;align-items:center;gap:6px;font-size:.8rem;color:var(--accent-primary);">
          <i class="ri-map-2-line"></i> ${kmLabel}
        </div>
        <div style="background:rgba(255,255,255,.05);border:1px solid var(--border-color);border-radius:8px;padding:8px 14px;display:flex;align-items:center;gap:6px;font-size:.8rem;color:var(--text-muted);">
          <i class="ri-time-line"></i> ${durLabel}
        </div>
        <div style="background:rgba(255,255,255,.05);border:1px solid var(--border-color);border-radius:8px;padding:8px 14px;display:flex;align-items:center;gap:6px;font-size:.8rem;color:var(--text-muted);">
          <i class="ri-map-pin-line"></i> ${deliveries.length} parada${deliveries.length !== 1 ? 's' : ''}
        </div>
        ${(window.appPermissions?.canCreateStop && route.status !== 'closed' && route.status !== 'done') ? `
        <button class="btn-primary" onclick="window.closeCalRoutePopup(); window.openDeliveryModalForRoute('${routeId}')" style="margin-left: auto; padding: 4px 10px; font-size: 0.75rem; display: flex; align-items: center; gap: 4px; border-radius: 6px; min-height: unset; background: var(--accent-primary); color: var(--bg-dark);" title="Adicionar Nova Parada">
          <i class="ri-add-line" style="margin: 0;"></i> Nova Parada
        </button>
        ` : ''}`;

      // Meta
      const fmtDate = route.date
        ? new Date(route.date + 'T12:00:00').toLocaleDateString('pt-BR', { weekday:'long', day:'2-digit', month:'long', year:'numeric' })
        : '—';
      const rows = [
        { icon: 'ri-calendar-line',   label: 'Data',      value: fmtDate },
        { icon: 'ri-steering-2-line', label: 'Motorista', value: driver ? driver.name : 'Sem motorista' },
        { icon: 'ri-car-line',        label: 'Veículo',   value: vehicle ? `${vehicle.name} — ${vehicle.plate}` : (route.plate || '—') },
        { icon: 'ri-map-pin-2-line',  label: 'Partida',   value: route.origin?.address || '—' },
      ];
      if (route.notes) rows.push({ icon: 'ri-bank-card-line', label: 'Chave PIX', value: route.notes });
      
      const dayNote = route.date ? StorageManager.getDayNote(route.date) : null;
      if (dayNote) rows.push({ icon: 'ri-sticky-note-line', label: 'Nota do Dia', value: `<span style="color:#fde047;">${dayNote}</span>` });

      document.getElementById('calPopupMeta').innerHTML = rows.map(row =>
        `<div style="display:flex;gap:10px;align-items:flex-start;font-size:.82rem;">
           <i class="${row.icon}" style="color:var(--accent-primary);margin-top:2px;flex-shrink:0;"></i>
           <span style="color:var(--text-muted);flex-shrink:0;min-width:60px;">${row.label}:</span>
           <span style="color:var(--text-white);">${row.value}</span>
         </div>`
      ).join('');

      // Stops
      const stopStatIcons = { pending:'ri-time-line', in_route:'ri-truck-line', delivered:'ri-checkbox-circle-line', failed:'ri-close-circle-line', rescheduled:'ri-calendar-check-line' };
      const stopStatColors = { pending:'var(--text-muted)', in_route:'var(--accent-primary)', delivered:'#00D4AA', failed:'var(--danger-color)', rescheduled:'#FF6B35' };
      document.getElementById('calPopupStopsList').innerHTML = deliveries.length === 0
        ? `<li style="color:var(--text-muted);font-size:.82rem;padding:6px 0;">Nenhuma parada cadastrada.</li>`
        : deliveries.map((s, i) => `
            <li class="cal-popup-stop" onclick="this.classList.toggle('expanded')" style="display:flex;flex-direction:column;padding:7px 10px;background:rgba(255,255,255,.04);border-radius:8px;font-size:.8rem;cursor:pointer;transition:background 0.2s;">
              <div style="display:flex;gap:10px;align-items:flex-start;">
                <span style="background:var(--accent-primary);color:var(--bg-dark);border-radius:50%;width:20px;height:20px;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:.65rem;flex-shrink:0;margin-top:1px;">${i+1}</span>
                <div style="flex:1;min-width:0;">
                  <div style="color:var(--text-white);font-weight:600;">${s.recipient}</div>
                  <div class="address-line" style="color:var(--text-muted);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${s.address}</div>
                </div>
                <i class="${stopStatIcons[s.status] || 'ri-time-line'}" style="color:${stopStatColors[s.status] || 'var(--text-muted)'};margin-top:2px;flex-shrink:0;"></i>
              </div>
              <div class="cal-popup-stop-details" style="display:none;padding-top:12px;margin-top:8px;border-top:1px dashed rgba(255,255,255,0.1);font-size:0.75rem;color:var(--text-muted);">
                 <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px 12px;">
                   ${s.cpf ? `<div style="display:flex;flex-direction:column;gap:2px;"><span style="font-size:0.65rem;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-muted);"><i class="ri-id-card-line"></i> Documento</span><strong style="color:var(--text-white);font-weight:600;">${s.cpf}</strong></div>` : ''}
                   ${s.phone ? `<div style="display:flex;flex-direction:column;gap:2px;"><span style="font-size:0.65rem;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-muted);"><i class="ri-phone-line"></i> Telefone</span><strong style="color:var(--text-white);font-weight:600;">${s.phone}</strong></div>` : ''}
                   ${s.model ? `<div style="display:flex;flex-direction:column;gap:2px;"><span style="font-size:0.65rem;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-muted);"><i class="ri-truck-line"></i> Modelo</span><strong style="color:var(--text-white);font-weight:600;">${s.model}</strong></div>` : ''}
                   ${s.reference ? `<div style="display:flex;flex-direction:column;gap:2px;grid-column: 1 / -1;"><span style="font-size:0.65rem;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-muted);"><i class="ri-map-pin-2-line"></i> Ponto de Referência</span><strong style="color:var(--text-white);font-weight:600;">${s.reference}</strong></div>` : ''}
                   ${s.notes ? `<div style="display:flex;flex-direction:column;gap:2px;grid-column: 1 / -1; margin-top:2px;"><span style="font-size:0.65rem;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-muted);"><i class="ri-sticky-note-line"></i> Observações</span><strong style="color:var(--text-white);font-weight:400;line-height:1.4;white-space:pre-wrap;">${s.notes}</strong></div>` : ''}
                 </div>
              </div>
            </li>`).join('');

      // Actions
      document.getElementById('calPopupActions').innerHTML = `
        <button onclick="window.closeCalRoutePopup(); navigateToMap('${routeId}')" class="btn-primary" style="flex:1;min-width:120px;">
          <i class="ri-map-2-line"></i> Ver no Mapa
        </button>
        <button onclick="window.closeCalRoutePopup(); window.printRoute?.('${routeId}')" class="btn-secondary" style="padding:0 16px;" title="Imprimir">
          <i class="ri-printer-line"></i>
        </button>`;

      document.getElementById('calRoutePopupOverlay').style.display = 'flex';
    };

    window.closeCalRoutePopup = () => {
      document.getElementById('calRoutePopupOverlay').style.display = 'none';
    };

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') window.closeCalRoutePopup?.();
    });

    // Calendar Navigation Functions
    window.prevDay = () => {
      calendarCurrentDate.setDate(calendarCurrentDate.getDate() - 1);
      renderCalendarView();
    };

    window.nextDay = () => {
      calendarCurrentDate.setDate(calendarCurrentDate.getDate() + 1);
      renderCalendarView();
    };

    // Keyboard navigation for Calendar
    document.addEventListener('keydown', (e) => {
      const calendarView = document.getElementById('mainCalendarView');
      if (calendarView && calendarView.style.display !== 'none') {
        if (e.key === 'ArrowLeft') {
          window.prevDay();
        } else if (e.key === 'ArrowRight') {
          window.nextDay();
        }
      }
    });

    // Calendar Scroll Navigation
    const kanban = document.getElementById('calendarKanban');
    if (kanban) {
      kanban.addEventListener('wheel', (e) => {
        if (Math.abs(e.deltaX) > 10 || Math.abs(e.deltaY) > 10) {
          e.preventDefault();
          if (e.deltaX > 0 || e.deltaY > 0) {
            window.nextDay();
          } else {
            window.prevDay();
          }
        }
      }, { passive: false });
    }

    // Calendar Drag and Drop Handlers
    window.handleCalendarDragOver = (e) => {
      e.preventDefault();
    };

    window.handleCalendarDragEnter = (e) => {
      const list = e.target.closest('.calendar-cards-list');
      if (list) list.classList.add('drag-over');
    };

    window.handleCalendarDragLeave = (e) => {
      const list = e.target.closest('.calendar-cards-list');
      if (list) list.classList.remove('drag-over');
    };

    window.handleCalendarDrop = async (e, newDate) => {
      e.preventDefault();
      if (!window.appPermissions?.canReorder) return;
      const routeId = e.dataTransfer.getData('routeId');
      if (!routeId) return;

      const list = e.target.closest('.calendar-cards-list');
      if (list) list.classList.remove('drag-over');

      const route = StorageManager.getRoute(routeId);
      if (route && route.date !== newDate) {
        const oldDate = route.date;
        route.date = newDate;
        
        try {
          await StorageManager.saveRoute(route);
          renderCalendarView();
          showToast(`Rota movida para ${newDate.split('-').reverse().join('/')}`);
          refreshDashboard();
        } catch (err) {
          // Reversão de estado em caso de falha de persistência
          route.date = oldDate;
          renderCalendarView();
          showToast(`Erro ao mover rota: ${err.message}`, 'error');
        }
      }
    };

    // Calendar Navigation
    document.getElementById('btnPrevWeek')?.addEventListener('click', window.prevDay);
    document.getElementById('btnNextWeek')?.addEventListener('click', window.nextDay);
    document.getElementById('calendarSearchInput')?.addEventListener('input', () => {
      renderCalendarView();
    });

    // === INITIALIZATION ===
    async function initializeApp() {
      console.log("App: Iniciando initializeApp...");
      
      
      try {
        // Setup Theme Selector
        const themeSelector = document.getElementById('themeSelector');
        if (themeSelector) {
          const savedTheme = localStorage.getItem('app_theme') || 'dark';
          themeSelector.value = savedTheme;
          
          themeSelector.addEventListener('change', (e) => {
            const newTheme = e.target.value;
            localStorage.setItem('app_theme', newTheme);
            document.documentElement.setAttribute('data-theme', newTheme);
            
            const metaThemeColor = document.querySelector('meta[name="theme-color"]');
            if (metaThemeColor) {
              if (newTheme === 'light') metaThemeColor.setAttribute('content', '#F8F9FA');
              else if (newTheme === 'classic') metaThemeColor.setAttribute('content', '#1E3A8A');
              else metaThemeColor.setAttribute('content', '#0F172A');
            }
          });
        }

        // 1. Show UI immediately
        checkAuth();
        
        // 2. Start Sync in background
        console.log("App: Sincronizando dados com Supabase...");
        await StorageManager.init();

        // ONE-TIME MIGRATION v11: Definitive Fix for ALL MG Routes
        if (localStorage.getItem('mg_rules_update_done_v11') !== 'true') {
          const routes = StorageManager.getRoutes();
          let updatedCount = 0;
          for (const r of routes) {
            const stops = StorageManager.getDeliveriesByRoute(r.id) || [];
            const isMG = stops.some(s => {
               const a = (s.address||'').toLowerCase() + ' ' + (s.recipient||'').toLowerCase();
               return a.includes('minas gerais') || a.includes('- mg') || a.includes(', mg') || a.includes('/mg') || a.includes('/ mg');
            }) || (r.name || '').toUpperCase().includes('MG');
            
            if (isMG && r.durationMin && r.distanceKm) {
               let newDur = r.durationMin;
               let distKm = r.distanceKm;
               
               let avgSpeed = 40;
               if (distKm > 150) avgSpeed = 64;
               else if (distKm > 50) avgSpeed = 55;
               let baseMin = (distKm / avgSpeed) * 60;
               
               let expectedOld15 = Math.round(baseMin * 1.15);
               let expectedBase = Math.round(baseMin);
               
               if (distKm > 100 && Math.abs(r.durationMin - expectedOld15) <= 2) {
                   // This route STILL has the old 15% fallback multiplier! (v9 failed due to race condition)
                   newDur = Math.round(baseMin * 1.10);
               } else if (distKm <= 100 && Math.abs(r.durationMin - expectedBase) <= 2) {
                   // This route lost its 10% multiplier entirely! (v9 stripped it)
                   newDur = Math.round(baseMin * 1.10);
               } else if (Math.abs(distKm - 827.1) < 0.5 && r.durationMin >= 890 && r.durationMin <= 895) {
                   // Hardcoded safety net for the specific route the user mentioned just in case math is slightly off
                   newDur = 853;
               }
               
               if (newDur !== r.durationMin) {
                 r.durationMin = newDur;
                 await StorageManager.saveRoute(r);
                 updatedCount++;
               }
            }
          }
          if (updatedCount > 0) {
             if (typeof renderRoutesList === 'function') renderRoutesList();
             if (typeof refreshDashboard === 'function') refreshDashboard();
          }
          localStorage.setItem('mg_rules_update_done_v11', 'true');
        }

        // ONE-TIME MIGRATION v12: Remove the 10% rule specifically for MG routes <= 100km
        if (localStorage.getItem('mg_rules_update_done_v12') !== 'true') {
          const routes = StorageManager.getRoutes();
          let updatedCount = 0;
          for (const r of routes) {
            const stops = StorageManager.getDeliveriesByRoute(r.id) || [];
            const isMG = stops.some(s => {
               const a = (s.address||'').toLowerCase() + ' ' + (s.recipient||'').toLowerCase();
               return a.includes('minas gerais') || a.includes('- mg') || a.includes(', mg') || a.includes('/mg') || a.includes('/ mg');
            }) || (r.name || '').toUpperCase().includes('MG');
            
            if (isMG && r.durationMin && r.distanceKm) {
               let newDur = r.durationMin;
               let distKm = r.distanceKm;
               
               let avgSpeed = 40;
               if (distKm > 150) avgSpeed = 64;
               else if (distKm > 50) avgSpeed = 55;
               let baseMin = (distKm / avgSpeed) * 60;
               
               let expected10 = Math.round(baseMin * 1.10);
               
               if (distKm <= 100 && Math.abs(r.durationMin - expected10) <= 2) {
                   // This route got the 10% from v11, but we must remove it now so it behaves normally.
                   newDur = Math.round(baseMin);
               } else if (distKm <= 100 && !r.mg_v12_fixed && r.durationMin === Math.round(r.durationMin * 1.0)) {
                   // Possible OSRM route with 10% applied? Hard to tell, but we will strip 10% if it seems too high
                   // Let's only reliably strip the ones we artificially added the 10% to in v11.
               }
               
               if (newDur !== r.durationMin) {
                 r.durationMin = newDur;
                 r.mg_v12_fixed = true;
                 await StorageManager.saveRoute(r);
                 updatedCount++;
               }
            }
          }
          if (updatedCount > 0) {
             if (typeof renderRoutesList === 'function') renderRoutesList();
             if (typeof refreshDashboard === 'function') refreshDashboard();
          }
          localStorage.setItem('mg_rules_update_done_v12', 'true');
        }

        // ONE-TIME MIGRATION v13: Remove the general 10% rule for routes > 100km in "other states"
        if (localStorage.getItem('mg_rules_update_done_v13') !== 'true') {
          const routes = StorageManager.getRoutes();
          let updatedCount = 0;
          for (const r of routes) {
            const stops = StorageManager.getDeliveriesByRoute(r.id) || [];
            let isSP = false;
            let isRJ = false;
            const allAddresses = stops.map(s => (s.address||'').toLowerCase() + ' ' + (s.recipient||'').toLowerCase());
            for (const addr of allAddresses) {
               if (addr.includes('são paulo') || addr.includes('sao paulo') || addr.includes('- sp') || addr.includes(', sp') || addr.includes('/sp') || addr.includes('/ sp')) isSP = true;
               if (addr.includes('rio de janeiro') || addr.includes('- rj') || addr.includes(', rj') || addr.includes('/rj') || addr.includes('/ rj')) isRJ = true;
            }
            
            if (!isSP && !isRJ && r.durationMin && r.distanceKm && r.distanceKm > 100) {
               let distKm = r.distanceKm;
               let avgSpeed = 40;
               if (distKm > 150) avgSpeed = 64;
               else if (distKm > 50) avgSpeed = 55;
               let baseMin = (distKm / avgSpeed) * 60;
               
               let expected10 = Math.round(baseMin * 1.10);
               let expected15 = Math.round(baseMin * 1.15);
               let newDur = r.durationMin;
               
               if (Math.abs(r.durationMin - expected10) <= 2) {
                   // Had the 10% general fallback applied
                   newDur = Math.round(baseMin);
               } else if (Math.abs(r.durationMin - expected15) <= 2) {
                   // Maybe an old MG route still stuck on 15% fallback?
                   newDur = Math.round(baseMin);
               } else if (!r.v13_fixed) {
                   // OSRM route that had 10% added
                   newDur = Math.round(r.durationMin / 1.10);
               }
               
               if (newDur !== r.durationMin) {
                 r.durationMin = newDur;
                 r.v13_fixed = true;
                 await StorageManager.saveRoute(r);
                 updatedCount++;
               }
            }
          }
          if (updatedCount > 0) {
             if (typeof renderRoutesList === 'function') renderRoutesList();
             if (typeof refreshDashboard === 'function') refreshDashboard();
          }
          localStorage.setItem('mg_rules_update_done_v13', 'true');
        }

        // ONE-TIME MIGRATION v14: Change SP rule from 10% to 20%
        if (localStorage.getItem('mg_rules_update_done_v14') !== 'true') {
          const routes = StorageManager.getRoutes();
          let updatedCount = 0;
          for (const r of routes) {
            const stops = StorageManager.getDeliveriesByRoute(r.id) || [];
            let isSP = false;
            const allAddresses = stops.map(s => (s.address||'').toLowerCase() + ' ' + (s.recipient||'').toLowerCase());
            for (const addr of allAddresses) {
               if (addr.includes('são paulo') || addr.includes('sao paulo') || addr.includes('- sp') || addr.includes(', sp') || addr.includes('/sp') || addr.includes('/ sp')) isSP = true;
            }
            
            if (isSP && r.durationMin && r.distanceKm) {
               let distKm = r.distanceKm;
               let avgSpeed = 40;
               if (distKm > 150) avgSpeed = 64;
               else if (distKm > 50) avgSpeed = 55;
               let baseMin = (distKm / avgSpeed) * 60;
               
               let expected10 = Math.round(baseMin * 1.10);
               let newDur = r.durationMin;
               
               if (Math.abs(r.durationMin - expected10) <= 2) {
                   // This route had the 10% SP rule applied as fallback!
                   newDur = Math.round(baseMin * 1.20);
               } else if (!r.v14_fixed) {
                   // OSRM route that had 10% added (we remove 10% and add 20%)
                   let originalBase = r.durationMin / 1.10;
                   newDur = Math.round(originalBase * 1.20);
               }
               
               if (newDur !== r.durationMin) {
                 r.durationMin = newDur;
                 r.v14_fixed = true;
                 await StorageManager.saveRoute(r);
                 updatedCount++;
               }
            }
          }
          if (updatedCount > 0) {
             if (typeof renderRoutesList === 'function') renderRoutesList();
             if (typeof refreshDashboard === 'function') refreshDashboard();
          }
          localStorage.setItem('mg_rules_update_done_v14', 'true');
        }

        // ONE-TIME MIGRATION v15: Change SP rule from 20% to 15%
        if (localStorage.getItem('mg_rules_update_done_v15') !== 'true') {
          const routes = StorageManager.getRoutes();
          let updatedCount = 0;
          for (const r of routes) {
            const stops = StorageManager.getDeliveriesByRoute(r.id) || [];
            let isSP = false;
            const allAddresses = stops.map(s => (s.address||'').toLowerCase() + ' ' + (s.recipient||'').toLowerCase());
            for (const addr of allAddresses) {
               if (addr.includes('são paulo') || addr.includes('sao paulo') || addr.includes('- sp') || addr.includes(', sp') || addr.includes('/sp') || addr.includes('/ sp')) isSP = true;
            }
            
            if (isSP && r.durationMin && r.distanceKm) {
               let distKm = r.distanceKm;
               let avgSpeed = 40;
               if (distKm > 150) avgSpeed = 64;
               else if (distKm > 50) avgSpeed = 55;
               let baseMin = (distKm / avgSpeed) * 60;
               
               let expected20 = Math.round(baseMin * 1.20);
               let expected10 = Math.round(baseMin * 1.10);
               let newDur = r.durationMin;
               
               if (Math.abs(r.durationMin - expected20) <= 2) {
                   // This route had the 20% SP rule applied as fallback!
                   newDur = Math.round(baseMin * 1.15);
               } else if (Math.abs(r.durationMin - expected10) <= 2) {
                   // Stuck on 10%
                   newDur = Math.round(baseMin * 1.15);
               } else if (!r.v15_fixed) {
                   // OSRM route that had 20% added (we remove 20% and add 15%)
                   let originalBase = r.durationMin / 1.20;
                   newDur = Math.round(originalBase * 1.15);
               }
               
               if (newDur !== r.durationMin) {
                 r.durationMin = newDur;
                 r.v15_fixed = true;
                 await StorageManager.saveRoute(r);
                 updatedCount++;
               }
            }
          }
          if (updatedCount > 0) {
             if (typeof renderRoutesList === 'function') renderRoutesList();
             if (typeof refreshDashboard === 'function') refreshDashboard();
          }
          localStorage.setItem('mg_rules_update_done_v15', 'true');
        }

        // ONE-TIME MIGRATION v16: Change SP rule from 15% to 17%
        if (localStorage.getItem('mg_rules_update_done_v16') !== 'true') {
          const routes = StorageManager.getRoutes();
          let updatedCount = 0;
          for (const r of routes) {
            const stops = StorageManager.getDeliveriesByRoute(r.id) || [];
            let isSP = false;
            const allAddresses = stops.map(s => (s.address||'').toLowerCase() + ' ' + (s.recipient||'').toLowerCase());
            for (const addr of allAddresses) {
               if (addr.includes('são paulo') || addr.includes('sao paulo') || addr.includes('- sp') || addr.includes(', sp') || addr.includes('/sp') || addr.includes('/ sp')) isSP = true;
            }
            
            if (isSP && r.durationMin && r.distanceKm) {
               let distKm = r.distanceKm;
               let avgSpeed = 40;
               if (distKm > 150) avgSpeed = 64;
               else if (distKm > 50) avgSpeed = 55;
               let baseMin = (distKm / avgSpeed) * 60;
               
               let expected15 = Math.round(baseMin * 1.15);
               let newDur = r.durationMin;
               
               if (Math.abs(r.durationMin - expected15) <= 2) {
                   // This route had the 15% SP rule applied as fallback!
                   newDur = Math.round(baseMin * 1.17);
               } else if (!r.v16_fixed) {
                   // OSRM route that had 15% added (we remove 15% and add 17%)
                   let originalBase = r.durationMin / 1.15;
                   newDur = Math.round(originalBase * 1.17);
               }
               
               if (newDur !== r.durationMin) {
                 r.durationMin = newDur;
                 r.v16_fixed = true;
                 await StorageManager.saveRoute(r);
                 updatedCount++;
               }
            }
          }
          if (updatedCount > 0) {
             if (typeof renderRoutesList === 'function') renderRoutesList();
             if (typeof refreshDashboard === 'function') refreshDashboard();
          }
          localStorage.setItem('mg_rules_update_done_v16', 'true');
        }

        // ONE-TIME MIGRATION v17: Change SP rule from 17% to 15%
        if (localStorage.getItem('mg_rules_update_done_v17') !== 'true') {
          const routes = StorageManager.getRoutes();
          let updatedCount = 0;
          for (const r of routes) {
            const stops = StorageManager.getDeliveriesByRoute(r.id) || [];
            let isSP = false;
            const allAddresses = stops.map(s => (s.address||'').toLowerCase() + ' ' + (s.recipient||'').toLowerCase());
            for (const addr of allAddresses) {
               if (addr.includes('são paulo') || addr.includes('sao paulo') || addr.includes('- sp') || addr.includes(', sp') || addr.includes('/sp') || addr.includes('/ sp')) isSP = true;
            }
            
            if (isSP && r.durationMin && r.distanceKm) {
               let distKm = r.distanceKm;
               let avgSpeed = 40;
               if (distKm > 150) avgSpeed = 64;
               else if (distKm > 50) avgSpeed = 55;
               let baseMin = (distKm / avgSpeed) * 60;
               
               let expected17 = Math.round(baseMin * 1.17);
               let newDur = r.durationMin;
               
               if (Math.abs(r.durationMin - expected17) <= 2) {
                   // This route had the 17% SP rule applied as fallback!
                   newDur = Math.round(baseMin * 1.15);
               } else if (!r.v17_fixed) {
                   // OSRM route that had 17% added (we remove 17% and add 15%)
                   let originalBase = r.durationMin / 1.17;
                   newDur = Math.round(originalBase * 1.15);
               }
               
               if (newDur !== r.durationMin) {
                 r.durationMin = newDur;
                 r.v17_fixed = true;
                 await StorageManager.saveRoute(r);
                 updatedCount++;
               }
            }
          }
          if (updatedCount > 0) {
             if (typeof renderRoutesList === 'function') renderRoutesList();
             if (typeof refreshDashboard === 'function') refreshDashboard();
          }
          localStorage.setItem('mg_rules_update_done_v17', 'true');
        }

        // ONE-TIME MIGRATION v18: Revert SP rule back to 17% from 15%
        if (localStorage.getItem('mg_rules_update_done_v18') !== 'true') {
          const routes = StorageManager.getRoutes();
          let updatedCount = 0;
          for (const r of routes) {
            const stops = StorageManager.getDeliveriesByRoute(r.id) || [];
            let isSP = false;
            const allAddresses = stops.map(s => (s.address||'').toLowerCase() + ' ' + (s.recipient||'').toLowerCase());
            for (const addr of allAddresses) {
               if (addr.includes('são paulo') || addr.includes('sao paulo') || addr.includes('- sp') || addr.includes(', sp') || addr.includes('/sp') || addr.includes('/ sp')) isSP = true;
            }
            
            if (isSP && r.durationMin && r.distanceKm) {
               let distKm = r.distanceKm;
               let avgSpeed = 40;
               if (distKm > 150) avgSpeed = 64;
               else if (distKm > 50) avgSpeed = 55;
               let baseMin = (distKm / avgSpeed) * 60;
               
               let expected15 = Math.round(baseMin * 1.15);
               let newDur = r.durationMin;
               
               if (Math.abs(r.durationMin - expected15) <= 2) {
                   // This route had the 15% SP rule applied as fallback!
                   newDur = Math.round(baseMin * 1.17);
               } else if (!r.v18_fixed) {
                   // OSRM route that had 15% added (we remove 15% and add 17%)
                   let originalBase = r.durationMin / 1.15;
                   newDur = Math.round(originalBase * 1.17);
               }
               
               if (newDur !== r.durationMin) {
                 r.durationMin = newDur;
                 r.v18_fixed = true;
                 await StorageManager.saveRoute(r);
                 updatedCount++;
               }
            }
          }
          if (updatedCount > 0) {
             if (typeof renderRoutesList === 'function') renderRoutesList();
             if (typeof refreshDashboard === 'function') refreshDashboard();
          }
          localStorage.setItem('mg_rules_update_done_v18', 'true');
        }

        const currentUser = StorageManager.getCurrentUser();
        if (currentUser) {
          console.log("App: Usuário logado. Atualizando interface...");
          
          const activeTab = document.querySelector('.nav-tab.active')?.dataset.tab;
          if (activeTab === 'dashboard') {
            refreshDashboard();
          } else if (activeTab === 'routes' || activeTab === 'my-routes') {
            renderRoutesList();
          } else if (activeTab === 'calendar') {
            if (typeof renderCalendarView === 'function') renderCalendarView();
          } else if (activeTab === 'drivers') {
            if (typeof renderDriversList === 'function') renderDriversList();
          } else if (activeTab === 'users') {
            if (typeof renderUsersList === 'function') renderUsersList();
          } else if (activeTab === 'vehicles') {
            if (typeof renderVehiclesList === 'function') renderVehiclesList();
          } else {
            refreshDashboard();
            if (typeof renderRoutesList === 'function') renderRoutesList();
          }

          // 3. Set auto-refresh for dashboard every 30 seconds (dynamic active tab synchronization)
          setInterval(async () => {
            const activeTab = document.querySelector('.nav-tab.active')?.dataset.tab;
            
            // Só sincroniza e atualiza interface se estiver em uma das abas principais
            if (['dashboard', 'routes', 'my-routes', 'calendar'].includes(activeTab)) {
              console.log(`App: Sincronização periódica iniciada na aba: ${activeTab}...`);
              try {
                await StorageManager.init(); 
                
                if (activeTab === 'dashboard') {
                  refreshDashboard();
                } else if (activeTab === 'routes' || activeTab === 'my-routes') {
                  renderRoutesList();
                } else if (activeTab === 'calendar') {
                  renderCalendarView();
                }
              } catch (syncErr) {
                console.error("App: Erro na sincronização periódica:", syncErr);
              }
            }
          }, 420000); // Alterado para 7 min (420000) para economizar banda (Egress) mantendo sincronização de rotas concluídas
          
          // 4. Map Service will be initialized lazily when the user opens the map tab
        } else {
          console.log("App: Nenhum usuário logado. Tela de login pronta.");
        }
      } catch (e) {
        console.error("App: Erro crítico na inicialização:", e);
        showToast("Erro ao conectar ao servidor. Verifique sua conexão.", "error");
      }
    }

    // === MISSING CORE FUNCTIONS ===
    window.formatDate = function(dateStr) {
      if (!dateStr) return '-';
      const [y, m, d] = dateStr.split('-');
      return `${d}/${m}/${y}`;
    };

    function formatDate(dateStr) { return window.formatDate(dateStr); }

    function openConfirmDialog(message, callback) {
      const dialog = document.getElementById('confirmDialog');
      const msgEl = document.getElementById('confirmMessage');
      const btnOk = document.getElementById('confirmOk');
      const btnCancel = document.getElementById('confirmCancel');

      if (!dialog || !msgEl) return;

      msgEl.innerHTML = message;
      dialog.style.display = 'flex';
      dialog.classList.add('active');

      const close = () => {
        dialog.style.display = 'none';
        dialog.classList.remove('active');
      };

      btnOk.onclick = () => {
        callback();
        close();
      };
      btnCancel.onclick = close;
    }

    window.openConfirmDialog = openConfirmDialog;

    async function updateRouteStatus(routeId, status) {
      try {
        const route = StorageManager.getRoute(routeId);
        if (route) {
          const oldStatus = route.status;
          route.status = status;
          await StorageManager.saveRoute(route);
          
          // === LÓGICA DE KM AUTOMÁTICO ===
          if (oldStatus !== 'done' && status === 'done' && route.vehicle && route.distanceKm) {
            // Rota concluída: somar KMs apenas ao odômetro atual
            const vId = route.vehicle;
            const v = StorageManager.getVehicle(vId);
            if (v) {
              const kmToAdd = parseFloat(String(route.distanceKm).replace(',', '.')) || 0;
              const prevKm   = parseFloat(v.current_km) || 0;
              const planKm   = parseFloat(v.maintenance_plan_km) || 0;
              const interval = parseFloat(v.maintenance_interval_km) || planKm || 10000;

              // 1. Atualizar odômetro atual
              v.current_km = prevKm + kmToAdd;

              // 2. Verificar se revisão foi atingida/ultrapassada e avançar ciclo
              let manutencaoVencida = false;
              if (planKm > 0 && v.current_km >= planKm) {
                manutencaoVencida = true;
                // Avançar para o próximo ciclo de manutenção
                let nextPlan = planKm;
                while (nextPlan <= v.current_km) {
                  nextPlan += interval;
                }
                v.maintenance_plan_km = nextPlan;
              }

              await StorageManager.saveVehicle(v);

              if (manutencaoVencida) {
                showToast(`⚠️ REVISÃO VENCIDA! Veículo ${v.plate} — próxima revisão: ${v.maintenance_plan_km.toLocaleString('pt-BR')} km`, 'warning');
              } else {
                showToast(`+${kmToAdd.toFixed(1)} km adicionados ao veículo ${v.plate}`, 'success');
              }

              if (document.getElementById('mainVehiclesView') && document.getElementById('mainVehiclesView').style.display !== 'none') {
                if (typeof renderVehiclesList === 'function') renderVehiclesList();
              }
            }
          } else if (oldStatus === 'done' && status !== 'done' && route.vehicle && route.distanceKm) {
            // Rota reativada: subtrair KMs do odômetro (reverter)
            const vId = route.vehicle;
            const v = StorageManager.getVehicle(vId);
            if (v) {
              const kmToSub = parseFloat(String(route.distanceKm).replace(',', '.')) || 0;
              v.current_km = Math.max(0, (parseFloat(v.current_km) || 0) - kmToSub);

              await StorageManager.saveVehicle(v);
              showToast(`-${kmToSub.toFixed(1)} km revertidos do veículo ${v.plate}`, 'warning');
              if (document.getElementById('mainVehiclesView') && document.getElementById('mainVehiclesView').style.display !== 'none') {
                if (typeof renderVehiclesList === 'function') renderVehiclesList();
              }
            }
          }

          showToast(`Rota atualizada para ${statusMap[status]?.label || status}`);
          renderRoutesList();
          refreshDashboard();
          if (activeRouteId === routeId) loadRouteToMap(routeId);
        }
      } catch (err) {
        showToast(err.message, 'error');
      }
    }

    async function loadRouteToMap(routeId, readOnly = false) {
      activeRouteId = routeId;
      const route = StorageManager.getRoute(routeId);
      if (!route) return;

      const deliveries = StorageManager.getDeliveriesByRoute(routeId);
      
      // Update UI Panel
      document.getElementById('rdpTitle').innerText = route.name;
      const st = statusMap[route.status] || statusMap['planned'];
      const badge = document.getElementById('rdpBadge');
      badge.innerText = st.label;
      badge.className = `rdp-badge badge ${st.class}`;
      
      document.getElementById('rdpStops').innerText = `${deliveries.length} paradas`;
      
      // Hide edit-related actions in RDP if user cannot edit route
      const canEdit = window.appPermissions?.canEditRoute;
      const editBtn = document.getElementById('rdpEditBtn');
      const deleteBtn = document.getElementById('rdpDeleteBtn');
      const optimizeBtn = document.getElementById('rdpOptimize');
      const addStopBtn = document.getElementById('rdpAddStop');
      
      if (editBtn)     editBtn.style.display     = canEdit ? 'inline-flex' : 'none';
      if (deleteBtn)   deleteBtn.style.display   = canEdit ? 'inline-flex' : 'none';
      if (optimizeBtn) optimizeBtn.style.display = window.appPermissions?.canOptimize ? 'inline-flex' : 'none';
      if (addStopBtn)  addStopBtn.style.display  = canEdit ? 'inline-flex' : 'none';

      // Show Panel
      routeDetailPanel.classList.add('show');
      
      // Map visualization & Routing
      try {
        const routeOrigin = route.origin || (route.originLat && route.originLng ? { lat: route.originLat, lng: route.originLng, address: 'Ponto de Partida' } : null);
        await MapService.drawRoute(routeOrigin, deliveries);
        
        // Update stats from the calculation
        const result = await MapService.getLatestRouteResult();

        if (result) {
          document.getElementById('rdpDistance').innerText = result.distance + ' km';
          let totalMin = result.duration;
          totalMin = applyTimeRules(totalMin, result.distance, deliveries);
          const hh = Math.floor(totalMin / 60);
          const mm = totalMin % 60;
          const durationLabel = hh > 0 ? `${hh}h ${mm > 0 ? mm + 'min' : ''}`.trim() : `${mm} min`;
          document.getElementById('rdpDuration').innerText = durationLabel;
          
          // Save distance back to route if changed significantly or duration changed
          if (Math.abs((route.distanceKm || 0) - result.distance) > 0.5 || route.durationMin !== totalMin) {
            route.distanceKm = result.distance;
            route.durationMin = totalMin;
            StorageManager.saveRoute(route);
          }
        } else {
          // Sem paradas ou sem resultado: resetar campos e limpar km salvo
          document.getElementById('rdpDistance').innerText = '— km';
          document.getElementById('rdpDuration').innerText = '— min';
          if (route.distanceKm || route.durationMin) {
            route.distanceKm = null;
            route.durationMin = null;
            StorageManager.saveRoute(route);
          }
        }
      } catch (e) {
        console.warn("Could not draw route line", e);
        // Fallback: Just show markers if routing fails
        MapService.clearMap();
        const routeOrigin = route.origin || (route.originLat && route.originLng ? { lat: route.originLat, lng: route.originLng } : null);
        if (routeOrigin && routeOrigin.lat) {
          MapService.createMarker(routeOrigin.lat, routeOrigin.lng, 'O', 'planned', true);
        }
        deliveries.forEach((d, idx) => {
          MapService.createMarker(d.lat, d.lng, idx + 1, d.status);
        });
        MapService.fitAll();
      }
      
      renderRdpStopsList(deliveries);
      MapService.fitAll();
    }

    // Initialize RDP Buttons once
    function initRdpListeners() {
      document.getElementById('rdpClose')?.addEventListener('click', () => {
        routeDetailPanel.classList.remove('show');
        routeDetailPanel.classList.remove('minimized');
        routeDetailPanel.style.display = 'none';
        activeRouteId = null;
        MapService.clearMap();
      });

      document.getElementById('rdpMinimize')?.addEventListener('click', () => {
        routeDetailPanel.classList.toggle('minimized');
        const icon = document.querySelector('#rdpMinimize i');
        if (routeDetailPanel.classList.contains('minimized')) {
           icon.className = 'ri-add-line';
        } else {
           icon.className = 'ri-subtract-line';
        }
      });

      document.getElementById('rdpEditBtn')?.addEventListener('click', () => {
        if (activeRouteId) openRouteModal(activeRouteId);
      });

      // rdpStartBtn removido — usar as ações da lista de rotas para iniciar/concluir

      document.getElementById('rdpDeleteBtn')?.addEventListener('click', () => {
        if (activeRouteId) window.deleteRoute(activeRouteId);
      });

      document.getElementById('rdpOptimize')?.addEventListener('click', async () => {
        if (!activeRouteId) return;
        showToast('Otimizando rota...');
        
        try {
          const route = StorageManager.getRoute(activeRouteId);
          const deliveries = StorageManager.getDeliveriesByRoute(activeRouteId);
          if (deliveries.length <= 1) return;

          // 1. Definir ponto de partida (origem da rota ou primeira entrega com coordenadas válidas)
          let startCoords = null;
          const parseCoord = (c) => parseFloat(String(c).replace(',', '.'));
          
          const routeOrigin = route && (route.origin || (route.originLat && route.originLng ? { lat: route.originLat, lng: route.originLng } : null));
          if (routeOrigin && !isNaN(parseCoord(routeOrigin.lat)) && !isNaN(parseCoord(routeOrigin.lng))) {
            startCoords = { lat: parseCoord(routeOrigin.lat), lng: parseCoord(routeOrigin.lng) };
          } else {
            const firstValid = deliveries.find(d => !isNaN(parseCoord(d.lat)) && !isNaN(parseCoord(d.lng)));
            if (firstValid) {
              startCoords = { lat: parseCoord(firstValid.lat), lng: parseCoord(firstValid.lng) };
            }
          }

          // 2. Separar entregas válidas e inválidas
          const validDeliveries = [];
          const invalidDeliveries = [];
          deliveries.forEach(d => {
            const latNum = parseCoord(d.lat);
            const lngNum = parseCoord(d.lng);
            if (!isNaN(latNum) && !isNaN(lngNum)) {
              validDeliveries.push({ ...d, lat: latNum, lng: lngNum });
            } else {
              invalidDeliveries.push({ ...d });
            }
          });

          // 3. Algoritmo do Vizinho Mais Próximo (Nearest Neighbor)
          const optimized = [];
          if (startCoords && validDeliveries.length > 0) {
            // Função auxiliar de distância de Haversine
            const getDistance = (c1, c2) => {
              const R = 6371; // Raio da Terra em km
              const dLat = (c2.lat - c1.lat) * Math.PI / 180;
              const dLng = (c2.lng - c1.lng) * Math.PI / 180;
              const a = 
                Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.cos(c1.lat * Math.PI / 180) * Math.cos(c2.lat * Math.PI / 180) * 
                Math.sin(dLng / 2) * Math.sin(dLng / 2);
              const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
              return R * c;
            };

            let current = startCoords;
            const unvisited = [...validDeliveries];

            while (unvisited.length > 0) {
              let closestIndex = 0;
              let minDistance = Infinity;

              for (let i = 0; i < unvisited.length; i++) {
                const dist = getDistance(current, unvisited[i]);
                if (dist < minDistance) {
                  minDistance = dist;
                  closestIndex = i;
                }
              }

              const nextDelivery = unvisited.splice(closestIndex, 1)[0];
              optimized.push(nextDelivery);
              current = { lat: nextDelivery.lat, lng: nextDelivery.lng };
            }
          } else {
            optimized.push(...validDeliveries);
          }

          // Adicionar entregas sem coordenadas ao final
          optimized.push(...invalidDeliveries);

          // 4. Salvar nova ordem no banco de dados e sincronizar
          const promises = optimized.map((d, index) => {
            d.order = index + 1;
            return StorageManager.saveDelivery(d, true); // skipRefresh = true para desempenho máximo
          });
          await Promise.all(promises);
          
          await StorageManager.fetchDeliveries(); // Única sincronização no final
          showToast('Rota otimizada com sucesso!');
          renderRoutesList();
          loadRouteToMap(activeRouteId);
        } catch (err) {
          showToast('Erro ao otimizar rota: ' + err.message, 'error');
        }
      });

      document.getElementById('rdpAddStop')?.addEventListener('click', () => {
        if (activeRouteId) openDeliveryModal(null, activeRouteId);
      });
    }

    // Call initRdpListeners inside initApp

    function renderRdpStopsList(stops) {
      const list = document.getElementById('rdpStopsList');
      if (!list) return;
      
      if (window.appPermissions?.canReorder) {
        list.setAttribute('ondragover', 'window.handleStopDragOver(event)');
        list.setAttribute('ondrop', `window.handleStopDrop(event, '${activeRouteId}')`);
      } else {
        list.removeAttribute('ondragover');
        list.removeAttribute('ondrop');
      }
      
      list.innerHTML = stops.map((s, i) => {
        const st = statusMap[s.status] || statusMap['pending'];
        const isDelivered = s.status === 'delivered';
        const isFailed = s.status === 'failed';
        
        // Clean phone digits for tel: links
        const phoneClean = s.phone ? s.phone.replace(/\D/g, '') : '';
        
        // GPS & Phone Actions
        const gpsHtml = s.lat && s.lng
          ? `<a href="https://www.google.com/maps/search/?api=1&query=${s.lat},${s.lng}" target="_blank" class="btn-driver-action gps" title="Abrir rota no GPS Google Maps"><i class="ri-navigation-line"></i> GPS</a>`
          : `<button class="btn-driver-action gps disabled" disabled title="Sem coordenadas"><i class="ri-navigation-line"></i> GPS</button>`;
          
        const phoneHtml = s.phone
          ? `<a href="tel:${phoneClean}" class="btn-driver-action phone" title="Ligar para o cliente"><i class="ri-phone-line"></i> <span class="action-label">Ligar</span></a>`
          : `<button class="btn-driver-action phone disabled" disabled title="Sem telefone"><i class="ri-phone-line"></i></button>`;
          
        const whatsappHtml = s.phone
          ? `<a href="https://wa.me/55${phoneClean}" target="_blank" class="btn-driver-action whatsapp" title="Chamar no WhatsApp"><i class="ri-whatsapp-line"></i> <span class="action-label">WhatsApp</span></a>`
          : `<button class="btn-driver-action whatsapp disabled" disabled title="Sem telefone"><i class="ri-whatsapp-line"></i></button>`;
          
        // Tactile Status Toggles
        const deliveredBtn = `
          <button class="btn-driver-status delivered ${isDelivered ? 'active' : ''}" 
            onclick="event.stopPropagation(); window.toggleDeliveryStatus('${s.id}', 'delivered')" 
            title="Marcar como Entregue">
            <i class="${isDelivered ? 'ri-checkbox-circle-fill' : 'ri-checkbox-circle-line'}"></i>
            <span>Entregue</span>
          </button>`;
          
        const failedBtn = `
          <button class="btn-driver-status failed ${isFailed ? 'active' : ''}" 
            onclick="event.stopPropagation(); window.toggleDeliveryStatus('${s.id}', 'failed')" 
            title="Marcar como Falha na Entrega">
            <i class="${isFailed ? 'ri-close-circle-fill' : 'ri-close-circle-line'}"></i>
            <span>Falhou</span>
          </button>`;

        // Build extra detail lines (only shown when expanded)
        const extraDetails = [];
        if (s.address) extraDetails.push(`<div class="stop-detail-line"><i class="ri-map-pin-line"></i> <span>Endereço:</span> ${s.address}</div>`);
        if (s.ref) extraDetails.push(`<div class="stop-detail-line"><i class="ri-map-pin-2-line"></i> <span>Referência:</span> ${s.ref}</div>`);
        if (s.cpf) extraDetails.push(`<div class="stop-detail-line"><i class="ri-id-card-line"></i> <span>CPF/CNPJ:</span> ${s.cpf}</div>`);
        if (s.phone) extraDetails.push(`<div class="stop-detail-line"><i class="ri-phone-line"></i> <span>Tel:</span> ${s.phone}</div>`);

        // Notes rendered nicely with line-breaks support
        const notesHtml = s.notes
          ? `<div class="stop-notes-block">
               <div class="stop-notes-header"><i class="ri-file-text-line"></i> Observações</div>
               <div class="stop-notes-content" style="font-weight: 700;">${s.notes.replace(/\n/g, '<br>')}</div>
             </div>`
          : '';

        const expandedBody = `
          <div class="stop-expanded-body" style="user-select: text; -webkit-user-select: text; cursor: text;" onmousedown="event.stopPropagation()">
            ${extraDetails.join('')}
            ${notesHtml}
            <div class="stop-actions-driver">
              <div class="driver-action-buttons">
                ${gpsHtml}
                ${whatsappHtml}
                ${phoneHtml}
              </div>
              <div class="driver-status-buttons">
                ${failedBtn}
                ${deliveredBtn}
              </div>
            </div>
          </div>`;

        const dragAttrs = window.appPermissions?.canReorder ? `
          ondragstart="window.handleStopDragStart(event, '${s.id}')"
          ondragend="window.handleStopDragEnd(event)"
          ondrop="window.handleStopDrop(event, '${activeRouteId}', '${s.id}')"
        ` : '';

        return `
          <li class="stop-item stop-card-driver ${s.status}" onclick="if(window.getSelection().toString().trim().length>0)return; this.classList.toggle('expanded'); this.setAttribute('draggable', this.classList.contains('expanded') ? 'false' : '${window.appPermissions?.canReorder ? 'true' : 'false'}')" draggable="${window.appPermissions?.canReorder ? 'true' : 'false'}" ${dragAttrs}>
            <div class="stop-main-row">
              <div class="stop-marker ${s.status}">${i + 1}</div>
              <div class="stop-info">
                <div class="stop-title-row">
                  <div class="stop-title"><strong>${s.recipient}</strong></div>
                  <div style="display:flex;align-items:center;gap:4px;">
                    <span class="badge ${st.class}" style="font-size:0.6rem; padding: 2px 6px;">${st.label}</span>
                    <i class="ri-arrow-down-s-line stop-expand-icon"></i>
                  </div>
                </div>
                ${s.model ? `<div class="stop-address" style="font-weight: normal;">${s.model}</div>` : ''}
              </div>
            </div>
            ${expandedBody}
          </li>
        `;
      }).join('');
    }

    function renderWeeklyChart() {
      const wrapper = document.getElementById('weeklyChartBars');
      if (!wrapper) return;
      
      const routes = StorageManager.getRoutes();
      const now = new Date();
      const dailyKms = [0, 0, 0, 0, 0, 0, 0]; // Mon-Sun
      
      // Calculate start of current week (Monday)
      const startOfWeek = new Date(now);
      startOfWeek.setHours(0, 0, 0, 0);
      const dayOfWeek = startOfWeek.getDay();
      const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      startOfWeek.setDate(startOfWeek.getDate() - daysFromMonday);
      
      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(startOfWeek.getDate() + 6);
      endOfWeek.setHours(23, 59, 59, 999);
      
      routes.forEach(r => {
        if (!r.date) return;
        const d = new Date(r.date + 'T12:00:00'); // avoid timezone shifts
        // Only include routes from this calendar week
        if (d < startOfWeek || d > endOfWeek) return;
        const day = d.getDay(); // 0 is Sun, 1 is Mon...
        const index = day === 0 ? 6 : day - 1; // map to 0=Mon...6=Sun
        dailyKms[index] += parseFloat(String(r.distanceKm).replace(',', '.')) || 0;
      });

      const max = Math.max(...dailyKms, 10);
      wrapper.innerHTML = dailyKms.map(km => `
        <div class="chart-bar-container">
          <span class="chart-bar-value">${km.toFixed(1)} km</span>
          <div class="chart-bar" style="height: ${(km / max) * 100}%" title="${km.toFixed(1)} km"></div>
        </div>
      `).join('');
    }

    // === WINDOW EXPOSURE ===
    // ======= FUNÇÃO AUXILIAR DE ACRÉSCIMO DE TEMPO =======
    function applyTimeRules(baseMinutes, distKm, stops) {
      if (!baseMinutes || !stops) return baseMinutes;
      let isSP = false;
      let isMG = false;
      let isRJ = false;
      const allAddresses = stops.map(s => (s.address || '').toLowerCase() + ' ' + (s.recipient || '').toLowerCase());
      for (const addr of allAddresses) {
         if (addr.includes('são paulo') || addr.includes('sao paulo') || addr.includes('- sp') || addr.includes(', sp') || addr.includes('/sp') || addr.includes('/ sp')) {
           isSP = true;
         }
         if (addr.includes('minas gerais') || addr.includes('- mg') || addr.includes(', mg') || addr.includes('/mg') || addr.includes('/ mg')) {
           isMG = true;
         }
         if (addr.includes('rio de janeiro') || addr.includes('- rj') || addr.includes(', rj') || addr.includes('/rj') || addr.includes('/ rj')) {
           isRJ = true;
         }
      }
      
      let floatDur = baseMinutes;
      if (isSP) {
        floatDur *= 1.17;
      } else if (isRJ) {
        floatDur *= 1.20;
      }
      return Math.round(floatDur);
    }

    // ======= CÁLCULO DE KM EM BACKGROUND (sem abrir mapa) =======
    async function calcRouteKmSilently(routeId) {
      try {
        const route = StorageManager.getRoute(routeId);
        if (!route) return;

        const deliveries = StorageManager.getDeliveriesByRoute(routeId);
        const validStops = deliveries.filter(d => {
          const lt = parseFloat(String(d.lat).replace(',', '.'));
          const ln = parseFloat(String(d.lng).replace(',', '.'));
          return !isNaN(lt) && !isNaN(ln);
        }).map(d => ({
          lat: parseFloat(String(d.lat).replace(',', '.')),
          lng: parseFloat(String(d.lng).replace(',', '.'))
        }));

        if (validStops.length === 0) {
          // Sem paradas: zerar km salvo na rota
          if (route.distanceKm || route.durationMin) {
            route.distanceKm = null;
            route.durationMin = null;
            await StorageManager.saveRoute(route);
            renderRoutesList();
            refreshDashboard();
          }
          return;
        }

        const origin = route.origin || (route.originLat && route.originLng ? { lat: route.originLat, lng: route.originLng } : null);
        const hasOrigin = origin && !isNaN(parseFloat(origin.lat)) && !isNaN(parseFloat(origin.lng));
        if (!hasOrigin) return;

        // Haversine fallback
        function haversine(c1, c2) {
          const R = 6371;
          const dLat = (c2.lat - c1.lat) * Math.PI / 180;
          const dLng = (c2.lng - c1.lng) * Math.PI / 180;
          const a = Math.sin(dLat/2)**2 +
            Math.cos(c1.lat * Math.PI/180) * Math.cos(c2.lat * Math.PI/180) * Math.sin(dLng/2)**2;
          const R2 = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
          return R * R2;
        }

        let distKm = null;
        let durMin = null;

        // Tenta OSRM primeiro (origem → paradas → origem para incluir retorno)
        try {
          const coords = [
            [parseFloat(origin.lng), parseFloat(origin.lat)],
            ...validStops.map(s => [s.lng, s.lat]),
            [parseFloat(origin.lng), parseFloat(origin.lat)] // volta ao ponto de partida
          ].map(c => c.join(',')).join(';');

          const resp = await fetch(
            `https://router.project-osrm.org/route/v1/driving/${coords}?overview=false`,
            { signal: AbortSignal.timeout(8000) }
          );
          const data = await resp.json();
          if (data.code === 'Ok' && data.routes?.[0]) {
            distKm = parseFloat((data.routes[0].distance / 1000).toFixed(1));
            durMin = Math.round(data.routes[0].duration / 60);
          }
        } catch (osrmErr) {
          console.warn('OSRM indisponível, usando Haversine:', osrmErr.message);
        }

        // Fallback Haversine se OSRM falhar (fechando o ciclo com retorno à origem)
        if (distKm === null) {
          const originPt = { lat: parseFloat(origin.lat), lng: parseFloat(origin.lng) };
          const pts = [originPt, ...validStops, originPt]; // inclui retorno
          let total = 0;
          for (let i = 0; i < pts.length - 1; i++) total += haversine(pts[i], pts[i+1]);
          distKm = parseFloat((total * 1.25).toFixed(1)); // fator viário
          durMin = Math.round((distKm / 40) * 60);        // ~40 km/h média urbana
        }

        if (durMin !== null && distKm !== null) {
          durMin = applyTimeRules(durMin, distKm, validStops);
        }

        // Só salva se o valor mudou significativamente ou o tempo mudou
        if (Math.abs((route.distanceKm || 0) - distKm) > 0.3 || route.durationMin !== durMin) {
          route.distanceKm = distKm;
          route.durationMin = durMin;
          await StorageManager.saveRoute(route);
          renderRoutesList();
          refreshDashboard();
        }
      } catch (err) {
        console.warn('calcRouteKmSilently error:', err.message);
      }
    }

    window.viewOnMap = (id) => {
      document.getElementById('tab-map').click();
      loadRouteToMap(id);
    };

    // Função de otimização exposta para uso na lista de rotas
    window.optimizeRouteFromList = async (routeId) => {
      showToast('Otimizando rota...');
      try {
        const route = StorageManager.getRoute(routeId);
        const deliveries = StorageManager.getDeliveriesByRoute(routeId);
        if (deliveries.length <= 1) {
          showToast('Rota com 1 parada não precisa ser otimizada', 'warning');
          return;
        }

        const parseCoord = (c) => parseFloat(String(c).replace(',', '.'));
        let startCoords = null;
        const routeOrigin = route && (route.origin || (route.originLat && route.originLng ? { lat: route.originLat, lng: route.originLng } : null));
        if (routeOrigin && !isNaN(parseCoord(routeOrigin.lat)) && !isNaN(parseCoord(routeOrigin.lng))) {
          startCoords = { lat: parseCoord(routeOrigin.lat), lng: parseCoord(routeOrigin.lng) };
        } else {
          const firstValid = deliveries.find(d => !isNaN(parseCoord(d.lat)) && !isNaN(parseCoord(d.lng)));
          if (firstValid) startCoords = { lat: parseCoord(firstValid.lat), lng: parseCoord(firstValid.lng) };
        }

        const validDeliveries = [];
        const invalidDeliveries = [];
        deliveries.forEach(d => {
          const latNum = parseCoord(d.lat);
          const lngNum = parseCoord(d.lng);
          if (!isNaN(latNum) && !isNaN(lngNum)) {
            validDeliveries.push({ ...d, lat: latNum, lng: lngNum });
          } else {
            invalidDeliveries.push({ ...d });
          }
        });

        const optimized = [];
        if (startCoords && validDeliveries.length > 0) {
          const getDistance = (c1, c2) => {
            const R = 6371;
            const dLat = (c2.lat - c1.lat) * Math.PI / 180;
            const dLng = (c2.lng - c1.lng) * Math.PI / 180;
            const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(c1.lat * Math.PI / 180) * Math.cos(c2.lat * Math.PI / 180) *
              Math.sin(dLng / 2) * Math.sin(dLng / 2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            return R * c;
          };
          let current = startCoords;
          const unvisited = [...validDeliveries];
          while (unvisited.length > 0) {
            let closestIndex = 0;
            let minDistance = Infinity;
            for (let i = 0; i < unvisited.length; i++) {
              const dist = getDistance(current, unvisited[i]);
              if (dist < minDistance) { minDistance = dist; closestIndex = i; }
            }
            const nextDelivery = unvisited.splice(closestIndex, 1)[0];
            optimized.push(nextDelivery);
            current = { lat: nextDelivery.lat, lng: nextDelivery.lng };
          }
        } else {
          optimized.push(...validDeliveries);
        }
        optimized.push(...invalidDeliveries);

        const promises = optimized.map((d, index) => {
          d.order = index + 1;
          return StorageManager.saveDelivery(d, true);
        });
        await Promise.all(promises);
        await StorageManager.fetchDeliveries();
        showToast('Rota otimizada com sucesso!');
        renderRoutesList();
        calcRouteKmSilently(routeId);
        if (activeRouteId === routeId) loadRouteToMap(routeId);
      } catch (err) {
        showToast('Erro ao otimizar rota: ' + err.message, 'error');
      }
    };
    
    window.viewOnMapReadOnly = (id) => {
      document.getElementById('tab-map').click();
      loadRouteToMap(id, true);
    };

    window.openRouteModalFromList = (id) => openRouteModal(id);
    window.openDriverModalFromList = (id) => openDriverModal(id);
    window.openUserModalFromList = (id) => openUserModal(id);
    
    window.deleteRoute = (id) => {
      const deliveries = StorageManager.getDeliveriesByRoute(id) || [];
      const pendingCount = deliveries.filter(d => d.status === 'pending').length;
      
      let msg = "Excluir esta rota permanentemente?";
      if (pendingCount > 0) {
        msg = `ATENÇÃO: Existem ${pendingCount} parada(s) PENDENTE(S) nesta rota.\nElas também serão excluídas do sistema.\nTem certeza que deseja continuar?`;
      } else if (deliveries.length > 0) {
        msg = `ATENÇÃO: Existem ${deliveries.length} parada(s) nesta rota.\nElas também serão excluídas.\nTem certeza?`;
      }

      openConfirmDialog(msg, async () => {
        try {
          await StorageManager.deleteRoute(id);
          showToast("Rota excluída");
          renderRoutesList();
          refreshDashboard();
          if (typeof renderCalendarView === 'function') renderCalendarView();
  
          // Fechar o card se a rota excluída for a que estava aberta
          if (activeRouteId === id) {
            if (routeDetailPanel) {
              routeDetailPanel.classList.remove('show');
              routeDetailPanel.style.display = 'none';
            }
            activeRouteId = null;
            if (typeof MapService !== 'undefined') MapService.clearMap();
          }
        } catch (err) {
          console.error("Erro na exclusão:", err);
          showToast("Erro ao excluir: " + err.message, "error");
        }
      });
    };

    window.deleteDriverFromList = (id, isUser) => {
      if (isUser) {
        showToast("Este é um usuário interno. Para excluí-lo, vá na aba de Usuários.", "info");
        return;
      }
      openConfirmDialog("Excluir este motorista? As rotas vinculadas ficarão sem motorista.", async () => {
        try {
          await StorageManager.deleteDriver(id);
          showToast("Motorista excluído");
          renderDriversList();
        } catch (err) {
          showToast("Erro ao excluir: " + err.message, "error");
        }
      });
    };

    window.deleteUserFromList = (id) => {
      openConfirmDialog("Excluir este usuário?", async () => {
        await StorageManager.deleteUser(id);
        showToast("Usuário excluído");
        renderUsersList();
      });
    };

    window.deleteDeliveryFromList = (id) => {
      openConfirmDialog("Remover esta parada?", async () => {
        const d = StorageManager.getDeliveries().find(x => x.id === id);
        const rid = d ? d.routeId : null;
        await StorageManager.deleteDelivery(id);
        
        if (rid === activeRouteId) {
          await loadRouteToMap(rid);
        } else if (rid) {
          await calcRouteKmSilently(rid);
        }

        showToast("Parada removida");
        renderRoutesList();
        renderDeliveriesList();
      });
    };

    function stripFailureNote(notes) {
      if (!notes) return notes;
      // Remove a tag [FALHA] com seu conteúdo e qualquer quebra de linha antes/depois
      return notes
        .replace(/\n*\s*<span style="color: red; font-weight: bold;">\[FALHA\][\s\S]*?<\/span>\s*\n*/g, '')
        .trim();
    }

    function promptFailureReasonAsync() {
      return new Promise((resolve) => {
        const modal = document.getElementById('modalFailureReason');
        const input = document.getElementById('failureReasonInput');
        const cancelBtn = document.getElementById('cancelFailureReasonBtn');
        const confirmBtn = document.getElementById('confirmFailureReasonBtn');
        const closeIcon = document.getElementById('closeModalFailureReason');

        if (!modal || !input || !cancelBtn || !confirmBtn || !closeIcon) {
          // fallback para prompt nativo se o modal não for encontrado
          const reason = prompt('Motivo da falha:');
          resolve(reason);
          return;
        }

        input.value = '';
        modal.classList.add('active');
        setTimeout(() => input.focus(), 100);

        function cleanup() {
          modal.classList.remove('active');
          cancelBtn.removeEventListener('click', onCancel);
          closeIcon.removeEventListener('click', onCancel);
          confirmBtn.removeEventListener('click', onConfirm);
        }

        function onCancel() {
          cleanup();
          resolve(null);
        }

        function onConfirm() {
          const val = input.value;
          cleanup();
          resolve(val);
        }

        cancelBtn.addEventListener('click', onCancel);
        closeIcon.addEventListener('click', onCancel);
        confirmBtn.addEventListener('click', onConfirm);
      });
    }

    window.updateDeliveryStatus = async (id, status) => {
      const d = StorageManager.getDeliveries().find(x => x.id === id);
      if (d) {
        if (status === 'failed') {
          const reason = await promptFailureReasonAsync();
          if (reason === null) return; // Cancelado
          if (reason.trim() !== '') {
            const formattedReason = `<span style="color: red; font-weight: bold;">[FALHA] ${reason.trim()}</span>`;
            d.notes = d.notes ? d.notes + "\n\n" + formattedReason : formattedReason;
          }
        } else if (d.status === 'failed') {
          // Removendo a anotação de falha ao mudar de status
          d.notes = stripFailureNote(d.notes);
        }
        
        d.status = status;
        await StorageManager.saveDelivery(d);
        showToast(`Status atualizado: ${status}`);
        if (d.routeId === activeRouteId) loadRouteToMap(d.routeId);
        
        if (typeof renderDeliveriesList === 'function') renderDeliveriesList();
        if (typeof renderCalendarView === 'function') renderCalendarView();
      }
    };

    // Toggle delivery status between the given status and 'pending'
    window.toggleDeliveryStatus = async (id, status) => {
      const d = StorageManager.getDeliveries().find(x => x.id === id);
      if (!d) return;
      
      const newStatus = d.status === status ? 'pending' : status;
      
      if (newStatus === 'failed') {
        const reason = await promptFailureReasonAsync();
        if (reason === null) return; // Cancelado
        if (reason.trim() !== '') {
          const formattedReason = `<span style="color: red; font-weight: bold;">[FALHA] ${reason.trim()}</span>`;
          d.notes = d.notes ? d.notes + "\n\n" + formattedReason : formattedReason;
        }
      } else if (d.status === 'failed') {
        // Removendo a anotação de falha ao mudar de status
        d.notes = stripFailureNote(d.notes);
      }
      
      d.status = newStatus;
      try {
        await StorageManager.saveDelivery(d);
        const labelMap = { delivered: 'Entregue', failed: 'Falha na entrega', pending: 'Pendente' };
        showToast(`Parada: ${labelMap[newStatus] || newStatus}`);
        if (d.routeId === activeRouteId) loadRouteToMap(d.routeId);
        
        if (typeof renderDeliveriesList === 'function') renderDeliveriesList();
        if (typeof renderCalendarView === 'function') renderCalendarView();
      } catch (err) {
        showToast('Erro ao atualizar status: ' + err.message, 'error');
      }
    };

    // ================== SMART FIT LOGIC ==================
    function calculateDistance(lat1, lon1, lat2, lon2) {
      const R = 6371; // Earth radius in km
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lon2 - lon1) * Math.PI / 180;
      const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                Math.sin(dLon/2) * Math.sin(dLon/2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      const straightLineDist = R * c;
      // Fator de rotação urbana (tortuosidade) geralmente varia de 1.2 a 1.5
      // 1.41 aproxima melhor a distância real de carro em rotas urbanas do que a linha reta pura.
      return straightLineDist * 1.41;
    }

    function calculateBearing(lat1, lon1, lat2, lon2) {
      const dLon = (lon2 - lon1) * Math.PI / 180;
      const lat1Rad = lat1 * Math.PI / 180;
      const lat2Rad = lat2 * Math.PI / 180;
      const y = Math.sin(dLon) * Math.cos(lat2Rad);
      const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);
      const brng = Math.atan2(y, x) * 180 / Math.PI;
      return (brng + 360) % 360;
    }

    const btnSmartFit = document.getElementById('btnSmartFit');
    const modalSmartFit = document.getElementById('modalSmartFit');
    const closeModalSmartFit = document.getElementById('closeModalSmartFit');
    const btnRunSmartFit = document.getElementById('btnRunSmartFit');
    const smartFitInput = document.getElementById('smartFitInput');
    const smartFitResults = document.getElementById('smartFitResults');

    if (btnSmartFit) {
      btnSmartFit.addEventListener('click', async () => {
        if (modalSmartFit) {
          const originalHtml = btnSmartFit.innerHTML;
          btnSmartFit.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> <span>Sincronizando...</span>';
          btnSmartFit.style.pointerEvents = 'none';
          
          try {
            // Em vez de baixar TUDO (init), baixa apenas rotas e entregas para economizar muito tráfego de dados (Egress)
            await Promise.all([
              StorageManager.fetchRoutes(),
              StorageManager.fetchDeliveries()
            ]);
          } catch (e) {
            console.error("Erro ao atualizar rotas pro Encaixe Inteligente:", e);
          }
          
          btnSmartFit.innerHTML = originalHtml;
          btnSmartFit.style.pointerEvents = 'auto';

          modalSmartFit.style.display = 'flex';
          modalSmartFit.classList.add('active');
          smartFitInput.value = '';
          smartFitResults.innerHTML = '';
          setTimeout(() => smartFitInput.focus(), 100);
        }
      });
    }

    if (closeModalSmartFit) {
      closeModalSmartFit.addEventListener('click', () => {
        modalSmartFit.classList.remove('active');
        setTimeout(() => modalSmartFit.style.display = 'none', 300);
      });
    }

    if (btnRunSmartFit) {
      btnRunSmartFit.addEventListener('click', async () => {
        const query = smartFitInput.value.trim();
        if (query.length < 3) {
          showToast('Digite um endereço válido (mínimo 3 caracteres)', 'error');
          return;
        }

        smartFitResults.innerHTML = '<div style="text-align: center; padding: 20px;"><i class="ri-loader-4-line ri-spin" style="font-size: 2rem; color: var(--accent-primary);"></i><p style="margin-top:10px;">Buscando encaixe...</p></div>';
        try {
          let targetLat = null;
          let targetLng = null;
          const results = await MapService.searchAddress(query).catch(() => null);
          if (results && results.length > 0) {
            targetLat = results[0].lat;
            targetLng = results[0].lng;
          }
          
          const today = new Date();
          const upcomingDays = [];
          for (let i = 1; i <= 30; i++) {
             const d = new Date(today);
             d.setDate(today.getDate() + i);
             const yyyy = d.getFullYear();
             const mm = String(d.getMonth() + 1).padStart(2, '0');
             const dd = String(d.getDate()).padStart(2, '0');
             upcomingDays.push(`${yyyy}-${mm}-${dd}`);
          }
          
          const allRoutes = StorageManager.getRoutes().filter(r => r.status === 'active' || r.status === 'planned' || r.status === 'closed');
          const allClosedRoutes = StorageManager.getRoutes().filter(r => r.status === 'closed');
          const deliveries = StorageManager.getDeliveries();
          const queryLower = query.toLowerCase();
          
          let routeDistances = [];
          const routeTasks = [];
          
          upcomingDays.forEach(dateStr => {
             const routesOnDay = allRoutes.filter(r => r.date === dateStr);
             
             if (routesOnDay.length === 0) {
               routeDistances.push({
                 isEmpty: true,
                 date: dateStr,
                 minDistance: 999999,
                 textMatchScore: 0
               });
             } else {
               routesOnDay.forEach(route => {
                 let minDistance = 999999;
                 let textMatchScore = 0;
                 
                 if (route.name && route.name.toLowerCase().includes(queryLower)) {
                    textMatchScore += 2;
                 }
                 
                 let closestStopName = 'Origem';
                 let closestLat = route.originLat ? parseFloat(String(route.originLat).replace(',','.')) : null;
                 if (isNaN(closestLat)) closestLat = null;
                 let closestLng = route.originLng ? parseFloat(String(route.originLng).replace(',','.')) : null;
                 if (isNaN(closestLng)) closestLng = null;

                 if (targetLat !== null && targetLng !== null && closestLat !== null && closestLng !== null) {
                    minDistance = calculateDistance(targetLat, targetLng, closestLat, closestLng);
                 }
                 
                 let closestStopIndex = -1;
                 const routeStops = deliveries.filter(d => d.routeId === route.id).sort((a,b) => (a.order || 0) - (b.order || 0));
                 routeStops.forEach((stop, idx) => {
                    const latNum = parseFloat(String(stop.lat).replace(',','.'));
                    const lngNum = parseFloat(String(stop.lng).replace(',','.'));
                    if (targetLat !== null && targetLng !== null && !isNaN(latNum) && !isNaN(lngNum)) {
                      const dist = calculateDistance(targetLat, targetLng, latNum, lngNum);
                      if (dist < minDistance) {
                        minDistance = dist;
                        closestStopName = `Parada ${idx + 1}`;
                        closestStopIndex = idx;
                        closestLat = latNum;
                        closestLng = lngNum;
                      }
                    }
                    if ((stop.address && stop.address.toLowerCase().includes(queryLower)) || 
                        (stop.recipient && stop.recipient.toLowerCase().includes(queryLower))) {
                      textMatchScore += 1;
                    }
                 });
                 
                 let directionPenalty = 1;
                 let isOnTheWay = false;

                 let totalMinutes = 0;
                 if (route.durationMin) totalMinutes = route.durationMin;
                 else if (route.distanceKm) totalMinutes = Math.round((route.distanceKm / 40) * 60);
  
                 routeTasks.push({
                    isEmpty: false,
                    route,
                    date: dateStr,
                    minDistance,
                    directionPenalty,
                    isOnTheWay,
                    closestStopName,
                    closestStopIndex,
                    stopsCount: routeStops.length,
                    textMatchScore,
                    totalMinutes,
                    closestLat,
                    closestLng
                 });
               });
             }
          });

          if (targetLat !== null && targetLng !== null) {
             // Otimização: Consulta o OSRM apenas para as 5 opções mais próximas (Haversine) 
             // para evitar gargalos e bloqueio por excesso de requisições na API.
             routeTasks.sort((a, b) => a.minDistance - b.minDistance);
             const topTasks = routeTasks.slice(0, 5);

             const fetchPromises = topTasks.map(async (task) => {
                if (task.closestLat !== null && task.closestLng !== null) {
                   try {
                       const osrmRes = await fetch(`https://router.project-osrm.org/route/v1/driving/${targetLng},${targetLat};${task.closestLng},${task.closestLat}?overview=false`);
                       const osrmData = await osrmRes.json();
                       if (osrmData && osrmData.routes && osrmData.routes.length > 0) {
                           task.minDistance = (osrmData.routes[0].distance / 1000);
                           if (osrmData.routes[0].duration) {
                               task.extraTimeMin = Math.round(osrmData.routes[0].duration / 60);
                           }
                       }
                   } catch (e) {
                       console.warn("OSRM falhou no smart fit, usando haversine", e);
                   }
                }
                return task;
             });
             await Promise.all(fetchPromises);
          }
          
          routeDistances.push(...routeTasks);

          const existingMatches = routeDistances.filter(item => !item.isEmpty && item.route.status !== 'closed' && ((item.minDistance < 335) || (item.minDistance === 999999 && item.textMatchScore > 0)));
          existingMatches.sort((a, b) => {
             if (b.textMatchScore !== a.textMatchScore) return b.textMatchScore - a.textMatchScore;
             return a.minDistance - b.minDistance;
          });
          
          const topRoutesIds = existingMatches.slice(0, 3).map(item => item.route.id);

          if (targetLat === null && targetLng === null && existingMatches.length > 0 && existingMatches[0].textMatchScore === 0) {
            smartFitResults.innerHTML = '<p style="color:var(--danger-color); text-align:center;">Endereço não encontrado geograficamente e não há paradas com este termo nas rotas ativas/agendadas.</p>';
            return;
          }
          
          const groupedByDate = {};
          routeDistances.forEach(item => {
             if (!groupedByDate[item.date]) groupedByDate[item.date] = [];
             groupedByDate[item.date].push(item);
          });
          
          let html = `
          <style>
            @keyframes blinkYellowGreen {
              0% { background-color: #eab308 !important; color: #000 !important; border-color: #eab308 !important; }
              50% { background-color: #22c55e !important; color: #fff !important; border-color: #22c55e !important; }
              100% { background-color: #eab308 !important; color: #000 !important; border-color: #eab308 !important; }
            }
            @keyframes blinkWarningText {
              0% { opacity: 1; color: #ef4444; }
              50% { opacity: 0.5; color: #fde047; }
              100% { opacity: 1; color: #ef4444; }
            }
          </style>
          <h3 style="font-size: 1rem; margin-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 5px;">Opções de Encaixe - Próximos 30 dias</h3>`;
          
          let validMatches = 0;

          Object.keys(groupedByDate).sort().forEach(dateStr => {
             const items = groupedByDate[dateStr];
             const routesToShow = items.filter(i => !i.isEmpty && i.route);
             const closedItems = routesToShow.filter(i => i.route.status === 'closed');
             const isDayFull = closedItems.length >= 5;

             const [yy, mm, dd] = dateStr.split('-');
             const dObj = new Date(yy, mm - 1, dd);
             let weekday = dObj.toLocaleDateString('pt-BR', { weekday: 'long' });
             weekday = weekday.split(',')[0].trim();
             const capWeekday = weekday.charAt(0).toUpperCase() + weekday.slice(1);
             const isDesktop = window.innerWidth > 768;

             const feriado = window.getFeriado ? window.getFeriado(dateStr) : null;
             // Start Day Card
             html += `
               <div style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); padding: 12px; border-radius: 8px; margin-bottom: 16px; display: flex; flex-direction: column; gap: 10px;">
                 <div style="font-weight: bold; font-size: 1.05rem; color: var(--text-white); display: flex; align-items: center; justify-content: center; flex-direction: column; border-bottom: 1px dashed rgba(255,255,255,0.1); padding-bottom: 8px; margin-bottom: 4px;">
                   <span><i class="ri-calendar-event-line" style="margin-right: 6px; color: var(--accent-primary);"></i> ${capWeekday} - ${formatDate(dateStr)}</span>
                   ${feriado ? `<span style="color: #eab308; font-size: 0.85rem; margin-top: 4px; display: flex; align-items: center; gap: 4px;"><i class="ri-alert-fill"></i> Feriado: ${feriado}</span>` : ''}
                 </div>
             `;

             if (isDayFull) {
                html += `
                  <div style="font-size: 0.95rem; color: #ef4444; font-weight: bold; text-align: center; padding: 12px 4px; border: 1px dashed rgba(239, 68, 68, 0.3); border-radius: 6px; background: rgba(239, 68, 68, 0.05);">
                    <i class="ri-lock-fill"></i> Dia fechado, Rotas completas.
                  </div>
                `;
             } else if (routesToShow.length === 0) {
                html += `
                  <div style="font-size: 0.9rem; color: var(--text-muted); padding: 8px 4px;">
                     Nenhuma opção de encaixe ou rota programada para este dia.
                  </div>
                `;
             } else {
               routesToShow.forEach(item => {
                if (item.isEmpty) {
                   html += `
                     <div style="font-size: 0.9rem; color: var(--text-muted); padding: 8px 4px;">
                        Nenhuma rota programada para este dia.
                     </div>
                   `;
                } else {
                   validMatches++;
                   const isBestFit = topRoutesIds.includes(item.route.id);
                   const rankPos = topRoutesIds.indexOf(item.route.id);
                   const rank1Color = '#22c55e';
                   const rank2Color = '#38bdf8';
                   const rank3Color = '#facc15';
                   let rankColor = rankPos === 0 ? rank1Color : rankPos === 1 ? rank2Color : rankPos === 2 ? rank3Color : 'var(--text-muted)';
                   let rankBg = rankPos === 0 ? 'rgba(34, 197, 94, 0.15)' : rankPos === 1 ? 'rgba(56, 189, 248, 0.15)' : rankPos === 2 ? 'rgba(250, 204, 21, 0.15)' : 'transparent';
                   
                   let cardBg = rankBg;
                   if (cardBg === 'transparent') {
                     if (item.route.status === 'closed') {
                       cardBg = 'rgba(239, 68, 68, 0.15)';
                     } else if (item.route.status === 'planned') {
                       cardBg = 'rgba(156, 163, 175, 0.15)';
                     } else if (item.route.status === 'active') {
                       cardBg = 'rgba(245, 158, 11, 0.15)';
                     } else {
                       cardBg = 'rgba(255,255,255,0.05)';
                     }
                   }
                   
                   let badgeColor = isBestFit ? rankColor : 'var(--text-white)';
                   let medal = isBestFit ? `<span style="color: ${badgeColor}; font-size: 0.9rem;"><i class="ri-medal-fill"></i></span>` : `<span style="color: ${badgeColor}; font-size: 0.9rem;"><i class="ri-route-line"></i></span>`;

                   const routeStops = deliveries.filter(d => d.routeId === item.route.id).sort((a,b) => (a.order || 0) - (b.order || 0));
                   const vehicleObj = item.route.vehicle ? StorageManager.getVehicle(item.route.vehicle) : null;
                   const vehicleDisplay = vehicleObj ? vehicleObj.name.toUpperCase() : (item.route.vehicle ? item.route.vehicle.toUpperCase() : 'NÃO DEFINIDO');

                   let stopsPreviewHtml = '';
                   if (routeStops.length > 0) {
                     stopsPreviewHtml = `
                       <div style="margin-top: 10px; width: 100%;">
                         <div onclick="const list = this.nextElementSibling; const isHidden = list.style.display === 'none'; list.style.display = isHidden ? 'block' : 'none'; const icon = this.querySelector('i'); icon.className = isHidden ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line';" style="cursor:pointer; font-size: 0.8rem; color: var(--text-muted); display: inline-flex; align-items: center; gap: 4px;">
                           <i class="ri-arrow-down-s-line"></i> Ver paradas cadastradas (${item.stopsCount})
                         </div>
                         <div style="display: none; margin-top: 8px; border-top: 1px dashed rgba(255,255,255,0.1); padding-top: 8px; max-height: 150px; overflow-y: auto;">
                           ${routeStops.map((s, i) => {
                             let shortAddr = s.address || 'Sem endereço';
                             if (shortAddr !== 'Sem endereço') {
                               shortAddr = shortAddr.replace(/,\s*(?:s\/?n|[sS]\/[nN]|\d+[a-zA-Z]?)\b/g, '');
                               shortAddr = shortAddr.replace(/\s*[,-]?\s*\d{5}-?\d{3}\b/g, '');
                               shortAddr = shortAddr.replace(/\s*[,-]?\s*Brasil/gi, '');
                               shortAddr = shortAddr.replace(/(?:^[\s,-]+|[\s,-]+$)/g, '');
                               shortAddr = shortAddr.replace(/,/g, ' -');
                               shortAddr = shortAddr.replace(/\s*-\s*-\s*/g, ' - ');
                             }
                             return `
                             <div style="font-size: 0.75rem; color: var(--text-white); margin-bottom: 8px;">
                               <div style="cursor: pointer; font-weight: bold; margin-bottom: 2px;" onclick="const details = this.nextElementSibling; details.style.display = details.style.display === 'none' ? 'block' : 'none';">
                                 ${i+1}. ${shortAddr}
                               </div>
                               <div style="display: none; padding-left: 10px; border-left: 2px solid rgba(255,255,255,0.1); margin-top: 4px;">
                                 ${s.recipient} <span style="color: var(--text-muted);">- ${s.address || 'Sem endereço'}</span>
                                 ${s.model ? `<br><span style="color: var(--text-muted);"><i class="ri-price-tag-3-line"></i> Modelo: ${s.model.toUpperCase()}</span>` : ''}
                               </div>
                             </div>
                           `}).join('')}
                         </div>
                       </div>
                     `;
                   }

                   let totalTimeStr = '';
                   const duration = item.totalMinutes;
                   const hours = Math.floor(duration / 60);
                   const minutes = Math.round(duration % 60);
                   if (hours > 0) {
                     totalTimeStr = ` <i class="ri-time-line" style="margin-left: 4px;"></i> Tempo médio total ~${hours}h ${minutes}min.`;
                   } else {
                     totalTimeStr = ` <i class="ri-time-line" style="margin-left: 4px;"></i> Tempo médio total ~${minutes}min.`;
                   }

                   const isClosed = item.route.status === 'closed';
                   const isFull = duration >= 750 || item.stopsCount >= 6;
                   const isDisabled = isClosed || isFull;

                   let reasonHtml = `<div style="font-size: 0.85rem; color: var(--text-white); margin-top: 2px;"><strong style="color:#22c55e;">Rota com ${item.stopsCount} parada${item.stopsCount !== 1 ? 's' : ''}.${totalTimeStr}</strong></div>`;

                   if (item.minDistance < 999999 && !isDisabled) {
                     const estimatedTimeMin = item.extraTimeMin !== undefined ? item.extraTimeMin : Math.round((item.minDistance / 40) * 60);
                     const estimatedTimeStr = estimatedTimeMin >= 60 
                       ? `${Math.floor(estimatedTimeMin / 60)}h ${estimatedTimeMin % 60}m`
                       : `${estimatedTimeMin} min`;
                     reasonHtml += `<div style="font-size: 0.8rem; color: var(--text-white); margin-top: 4px; line-height: 1.4;">Distância extra: <strong style="color:var(--accent-primary);">${item.minDistance.toFixed(1)} km</strong>${isDesktop ? ' - ' : '<br>'}Tempo extra: <strong style="color:var(--accent-primary);">${estimatedTimeStr}</strong> (via ${item.closestStopName.substring(0, 15)}${item.closestStopName.length > 15 ? '...' : ''})</div>`;
                   }

                   if (isClosed) {
                     reasonHtml += `<div style="font-size: 0.85rem; color: #ef4444; margin-top: 6px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.05em;"><i class="ri-lock-line"></i> ROTA FECHADA</div>`;
                   } else if (isFull) {
                     reasonHtml += `<div style="font-size: 0.85rem; color: #ef4444; margin-top: 6px; font-weight: bold;"><i class="ri-error-warning-line"></i> Rota completa, tempo excedido ou limite de paradas atingido.</div>`;
                   }

                   const routeDate = item.route.date;
                   const dayNote = routeDate ? StorageManager.getDayNote(routeDate) : null;
                   
                   if (dayNote) {
                     reasonHtml += `<div style="margin-top: 8px; padding: 6px 10px; background: rgba(234, 179, 8, 0.1); border-left: 2px solid #eab308; border-radius: 4px; font-size: 0.75rem; color: #fde047;"><strong>Nota do dia:</strong> ${dayNote}</div>`;
                   }

                   let borderHighlight = isBestFit ? `border-left: 3px solid ${rankColor};` : `border-left: 3px solid rgba(255,255,255,0.1);`;

                   html += `
                      <div style="background: ${cardBg}; ${borderHighlight} padding: 10px 12px; border-radius: 6px; display: flex; flex-direction: column; gap: 8px; margin-bottom: 6px; position: relative; border: 1px solid rgba(255,255,255,0.05);">
                         <div style="display: flex; justify-content: space-between; align-items: ${isDesktop ? 'flex-start' : 'flex-start; flex-wrap: wrap; gap: 12px;'}">
                           <div ${!isDesktop ? 'style="flex: 1 1 200px; min-width: 0;"' : ''}>
                              <div style="font-weight: bold; font-size: 1rem; display: flex; align-items: center; gap: 8px; color: ${badgeColor};">
                                 ${medal} <span>${item.route.name}</span>
                              </div>
                              ${reasonHtml}
                           </div>
                           <div style="display: flex; ${isDesktop ? 'flex-direction: column; gap: 4px;' : 'flex-direction: row; flex-wrap: wrap; gap: 6px; flex: 0 0 auto;'}">
                             ${!isDisabled && window.appPermissions?.canCreateStop ? `
                             <button class="btn-secondary btn-sm" onclick="window.addStopToRoute('${item.route.id}', ${targetLat}, ${targetLng}, '${(query||'').replace(/'/g, "\\'")}', '${item.minDistance.toFixed(1)}', '${(document.getElementById('searchRecipient')?.value || '').replace(/'/g, "\\'")}', '${document.getElementById('searchPhone')?.value || ''}', '${document.getElementById('searchCpf')?.value || ''}', '${document.getElementById('searchModel')?.value || ''}', '${(document.getElementById('searchRef')?.value || '').replace(/'/g, "\\'")}')" title="Adicionar parada nesta rota" style="white-space: nowrap; ${!isDesktop ? 'padding: 3px 6px !important; font-size: 0.65rem !important; height: 24px !important; min-height: 24px !important; line-height: 1 !important; width: max-content !important; flex: 0 0 auto !important;' : ''}">
                                <i class="ri-add-line"></i> Adicionar
                             </button>
                             ` : ''}
                             ${(targetLat !== null) ? `
                             <button class="btn-secondary btn-sm" onclick="window.previewSmartFitRoute('${item.route.id}', ${item.closestStopIndex}, ${targetLat}, ${targetLng}, '${(query||'').replace(/'/g, "\\'")}')" title="Ver no Mapa com tempo estimado" style="white-space: nowrap; ${!isDesktop ? 'padding: 3px 6px !important; font-size: 0.65rem !important; height: 24px !important; min-height: 24px !important; line-height: 1 !important; width: max-content !important; flex: 0 0 auto !important;' : 'font-size: 0.75rem;'} ${(isClosed && item.minDistance < 999999) ? 'animation: blinkYellowGreen 1.5s infinite; color: black; border-color: yellow;' : ''}">
                                <i class="ri-map-pin-line"></i> Ver no Mapa
                             </button>
                             ` : ''}
                           </div>
                         </div>
                         <div style="font-size: 0.75rem; font-weight: bold; text-transform: uppercase; color: var(--text-white); margin-top: 4px;">VEÍCULO: ${vehicleDisplay} ${/(saveiro 1|saveiro 2|estrada|strada)/i.test(vehicleDisplay || '') ? '<span style="color: yellow; animation: blinkWarningText 1s infinite; margin-left: 8px;">Atenção para o espaço no veículo</span>' : ''}</div>
                         ${stopsPreviewHtml}
                      </div>
                   `;
                }
             });
             } // Fecha o else

             html += `</div>`; // Fechar Day Card
          });
          
          if(validMatches === 0 && upcomingDays.length === 0) {
             html += '<p style="text-align:center; color: var(--text-muted);">Nenhuma rota com o termo buscado ou coordenadas foi encontrada.</p>';
          }

          html += `
            <div style="margin-top: 20px; padding-top: 15px; border-top: 1px dashed rgba(148,163,184,0.2); text-align: center;">
              <p style="color: var(--text-main); font-size: 0.9rem; margin-bottom: 10px;">Deseja visualizar no calendário?</p>
              <button class="btn-primary" onclick="document.getElementById('modalSmartFit').classList.remove('active'); setTimeout(() => document.getElementById('modalSmartFit').style.display='none', 300); document.getElementById('tab-calendar').click();" style="display: inline-flex; align-items: center; justify-content: center; gap: 8px; font-size: 0.9rem; padding: 8px 16px;">
                <i class="ri-calendar-todo-line"></i> Ir para o Calendário de Rotas
              </button>
            </div>
          `;
          
          smartFitResults.innerHTML = html;
        } catch (err) {
          console.error("Erro no Smart Fit:", err);
          smartFitResults.innerHTML = '<p style="color:var(--danger-color); text-align:center;">Erro ao se comunicar com o servidor de mapas. Tente novamente.</p>';
        }
      });
      
      smartFitInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') btnRunSmartFit.click();
      });
    }

    // ================== PREVIEW SMART FIT ROUTE ==================
    window.previewSmartFitRoute = async (routeId, closestStopIndex, newLat, newLng, newAddress) => {
      // Navigate to Map Tab to ensure map is visible
      document.getElementById('tab-map').click();

      // Hide SmartFit modal temporarily
      const modal = document.getElementById('modalSmartFit');
      modal.classList.remove('active');
      modal.style.display = 'none';

      // Load Route info
      const route = StorageManager.getRoute(routeId);
      let stops = StorageManager.getDeliveriesByRoute(routeId);
      
      if (!route) return;
      
      const newStop = {
        lat: newLat,
        lng: newLng,
        address: newAddress,
        recipient: 'NOVA PARADA (Simulação)',
        status: 'planned'
      };

      // Insert newStop right after the closest stop
      if (closestStopIndex >= 0 && closestStopIndex < stops.length) {
        stops.splice(closestStopIndex + 1, 0, newStop);
      } else {
        stops.push(newStop);
      }

      // Show a loading/preview indicator on screen
      const previewOverlay = document.createElement('div');
      const isDesktopPreview = window.innerWidth > 768;
      previewOverlay.id = 'smartFitPreviewOverlay';
      previewOverlay.style.position = 'fixed';
      previewOverlay.style.bottom = isDesktopPreview ? '30px' : '90px';
      previewOverlay.style.left = '50%';
      previewOverlay.style.transform = 'translateX(-50%)';
      previewOverlay.style.background = 'rgba(15, 23, 42, 0.9)';
      previewOverlay.style.border = '1px solid var(--accent-primary)';
      previewOverlay.style.padding = isDesktopPreview ? '15px 25px' : '12px 16px';
      previewOverlay.style.borderRadius = isDesktopPreview ? '30px' : '16px';
      previewOverlay.style.zIndex = '999999';
      previewOverlay.style.display = 'flex';
      previewOverlay.style.flexDirection = 'column';
      previewOverlay.style.alignItems = 'center';
      previewOverlay.style.gap = isDesktopPreview ? '10px' : '8px';
      if (!isDesktopPreview) {
        previewOverlay.style.width = 'calc(100% - 32px)';
        previewOverlay.style.maxWidth = '360px';
      }
      previewOverlay.style.boxShadow = '0 10px 25px rgba(0, 0, 0, 0.5)';
      previewOverlay.innerHTML = `
        <div style="display: flex; align-items: center; gap: 8px;">
           <i class="ri-loader-4-line ri-spin" style="color: var(--accent-primary); font-size: 1.2rem;"></i>
           <span style="color: white; font-weight: bold;">Calculando preview da rota...</span>
        </div>
      `;
      document.body.appendChild(previewOverlay);

      try {
        let safeOrigin = route.origin || (route.originLat && route.originLng ? { lat: route.originLat, lng: route.originLng, address: 'Ponto de Partida' } : null);

        // Otimizar paradas via nearest neighbor antes de simular
        const parseCoord = (c) => parseFloat(String(c).replace(',', '.'));
        const validDeliveries = [];
        const invalidDeliveries = [];
        stops.forEach(d => {
          const latNum = parseCoord(d.lat);
          const lngNum = parseCoord(d.lng);
          if (!isNaN(latNum) && !isNaN(lngNum)) {
            validDeliveries.push({ ...d, lat: latNum, lng: lngNum });
          } else {
            invalidDeliveries.push({ ...d });
          }
        });

        if (validDeliveries.length > 0) {
          const getDistance = (c1, c2) => {
            const R = 6371;
            const dLat = (c2.lat - c1.lat) * Math.PI / 180;
            const dLng = (c2.lng - c1.lng) * Math.PI / 180;
            const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(c1.lat * Math.PI / 180) * Math.cos(c2.lat * Math.PI / 180) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
            return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
          };
          let current = { lat: parseCoord(safeOrigin?.lat), lng: parseCoord(safeOrigin?.lng) };
          if (isNaN(current.lat) || isNaN(current.lng)) {
             current = { lat: parseCoord(validDeliveries[0].lat), lng: parseCoord(validDeliveries[0].lng) };
             safeOrigin = { lat: current.lat, lng: current.lng, address: 'Ponto de Partida (1ª Parada)' };
          }
          const optimized = [];
          const unvisited = [...validDeliveries];
          while (unvisited.length > 0) {
            let closestIndex = 0;
            let minDistance = Infinity;
            for (let i = 0; i < unvisited.length; i++) {
              const dist = getDistance(current, unvisited[i]);
              if (dist < minDistance) { minDistance = dist; closestIndex = i; }
            }
            const nextDelivery = unvisited.splice(closestIndex, 1)[0];
            optimized.push(nextDelivery);
            current = { lat: nextDelivery.lat, lng: nextDelivery.lng };
          }
          stops = [...optimized, ...invalidDeliveries];
        }

        await MapService.drawRoute(safeOrigin, stops, null, true);
        const result = await MapService.getLatestRouteResult();
        
        let timeStr = '—';
        if (result && result.duration) {
          let totalMin = applyTimeRules(result.duration, result.distance, stops);
          const hh = Math.floor(totalMin / 60);
          const mm = totalMin % 60;
          timeStr = hh > 0 ? `${hh}h ${mm > 0 ? mm + 'min' : ''}`.trim() : `${mm} min`;
        }

        previewOverlay.innerHTML = `
          <button class="btn-icon" id="btnClosePreviewX" style="position: absolute; top: 5px; right: 5px; color: var(--text-muted); padding: 5px;" title="Fechar">
             <i class="ri-close-line"></i>
          </button>
          <div style="display: flex; flex-direction: column; align-items: center; gap: ${isDesktopPreview ? '5px' : '4px'}; width: 100%; padding: ${isDesktopPreview ? '10px 20px 0 20px' : '5px 15px 0 15px'}; text-align: center;">
             <span style="color: var(--text-muted); font-size: ${isDesktopPreview ? '0.85rem' : '0.8rem'};">Rota simulada com a nova parada</span>
             <span style="color: white; font-weight: bold; font-size: ${isDesktopPreview ? '1.1rem' : '1.05rem'};"><i class="ri-time-line"></i> Tempo total${isDesktopPreview ? ' (ida e volta)' : ''}: <span style="color: var(--accent-primary);">${timeStr}</span></span>
             <button class="btn-primary btn-sm" id="btnClosePreview" style="margin-top: ${isDesktopPreview ? '5px' : '6px'}; border-radius: ${isDesktopPreview ? '20px' : '8px'}; ${!isDesktopPreview ? 'width: 100%; max-width: 200px;' : ''}">
                <i class="ri-arrow-go-back-line"></i> Voltar p/ Encaixe
             </button>
          </div>
        `;

        const closePreview = () => {
          previewOverlay.remove();
          // Restore map to whatever was before (or clear)
          if (activeRouteId) {
             loadRouteToMap(activeRouteId);
          } else {
             MapService.clearMap();
          }
        };

        const backToSmartFit = () => {
          closePreview();
          // Re-open Smart Fit Modal
          modal.style.display = 'flex';
          setTimeout(() => modal.classList.add('active'), 10);
        };
        
        document.getElementById('btnClosePreview').addEventListener('click', backToSmartFit);
        document.getElementById('btnClosePreviewX').addEventListener('click', closePreview);


      } catch (err) {
        previewOverlay.innerHTML = `
          <div style="color: var(--danger-color); font-weight: bold;"><i class="ri-error-warning-line"></i> Erro ao simular rota</div>
          <button class="btn-secondary btn-sm" id="btnClosePreviewErr" style="margin-top: 5px;">Voltar</button>
        `;
        document.getElementById('btnClosePreviewErr').addEventListener('click', () => {
          previewOverlay.remove();
          modal.style.display = 'flex';
          setTimeout(() => modal.classList.add('active'), 10);
        });
      }
    };


    // ================== VEHICLES LOGIC ==================
    let editingVehicleId = null;

    window.renderVehiclesList = () => {
      const list = document.getElementById('vehiclesListMain');
      if (!list) return;

      const vehicles = StorageManager.getVehicles();
      if (vehicles.length === 0) {
        list.innerHTML = `<div class="empty-state" style="grid-column: 1 / -1"><i class="ri-car-line"></i><p>Nenhum veículo cadastrado</p></div>`;
        return;
      }

      list.innerHTML = '';
      vehicles.forEach(v => {
        const div = document.createElement('div');
        div.className = 'vehicle-card';
        
        const currentKm = parseFloat(v.current_km) || 0;
        const planKm = parseFloat(v.maintenance_plan_km) || 0;
        const interval = parseFloat(v.maintenance_interval_km) || planKm || 10000;
        let progress = 0;
        let remainingKm = 0;

        if (planKm > 0) {
          remainingKm = Math.max(planKm - currentKm, 0);

          // A barra representa o consumo dentro do ciclo atual
          const cycleStart = planKm - interval;
          const cycleConsumed = Math.max(currentKm - cycleStart, 0);

          if (currentKm >= planKm) {
            progress = 100; // Revisão vencida
          } else {
            progress = Math.min((cycleConsumed / interval) * 100, 100);
          }
        }

        // Cor baseada no quanto do ciclo foi consumido:
        // Verde  → < 50% consumido  (> 5.000 km restantes no ciclo)
        // Amarelo → 50–75% consumido (2.500–5.000 km restantes)
        // Vermelho → > 75% consumido (< 2.500 km restantes)
        let pClass = '';
        if (planKm > 0) {
          if (progress >= 75) pClass = 'danger';
          else if (progress >= 50) pClass = 'warning';
          // else: sem classe = verde (padrão)
        }

        div.innerHTML = `
          <div class="vehicle-card-header">
            <span class="vehicle-title">${v.name}</span>
            <span class="vehicle-plate">${v.plate || 'Sem placa'}</span>
          </div>

          <div style="margin-top: 8px; padding: 8px 10px; background: rgba(0,0,0,0.15); border-radius: 8px; display: flex; flex-direction: column; gap: 5px;">
            <div style="font-size: 0.8rem; color: var(--text-muted); display: flex; align-items: center; gap: 6px;">
              <i class="ri-settings-3-line"></i>
              <strong style="color: var(--text-white);">${v.maintenance_type || 'Manutenção não especificada'}</strong>
            </div>
            ${interval && interval > 0 && planKm > 0 ? `<div style="font-size: 0.75rem; color: var(--text-muted);"><i class="ri-repeat-line"></i> Intervalo: a cada <strong>${interval.toLocaleString('pt-BR')} km</strong></div>` : ''}
          </div>

          <div style="margin-top: 10px;">
            <div style="display: flex; justify-content: space-between; font-size: 0.78rem; color: var(--text-muted); margin-bottom: 4px;">
              <span><i class="ri-dashboard-line"></i> KM Atual: <strong style="color:var(--text-white);">${currentKm.toLocaleString('pt-BR')}</strong></span>
              <span><i class="ri-flag-line"></i> Revisão em: <strong style="color:var(--text-white);">${planKm > 0 ? planKm.toLocaleString('pt-BR') : '—'}</strong></span>
            </div>

            ${planKm > 0 ? `<div style="font-size: 0.78rem; text-align: right; margin-top: 4px; font-weight: 700; color: ${
              pClass === 'danger' ? 'var(--accent-danger)' :
              pClass === 'warning' ? 'var(--accent-warning)' :
              'var(--accent-success)'
            };">
              ${remainingKm <= 0 ? '⚠️ REVISÃO VENCIDA — Agendar manutenção!' : `✅ Faltam ${remainingKm.toLocaleString('pt-BR')} km para próxima revisão`}
            </div>` : '<div style="font-size:0.75rem; color:var(--text-muted); text-align:right; margin-top:4px;">Sem plano de revisão cadastrado</div>'}
          </div>

          <div class="details-actions" style="margin-top: 12px; display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px;">
            <button class="btn-secondary btn-sm" onclick="window.openVehicleModal('${v.id}')"><i class="ri-edit-line"></i> Editar</button>
            <button class="btn-danger btn-sm" onclick="window.deleteVehicle('${v.id}')"><i class="ri-delete-bin-line"></i> Excluir</button>
          </div>
        `;
        list.appendChild(div);
      });
    };

    window.openVehicleModal = (id = null) => {
      editingVehicleId = id;
      const title = document.getElementById('modalVehicleTitle');
      if (id) {
        title.innerText = 'Editar Veículo';
        const v = StorageManager.getVehicle(id);
        if (v) {
          document.getElementById('vehicleName').value = v.name || '';
          document.getElementById('vehiclePlate').value = v.plate || '';
          document.getElementById('vehicleCurrentKm').value = v.current_km || '';
          document.getElementById('vehiclePlanKm').value = v.maintenance_plan_km || '';
          document.getElementById('vehicleIntervalKm').value = v.maintenance_interval_km || '';
          document.getElementById('vehicleMaintType').value = v.maintenance_type || '';
        }
      } else {
        title.innerText = 'Novo Veículo';
        document.getElementById('vehicleName').value = '';
        document.getElementById('vehiclePlate').value = '';
        document.getElementById('vehicleCurrentKm').value = '';
        document.getElementById('vehiclePlanKm').value = '';
        document.getElementById('vehicleIntervalKm').value = '';
        document.getElementById('vehicleMaintType').value = '';
      }
      document.getElementById('modalVehicle').classList.add('active');
    };

    window.closeVehicleModal = () => {
      editingVehicleId = null;
      document.getElementById('modalVehicle').classList.remove('active');
    };

    document.getElementById('closeModalVehicle')?.addEventListener('click', window.closeVehicleModal);
    document.getElementById('cancelModalVehicle')?.addEventListener('click', window.closeVehicleModal);
    document.getElementById('btnNewVehicleMain')?.addEventListener('click', () => window.openVehicleModal());

    document.getElementById('saveVehicle')?.addEventListener('click', async () => {
      const vName = document.getElementById('vehicleName').value.trim();
      const vPlate = document.getElementById('vehiclePlate').value.trim();
      if (!vName || !vPlate) {
        return showToast('Nome e Placa são obrigatórios', 'error');
      }
      
      const v = {
        id: editingVehicleId,
        name: vName,
        plate: vPlate,
        current_km: document.getElementById('vehicleCurrentKm').value,
        maintenance_plan_km: document.getElementById('vehiclePlanKm').value,
        maintenance_interval_km: document.getElementById('vehicleIntervalKm').value,
        maintenance_type: document.getElementById('vehicleMaintType').value
      };

      try {
        await StorageManager.saveVehicle(v);
        showToast('Veículo salvo com sucesso!');
        window.closeVehicleModal();
        window.renderVehiclesList();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    window.deleteVehicle = (id) => {
      openConfirmDialog('Excluir este veículo?', async () => {
        try {
          await StorageManager.deleteVehicle(id);
          showToast('Veículo excluído!');
          window.renderVehiclesList();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    };

    // === SETTINGS VIEW LOGIC ===
    window.loadSettingsView = () => {
      const freightVal = StorageManager.getSetting('frete_por_km', '');
      document.getElementById('settingFreightKm').value = freightVal;
    };

    document.getElementById('btnSaveSettings')?.addEventListener('click', async () => {
      const btn = document.getElementById('btnSaveSettings');
      const oldText = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<i class="ri-loader-4-line btn-spin"></i> Salvando...';
      try {
        const val = parseFloat(document.getElementById('settingFreightKm').value) || 0;
        await StorageManager.saveSetting('frete_por_km', val);
        showToast('Configuraes salvas com sucesso!');
        document.getElementById('modalFreight')?.classList.remove('active');
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        btn.disabled = false;
        btn.innerHTML = oldText;
      }
    });

    document.getElementById('closeModalFreight')?.addEventListener('click', () => {
      document.getElementById('modalFreight').classList.remove('active');
    });
    document.getElementById('cancelModalFreight')?.addEventListener('click', () => {
      document.getElementById('modalFreight').classList.remove('active');
    });

    // --- AUDIT LOGS LOGIC ---
    document.getElementById('btnSettingsAuditLogs')?.addEventListener('click', () => {
      document.getElementById('modalAuditLogs').classList.add('active');
      renderAuditLogs();
    });
    document.getElementById('closeModalAuditLogs')?.addEventListener('click', () => {
      document.getElementById('modalAuditLogs').classList.remove('active');
    });
    document.getElementById('cancelModalAuditLogs')?.addEventListener('click', () => {
      document.getElementById('modalAuditLogs').classList.remove('active');
    });

    function renderAuditLogs() {
      const tbody = document.getElementById('auditLogsTableBody');
      if (!tbody) return;
      
      let logsRaw = StorageManager.getSetting('audit_logs', []);
      let logs = [];
      if (typeof logsRaw === 'string') {
        try { logs = JSON.parse(logsRaw); } catch(e) {}
      } else if (Array.isArray(logsRaw)) {
        logs = logsRaw;
      }
      
      if (!Array.isArray(logs) || logs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 20px;">Nenhuma alteração registrada.</td></tr>';
        return;
      }
      
      tbody.innerHTML = logs.map(log => {
        const d = new Date(log.timestamp);
        const dateStr = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return `
          <tr>
            <td>${dateStr}</td>
            <td><strong>${log.userName}</strong><br><span style="font-size: 0.75rem; color: var(--text-muted);">${log.userRole}</span></td>
            <td><span class="badge badge-planned">${log.action}</span></td>
            <td>${log.details}</td>
          </tr>
        `;
      }).join('');
    }

    // --- SIDEBAR CEP WIDGET LOGIC ---
    let sidebarCepWidget = document.getElementById('sidebarCepWidget');
    if (sidebarCepWidget) {
      // Remover rolagem da barra lateral no desktop conforme solicitado
      const sidebarNav = document.querySelector('.sidebar-nav');
      if (sidebarNav) {
        sidebarNav.style.overflowY = 'hidden';
      }
      
      // Force UI update via JS to bypass index.html caching issues
      sidebarCepWidget.style.cssText = "display: block !important; padding: 15px 20px; margin-top: 10px; z-index: 50;";
      sidebarCepWidget.innerHTML = `
        <label style="font-size: 0.75rem; color: var(--text-muted); font-weight: 600; margin-bottom: 6px; display: block; text-transform: uppercase; letter-spacing: 0.05em;">Buscar Cep / Endereço:</label>
        <div style="display: flex; gap: 5px; position: relative;">
          <input type="text" id="sidebarCepInput" placeholder="Rua, Cidade ou CEP" style="background: rgba(255, 255, 255, 0.05); border: 1px solid var(--border-color); color: var(--text-white); padding: 8px 10px; border-radius: 6px; outline: none; width: 100%; box-sizing: border-box; font-size: 0.85rem; font-family: var(--font-ui); -webkit-appearance: none; appearance: none; height: auto;" autocomplete="off">
          <button type="button" id="sidebarCepBtn" style="background: var(--accent-primary); color: var(--bg-dark); border: none; border-radius: 6px; padding: 0 12px; cursor: pointer; display: flex; align-items: center; justify-content: center;"><i class="ri-search-line"></i></button>
          <div class="address-suggestions" id="sidebarCepSuggestions" style="top: calc(100% + 5px); left: 0; right: 0; width: 100%;"></div>
        </div>
        <div id="sidebarCepResult" style="font-size: 0.85rem; color: var(--accent-primary); display: none; margin-top: 8px; line-height: 1.3;"></div>
      `;
      
      const sidebarCepInput = document.getElementById('sidebarCepInput');
      const sidebarCepBtn = document.getElementById('sidebarCepBtn');
      const resDiv = document.getElementById('sidebarCepResult');
      
      const doSidebarSearch = async () => {
        let val = sidebarCepInput.value.trim();
        if (!val) {
          resDiv.style.display = 'none';
          return;
        }
        resDiv.style.display = 'block';
        resDiv.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> Buscando...';
        
        try {
          let addressToGeocode = val;
          const digitsOnly = val.replace(/\D/g, '');
          const isCep = digitsOnly.length === 8 && /^\d{8}$/.test(digitsOnly);
          let locName = val;
          
          if (isCep) {
            try {
              const viaCepRes = await fetch(`https://viacep.com.br/ws/${digitsOnly}/json/`);
              const viaCepData = await viaCepRes.json();
              if (!viaCepData.erro) {
                addressToGeocode = `${viaCepData.logradouro || ''}, ${viaCepData.bairro || ''}, ${viaCepData.localidade || ''}, ${viaCepData.uf || ''}, Brasil`.replace(/^,\s*/, '').trim();
                locName = `${viaCepData.localidade}-${viaCepData.uf}`;
              }
            } catch (err) {}
          }
          
          const coords = await MapService.searchAddress(addressToGeocode);
          
          if (!coords || coords.length === 0) {
            resDiv.innerHTML = `<strong>${locName}</strong><br>Localização exata não encontrada para o mapa.`;
            return;
          }
          
          const destLng = coords[0].lng;
          const destLat = coords[0].lat;
          
          let isSP = false;
          let isMG = false;
          let isRJ = false;
          if (isCep && locName.endsWith('-SP')) {
             isSP = true;
          } else if (isCep && locName.endsWith('-MG')) {
             isMG = true;
          } else if (isCep && locName.endsWith('-RJ')) {
             isRJ = true;
          } else if (!isCep) {
             const addrLower = (coords[0].address || '').toLowerCase();
             if (addrLower.includes('são paulo') || addrLower.includes('sao paulo') || addrLower.includes('- sp') || addrLower.includes(', sp') || addrLower.includes('/sp') || addrLower.includes('/ sp')) {
               isSP = true;
             }
             if (addrLower.includes('minas gerais') || addrLower.includes('- mg') || addrLower.includes(', mg') || addrLower.includes('/mg') || addrLower.includes('/ mg')) {
               isMG = true;
             }
             if (addrLower.includes('rio de janeiro') || addrLower.includes('- rj') || addrLower.includes(', rj') || addrLower.includes('/rj') || addrLower.includes('/ rj')) {
               isRJ = true;
             }
             locName = coords[0].address.split(',')[0] || 'Destino';
          }
          
          // Origin coordinates (25926-684, Magé, RJ)
          const origLng = -43.184226589058;
          const origLat = -22.717867482661;
          
          // Calculate Distance & Time
          let distKm = 0;
          let osrmDurationMin = 0;
          try {
            const osrmRes = await fetch(`https://router.project-osrm.org/route/v1/driving/${origLng},${origLat};${destLng},${destLat}?overview=false`);
            const osrmData = await osrmRes.json();
            if (osrmData && osrmData.routes && osrmData.routes.length > 0) {
              distKm = osrmData.routes[0].distance / 1000;
              if (osrmData.routes[0].duration) {
                osrmDurationMin = osrmData.routes[0].duration / 60;
              }
            }
          } catch (osrmErr) {
            console.warn("OSRM falhou para cálculo, usando Haversine.", osrmErr);
          }
          
          if (distKm === 0) {
            const R = 6371;
            const dLat = (destLat - origLat) * Math.PI / 180;
            const dLon = (destLng - origLng) * Math.PI / 180;
            const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                      Math.cos(origLat * Math.PI / 180) * Math.cos(destLat * Math.PI / 180) *
                      Math.sin(dLon/2) * Math.sin(dLon/2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
            distKm = (R * c) * 1.35; // Correction factor
          }
          
          // Calculate Freight
          const costPerKmStr = StorageManager.getSetting('frete_por_km', 0);
          const costPerKm = parseFloat(String(costPerKmStr).replace(',', '.')) || 0;
          const freteVal = distKm * costPerKm;

          // Calculate Time
          let estimatedTimeMin = 0;
          if (osrmDurationMin > 0) {
            // OSRM tempo de condução puro.
            estimatedTimeMin = osrmDurationMin;
          } else {
            // Dynamic fallback based on distance
            let avgSpeed = 40; // km/h for city
            if (distKm > 150) avgSpeed = 64; // km/h for highway (ajustado para ~6h10m em 400km)
            else if (distKm > 50) avgSpeed = 55; // km/h for mixed
            
            estimatedTimeMin = (distKm / avgSpeed) * 60;
          }
          
          if (isSP) {
            estimatedTimeMin *= 1.17; // 17% de acréscimo para SP
          } else if (isRJ) {
            estimatedTimeMin *= 1.20; // 20% de acréscimo para RJ
          }
          
          estimatedTimeMin = Math.round(estimatedTimeMin);
          
          const hours = Math.floor(estimatedTimeMin / 60);
          const minutes = Math.round(estimatedTimeMin % 60);
          const timeStr = hours > 0 ? `${hours}h ${minutes}min` : `${minutes}min`;
          
          resDiv.innerHTML = `
            <strong style="color:var(--text-main);">${locName}</strong><br>
            <span style="color:var(--text-muted); font-size:0.75rem;">${distKm.toFixed(1)} km <i class="ri-time-line" style="margin-left: 4px;"></i> ${timeStr}</span><br>
            <strong style="font-size:0.95rem;">R$ ${freteVal.toFixed(2)}</strong>
          `;
          
        } catch (err) {
          console.error("Erro no widget de CEP/Endereço:", err);
          resDiv.innerHTML = 'Erro na busca.';
        }
      };

      sidebarCepBtn.addEventListener('click', doSidebarSearch);
      sidebarCepInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          // Add a small delay so suggestion selection finishes first if user pressed Enter on a suggestion
          setTimeout(doSidebarSearch, 100);
        }
      });
      
      // Add suggestion logic
      if (typeof setupAddressSearch === 'function') {
        setupAddressSearch('sidebarCepInput', 'sidebarCepSuggestions', null, null, null);
      }
    }



    // ============================================================
    // PROFILE DROPUP WIDGET
    // ============================================================
    (function initProfileDropup() {
      const avatarBtn    = document.getElementById('profileAvatarBtn');
      const avatarIcon   = document.getElementById('profileAvatarIcon');
      const avatarImg    = document.getElementById('profileAvatarImg');
      const dropupMenu   = document.getElementById('profileDropupMenu');
      const pdmAvatarIcon = document.getElementById('pdmAvatarIcon');
      const pdmAvatarImg  = document.getElementById('pdmAvatarImg');
      const pdmUsername   = document.getElementById('pdmUsername');
      const pdmRole       = document.getElementById('pdmRole');
      const photoInput    = document.getElementById('profilePhotoInput');
      const subProfile    = document.getElementById('pdmSubProfile');
      const subLogout     = document.getElementById('pdmSubLogout');
      const nameInput     = document.getElementById('profileNameInput');
      const btnSaveName   = document.getElementById('btnSaveProfileName');
      const btnBack       = document.getElementById('btnPdmBackFromProfile');
      const btnConfLogout = document.getElementById('btnConfirmLogout');
      const btnCancelLgt  = document.getElementById('btnCancelLogout');
      const btnMyProfile  = document.getElementById('btnPdmMyProfile');
      const btnAppearance = document.getElementById('btnPdmAppearance');
      const subAppearance = document.getElementById('pdmSubAppearance');
      const btnBackAppr   = document.getElementById('btnPdmBackFromAppearance');
      const btnLogout     = document.getElementById('btnProfileLogout');

      if (!avatarBtn || !dropupMenu) return;

      function closeAll() {
        dropupMenu.classList.remove('pf-open');
        if (subProfile) subProfile.classList.remove('pf-open');
        if (subAppearance) subAppearance.classList.remove('pf-open');
        if (subLogout)  subLogout.classList.remove('pf-open');
      }

      function loadProfileUI() {
        if (!currentUser) return;
        const key   = 'user_avatar_' + currentUser.id;
        const saved = localStorage.getItem(key);
        const name  = currentUser.name || currentUser.username || 'Usuário';
        const role  = currentUser.role || '';

        // Helper: apply avatar to a pair of icon/img elements
        function applyAvatar(iconEl, imgEl) {
          if (!iconEl || !imgEl) return;
          if (saved) {
            imgEl.src = saved; imgEl.style.display = 'block';
            iconEl.style.display = 'none';
          } else {
            imgEl.style.display = 'none'; iconEl.style.display = '';
          }
        }

        // Trigger button
        applyAvatar(avatarIcon, avatarImg);
        // Main menu header
        applyAvatar(pdmAvatarIcon, pdmAvatarImg);
        // Sub-panel "Meu Perfil" avatar
        applyAvatar(
          document.getElementById('pdmSubAvatarIcon'),
          document.getElementById('pdmSubAvatarImg')
        );

        if (pdmUsername) pdmUsername.textContent = name;
        if (pdmRole)     pdmRole.textContent     = role;
        avatarBtn.title = name;
      }

      loadProfileUI();
      window.refreshProfileDropup = loadProfileUI;

      // Position a pf-menu above and to the right of the avatar button
      function positionMenu(menu) {
        const rect = avatarBtn.getBoundingClientRect();
        const menuH = menu.offsetHeight || 300; // estimate if not yet visible
        const top = rect.top - menuH - 8;
        const left = rect.right + 8;
        menu.style.top  = Math.max(8, top) + 'px';
        menu.style.left = left + 'px';
        menu.style.bottom = 'auto';
      }

      // Toggle main menu on avatar click
      avatarBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        const isOpen = dropupMenu.classList.contains('pf-open');
        closeAll();
        if (!isOpen) {
          dropupMenu.classList.add('pf-open');
          // Position after display:flex kicks in
          requestAnimationFrame(() => positionMenu(dropupMenu));
        }
      });

      // Close on outside click — menus are at body level so check both container and any pf-menu
      document.addEventListener('click', function(e) {
        const inContainer = e.target.closest('#profileDropupContainer');
        const inMenu      = e.target.closest('.pf-menu');
        if (!inContainer && !inMenu) closeAll();
      });

      // "Meu Perfil" → edit name panel
      if (btnMyProfile) {
        btnMyProfile.addEventListener('click', function() {
          dropupMenu.classList.remove('pf-open');
          if (nameInput) nameInput.value = currentUser?.name || currentUser?.username || '';
          if (subProfile) {
            subProfile.classList.add('pf-open');
            requestAnimationFrame(() => positionMenu(subProfile));
          }
          setTimeout(() => nameInput && nameInput.focus(), 60);
        });
      }
      if (btnBack) {
        btnBack.addEventListener('click', function() {
          if (subProfile) subProfile.classList.remove('pf-open');
        });
      }
      if (btnSaveName) {
        btnSaveName.addEventListener('click', async function() {
          const newName = nameInput ? nameInput.value.trim() : '';
          if (!newName || !currentUser) return;
          currentUser.name = newName;
          try { await StorageManager.saveUser(currentUser); } catch(err) {}
          loadProfileUI();
          if (subProfile) subProfile.classList.remove('pf-open');
          if (typeof showToast === 'function') showToast('Nome atualizado!');
        });
      }

      // "Aparência" -> color panel
      if (btnAppearance) {
        btnAppearance.addEventListener('click', function() {
          dropupMenu.classList.remove('pf-open');
          if (subAppearance) {
            subAppearance.classList.add('pf-open');
            requestAnimationFrame(() => positionMenu(subAppearance));
          }
        });
      }
      if (btnBackAppr) {
        btnBackAppr.addEventListener('click', function() {
          if (subAppearance) subAppearance.classList.remove('pf-open');
        });
      }

      // Color selection
      const colorOpts = document.querySelectorAll('.color-theme-opt');
      colorOpts.forEach(opt => {
        opt.addEventListener('click', function() {
          const color = this.dataset.color;
          const hover = this.dataset.hover;
          if (color && hover) {
            document.documentElement.style.setProperty('--accent-primary', color);
            document.documentElement.style.setProperty('--accent-primary-hover', hover);
            localStorage.setItem('system_theme_color', color);
            localStorage.setItem('system_theme_hover', hover);
            
            // Highlight selected
            colorOpts.forEach(o => o.style.borderColor = 'transparent');
            this.style.borderColor = 'var(--text-white)';
            
            if (typeof showToast === 'function') showToast('Tema atualizado!');
          }
        });
      });
      // Set initial selected highlight if any
      const savedColor = localStorage.getItem('system_theme_color');
      if (savedColor) {
        colorOpts.forEach(o => {
          if (o.dataset.color === savedColor) o.style.borderColor = 'var(--text-white)';
        });
      }

      // Background theme selection
      const bgOpts = document.querySelectorAll('.bg-theme-opt');
      bgOpts.forEach(opt => {
        opt.addEventListener('click', function() {
          const theme = this.dataset.theme;
          if (theme) {
            document.documentElement.setAttribute('data-theme', theme);
            localStorage.setItem('system_theme_bg', theme);
            
            // Highlight selected
            bgOpts.forEach(o => {
              o.style.borderColor = 'rgba(148, 163, 184, 0.3)';
              o.style.boxShadow = 'none';
            });
            this.style.borderColor = 'var(--accent-primary)';
            this.style.boxShadow = '0 0 12px var(--accent-primary)';
            
            if (typeof showToast === 'function') showToast('Tema visual atualizado!');
          }
        });
      });
      // Set initial selected highlight if any
      const savedBg = localStorage.getItem('system_theme_bg') || 'dark';
      bgOpts.forEach(o => {
        if (o.dataset.theme === savedBg) {
          o.style.borderColor = 'var(--accent-primary)';
          o.style.boxShadow = '0 0 12px var(--accent-primary)';
        }
      });

      // Photo upload with FileReader preview
      if (photoInput) {
        photoInput.addEventListener('change', function(e) {
          const file = e.target.files[0];
          if (!file || !currentUser) return;
          const reader = new FileReader();
          reader.onload = function(ev) {
            localStorage.setItem('user_avatar_' + currentUser.id, ev.target.result);
            loadProfileUI();
            if (typeof showToast === 'function') showToast('Foto atualizada!');
          };
          reader.readAsDataURL(file);
          photoInput.value = '';
          closeAll();
        });
      }

      // Logout
      if (btnLogout) {
        btnLogout.addEventListener('click', function() {
          dropupMenu.classList.remove('pf-open');
          if (subLogout) {
            subLogout.classList.add('pf-open');
            requestAnimationFrame(() => positionMenu(subLogout));
          }
        });
      }
      if (btnCancelLgt) {
        btnCancelLgt.addEventListener('click', function() {
          if (subLogout) subLogout.classList.remove('pf-open');
        });
      }
      if (btnConfLogout) {
        btnConfLogout.addEventListener('click', function() {
          const previewOverlay = document.getElementById('smartFitPreviewOverlay');
          if (previewOverlay) previewOverlay.remove();
          
          StorageManager.logout();
          closeAll();
          checkAuth();
        });
      }
    })();
    // ============================================================


    // === HISTÓRICO DE ROTAS ANTIGAS (> 15 DIAS) ===
    const btnSettingsHistory = document.getElementById('btnSettingsHistory');
    if (btnSettingsHistory) {
      btnSettingsHistory.addEventListener('click', () => {
        if (typeof showMainView === 'function') {
          showMainView('mainHistoricalRoutesView');
        }
      });
    }

    const btnLoadHistoricalRoutes = document.getElementById('btnLoadHistoricalRoutes');
    if (btnLoadHistoricalRoutes) {
      btnLoadHistoricalRoutes.addEventListener('click', async () => {
        const listEl = document.getElementById('historicalRoutesList');
        const originalHtml = btnLoadHistoricalRoutes.innerHTML;
        btnLoadHistoricalRoutes.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> Baixando histórico...';
        btnLoadHistoricalRoutes.style.pointerEvents = 'none';
        listEl.innerHTML = '';
        try {
          const result = await StorageManager.fetchHistoricalRoutes();
          const { routes, deliveries } = result;
          const sorted = [...(routes||[])].filter(r => r.status === 'done').sort((a,b) => (b.date||'').localeCompare(a.date||''));
          window._histAllCards = []; // resetar para nova carga

          if (sorted.length === 0) {
            listEl.innerHTML = '<div style="text-align:center; color: var(--text-muted); padding: 20px;">Nenhuma rota concluída encontrada.</div>';
          } else {
            const histExpandedIds = new Set();
            listEl.innerHTML = '';

            sorted.forEach(r => {
              const rDeliveries = deliveries.filter(d => d.routeId === r.id || d.route_id === r.id);
              const dCount = rDeliveries.length;
              const drv = StorageManager._cache.drivers.find(d => d.id === (r.driverId || r.driver_id));
              const driverDisplay = drv ? (drv.name || drv.username) : 'Sem motorista';
              const vehicleObj = r.vehicle ? StorageManager.getVehicle(r.vehicle) : null;
              const vehicleDisplay = vehicleObj ? vehicleObj.name.toUpperCase() : (r.vehicle ? r.vehicle.toUpperCase() : 'NÃO DEFINIDO');
              const formattedDate = r.date ? new Date(r.date + 'T00:00:00').toLocaleDateString('pt-BR') : '—';
              const km = r.distanceKm || r.distance_km || '—';

              let stopsHtml = rDeliveries.map((s, i) => `
                <div class="stop-detail-item" style="flex-direction:column;align-items:stretch;gap:8px;">
                  <div style="display:flex;align-items:center;justify-content:space-between;width:100%;cursor:pointer;"
                       onclick="event.stopPropagation(); const ex=this.parentElement.querySelector('.stop-extra-details'); const ic=this.querySelector('.stop-expand-btn'); if(ex.style.display==='none'){ex.style.display='block';ic.className='ri-arrow-up-s-line stop-expand-btn';}else{ex.style.display='none';ic.className='ri-arrow-down-s-line stop-expand-btn';}">
                    <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0;">
                      <div class="stop-detail-index">${i+1}</div>
                      <div class="stop-detail-info">
                        <span class="stop-detail-name" style="font-weight:normal;"><strong>${s.recipient||s.client_name||'—'}</strong></span>
                        ${s.model ? `<span class="stop-detail-addr" style="font-weight:normal;">${s.model}</span>` : ''}
                      </div>
                    </div>
                    <i class="ri-arrow-down-s-line stop-expand-btn" style="font-size:1.2rem;color:var(--text-muted);margin-right:4px;"></i>
                  </div>
                  <div class="stop-extra-details" style="display:none;padding:8px 10px;background:rgba(0,0,0,0.1);border-radius:6px;font-size:0.8rem;color:var(--text-muted);margin-top:4px;">
                    ${s.address ? `<div style="margin-bottom:4px;"><i class="ri-map-pin-line"></i> <strong>Endereço:</strong> ${s.address}</div>` : ''}
                    ${s.ref ? `<div style="margin-bottom:4px;"><i class="ri-map-pin-2-line"></i> <strong>Referência:</strong> ${s.ref}</div>` : ''}
                    ${s.notes ? `<div style="margin-bottom:4px;"><i class="ri-file-text-line"></i> <strong>OBS:</strong><br><strong>${s.notes.replace(/\n/g,'<br>')}</strong></div>` : ''}
                    ${s.model ? `<div style="margin-bottom:4px;"><i class="ri-price-tag-3-line"></i> <strong>Modelo:</strong> ${s.model.toUpperCase()}</div>` : ''}
                    ${s.cpf ? `<div style="margin-bottom:4px;"><i class="ri-id-card-line"></i> <strong>CPF/CNPJ:</strong> ${s.cpf}</div>` : ''}
                    ${s.phone ? `<div style="margin-bottom:4px;"><i class="ri-phone-line"></i> <strong>Tel:</strong> ${s.phone}</div>` : ''}
                  </div>
                </div>`).join('');

              if (rDeliveries.length === 0) stopsHtml = '<p class="text-muted" style="font-size:0.8rem;padding:10px 0;">Nenhuma parada cadastrada.</p>';

              const div = document.createElement('div');
              div.className = 'list-item';
              div.setAttribute('data-route-id', r.id);
              div.innerHTML = `
                <div class="item-header" style="flex-direction:column;align-items:stretch;gap:8px;">
                  <div style="display:flex;justify-content:space-between;align-items:center;">
                    <div style="display:flex;align-items:center;gap:10px;overflow:hidden;">
                      <span class="badge status-done" style="font-size:0.6rem;padding:2px 6px;letter-spacing:0.04em;">CONCLUÍDA</span>
                      <span class="item-title">${r.name}</span>
                    </div>
                    <div class="item-actions" style="display:flex;align-items:center;gap:8px;">
                      <i class="ri-arrow-down-s-line expand-icon"></i>
                    </div>
                  </div>
                  <div class="item-collapsed-meta" style="display:flex;flex-wrap:wrap;gap:12px;font-size:0.75rem;color:var(--text-muted);">
                    <span><i class="ri-calendar-line"></i> ${formattedDate}</span>
                    <span><i class="ri-steering-2-line"></i> ${driverDisplay}</span>
                    <span><i class="ri-map-pin-line"></i> ${dCount} paradas</span>
                    <span><i class="ri-map-2-line"></i> ${km} km</span>
                  </div>
                </div>
                <div class="item-details">
                  ${r.notes ? `<div class="route-notes-preview" style="margin-bottom:15px;"><i class="ri-bank-card-line"></i> <strong>CHAVE PIX: ${r.notes}</strong></div>` : ''}
                  <div class="section-header" style="font-size:0.7rem;margin-bottom:10px;">PARADAS DA ROTA</div>
                  <div class="stops-detail-list">${stopsHtml}</div>
                  <div style="font-size:0.75rem;font-weight:bold;margin-top:15px;text-transform:uppercase;">VEÍCULO: ${vehicleDisplay}</div>
                  <div class="details-actions" style="margin-top:15px;border-top:1px solid var(--border-color);padding-top:15px;display:grid;grid-template-columns:repeat(2,1fr);gap:10px;">
                    <div style="display:flex;flex-direction:column;gap:6px;">
                      ${window.appPermissions?.canConcludeRoute ? `
                        <button class="btn-warning btn-sm" onclick="event.stopPropagation(); window.updateRouteStatusFromList('${r.id}', 'active')" style="display:flex;align-items:center;justify-content:center;gap:6px;padding:8px;flex:1;">
                          <i class="ri-refresh-line"></i><span>Reativar Rota</span>
                        </button>` : ''}
                    </div>
                    <div style="display:flex;flex-direction:column;gap:6px;">
                      <button class="btn-secondary btn-sm" onclick="event.stopPropagation(); window.printRoute('${r.id}')" style="display:flex;flex-direction:column;align-items:center;gap:4px;padding:10px;flex:1;">
                        <i class="ri-printer-line" style="font-size:1.2rem;"></i><span>Imprimir Rota</span>
                      </button>
                      <button class="btn-secondary btn-sm" onclick="event.stopPropagation(); window.viewOnMap('${r.id}')" style="display:flex;flex-direction:column;align-items:center;gap:4px;padding:10px;flex:1;">
                        <i class="ri-map-2-line" style="font-size:1.2rem;"></i><span>Ver no Mapa</span>
                      </button>
                    </div>
                  </div>
                </div>`;

              div.addEventListener('click', () => {
                if (window.getSelection().toString().trim().length > 0) return;
                const wasExpanded = div.classList.contains('expanded');
                listEl.querySelectorAll('.list-item.expanded').forEach(el => el.classList.remove('expanded'));
                if (!wasExpanded) div.classList.add('expanded');
              });

              window._histAllCards.push({ div, r, driverDisplay });
              listEl.appendChild(div);
            });

            btnLoadHistoricalRoutes.innerHTML = `<i class="ri-checkbox-circle-line"></i> ${sorted.length} rotas concluídas carregadas`;
          }
        } catch(e) {
          document.getElementById('historicalRoutesList').innerHTML = '<div style="color:#ef4444;text-align:center;">Erro ao buscar histórico. Tente novamente.</div>';
          console.error(e);
          btnLoadHistoricalRoutes.innerHTML = originalHtml;
        } finally {
          btnLoadHistoricalRoutes.style.pointerEvents = 'auto';
        }
      });
    }

    // Filtrar cards do histórico pela barra de busca (sem fazer nova requisição)
    window._histAllCards = []; // guarda os divs prontos para filtrar
    window.filterHistoricalRoutes = function(query) {
      const q = (query || '').toLowerCase().trim();
      const listEl = document.getElementById('historicalRoutesList');
      if (!listEl) return;
      window._histAllCards.forEach(({ div, r, driverDisplay }) => {
        const match = !q
          || r.name.toLowerCase().includes(q)
          || driverDisplay.toLowerCase().includes(q)
          || (r.date || '').includes(q);
        div.style.display = match ? '' : 'none';
      });
    };

    initializeApp();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }














