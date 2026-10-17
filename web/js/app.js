/**
 * YBS Route Planner Application Controller
 */

document.addEventListener('DOMContentLoaded', () => {
  // Check if data is loaded
  if (!window.YBS_STOPS || !window.YBS_ROUTES) {
    console.error('Data not loaded! Make sure data_stops.js and data_routes.js are loaded.');
    alert('ဒေတာများ မရရှိသေးပါ။ ကျေးဇူးပြု၍ စာမျက်နှာကို ပြန်လည် Reload လုပ်ပေးပါ။');
    return;
  }

  // Initialize Transit Router
  const router = new YBSTransitRouter(window.YBS_STOPS, window.YBS_ROUTES);
  console.log(`Router initialized with ${window.YBS_STOPS.length} stops and ${window.YBS_ROUTES.length} routes.`);

  // UI Elements
  const inputStart = document.getElementById('inputStartStop');
  const inputTarget = document.getElementById('inputTargetStop');
  const dropdownStart = document.getElementById('dropdownStart');
  const dropdownTarget = document.getElementById('dropdownTarget');
  const btnClearStart = document.getElementById('btnClearStart');
  const btnClearTarget = document.getElementById('btnClearTarget');
  const btnSwap = document.getElementById('btnSwapStops');
  const btnSearch = document.getElementById('btnSearch');
  const btnReset = document.getElementById('btnReset');
  const statusBar = document.getElementById('statusBar');
  const statusCountText = document.getElementById('statusCountText');
  const statusTimingText = document.getElementById('statusTimingText');
  const filterTabs = document.getElementById('filterTabs');
  const routesList = document.getElementById('routesList');
  const initialState = document.getElementById('initialState');

  const badgeAll = document.getElementById('badgeAll');
  const badgeDirect = document.getElementById('badgeDirect');
  const badgeOneTransfer = document.getElementById('badgeOneTransfer');
  const badgeTwoTransfers = document.getElementById('badgeTwoTransfers');

  const btnInfoModal = document.getElementById('btnInfoModal');
  const modalBackdrop = document.getElementById('modalBackdrop');
  const btnModalClose = document.getElementById('btnModalClose');

  const mapOverlay = document.getElementById('mapOverlay');
  const overlayTitle = document.getElementById('overlayTitle');
  const overlayDesc = document.getElementById('overlayDesc');
  const btnCenterYangon = document.getElementById('btnCenterYangon');
  const btnClearMap = document.getElementById('btnClearMap');

  // State
  let selectedStart = null;
  let selectedTarget = null;
  let currentSearchResults = null;
  let currentActiveTab = 'all';
  let activeRouteLayers = [];
  let activeMarkers = [];

  // =========================================================================
  // Initialize Leaflet Map
  // =========================================================================
  const YANGON_CENTER = [16.8409, 96.1735];
  const map = L.map('map', {
    zoomControl: true,
    minZoom: 10,
    maxZoom: 18
  }).setView(YANGON_CENTER, 12);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors | YBS Yangon'
  }).addTo(map);

  function clearMapLayers() {
    activeRouteLayers.forEach(layer => map.removeLayer(layer));
    activeRouteLayers = [];
    activeMarkers.forEach(m => map.removeLayer(m));
    activeMarkers = [];
    mapOverlay.style.display = 'none';
  }

  btnCenterYangon.addEventListener('click', () => {
    map.flyTo(YANGON_CENTER, 12, { duration: 1.0 });
  });

  btnClearMap.addEventListener('click', () => {
    clearMapLayers();
    document.querySelectorAll('.route-card.selected').forEach(c => c.classList.remove('selected'));
  });

  // Custom marker helper
  function createPinIcon(type, text) {
    let pinClass = 'pin-start';
    if (type === 'transfer') pinClass = 'pin-transfer';
    if (type === 'target') pinClass = 'pin-target';

    return L.divIcon({
      className: 'custom-leaflet-marker',
      html: `<div class="custom-pin ${pinClass}">${text}</div>`,
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });
  }

  // =========================================================================
  // Stop Search & Autocomplete
  // =========================================================================
  function filterStops(query) {
    if (!query || query.trim().length === 0) return [];
    const q = query.trim().toLowerCase();

    const matches = [];
    for (const stop of window.YBS_STOPS) {
      const matchMm = stop.name_mm && stop.name_mm.toLowerCase().includes(q);
      const matchEn = stop.name_en && stop.name_en.toLowerCase().includes(q);
      const matchRoadMm = stop.road_mm && stop.road_mm.toLowerCase().includes(q);
      const matchRoadEn = stop.road_en && stop.road_en.toLowerCase().includes(q);
      const matchTspMm = stop.township_mm && stop.township_mm.toLowerCase().includes(q);
      const matchTspEn = stop.township_en && stop.township_en.toLowerCase().includes(q);

      if (matchMm || matchEn || matchRoadMm || matchRoadEn || matchTspMm || matchTspEn) {
        let score = 0;
        if (stop.name_mm && stop.name_mm.toLowerCase().startsWith(q)) score += 10;
        if (stop.name_en && stop.name_en.toLowerCase().startsWith(q)) score += 8;
        if (matchMm) score += 5;
        if (matchTspMm) score += 3;
        matches.push({ stop, score });
      }
    }

    matches.sort((a, b) => b.score - a.score);
    return matches.slice(0, 15).map(m => m.stop);
  }

  function setupAutocomplete(inputEl, dropdownEl, clearBtn, onSelect) {
    let activeIndex = -1;

    function renderDropdown(items) {
      dropdownEl.innerHTML = '';
      if (items.length === 0) {
        dropdownEl.style.display = 'none';
        return;
      }

      items.forEach((stop, index) => {
        const item = document.createElement('div');
        item.className = 'dropdown-item';
        item.innerHTML = `
          <div class="item-main">${stop.name_mm || stop.name_en}</div>
          <div class="item-sub">
            <span class="item-road">${stop.road_mm || stop.road_en || '-'}</span>
            <span class="item-tsp">• ${stop.township_mm || stop.township_en || ''}</span>
          </div>
        `;
        item.addEventListener('click', () => {
          selectStop(stop);
        });
        dropdownEl.appendChild(item);
      });

      dropdownEl.style.display = 'block';
      activeIndex = -1;
    }

    function selectStop(stop) {
      inputEl.value = `${stop.name_mm || stop.name_en} (${stop.township_mm || stop.township_en || ''})`;
      clearBtn.style.display = 'block';
      dropdownEl.style.display = 'none';
      onSelect(stop);
    }

    inputEl.addEventListener('input', () => {
      const q = inputEl.value;
      if (q.length > 0) {
        clearBtn.style.display = 'block';
        const results = filterStops(q);
        renderDropdown(results);
      } else {
        clearBtn.style.display = 'none';
        dropdownEl.style.display = 'none';
        onSelect(null);
      }
    });

    inputEl.addEventListener('keydown', (e) => {
      const items = dropdownEl.querySelectorAll('.dropdown-item');
      if (items.length === 0) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        activeIndex = (activeIndex + 1) % items.length;
        updateActive(items);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        activeIndex = (activeIndex - 1 + items.length) % items.length;
        updateActive(items);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (activeIndex >= 0 && activeIndex < items.length) {
          items[activeIndex].click();
        }
      } else if (e.key === 'Escape') {
        dropdownEl.style.display = 'none';
      }
    });

    function updateActive(items) {
      items.forEach((item, idx) => {
        if (idx === activeIndex) {
          item.classList.add('active');
          item.scrollIntoView({ block: 'nearest' });
        } else {
          item.classList.remove('active');
        }
      });
    }

    clearBtn.addEventListener('click', () => {
      inputEl.value = '';
      clearBtn.style.display = 'none';
      dropdownEl.style.display = 'none';
      onSelect(null);
    });

    // Close dropdown when clicked outside
    document.addEventListener('click', (e) => {
      if (!inputEl.contains(e.target) && !dropdownEl.contains(e.target)) {
        dropdownEl.style.display = 'none';
      }
    });
  }

  setupAutocomplete(inputStart, dropdownStart, btnClearStart, (stop) => {
    selectedStart = stop;
  });

  setupAutocomplete(inputTarget, dropdownTarget, btnClearTarget, (stop) => {
    selectedTarget = stop;
  });

  // Swap Start & Target
  btnSwap.addEventListener('click', () => {
    const tempStop = selectedStart;
    selectedStart = selectedTarget;
    selectedTarget = tempStop;

    const tempVal = inputStart.value;
    inputStart.value = inputTarget.value;
    inputTarget.value = tempVal;

    btnClearStart.style.display = inputStart.value ? 'block' : 'none';
    btnClearTarget.style.display = inputTarget.value ? 'block' : 'none';

    if (selectedStart && selectedTarget) {
      executeSearch();
    }
  });

  // Reset Form
  btnReset.addEventListener('click', () => {
    selectedStart = null;
    selectedTarget = null;
    inputStart.value = '';
    inputTarget.value = '';
    btnClearStart.style.display = 'none';
    btnClearTarget.style.display = 'none';
    dropdownStart.style.display = 'none';
    dropdownTarget.style.display = 'none';

    statusBar.style.display = 'none';
    filterTabs.style.display = 'none';
    routesList.innerHTML = `
      <div class="empty-state" id="initialState">
        <div class="empty-icon">🗺️</div>
        <div class="empty-title">မှတ်တိုင်များ ရွေးချယ်ပါ</div>
        <div class="empty-text">
          စတင်စီးနင်းမည့် မှတ်တိုင်နှင့် ရောက်ရှိလိုသည့် မှတ်တိုင်ကို ရွေးချယ်ပြီး ရှာဖွေနိုင်ပါသည်။
        </div>
      </div>
    `;
    clearMapLayers();
    map.flyTo(YANGON_CENTER, 12);
  });

  // Preset Chips
  document.querySelectorAll('.preset-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const startQuery = btn.getAttribute('data-start');
      const startTsp = btn.getAttribute('data-start-tsp');
      const targetQuery = btn.getAttribute('data-target');
      const targetTsp = btn.getAttribute('data-target-tsp');

      // Find matching stops
      let startMatch = null;
      let targetMatch = null;

      for (const s of window.YBS_STOPS) {
        if (!startMatch && (s.name_mm.includes(startQuery) || s.name_en.includes(startQuery))) {
          if (!startTsp || s.township_mm.includes(startTsp)) startMatch = s;
        }
        if (!targetMatch && (s.name_mm.includes(targetQuery) || s.name_en.includes(targetQuery))) {
          if (!targetTsp || s.township_mm.includes(targetTsp)) targetMatch = s;
        }
      }

      if (startMatch && targetMatch) {
        selectedStart = startMatch;
        selectedTarget = targetMatch;
        inputStart.value = `${startMatch.name_mm} (${startMatch.township_mm})`;
        inputTarget.value = `${targetMatch.name_mm} (${targetMatch.township_mm})`;
        btnClearStart.style.display = 'block';
        btnClearTarget.style.display = 'block';
        executeSearch();
      }
    });
  });

  // Search Button
  btnSearch.addEventListener('click', () => {
    executeSearch();
  });

  // =========================================================================
  // Execute Search Function
  // =========================================================================
  function executeSearch() {
    if (!selectedStart) {
      alert('စတင်စီးနင်းမည့် မှတ်တိုင်ကို ရွေးချယ်ပေးပါ');
      inputStart.focus();
      return;
    }
    if (!selectedTarget) {
      alert('ရောက်ရှိလိုသည့် မှတ်တိုင်ကို ရွေးချယ်ပေးပါ');
      inputTarget.focus();
      return;
    }

    if (selectedStart.id === selectedTarget.id) {
      alert('စတင်စီးနင်းမည့် မှတ်တိုင်နှင့် ရောက်ရှိလိုသည့် မှတ်တိုင် မတူညီသင့်ပါ');
      return;
    }

    const t0 = performance.now();
    const results = router.search(selectedStart.id, selectedTarget.id);
    const t1 = performance.now();
    const elapsed = Math.round(t1 - t0);

    currentSearchResults = results;
    currentActiveTab = 'all';

    // Update Tab Badges
    badgeAll.textContent = results.all.length;
    badgeDirect.textContent = results.direct.length;
    badgeOneTransfer.textContent = results.oneTransfer.length;
    badgeTwoTransfers.textContent = results.twoTransfers.length;

    // Show Status Bar & Tabs
    statusBar.style.display = 'flex';
    filterTabs.style.display = 'flex';
    statusCountText.textContent = `ရလဒ် စုစုပေါင်း ${results.all.length} ခု တွေ့ရှိပါသည်`;
    statusTimingText.textContent = `A* တွက်ချက်ချိန်: ${elapsed} ms`;

    // Activate default tab
    document.querySelectorAll('.tab-btn').forEach(tb => tb.classList.remove('active'));
    document.querySelector('.tab-btn[data-tab="all"]').classList.add('active');

    renderRouteList();

    // Automatically highlight top route on map
    if (results.all.length > 0) {
      renderRouteOnMap(results.all[0]);
    } else {
      clearMapLayers();
    }
  }

  // Filter Tabs click
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(tb => tb.classList.remove('active'));
      btn.classList.add('active');
      currentActiveTab = btn.getAttribute('data-tab');
      renderRouteList();
    });
  });

  // =========================================================================
  // Render Route Cards
  // =========================================================================
  function renderRouteList() {
    routesList.innerHTML = '';
    if (!currentSearchResults || currentSearchResults.all.length === 0) {
      routesList.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🚫</div>
          <div class="empty-title">လမ်းကြောင်း မရှိပါ</div>
          <div class="empty-text">ရွေးချယ်ထားသော မှတ်တိုင်များအကြား ချိတ်ဆက်ထားသော YBS ဘတ်စ်ကား မတွေ့ရှိပါ။</div>
        </div>
      `;
      return;
    }

    let listToRender = currentSearchResults.all;
    if (currentActiveTab === 'direct') listToRender = currentSearchResults.direct;
    if (currentActiveTab === 'oneTransfer') listToRender = currentSearchResults.oneTransfer;
    if (currentActiveTab === 'twoTransfers') listToRender = currentSearchResults.twoTransfers;

    if (listToRender.length === 0) {
      routesList.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">ℹ️</div>
          <div class="empty-title">ဤကဏ္ဍတွင် လမ်းကြောင်းမရှိပါ</div>
          <div class="empty-text">အခြား အဆင့် (ဥပမာ - ၁ ကြိမ်ပြောင်း သို့မဟုတ် ၂ ကြိမ်ပြောင်း) tab များကို ကြည့်ရှုပါ။</div>
        </div>
      `;
      return;
    }

    listToRender.forEach((route, index) => {
      // Is this the globally best route? (Top result in 'all' list)
      const isBest = (currentActiveTab === 'all' && index === 0);

      const card = document.createElement('div');
      card.className = `route-card ${isBest ? 'best-route' : ''}`;
      if (index === 0) card.classList.add('selected');

      // Stage label & badge
      let stageClass = 'stage-1';
      let stageLabel = '၁ ဆင့် (တိုက်ရိုက်)';
      if (route.stages === 2) {
        stageClass = 'stage-2';
        stageLabel = '၂ ဆင့် (၁ ကြိမ်ပြောင်း)';
      } else if (route.stages === 3) {
        stageClass = 'stage-3';
        stageLabel = '၃ ဆင့် (၂ ကြိမ်ပြောင်း)';
      }

      // Bus Pills
      const busPillsHtml = route.segments.map((seg, sIdx) => {
        return `
          <span class="bus-pill" style="background-color: ${seg.color || '#2563eb'};">
            🚌 YBS ${seg.routeId}
          </span>
          ${sIdx < route.segments.length - 1 ? '<span class="bus-arrow">➔</span>' : ''}
        `;
      }).join('');

      // Itinerary steps HTML
      let itineraryHtml = '';
      route.segments.forEach((seg, sIdx) => {
        const isFirst = (sIdx === 0);
        const isLast = (sIdx === route.segments.length - 1);

        // Intermediate stops list HTML
        const stopItemsHtml = seg.stops.map(st => `
          <div class="intermediate-stop-item">
            <span>• ${st.name_mm || st.name_en}</span>
            <span class="item-tsp">${st.township_mm || ''}</span>
          </div>
        `).join('');

        itineraryHtml += `
          <div class="timeline-step ${isFirst ? 'start-step' : 'transfer-step'}">
            <div class="timeline-dot"></div>
            <div class="step-content">
              <div class="step-title">
                <span>စီးနင်းရန်: <strong>YBS ${seg.routeId}</strong></span>
                <span style="font-size: 0.75rem; color: #64748b;">${seg.stopCount} မှတ်တိုင် (${seg.distance} km)</span>
              </div>
              <div class="step-desc">
                🚏 <strong>${seg.boardStop.name_mm}</strong> မှတ်တိုင် (${seg.boardStop.township_mm}) မှ တက်ပါ
              </div>
              
              <!-- Accordion for intermediate stops -->
              <button class="accordion-toggle" onclick="event.stopPropagation(); toggleStopsAccordion(this)">
                <span>ဖြတ်သန်းမည့် မှတ်တိုင်များ (${seg.stopCount})</span> ▾
              </button>
              <div class="intermediate-stops-list">
                ${stopItemsHtml}
              </div>

              <div class="step-desc" style="margin-top: 4px;">
                🏁 <strong>${seg.alightStop.name_mm}</strong> မှတ်တိုင် (${seg.alightStop.township_mm}) တွင် ဆင်းပါ
              </div>

              ${!isLast ? `
                <div class="transfer-callout">
                  🔄 <strong>${seg.alightStop.name_mm}</strong> မှတ်တိုင်တွင် ဆင်းပြီး 
                  ${seg.walkAfterMeters > 0 ? `(လမ်းကူးပြီး) ` : ''}
                  <strong>YBS ${route.segments[sIdx + 1].routeId}</strong> သို့ ပြောင်းစီးပါ
                </div>
              ` : ''}
            </div>
          </div>
        `;

        if (isLast) {
          itineraryHtml += `
            <div class="timeline-step target-step">
              <div class="timeline-dot"></div>
              <div class="step-content">
                <div class="step-title" style="color: var(--danger);">
                  📍 ရောက်ရှိ: <strong>${seg.alightStop.name_mm}</strong>
                </div>
                <div class="step-desc">
                  ${seg.alightStop.road_mm}၊ ${seg.alightStop.township_mm}
                </div>
              </div>
            </div>
          `;
        }
      });

      card.innerHTML = `
        ${isBest ? `
          <div class="best-badge">
            ⭐ အကောင်းဆုံး လမ်းကြောင်း (Recommended)
          </div>
        ` : ''}
        <div class="card-header">
          <div class="bus-pills-row">
            ${busPillsHtml}
          </div>
          <span class="stage-badge ${stageClass}">${stageLabel}</span>
        </div>

        <div class="card-metrics">
          <div class="metric-item">
            <span>⏱️</span>
            <span>ခန့်မှန်း: <strong>~${route.estimatedMinutes} မိနစ်</strong></span>
          </div>
          <div class="metric-item">
            <span>📏</span>
            <span><strong>${route.totalDistance} km</strong></span>
          </div>
          <div class="metric-item">
            <span>🚏</span>
            <span><strong>${route.totalStops} မှတ်တိုင်</strong></span>
          </div>
        </div>

        <div class="card-itinerary">
          <div class="timeline">
            ${itineraryHtml}
          </div>
        </div>

        <div class="card-footer">
          <button class="btn-view-map">
            🗺️ မြေပုံပေါ်တွင် ကြည့်မည်
          </button>
        </div>
      `;

      card.addEventListener('click', () => {
        document.querySelectorAll('.route-card.selected').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        renderRouteOnMap(route);
      });

      routesList.appendChild(card);
    });
  }

  // Intermediate stops toggle accordion helper
  window.toggleStopsAccordion = function(btn) {
    const list = btn.nextElementSibling;
    if (list.style.display === 'block') {
      list.style.display = 'none';
      btn.querySelector('span').textContent = btn.querySelector('span').textContent.replace('▴', '▾');
    } else {
      list.style.display = 'block';
      btn.querySelector('span').textContent = btn.querySelector('span').textContent.replace('▾', '▴');
    }
  };

  // =========================================================================
  // Render Route on Leaflet Map
  // =========================================================================
  function renderRouteOnMap(route) {
    clearMapLayers();

    const allLatLangs = [];
    const routeSummaryPills = route.segments.map(s => `[YBS ${s.routeId}]`).join(' ➔ ');

    overlayTitle.textContent = `${route.stages} ဆင့် ခရီးစဉ်: ${routeSummaryPills}`;
    overlayDesc.textContent = `အကွာအဝေး ${route.totalDistance} km • ကြာချိန် ~${route.estimatedMinutes} မိနစ် • ${route.totalStops} မှတ်တိုင်`;
    mapOverlay.style.display = 'block';

    // Draw each segment
    route.segments.forEach((seg, sIdx) => {
      const segCoords = [];

      // If full shape coordinates exist for this route, extract the sub-slice
      // Otherwise connect stop by stop
      const rObj = window.YBS_ROUTES.find(r => r.id === seg.routeId);
      if (rObj && rObj.coordinates && rObj.coordinates.length > 0) {
        // Approximate shape slice using boarding and alighting stop coordinates
        segCoords.push([seg.boardStop.lat, seg.boardStop.lng]);
        seg.stops.forEach(st => segCoords.push([st.lat, st.lng]));
        segCoords.push([seg.alightStop.lat, seg.alightStop.lng]);
      } else {
        seg.stops.forEach(st => segCoords.push([st.lat, st.lng]));
      }

      segCoords.forEach(c => allLatLangs.push(c));

      // Draw polyline with route's specific color
      const polyline = L.polyline(segCoords, {
        color: seg.color || '#2563eb',
        weight: 6,
        opacity: 0.85,
        lineCap: 'round',
        lineJoin: 'round'
      }).addTo(map);

      polyline.bindPopup(`
        <strong>YBS ${seg.routeId}</strong><br>
        ${seg.routeName}<br>
        ${seg.boardStop.name_mm} ➔ ${seg.alightStop.name_mm}<br>
        ${seg.stopCount} မှတ်တိုင် (${seg.distance} km)
      `);

      activeRouteLayers.push(polyline);

      // Add Start Marker (First Leg)
      if (sIdx === 0) {
        const startMarker = L.marker([seg.boardStop.lat, seg.boardStop.lng], {
          icon: createPinIcon('start', '🟢')
        }).addTo(map);

        startMarker.bindPopup(`
          <strong>🟢 စတင်စီးနင်းမည့် မှတ်တိုင်</strong><br>
          ${seg.boardStop.name_mm} (${seg.boardStop.name_en})<br>
          ${seg.boardStop.road_mm}၊ ${seg.boardStop.township_mm}<br>
          <em>YBS ${seg.routeId} ကို စတင်စီးပါ</em>
        `).openPopup();

        activeMarkers.push(startMarker);
      }

      // Add Transfer Marker (Intermediate Legs)
      if (sIdx < route.segments.length - 1) {
        const nextSeg = route.segments[sIdx + 1];
        const transferMarker = L.marker([seg.alightStop.lat, seg.alightStop.lng], {
          icon: createPinIcon('transfer', '🔄')
        }).addTo(map);

        transferMarker.bindPopup(`
          <strong>🔄 ကားပြောင်းစီးမည့် မှတ်တိုင်</strong><br>
          ${seg.alightStop.name_mm} (${seg.alightStop.township_mm})<br>
          <em>YBS ${seg.routeId} မှ ဆင်းပြီး YBS ${nextSeg.routeId} သို့ ပြောင်းစီးပါ</em>
        `);

        activeMarkers.push(transferMarker);
      }

      // Add Target Marker (Final Leg)
      if (sIdx === route.segments.length - 1) {
        const targetMarker = L.marker([seg.alightStop.lat, seg.alightStop.lng], {
          icon: createPinIcon('target', '🏁')
        }).addTo(map);

        targetMarker.bindPopup(`
          <strong>🔴 ရောက်ရှိမည့် ပန်းတိုင်</strong><br>
          ${seg.alightStop.name_mm} (${seg.alightStop.name_en})<br>
          ${seg.alightStop.road_mm}၊ ${seg.alightStop.township_mm}
        `);

        activeMarkers.push(targetMarker);
      }
    });

    // Fit map bounds to show full route
    if (allLatLangs.length > 0) {
      map.fitBounds(allLatLangs, {
        padding: [50, 50],
        maxZoom: 15
      });
    }
  }

  // =========================================================================
  // Algorithm Info Modal
  // =========================================================================
  btnInfoModal.addEventListener('click', () => {
    modalBackdrop.classList.add('show');
  });

  btnModalClose.addEventListener('click', () => {
    modalBackdrop.classList.remove('show');
  });

  modalBackdrop.addEventListener('click', (e) => {
    if (e.target === modalBackdrop) {
      modalBackdrop.classList.remove('show');
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      modalBackdrop.classList.remove('show');
    }
  });
});
