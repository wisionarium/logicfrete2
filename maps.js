/**
 * LOGIC FRETE - Maps Integration (MapLibre GL JS + Nominatim + OSRM)
 * High performance vector maps.
 */

 const MapService = {
    map: null,
    markers: [],
    routeLayerId: 'route-line',
    routeSourceId: 'route-source',
    
    // Default config
    defaultCenter: [-46.6333, -23.5505], // São Paulo (MapLibre uses [lng, lat])
    defaultZoom: 12,

    // Available themes (OpenFreeMap & MapLibre compatible)
    themes: {
      dark: 'https://tiles.openfreemap.org/styles/dark',
      light: 'https://tiles.openfreemap.org/styles/liberty',
      satellite: {
        version: 8,
        sources: {
          'esri-satellite': {
            type: 'raster',
            tiles: [
              'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
            ],
            tileSize: 256,
            attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
          }
        },
        layers: [
          {
            id: 'esri-satellite-layer',
            type: 'raster',
            source: 'esri-satellite',
            minzoom: 0,
            maxzoom: 20
          }
        ]
      },
      terrain: {
        version: 8,
        sources: {
          'esri-terrain': {
            type: 'raster',
            tiles: [
              'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}'
            ],
            tileSize: 256,
            attribution: 'Tiles &copy; Esri'
          }
        },
        layers: [
          {
            id: 'esri-terrain-layer',
            type: 'raster',
            source: 'esri-terrain',
            minzoom: 0,
            maxzoom: 20
          }
        ]
      }
    },
  
    init(containerId) {
      if (!document.getElementById(containerId) || this.map) return;
  
      this._styleLoaded = false;

      this.map = new maplibregl.Map({
        container: containerId,
        style: this.themes.light, // Default to light mode
        center: this.defaultCenter,
        zoom: this.defaultZoom,
        attributionControl: false,
        touchZoomRotate: true // Enable pinch to zoom and rotation
      });
  
      // NavigationControl added to bottom-right
      this.map.addControl(new maplibregl.NavigationControl(), 'bottom-right');
      
      // GeolocateControl added to bottom-right
      this.map.addControl(new maplibregl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true
      }), 'bottom-right');

      this.map.on('load', () => {
        this._styleLoaded = true;
        // Force correct sizing after style load — critical for desktop (display:none → flex)
        this.map.resize();
      });

      // Mark style as re-loaded every time a new style finishes loading
      this.map.on('style.load', () => {
        this._styleLoaded = true;
        this.map.resize();
      });

      // Auto-resize map when its container becomes visible or changes size
      const containerEl = document.getElementById(containerId);
      if (window.ResizeObserver && containerEl) {
        new ResizeObserver(() => {
          if (this.map) this.map.resize();
        }).observe(containerEl);
      }
    },

    /**
     * Returns a Promise that resolves when the map style is fully loaded.
     * Polls until this.map is created (lazy-init case), then waits for style load.
     */
    waitReady() {
      return new Promise((resolve) => {
        const check = () => {
          if (!this.map) {
            // Map not yet initialized — poll every 50ms
            setTimeout(check, 50);
            return;
          }
          if (this.map.isStyleLoaded() || this._styleLoaded) {
            this._styleLoaded = true;
            resolve();
          } else {
            let isResolved = false;
            const onLoad = () => {
              if (isResolved) return;
              isResolved = true;
              this._styleLoaded = true;
              this.map.off('style.load', onLoad);
              resolve();
            };
            this.map.once('style.load', onLoad);
            // Fallback timeout just in case event is missed or style fails
            setTimeout(() => {
              if (!isResolved) {
                 isResolved = true;
                 this._styleLoaded = true;
                 resolve();
              }
            }, 2000);
          }
        };
        check();
      });
    },
  
    setBaseLayer(themeName) {
      if (!this.map || !this.themes[themeName]) return;
      this._styleLoaded = false;
      this.map.setStyle(this.themes[themeName]);
    },

    toggleTraffic() {
      if (!this.map) return false;

      const trafficSourceId = 'google-traffic-source';
      const trafficLayerId = 'google-traffic-layer';

      if (this.map.getLayer(trafficLayerId)) {
        this.map.removeLayer(trafficLayerId);
        this.map.removeSource(trafficSourceId);
        return false;
      } else {
        // Add Google Traffic Raster Source
        this.map.addSource(trafficSourceId, {
          type: 'raster',
          tiles: [
            'https://mt1.google.com/vt?lyrs=h,traffic&x={x}&y={y}&z={z}'
          ],
          tileSize: 256
        });

        this.map.addLayer({
          id: trafficLayerId,
          type: 'raster',
          source: trafficSourceId,
          paint: {
            'raster-opacity': 0.7
          }
        });
        return true;
      }
    },
  
    locateUser() {
      if (!this.map) return;
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(pos => {
          if (pos && pos.coords && typeof pos.coords.longitude === 'number' && typeof pos.coords.latitude === 'number') {
            this.map.flyTo({
              center: [pos.coords.longitude, pos.coords.latitude],
              zoom: 14
            });
          }
        }, err => {
          console.warn("Geolocation warning:", err);
        });
      }
    },
  
    clearMap() {
      if (!this.map) return;
      // Remove all markers
      this.markers.forEach(m => m.remove());
      this.markers = [];
      
      // Remove route layer (only if style is ready)
      if (this._styleLoaded && this.map.isStyleLoaded()) {
        if (this.map.getLayer(this.routeLayerId)) {
          this.map.removeLayer(this.routeLayerId);
        }
        if (this.map.getSource(this.routeSourceId)) {
          this.map.removeSource(this.routeSourceId);
        }
      }
    },
    _lastResult: null,
    _styleLoaded: false,

    getLatestRouteResult() {
      return this._lastResult;
    },

    // Manual Routing via OSRM + GeoJSON
    async drawRoute(origin, stops, onComplete, isPreview = false) {
      if (!this.map || !origin) return;

      // *** Wait for the map style to be fully loaded before doing anything ***
      await this.waitReady();

      this.clearMap();
      this._lastResult = null;
  
      // Add origin marker with coordinate protection
      if (typeof origin.lat === 'number' && typeof origin.lng === 'number' && !isNaN(origin.lat) && !isNaN(origin.lng)) {
        this.createMarker(origin.lat, origin.lng, 'O', 'planned', true)
            .setPopup(new maplibregl.Popup({ offset: 25 }).setHTML(`<strong>Ponto de Partida</strong><br>${origin.address || ''}`));
      }
  
      if (!stops || stops.length === 0) {
        if (typeof origin.lat === 'number' && typeof origin.lng === 'number' && !isNaN(origin.lat) && !isNaN(origin.lng)) {
          this.map.flyTo({ center: [origin.lng, origin.lat], zoom: 14 });
        }
        return;
      }
  
      // Filter stops to only include valid coordinates for markers and routing
      const validStops = stops.filter(s => typeof s.lat === 'number' && typeof s.lng === 'number' && !isNaN(s.lat) && !isNaN(s.lng));
  
      // Add stop markers for valid coordinates
      validStops.forEach((s, i) => {
        this.createMarker(s.lat, s.lng, i + 1, s.status, false, s.recipient)
            .setPopup(new maplibregl.Popup({ offset: 25 }).setHTML(`<strong>Parada ${i+1}: ${s.recipient}</strong><br>${s.address}`));
      });
  
      if (validStops.length === 0) {
        if (typeof origin.lat === 'number' && typeof origin.lng === 'number' && !isNaN(origin.lat) && !isNaN(origin.lng)) {
          this.map.flyTo({ center: [origin.lng, origin.lat], zoom: 14 });
        }
        return;
      }
  
      // Tenta OSRM primeiro (origem → paradas → origem para incluir retorno)
      let distKm = null;
      let durMin = null;
      try {
        const coordsArr = [
          [parseFloat(origin.lng), parseFloat(origin.lat)],
          ...validStops.map(s => [s.lng, s.lat]),
          [parseFloat(origin.lng), parseFloat(origin.lat)] // volta ao ponto de partida
        ];
        const coordsStr = coordsArr.map(c => c.join(',')).join(';');

        let geometry = null;

        // OSRM Call para desenhar rotas reais (ruas)
        const resp = await fetch(
          `https://router.project-osrm.org/route/v1/driving/${coordsStr}?overview=full&geometries=geojson`,
          { signal: AbortSignal.timeout(8000) }
        );
        const data = await resp.json();
        if (data.code === 'Ok' && data.routes?.[0]) {
          distKm = parseFloat((data.routes[0].distance / 1000).toFixed(1));
          durMin = Math.round(data.routes[0].duration / 60);
          geometry = data.routes[0].geometry;
          this._lastResult = { distance: distKm, duration: durMin };
        }

        if (geometry) {

          // Double-check style is still loaded before adding source/layer
          await this.waitReady();

          // Add route to map (reuse source if exists)
          if (!this.map.getSource(this.routeSourceId)) {
            this.map.addSource(this.routeSourceId, {
              type: 'geojson',
              data: {
                type: 'Feature',
                properties: {},
                geometry: geometry
              }
            });
          } else {
            this.map.getSource(this.routeSourceId).setData({
              type: 'Feature',
              properties: {},
              geometry: geometry
            });
          }

          if (!this.map.getLayer(this.routeLayerId)) {
            this.map.addLayer({
              id: this.routeLayerId,
              type: 'line',
              source: this.routeSourceId,
              layout: {
                'line-join': 'round',
                'line-cap': 'round'
              },
              paint: {
                'line-color': '#00D4AA', // Neon Emerald accent instead of generic blue
                'line-width': 6,          // Slightly wider for dynamic visual flow
                'line-opacity': 0.85
              }
            });
          }
  
          if (onComplete) {
            onComplete(this._lastResult.distance, this._lastResult.duration);
          }
        }
      } catch (err) {
        console.error("Routing error:", err);
      }
      
      this.fitAll();
    },
  
    // Geocoding via Nominatim API
    async searchAddress(query) {
      if (!query || query.length < 3) return [];
      
      // Remover vírgulas para não atrapalhar a busca, conforme solicitado
      const cleanQuery = query.replace(/,/g, ' ').trim();

      try {
        // Switching to ArcGIS World Geocoding Service
        // This engine is vastly superior for Brazilian addresses, especially for specific house numbers
        const url = `https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?f=json&singleLine=${encodeURIComponent(cleanQuery)}&sourceCountry=BRA&maxLocations=10&outFields=Match_addr,StAddr,Nbrhd,City,Region`;
        
        const response = await fetch(url);
        const data = await response.json();
        
        if (!data || !data.candidates || data.candidates.length === 0) return [];
 
        return data.candidates.map(item => {
          // ArcGIS returns a beautifully formatted address in Match_addr
          // Example: "Rua Augusta, 1000, Consolação, São Paulo, 01305-100"
          let display = item.address;
          
          // Clean up the string to match the requested format: Rua, Número - Bairro, Cidade
          if (item.attributes) {
            const stAddr = item.attributes.StAddr || ''; // Street + Number
            const nbrhd = item.attributes.Nbrhd || '';   // Neighborhood
            const city = item.attributes.City || '';     // City
            const region = item.attributes.Region || ''; // State
            
            let customDisplay = stAddr;
            if (nbrhd) customDisplay += ` - ${nbrhd}`;
            if (city) customDisplay += `, ${city}`;
            if (region) customDisplay += ` (${region})`;
            
            if (customDisplay.length > 5) {
                display = customDisplay;
            }
          }
 
          return {
            address: display,
            lat: item.location.y,
            lng: item.location.x
          };
        });
      } catch (err) {
        console.error("ArcGIS Geocoding error:", err);
        return [];
      }
    },
  
    createMarker(lat, lng, number, status = 'planned', isOrigin = false, labelText = '') {
      // Defensive coding checks to prevent map service from crashing on invalid coordinates
      if (typeof lat !== 'number' || typeof lng !== 'number' || isNaN(lat) || isNaN(lng)) {
        console.warn("Invalid coordinates passed to createMarker:", lat, lng);
        // Return a mock marker object that safely handles typical chain operations
        return {
          setPopup: () => ({ togglePopup: () => {} }),
          remove: () => {}
        };
      }

      const el = document.createElement('div');
      el.className = 'custom-marker';
      const pinClass = isOrigin ? 'marker-origin' : `marker-${status}`;
      
      // Use labelText if provided, otherwise just the number/O
      const label = labelText || (isOrigin ? 'Origem' : `Parada ${number}`);

      el.innerHTML = `
        <div class="marker-pin ${pinClass}"></div>
        <i class="${isOrigin ? 'ri-home-4-fill' : ''}">${isOrigin ? '' : number}</i>
        <div class="marker-label">${label}</div>
      `;
  
      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([lng, lat])
        .addTo(this.map);
        
      this.markers.push(marker);
      return marker;
    },
  
    fitAll() {
      if (this.markers.length === 0) return;
      const bounds = new maplibregl.LngLatBounds();
      this.markers.forEach(m => bounds.extend(m.getLngLat()));
      this.map.fitBounds(bounds, { padding: 80 });
    }
  };
