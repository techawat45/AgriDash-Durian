/* ============================================================
   AgriDash Durian Pro - โมดูลแผนที่ดาวเทียม GIS และตารางทะเบียนรายต้น (gis.js)
   รองรับวาดขอบเขตแปลง คำนวณเนื้อที่ ผังระยะปลูกอัตโนมัติ ตารางเชื่อม 2 ทาง และนำเข้า/ส่งออก SW Maps
   ============================================================ */
const AGRI_GIS = (() => {
  const O = AGRI_ORCHARDS;
  const C = AGRI_CALC;
  const $ = (id) => document.getElementById(id);

  const HEALTH_COLORS = {
    'ปกติ': '#10b981',
    'เฝ้าระวังไฟท็อปธอร่า': '#f59e0b',
    'ฟื้นฟู': '#e11d48',
    'ต้นซ่อม': '#3b82f6'
  };
  const VARIETY_COLORS = {
    'หมอนทอง': '#059669',
    'กระดุม': '#d97706',
    'พวงมณี': '#9333ea',
    'ชะนี': '#0284c7',
    'ก้านยาว': '#be123c',
    'มังคุด': '#4f46e5'
  };
  const HEALTH_OPTIONS = ['ปกติ', 'เฝ้าระวังไฟท็อปธอร่า', 'ฟื้นฟู', 'ต้นซ่อม'];
  const STAGE_OPTIONS = ['พักต้น', 'แตกใบอ่อน', 'สะสมอาหาร', 'ออกดอก', 'หางแย้', 'ขยายพู'];
  const VARIETY_OPTIONS = ['หมอนทอง', 'กระดุม', 'พวงมณี', 'ชะนี', 'ก้านยาว', 'มังคุด'];

  let map = null;
  let polygonGroup = null;
  let treeGroup = null;
  let drawControl = null;
  let colorMode = 'health'; // 'health' | 'variety'
  let addPointMode = false;
  let dragTreeMode = false;
  let manualDrawPts = [];
  let manualDrawPolyline = null;
  let manualDrawMode = false;
  let selectedTreeId = '';

  const markerById = new Map();
  const polyLayerByPlotId = new Map();

  const toast = (msg, type) => (typeof showToast === 'function' ? showToast(msg, type || 'success') : alert(msg));

  function ensureMap() {
    const box = $('gis-map-canvas');
    if (!box || typeof L === 'undefined') return null;
    if (map) {
      setTimeout(() => map.invalidateSize(), 80);
      return map;
    }

    map = L.map(box, { zoomControl: true, preferCanvas: false }).setView([12.6096, 102.1045], 15);

    const sat = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { maxZoom: 20, attribution: 'ภาพถ่ายดาวเทียม © Esri, Maxar, Earthstar Geographics' }
    ).addTo(map);

    const street = L.tileLayer(
      'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      { maxZoom: 19, attribution: '© OpenStreetMap' }
    );

    polygonGroup = new L.FeatureGroup().addTo(map);
    treeGroup = new L.FeatureGroup().addTo(map);

    L.control.layers(
      { 'ภาพถ่ายดาวเทียม': sat, 'แผนที่ถนน': street },
      { 'ขอบเขตแปลงปลูก': polygonGroup, 'หมุดต้นทุเรียน': treeGroup },
      { position: 'topright', collapsed: true }
    ).addTo(map);

    if (L.Control && L.Control.Draw) {
      drawControl = new L.Control.Draw({
        position: 'topleft',
        draw: {
          polygon: { allowIntersection: false, showArea: true, shapeOptions: { color: '#10b981', weight: 3, fillOpacity: 0.18 } },
          polyline: false,
          rectangle: false,
          circle: false,
          circlemarker: false,
          marker: false
        },
        edit: { featureGroup: polygonGroup, remove: false }
      });
      map.addControl(drawControl);

      map.on(L.Draw.Event.CREATED, async (ev) => {
        if (ev.layerType === 'polygon') {
          const gj = ev.layer.toGeoJSON();
          await saveDrawnBoundaryForSelectedPlot(gj.geometry);
        }
      });

      map.on(L.Draw.Event.EDITED, async (ev) => {
        const layers = ev.layers;
        layers.eachLayer(async (layer) => {
          if (layer._agriPlotId) {
            const gj = layer.toGeoJSON();
            await savePlotBoundary(layer._agriPlotId, gj.geometry);
          }
        });
      });
    }

    map.on('click', onMapClick);
    renderMapLayers(true);
    return map;
  }

  function getSelectedTargetPlot() {
    const val = $('gis-target-plot')?.value || '';
    if (val.startsWith('p:')) return O.getPlot(val.slice(2));
    const filterVal = $('gis-filter-scope')?.value || 'all';
    if (filterVal.startsWith('p:')) return O.getPlot(filterVal.slice(2));
    return O.allPlots(true)[0] || null;
  }

  async function onMapClick(ev) {
    if (manualDrawMode) {
      manualDrawPts.push([ev.latlng.lat, ev.latlng.lng]);
      if (!manualDrawPolyline) {
        manualDrawPolyline = L.polygon(manualDrawPts, { color: '#10b981', weight: 3, dashArray: '6,4', fillOpacity: 0.2 }).addTo(map);
      } else {
        manualDrawPolyline.setLatLngs(manualDrawPts);
      }
      const statusEl = $('gis-draw-hint');
      if (statusEl) statusEl.innerText = `แตะปักมุมแปลงแล้ว ${manualDrawPts.length} จุด (ต้องมีอย่างน้อย 3 จุด แล้วกดปุ่ม "บันทึกขอบเขตแปลง")`;
      return;
    }

    if (!addPointMode) return;
    const plot = getSelectedTargetPlot();
    if (!plot) {
      toast('กรุณาสร้างและเลือกแปลงเป้าหมายก่อนปักหมุดต้นไม้', 'error');
      return;
    }
    const existingInPlot = (AGRI_DATA.state.trees || []).filter((t) => t.plotId === plot.id);
    const nextNum = existingInPlot.length + 1;
    const prefix = plot.name.slice(0, 4).replace(/\s+/g, '') || 'T';
    const doc = {
      id: O.newId('tr'),
      treeCode: `${prefix}-${String(nextNum).padStart(3, '0')}`,
      orchardId: plot.orchardId,
      plotId: plot.id,
      variety: plot.mainVariety || 'หมอนทอง',
      age: C.num(plot.treeAge) || 0,
      spacing: `${plot.spacingX || 8}x${plot.spacingY || 8}`,
      valveZone: plot.valveCount ? 'วาล์ว 1' : '',
      health: 'ปกติ',
      stage: 'พักต้น',
      lat: Number(ev.latlng.lat.toFixed(6)),
      lng: Number(ev.latlng.lng.toFixed(6)),
      location: { type: 'Point', coordinates: [Number(ev.latlng.lng.toFixed(6)), Number(ev.latlng.lat.toFixed(6))] },
      note: ''
    };
    try {
      await AGRI_DATA.save('trees', doc);
      selectedTreeId = doc.id;
      renderMapLayers(false);
      renderTreeTable();
      toast(`ปักหมุดต้น ${doc.treeCode} ในแปลง "${plot.name}" เรียบร้อย`);
    } catch (e) {
      toast('บันทึกหมุดต้นไม้ไม่สำเร็จ: ' + e.message, 'error');
    }
  }

  // ====== โหมดวาดขอบเขตแปลง (รองรับแตะทีละจุดบนจอมือถือและเมาส์บนคอม) ======
  function startDrawBoundary() {
    ensureMap();
    const plot = getSelectedTargetPlot();
    if (!plot) {
      toast('กรุณาสร้างสวนและเลือกแปลงก่อนวาดขอบเขต', 'error');
      return;
    }
    addPointMode = false;
    updateModeButtons();
    manualDrawMode = true;
    manualDrawPts = [];
    if (manualDrawPolyline && map) { map.removeLayer(manualDrawPolyline); manualDrawPolyline = null; }
    const bar = $('gis-draw-toolbar');
    if (bar) bar.classList.remove('hidden');
    const hint = $('gis-draw-hint');
    if (hint) hint.innerText = `กำลังวาดขอบเขตแปลง "${plot.name}" — แตะปักมุมรอบแปลงบนแผนที่อย่างน้อย 3 จุด`;
  }

  function undoDrawVertex() {
    if (!manualDrawPts.length) return;
    manualDrawPts.pop();
    if (manualDrawPolyline) {
      if (manualDrawPts.length) manualDrawPolyline.setLatLngs(manualDrawPts);
      else { map.removeLayer(manualDrawPolyline); manualDrawPolyline = null; }
    }
    const hint = $('gis-draw-hint');
    if (hint) hint.innerText = `เหลือมุมที่ปัก ${manualDrawPts.length} จุด`;
  }

  async function finishManualDrawBoundary() {
    if (manualDrawPts.length < 3) {
      toast('กรุณาแตะปักมุมรอบแปลงอย่างน้อย 3 จุด', 'error');
      return;
    }
    const ring = manualDrawPts.map(([lat, lng]) => [Number(lng.toFixed(6)), Number(lat.toFixed(6))]);
    ring.push([...ring[0]]);
    const geometry = { type: 'Polygon', coordinates: [ring] };
    cancelManualDrawBoundary();
    await saveDrawnBoundaryForSelectedPlot(geometry);
  }

  function cancelManualDrawBoundary() {
    manualDrawMode = false;
    manualDrawPts = [];
    if (manualDrawPolyline && map) { map.removeLayer(manualDrawPolyline); manualDrawPolyline = null; }
    $('gis-draw-toolbar')?.classList.add('hidden');
  }

  async function saveDrawnBoundaryForSelectedPlot(geometry) {
    const plot = getSelectedTargetPlot();
    if (!plot) {
      toast('กรุณาเลือกแปลงที่จะบันทึกขอบเขต', 'error');
      return;
    }
    await savePlotBoundary(plot.id, geometry);
  }

  async function savePlotBoundary(plotId, geometry) {
    const plot = O.getPlot(plotId);
    if (!plot) return;
    const sqm = C.polygonAreaSqm(geometry);
    const parts = C.sqmToThaiParts(sqm);
    const decRai = C.round2(C.sqmToRai(sqm));
    const updated = {
      ...plot,
      boundary: geometry,
      areaRai: decRai,
      areaNgan: parts.ngan,
      areaWah: parts.wah
    };
    try {
      await O.savePlot(updated);
      renderMapLayers(false);
      updateBoundaryInfoBar();
      toast(`บันทึกขอบเขตแปลง "${plot.name}" สำเร็จ เนื้อที่ ${C.formatArea(parts)} (${decRai} ไร่)`);
    } catch (e) {
      toast('บันทึกขอบเขตแปลงไม่สำเร็จ: ' + e.message, 'error');
    }
  }

  async function clearSelectedPlotBoundary() {
    const plot = getSelectedTargetPlot();
    if (!plot || !plot.boundary) { toast('แปลงนี้ยังไม่มีเส้นขอบเขต', 'warning'); return; }
    if (!confirm(`ต้องการล้างเส้นขอบเขตของแปลง "${plot.name}" ใช่หรือไม่?`)) return;
    await O.savePlot({ ...plot, boundary: null });
    renderMapLayers(false);
    updateBoundaryInfoBar();
    toast('ล้างเส้นขอบเขตแปลงแล้ว');
  }

  function toggleAddPointMode() {
    cancelManualDrawBoundary();
    addPointMode = !addPointMode;
    updateModeButtons();
    if (addPointMode) toast('โหมดปักหมุดรายต้นเปิดแล้ว — แตะตำแหน่งต้นทุเรียนบนแผนที่ได้เลย');
  }

  function toggleDragTreeMode() {
    dragTreeMode = !dragTreeMode;
    updateModeButtons();
    renderMapLayers(false);
    toast(dragTreeMode ? 'เปิดโหมดลากปรับตำแหน่งหมุดแล้ว — ลากหมุดให้ตรงทรงพุ่มจริงได้เลย' : 'ล็อกตำแหน่งหมุดต้นไม้แล้ว');
  }

  function setMarkerColorMode(mode) {
    colorMode = mode === 'variety' ? 'variety' : 'health';
    $('gis-color-health-btn')?.classList.toggle('active', colorMode === 'health');
    $('gis-color-variety-btn')?.classList.toggle('active', colorMode === 'variety');
    renderLegend();
    renderMapLayers(false);
  }

  function updateModeButtons() {
    const addBtn = $('gis-btn-add-point');
    if (addBtn) {
      addBtn.classList.toggle('btn-primary', addPointMode);
      addBtn.classList.toggle('btn-outline', !addPointMode);
      addBtn.innerText = addPointMode ? '📍 กำลังปักหมุด (แตะซ้ำเพื่อหยุด)' : '📍 ปักหมุดรายต้น';
    }
    const dragBtn = $('gis-btn-drag-tree');
    if (dragBtn) {
      dragBtn.classList.toggle('btn-primary', dragTreeMode);
      dragBtn.classList.toggle('btn-outline', !dragTreeMode);
      dragBtn.innerText = dragTreeMode ? '🔓 กำลังลากหมุดได้' : '🔒 ลากปรับตำแหน่งหมุด';
    }
  }

  function renderLegend() {
    const host = $('gis-map-legend');
    if (!host) return;
    const dict = colorMode === 'variety' ? VARIETY_COLORS : HEALTH_COLORS;
    host.innerHTML = Object.entries(dict)
      .map(([label, col]) => `<span class="gis-legend-chip"><i style="background:${col}"></i>${O.esc(label)}</span>`)
      .join('');
  }

  // ====== วาดเลเยอร์ขอบเขตแปลงและหมุดรายต้นบนแผนที่ ======
  function getFilteredTrees() {
    const scope = $('gis-filter-scope')?.value || 'all';
    const variety = $('gis-filter-variety')?.value || 'all';
    const health = $('gis-filter-health')?.value || 'all';
    const stage = $('gis-filter-stage')?.value || 'all';
    const q = ($('gis-search-input')?.value || '').trim().toLowerCase();

    return (AGRI_DATA.state.trees || []).filter((t) => {
      if (t.deletedAt) return false;
      if (scope.startsWith('o:') && t.orchardId !== scope.slice(2)) return false;
      if (scope.startsWith('p:') && t.plotId !== scope.slice(2)) return false;
      if (variety !== 'all' && t.variety !== variety) return false;
      if (health !== 'all' && t.health !== health) return false;
      if (stage !== 'all' && t.stage !== stage) return false;
      if (q) {
        const hay = `${t.treeCode || ''} ${t.valveZone || ''} ${t.variety || ''} ${t.note || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  function colorForTree(t) {
    if (colorMode === 'variety') return VARIETY_COLORS[t.variety] || '#059669';
    return HEALTH_COLORS[t.health] || '#10b981';
  }

  function makeTreeIcon(color, isSelected) {
    const size = isSelected ? 22 : 16;
    const ring = isSelected ? '0 0 0 5px rgba(16,185,129,0.45)' : '0 1px 4px rgba(0,0,0,0.45)';
    return L.divIcon({
      className: 'agri-tree-pin',
      html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:2.5px solid #ffffff;box-shadow:${ring};"></div>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2]
    });
  }

  function renderMapLayers(autoFit = false) {
    if (!map || !polygonGroup || !treeGroup) return;
    polygonGroup.clearLayers();
    treeGroup.clearLayers();
    markerById.clear();
    polyLayerByPlotId.clear();

    const scope = $('gis-filter-scope')?.value || 'all';
    const plots = O.allPlots().filter((p) => {
      if (p.active === false) return false;
      if (scope.startsWith('o:')) return p.orchardId === scope.slice(2);
      if (scope.startsWith('p:')) return p.id === scope.slice(2);
      return true;
    });

    const boundsPts = [];

    // 1. วาดขอบเขตแปลง (Polygon)
    plots.forEach((p) => {
      if (!p.boundary) return;
      try {
        const geoLayer = L.geoJSON(p.boundary, {
          style: {
            color: p.color || '#10b981',
            weight: 3,
            fillColor: p.color || '#10b981',
            fillOpacity: 0.16
          }
        });
        geoLayer.eachLayer((lyr) => {
          lyr._agriPlotId = p.id;
          const sqm = C.polygonAreaSqm(p.boundary);
          const areaTxt = C.formatArea(C.sqmToThaiParts(sqm));
          lyr.bindTooltip(`<strong>${O.esc(p.name)}</strong><br>${O.esc(areaTxt)}`, { permanent: false, direction: 'center' });
          polygonGroup.addLayer(lyr);
          polyLayerByPlotId.set(p.id, lyr);
          if (lyr.getBounds) {
            const b = lyr.getBounds();
            if (b.isValid()) {
              boundsPts.push(b.getSouthWest(), b.getNorthEast());
            }
          }
        });
      } catch (e) {}
    });

    // 2. วาดหมุดพิกัดรายต้น (Point)
    const trees = getFilteredTrees();
    trees.forEach((t) => {
      const lat = t.lat != null ? Number(t.lat) : (t.location?.coordinates?.[1] ?? null);
      const lng = t.lng != null ? Number(t.lng) : (t.location?.coordinates?.[0] ?? null);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

      const isSel = t.id === selectedTreeId;
      const m = L.marker([lat, lng], {
        icon: makeTreeIcon(colorForTree(t), isSel),
        draggable: dragTreeMode
      });
      const plot = O.getPlot(t.plotId);
      const orchard = O.getOrchard(t.orchardId);
      m.bindPopup(`
        <div style="min-width:190px;font-family:'Prompt',sans-serif;">
          <div style="font-weight:800;font-size:0.96rem;color:#065f46;">🌳 ${O.esc(t.treeCode || t.id)}</div>
          <div style="font-size:0.8rem;color:#475569;margin-bottom:6px;">${O.esc(orchard ? orchard.name : '')}${plot ? ' › ' + O.esc(plot.name) : ''}</div>
          <div style="font-size:0.82rem;line-height:1.55;">
            <strong>พันธุ์:</strong> ${O.esc(t.variety || '-')}<br>
            <strong>สุขภาพ:</strong> ${O.esc(t.health || 'ปกติ')}<br>
            <strong>ระยะ:</strong> ${O.esc(t.stage || '-')}<br>
            <strong>วาล์วน้ำ:</strong> ${O.esc(t.valveZone || '-')} · อายุ ${C.num(t.age)} ปี
          </div>
          <div style="margin-top:8px;display:flex;gap:6px;">
            <button type="button" onclick="openTreeEditModal('${O.esc(t.id)}')" style="flex:1;padding:5px 8px;border-radius:8px;border:1px solid #10b981;background:#ecfdf5;color:#065f46;font-weight:700;cursor:pointer;">✏️ แก้ไขต้นนี้</button>
          </div>
        </div>
      `);

      m.on('click', () => highlightTreeRowFromMap(t.id));
      m.on('dragend', async () => {
        const pos = m.getLatLng();
        const newLat = Number(pos.lat.toFixed(6));
        const newLng = Number(pos.lng.toFixed(6));
        await AGRI_DATA.save('trees', {
          ...t,
          lat: newLat,
          lng: newLng,
          location: { type: 'Point', coordinates: [newLng, newLat] }
        });
        renderTreeTable();
        toast(`ปรับตำแหน่งต้น ${t.treeCode} เรียบร้อย`);
      });

      treeGroup.addLayer(m);
      markerById.set(t.id, m);
      boundsPts.push([lat, lng]);
    });

    if (autoFit) {
      if (boundsPts.length) {
        map.fitBounds(L.latLngBounds(boundsPts), { padding: [28, 28], maxZoom: 18 });
      } else {
        const orc = O.activeOrchards().find((o) => o.lat != null && o.lng != null);
        if (orc) map.setView([Number(orc.lat), Number(orc.lng)], 16);
      }
    }
    updateBoundaryInfoBar();
  }

  function updateBoundaryInfoBar() {
    const el = $('gis-plot-area-summary');
    if (!el) return;
    const plot = getSelectedTargetPlot();
    if (!plot) {
      el.innerText = 'ยังไม่ได้เลือกแปลง — สร้างสวนและแปลงได้ที่เมนู "สวนและแปลง"';
      return;
    }
    const treeCount = (AGRI_DATA.state.trees || []).filter((t) => !t.deletedAt && t.plotId === plot.id).length;
    if (plot.boundary) {
      const sqm = C.polygonAreaSqm(plot.boundary);
      const areaTxt = C.formatArea(C.sqmToThaiParts(sqm));
      el.innerText = `📐 แปลง "${plot.name}": วาดขอบเขตแล้ว เนื้อที่ ${areaTxt} · ต้นไม้ในทะเบียน ${treeCount.toLocaleString('th-TH')} ต้น`;
    } else {
      el.innerText = `📐 แปลง "${plot.name}": พื้นที่ระบุ ${C.num(plot.areaRai)} ไร่ (ยังไม่ได้วาดเส้นขอบเขตบนแผนที่) · ต้นไม้ในทะเบียน ${treeCount.toLocaleString('th-TH')} ต้น`;
    }
  }

  // ====== เชื่อม 2 ทาง: คลิกหมุด → เลื่อนไฮไลต์แถวในตาราง / คลิกแถว → ซูมไปหาหมุดบนแผนที่ ======
  function highlightTreeRowFromMap(treeId) {
    selectedTreeId = treeId;
    document.querySelectorAll('#gis-tree-tbody tr').forEach((tr) => {
      tr.classList.toggle('gis-row-selected', tr.dataset.treeId === treeId);
    });
    const row = document.querySelector(`#gis-tree-tbody tr[data-tree-id="${CSS.escape(treeId)}"]`);
    if (row) row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function focusTreeOnMap(treeId) {
    selectedTreeId = treeId;
    document.querySelectorAll('#gis-tree-tbody tr').forEach((tr) => {
      tr.classList.toggle('gis-row-selected', tr.dataset.treeId === treeId);
    });
    ensureMap();
    const marker = markerById.get(treeId);
    if (marker && map) {
      const ll = marker.getLatLng();
      map.setView(ll, Math.max(map.getZoom(), 19), { animate: true });
      marker.openPopup();
      $('gis-map-canvas')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      toast('ต้นนี้ยังไม่มีพิกัดบนแผนที่ สามารถกดแก้ไขเพื่อระบุพิกัดได้', 'warning');
    }
  }

  function focusSelectedPlotOnMap() {
    ensureMap();
    const plot = getSelectedTargetPlot();
    if (!plot || !map) return;
    const poly = polyLayerByPlotId.get(plot.id);
    if (poly && poly.getBounds && poly.getBounds().isValid()) {
      map.fitBounds(poly.getBounds(), { padding: [24, 24], maxZoom: 19 });
      return;
    }
    const orchard = O.getOrchard(plot.orchardId);
    if (orchard && orchard.lat != null && orchard.lng != null) {
      map.setView([Number(orchard.lat), Number(orchard.lng)], 17);
    }
  }

  // ====== เครื่องมือสร้างผังระยะปลูกอัตโนมัติ ======
  function openGridGeneratorModal() {
    const plot = getSelectedTargetPlot();
    if (!plot) {
      toast('กรุณาสร้างและเลือกแปลงก่อนสร้างผังระยะปลูก', 'error');
      return;
    }
    if (!plot.boundary) {
      toast(`กรุณาวาดเส้นขอบเขตของแปลง "${plot.name}" บนแผนที่ก่อน เพื่อให้ระบบวางผังต้นไม้ลงในขอบเขตแปลง`, 'error');
      return;
    }
    $('grid-plot-name').innerText = O.plotLabel(plot);
    $('grid-sx').value = plot.spacingX || 8;
    $('grid-sy').value = plot.spacingY || 8;
    $('grid-angle').value = 0;
    $('grid-margin').value = 2;
    $('grid-prefix').value = plot.name.slice(0, 4).replace(/\s+/g, '') || 'T';
    $('grid-variety').value = VARIETY_OPTIONS.includes(plot.mainVariety) ? plot.mainVariety : 'หมอนทอง';
    $('grid-age').value = plot.treeAge || 1;
    $('grid-valve').value = plot.valveCount ? 'วาล์ว 1' : '';
    $('grid-staggered').checked = false;
    $('grid-replace').checked = false;
    previewGridGenerator();
    $('gis-grid-modal')?.classList.remove('hidden');
  }

  function closeGridGeneratorModal(e) {
    if (e && e.target !== e.currentTarget) return;
    $('gis-grid-modal')?.classList.add('hidden');
  }

  function previewGridGenerator() {
    const plot = getSelectedTargetPlot();
    const el = $('grid-preview-count');
    if (!plot || !plot.boundary || !el) return;
    const pts = C.generateTreeGrid(plot.boundary, {
      spacingX: $('grid-sx')?.value,
      spacingY: $('grid-sy')?.value,
      angleDeg: $('grid-angle')?.value,
      marginMeters: $('grid-margin')?.value,
      staggered: $('grid-staggered')?.checked,
      codePrefix: $('grid-prefix')?.value
    });
    el.innerText = `คำนวณได้ ${pts.length.toLocaleString('th-TH')} ต้น ภายในขอบเขตแปลง (ลากขยับปรับให้ตรงทรงพุ่มจริงภายหลังได้ทุกต้น)`;
  }

  async function executeGridGenerator(e) {
    if (e) e.preventDefault();
    const plot = getSelectedTargetPlot();
    if (!plot || !plot.boundary) return;

    const sx = Math.max(2, C.num($('grid-sx')?.value) || 8);
    const sy = Math.max(2, C.num($('grid-sy')?.value) || 8);
    const pts = C.generateTreeGrid(plot.boundary, {
      spacingX: sx,
      spacingY: sy,
      angleDeg: $('grid-angle')?.value,
      marginMeters: $('grid-margin')?.value,
      staggered: $('grid-staggered')?.checked,
      codePrefix: $('grid-prefix')?.value
    });

    if (!pts.length) {
      toast('ไม่พบจุดต้นไม้ในขอบเขต ลองลดระยะเว้นขอบแปลงหรือตรวจสอบขนาดแปลง', 'error');
      return;
    }

    const btn = $('grid-submit-btn');
    if (btn) btn.classList.add('loading');
    try {
      if ($('grid-replace')?.checked) {
        const oldIds = (AGRI_DATA.state.trees || [])
          .filter((t) => !t.deletedAt && t.plotId === plot.id)
          .map((t) => t.id);
        if (oldIds.length) await AGRI_DATA.removeBulk('trees', oldIds, { hard: true });
      }

      const variety = $('grid-variety')?.value || 'หมอนทอง';
      const age = Math.max(0, C.num($('grid-age')?.value));
      const valveZone = ($('grid-valve')?.value || '').trim();
      const spacingStr = `${sx}x${sy}`;

      const docs = pts.map((pt) => ({
        id: O.newId('tr'),
        treeCode: pt.treeCode,
        orchardId: plot.orchardId,
        plotId: plot.id,
        variety,
        age,
        spacing: spacingStr,
        valveZone,
        health: 'ปกติ',
        stage: 'พักต้น',
        lat: pt.lat,
        lng: pt.lng,
        location: { type: 'Point', coordinates: [pt.lng, pt.lat] },
        note: `แถวที่ ${pt.row} ต้นที่ ${pt.col}`
      }));

      await AGRI_DATA.saveBulk('trees', docs);
      closeGridGeneratorModal();
      renderMapLayers(true);
      renderTreeTable();
      toast(`สร้างผังต้นทุเรียนอัตโนมัติ ${docs.length.toLocaleString('th-TH')} ต้น ลงในแปลง "${plot.name}" สำเร็จ`);
    } catch (err) {
      toast('สร้างผังระยะปลูกไม่สำเร็จ: ' + err.message, 'error');
    } finally {
      if (btn) btn.classList.remove('loading');
    }
  }

  // ====== ตารางข้อมูลเชิงพื้นที่ด้านล่างแผนที่ ======
  function renderTreeTable() {
    const tbody = $('gis-tree-tbody');
    if (!tbody) return;
    const trees = getFilteredTrees();

    const countEl = $('gis-tree-count');
    if (countEl) countEl.innerText = `${trees.length.toLocaleString('th-TH')} ต้น`;

    if (!trees.length) {
      tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:26px;color:var(--slate-500);font-weight:600;">ยังไม่มีรายการต้นไม้ตามเงื่อนไขที่เลือก — วาดขอบเขตแปลงแล้วกด "สร้างผังระยะปลูกอัตโนมัติ" หรือกด "ปักหมุดรายต้น" บนแผนที่</td></tr>`;
      return;
    }

    // แสดงสูงสุด 400 แถวต่อหน้าเพื่อความลื่นไหลบนมือถือ
    const shown = trees.slice(0, 400);
    tbody.innerHTML = shown.map((t) => {
      const orchard = O.getOrchard(t.orchardId);
      const plot = O.getPlot(t.plotId);
      const hCol = HEALTH_COLORS[t.health] || '#10b981';
      const isSel = t.id === selectedTreeId;
      return `
        <tr data-tree-id="${O.esc(t.id)}" class="${isSel ? 'gis-row-selected' : ''}" style="cursor:pointer;" onclick="focusTreeOnMap('${O.esc(t.id)}')">
          <td data-label="รหัสต้น"><strong>${O.esc(t.treeCode || '-')}</strong></td>
          <td data-label="สวน">${O.esc(orchard ? orchard.name : '-')}</td>
          <td data-label="แปลง">${O.esc(plot ? plot.name : '-')}</td>
          <td data-label="สายพันธุ์">${O.esc(t.variety || '-')}</td>
          <td data-label="ระยะปลูก">${O.esc(t.spacing || '-')} ม.</td>
          <td data-label="อายุต้น">${C.num(t.age)} ปี</td>
          <td data-label="โซนวาล์วน้ำ">${O.esc(t.valveZone || '-')}</td>
          <td data-label="สุขภาพต้น"><span class="gis-health-pill" style="background:${hCol}1a;color:${hCol};border:1px solid ${hCol}55;">${O.esc(t.health || 'ปกติ')}</span></td>
          <td data-label="ระยะพัฒนาการ"><span class="badge-op">${O.esc(t.stage || '-')}</span></td>
          <td data-label="จัดการ" onclick="event.stopPropagation();" style="white-space:nowrap;">
            <button type="button" class="btn-icon" title="แก้ไข" onclick="openTreeEditModal('${O.esc(t.id)}')">✏️</button>
            <button type="button" class="btn-icon danger" title="ลบต้นนี้" onclick="deleteSingleTree('${O.esc(t.id)}')">🗑️</button>
          </td>
        </tr>
      `;
    }).join('');
  }

  function openTreeEditModal(treeId) {
    const t = treeId ? (AGRI_DATA.state.trees || []).find((x) => x.id === treeId) : null;
    const plotSel = $('tree-edit-plot');
    if (plotSel) {
      plotSel.innerHTML = O.optionsHTML({ includeAll: false, includeCommon: false, allowOrchardLevel: false });
    }
    if (t) {
      $('tree-modal-title').innerText = `✏️ แก้ไขข้อมูลต้น ${t.treeCode || ''}`;
      $('tree-edit-id').value = t.id;
      if (plotSel) plotSel.value = 'p:' + t.plotId;
      $('tree-edit-code').value = t.treeCode || '';
      $('tree-edit-variety').value = t.variety || 'หมอนทอง';
      $('tree-edit-spacing').value = t.spacing || '8x8';
      $('tree-edit-age').value = C.num(t.age);
      $('tree-edit-valve').value = t.valveZone || '';
      $('tree-edit-health').value = HEALTH_OPTIONS.includes(t.health) ? t.health : 'ปกติ';
      $('tree-edit-stage').value = STAGE_OPTIONS.includes(t.stage) ? t.stage : 'พักต้น';
      $('tree-edit-lat').value = t.lat ?? (t.location?.coordinates?.[1] ?? '');
      $('tree-edit-lng').value = t.lng ?? (t.location?.coordinates?.[0] ?? '');
      $('tree-edit-note').value = t.note || '';
    } else {
      const plot = getSelectedTargetPlot();
      if (!plot) { toast('กรุณาสร้างสวนและแปลงก่อนเพิ่มต้นไม้', 'error'); return; }
      $('tree-modal-title').innerText = '➕ เพิ่มทะเบียนรายต้น';
      $('tree-edit-id').value = '';
      if (plotSel) plotSel.value = 'p:' + plot.id;
      const cnt = (AGRI_DATA.state.trees || []).filter((x) => x.plotId === plot.id).length + 1;
      $('tree-edit-code').value = `${plot.name.slice(0, 4).replace(/\s+/g, '') || 'T'}-${String(cnt).padStart(3, '0')}`;
      $('tree-edit-variety').value = plot.mainVariety || 'หมอนทอง';
      $('tree-edit-spacing').value = `${plot.spacingX || 8}x${plot.spacingY || 8}`;
      $('tree-edit-age').value = plot.treeAge || 1;
      $('tree-edit-valve').value = '';
      $('tree-edit-health').value = 'ปกติ';
      $('tree-edit-stage').value = 'พักต้น';
      $('tree-edit-lat').value = '';
      $('tree-edit-lng').value = '';
      $('tree-edit-note').value = '';
    }
    $('gis-tree-modal')?.classList.remove('hidden');
  }

  function closeTreeEditModal(e) {
    if (e && e.target !== e.currentTarget) return;
    $('gis-tree-modal')?.classList.add('hidden');
  }

  async function saveTreeEditForm(e) {
    if (e) e.preventDefault();
    const plotVal = $('tree-edit-plot')?.value || '';
    const resolved = O.resolve(plotVal);
    if (!resolved.plotId) { toast('กรุณาเลือกแปลงของต้นไม้', 'error'); return; }

    const id = $('tree-edit-id')?.value || O.newId('tr');
    const latStr = ($('tree-edit-lat')?.value || '').trim();
    const lngStr = ($('tree-edit-lng')?.value || '').trim();
    const lat = latStr !== '' ? parseFloat(latStr) : null;
    const lng = lngStr !== '' ? parseFloat(lngStr) : null;

    const doc = {
      id,
      treeCode: ($('tree-edit-code')?.value || '').trim() || id,
      orchardId: resolved.orchardId,
      plotId: resolved.plotId,
      variety: ($('tree-edit-variety')?.value || 'หมอนทอง').trim(),
      spacing: ($('tree-edit-spacing')?.value || '8x8').trim(),
      age: Math.max(0, C.num($('tree-edit-age')?.value)),
      valveZone: ($('tree-edit-valve')?.value || '').trim(),
      health: $('tree-edit-health')?.value || 'ปกติ',
      stage: $('tree-edit-stage')?.value || 'พักต้น',
      lat: Number.isFinite(lat) ? lat : null,
      lng: Number.isFinite(lng) ? lng : null,
      location: Number.isFinite(lat) && Number.isFinite(lng) ? { type: 'Point', coordinates: [lng, lat] } : undefined,
      note: ($('tree-edit-note')?.value || '').trim()
    };

    try {
      await AGRI_DATA.save('trees', doc);
      closeTreeEditModal();
      renderMapLayers(false);
      renderTreeTable();
      toast('บันทึกข้อมูลต้นไม้เรียบร้อย');
    } catch (err) {
      toast('บันทึกไม่สำเร็จ: ' + err.message, 'error');
    }
  }

  async function deleteSingleTree(id) {
    if (!confirm('ต้องการลบต้นไม้นี้ออกจากทะเบียนใช่หรือไม่?')) return;
    await AGRI_DATA.remove('trees', id);
    renderMapLayers(false);
    renderTreeTable();
    toast('ลบต้นไม้เรียบร้อยแล้ว');
  }

  async function clearFilteredTrees() {
    const trees = getFilteredTrees();
    if (!trees.length) { toast('ไม่มีต้นไม้ตามตัวกรองที่เลือก', 'warning'); return; }
    if (!confirm(`ต้องการลบต้นไม้ที่แสดงอยู่ทั้งหมด ${trees.length.toLocaleString('th-TH')} ต้น ใช่หรือไม่?`)) return;
    await AGRI_DATA.removeBulk('trees', trees.map((t) => t.id), { hard: true });
    renderMapLayers(false);
    renderTreeTable();
    toast(`ลบต้นไม้ ${trees.length.toLocaleString('th-TH')} ต้น เรียบร้อยแล้ว`);
  }

  // ====== นำเข้าและส่งออกไฟล์ .geojson และ .csv สำหรับแอป SW Maps ======
  function downloadBlob(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportGeoJSON() {
    const features = [];
    const scope = $('gis-filter-scope')?.value || 'all';
    O.allPlots().forEach((p) => {
      if (p.active === false || !p.boundary) return;
      if (scope.startsWith('o:') && p.orchardId !== scope.slice(2)) return;
      if (scope.startsWith('p:') && p.id !== scope.slice(2)) return;
      const orc = O.getOrchard(p.orchardId);
      features.push({
        type: 'Feature',
        properties: {
          layer_type: 'plot_boundary',
          plot_id: p.id,
          orchard_name: orc ? orc.name : '',
          plot_name: p.name,
          area_rai: p.areaRai,
          main_variety: p.mainVariety || '',
          spacing: `${p.spacingX || 8}x${p.spacingY || 8}`
        },
        geometry: p.boundary.type === 'Feature' ? p.boundary.geometry : p.boundary
      });
    });

    getFilteredTrees().forEach((t) => {
      const lat = t.lat ?? t.location?.coordinates?.[1];
      const lng = t.lng ?? t.location?.coordinates?.[0];
      if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return;
      const orc = O.getOrchard(t.orchardId);
      const plot = O.getPlot(t.plotId);
      features.push({
        type: 'Feature',
        properties: {
          layer_type: 'tree',
          Tree_ID: t.treeCode || t.id,
          Orchard: orc ? orc.name : '',
          Plot: plot ? plot.name : '',
          Variety: t.variety || '',
          Spacing: t.spacing || '',
          Age_Years: C.num(t.age),
          Valve_Zone: t.valveZone || '',
          Health_Status: t.health || 'ปกติ',
          Growth_Stage: t.stage || 'พักต้น',
          Remarks: t.note || ''
        },
        geometry: { type: 'Point', coordinates: [Number(lng), Number(lat)] }
      });
    });

    const fc = { type: 'FeatureCollection', name: 'AgriDash_Orchard_SWMaps', features };
    const stamp = typeof getTodayISO === 'function' ? getTodayISO() : 'export';
    downloadBlob(`แผนที่สวนทุเรียน_SWMaps_${stamp}.geojson`, JSON.stringify(fc, null, 2), 'application/geo+json;charset=utf-8');
    toast(`ส่งออกไฟล์ GeoJSON (${features.length} รายการ) สำหรับ SW Maps เรียบร้อย`);
  }

  function exportTreesCSV() {
    const trees = getFilteredTrees();
    const header = ['Tree_ID', 'Orchard', 'Plot', 'Variety', 'Spacing', 'Age_Years', 'Valve_Zone', 'Health_Status', 'Growth_Stage', 'Latitude', 'Longitude', 'Remarks'];
    const rows = [header];
    trees.forEach((t) => {
      const orc = O.getOrchard(t.orchardId);
      const plot = O.getPlot(t.plotId);
      rows.push([
        t.treeCode || t.id,
        orc ? orc.name : '',
        plot ? plot.name : '',
        t.variety || '',
        t.spacing || '',
        C.num(t.age),
        t.valveZone || '',
        t.health || 'ปกติ',
        t.stage || 'พักต้น',
        t.lat ?? (t.location?.coordinates?.[1] ?? ''),
        t.lng ?? (t.location?.coordinates?.[0] ?? ''),
        t.note || ''
      ]);
    });
    const csv = rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const stamp = typeof getTodayISO === 'function' ? getTodayISO() : 'export';
    downloadBlob(`ทะเบียนต้นทุเรียน_SWMaps_${stamp}.csv`, '\uFEFF' + csv, 'text/csv;charset=utf-8');
    toast(`ส่งออกไฟล์ CSV (${trees.length} ต้น) เรียบร้อย`);
  }

  function parseCSVText(text) {
    const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
    if (lines.length < 2) return [];
    const splitLine = (line) => {
      const res = [];
      let cur = '', inQ = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
          else inQ = !inQ;
        } else if (ch === ',' && !inQ) {
          res.push(cur); cur = '';
        } else cur += ch;
      }
      res.push(cur);
      return res.map((s) => s.trim());
    };
    const headers = splitLine(lines[0]).map((h) => h.toLowerCase());
    return lines.slice(1).map((l) => {
      const vals = splitLine(l);
      const obj = {};
      headers.forEach((h, idx) => { obj[h] = vals[idx] ?? ''; });
      return obj;
    });
  }

  async function handleImportGISFile(event) {
    const file = event.target?.files?.[0];
    if (!file) return;
    const plot = getSelectedTargetPlot();
    if (!plot) {
      toast('กรุณาสร้างและเลือกแปลงปลายทางก่อนนำเข้าไฟล์', 'error');
      event.target.value = '';
      return;
    }

    try {
      const text = await file.text();
      const nameLower = file.name.toLowerCase();
      let importedTrees = [];
      let importedBoundary = null;

      if (nameLower.endsWith('.geojson') || nameLower.endsWith('.json') || text.trim().startsWith('{')) {
        const gj = JSON.parse(text);
        const features = gj.type === 'FeatureCollection' ? (gj.features || []) : (gj.type === 'Feature' ? [gj] : [{ type: 'Feature', geometry: gj, properties: {} }]);
        features.forEach((f, idx) => {
          const geom = f.geometry;
          const props = f.properties || {};
          if (!geom) return;
          if (geom.type === 'Polygon' || geom.type === 'MultiPolygon') {
            importedBoundary = geom;
          } else if (geom.type === 'Point' && Array.isArray(geom.coordinates) && geom.coordinates.length >= 2) {
            const lng = Number(geom.coordinates[0]);
            const lat = Number(geom.coordinates[1]);
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
            importedTrees.push({
              id: O.newId('tr'),
              treeCode: String(props.Tree_ID || props.tree_id || props.treeCode || props.name || `IMP-${String(idx + 1).padStart(3, '0')}`),
              orchardId: plot.orchardId,
              plotId: plot.id,
              variety: String(props.Variety || props.variety || plot.mainVariety || 'หมอนทอง'),
              spacing: String(props.Spacing || props.spacing || `${plot.spacingX || 8}x${plot.spacingY || 8}`),
              age: C.num(props.Age_Years ?? props.age ?? plot.treeAge),
              valveZone: String(props.Valve_Zone || props.valveZone || ''),
              health: String(props.Health_Status || props.health || 'ปกติ'),
              stage: String(props.Growth_Stage || props.stage || 'พักต้น'),
              lat,
              lng,
              location: { type: 'Point', coordinates: [lng, lat] },
              note: String(props.Remarks || props.remarks || props.note || '')
            });
          }
        });
      } else {
        const rows = parseCSVText(text);
        rows.forEach((r, idx) => {
          const lat = parseFloat(r.latitude ?? r.lat ?? r.y ?? '');
          const lng = parseFloat(r.longitude ?? r.lng ?? r.lon ?? r.x ?? '');
          const hasCoord = Number.isFinite(lat) && Number.isFinite(lng);
          importedTrees.push({
            id: O.newId('tr'),
            treeCode: r.tree_id || r.treecode || r['รหัสต้น'] || `CSV-${String(idx + 1).padStart(3, '0')}`,
            orchardId: plot.orchardId,
            plotId: plot.id,
            variety: r.variety || r['สายพันธุ์'] || plot.mainVariety || 'หมอนทอง',
            spacing: r.spacing || r['ระยะปลูก'] || `${plot.spacingX || 8}x${plot.spacingY || 8}`,
            age: C.num(r.age_years ?? r.age ?? r['อายุต้น'] ?? plot.treeAge),
            valveZone: r.valve_zone || r['โซนวาล์วน้ำ'] || '',
            health: r.health_status || r['สุขภาพต้น'] || 'ปกติ',
            stage: r.growth_stage || r['ระยะพัฒนาการ'] || 'พักต้น',
            lat: hasCoord ? lat : null,
            lng: hasCoord ? lng : null,
            location: hasCoord ? { type: 'Point', coordinates: [lng, lat] } : undefined,
            note: r.remarks || r.note || r['หมายเหตุ'] || ''
          });
        });
      }

      if (importedBoundary) await savePlotBoundary(plot.id, importedBoundary);
      if (importedTrees.length) await AGRI_DATA.saveBulk('trees', importedTrees);

      renderMapLayers(true);
      renderTreeTable();
      toast(`นำเข้าสำเร็จ: ต้นไม้ ${importedTrees.length.toLocaleString('th-TH')} ต้น${importedBoundary ? ' และเส้นขอบเขตแปลง 1 แปลง' : ''}`);
    } catch (err) {
      toast('นำเข้าไฟล์ไม่สำเร็จ: ' + err.message, 'error');
    } finally {
      event.target.value = '';
    }
  }

  function refreshSelects() {
    const targetSel = $('gis-target-plot');
    if (targetSel) {
      const prev = targetSel.value;
      targetSel.innerHTML = O.optionsHTML({ includeAll: false, includeCommon: false, allowOrchardLevel: false });
      if (prev && Array.from(targetSel.options).some((op) => op.value === prev)) targetSel.value = prev;
    }
    const filterSel = $('gis-filter-scope');
    if (filterSel) {
      const prev = filterSel.value || 'all';
      filterSel.innerHTML = O.optionsHTML({ includeAll: true, allLabel: 'ทุกสวนและทุกแปลง', includeCommon: false, allowOrchardLevel: true });
      if (Array.from(filterSel.options).some((op) => op.value === prev)) filterSel.value = prev;
    }
  }

  function onViewShown() {
    refreshSelects();
    renderLegend();
    ensureMap();
    renderMapLayers(true);
    renderTreeTable();
  }

  function onFilterChange() {
    renderMapLayers(true);
    renderTreeTable();
  }

  O.onChange(() => {
    refreshSelects();
    if (map) renderMapLayers(false);
    renderTreeTable();
  });
  AGRI_DATA.onChange((_, reason) => {
    if (reason === 'trees' || reason === 'workspace' || reason === 'workspace-offline') {
      if (map) renderMapLayers(false);
      renderTreeTable();
    }
  });

  Object.assign(window, {
    onGisViewShown: onViewShown,
    onGisFilterChange: onFilterChange,
    onGisTargetPlotChange: () => { updateBoundaryInfoBar(); focusSelectedPlotOnMap(); },
    startGisDrawBoundary: startDrawBoundary,
    undoGisDrawVertex: undoDrawVertex,
    finishGisDrawBoundary: finishManualDrawBoundary,
    cancelGisDrawBoundary: cancelManualDrawBoundary,
    clearSelectedPlotBoundary,
    toggleGisAddPointMode: toggleAddPointMode,
    toggleGisDragTreeMode: toggleDragTreeMode,
    setGisMarkerColorMode: setMarkerColorMode,
    openGridGeneratorModal,
    closeGridGeneratorModal,
    previewGridGenerator,
    executeGridGenerator,
    focusTreeOnMap,
    openTreeEditModal,
    closeTreeEditModal,
    saveTreeEditForm,
    deleteSingleTree,
    clearFilteredTrees,
    exportGisGeoJSON: exportGeoJSON,
    exportGisCSV: exportTreesCSV,
    handleImportGISFile
  });

  return { onViewShown, refreshSelects, renderTreeTable };
})();
