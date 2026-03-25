import './style.css';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet-draw';
import 'leaflet-draw/dist/leaflet.draw.css';
import * as turf from '@turf/turf';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import html2canvas from 'html2canvas';

// Base Maps
const darkMap = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
    subdomains: 'abcd',
    maxZoom: 20
});

const lightMap = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
    subdomains: 'abcd',
    maxZoom: 20
});

// Infomapa Rosario WMS Overlay
const parcelasInfomapa = L.tileLayer.wms('https://infomapa.rosario.gob.ar/wms/planobase', {
    layers: 'parcelas',
    format: 'image/png',
    transparent: true,
    version: '1.1.1',
    maxZoom: 22,
    maxNativeZoom: 19,
    attribution: "Infomapa Municipalidad de Rosario"
});

// Initialize map centered on Rosario, Argentina
const map = L.map('map', {
    center: [-32.9442, -60.6505],
    zoom: 14,
    layers: [darkMap, parcelasInfomapa]
});

// Add Layer Control so user can switch to Light Map if parcel lines are hard to see on Dark Mode
L.control.layers(
    { "Modo Oscuro (CARTO)": darkMap, "Modo Claro (CARTO)": lightMap },
    { "Líneas de Parcelas (Oficial)": parcelasInfomapa }
).addTo(map);

// FeatureGroup to store editable layers
const drawnItems = new L.FeatureGroup();
map.addLayer(drawnItems);

// FeatureGroup to store setback (retiro) visual polygon
const setbackGroup = new L.FeatureGroup();
map.addLayer(setbackGroup);

// Layer for Colored Edges
const edgesGroup = new L.FeatureGroup();
map.addLayer(edgesGroup);
window.edgeMapping = [];

// Initialize Leaflet Draw Control
const drawControl = new L.Control.Draw({
    edit: {
        featureGroup: drawnItems
    },
    draw: {
        polygon: {
            allowIntersection: false,
            drawError: {
                color: '#e1e100', // Color the shape will turn when intersects
                message: '<strong>Error:</strong> los bordes del polígono no pueden cruzarse!' // Message that will show when intersect
            },
            shapeOptions: {
                color: '#00e676',
                fillOpacity: 0.3
            }
        },
        polyline: false,
        circle: false,
        rectangle: false,
        circlemarker: false,
        marker: false
    }
});
map.addControl(drawControl);

// Handle shape creation
map.on(L.Draw.Event.CREATED, function (event) {
    const layer = event.layer;
    
    // Clear previous items to only allow one plot at a time
    drawnItems.clearLayers();
    setbackGroup.clearLayers();
    edgesGroup.clearLayers();
    drawnItems.addLayer(layer);
    
    calculateArea(layer);
    generateEdgeConfigUI(layer);
    updateAnalysis();
});

// Handle shape editing
map.on(L.Draw.Event.EDITED, function (event) {
    const layers = event.layers;
    layers.eachLayer(function (layer) {
        calculateArea(layer);
        generateEdgeConfigUI(layer);
    });
    updateAnalysis();
});

map.on(L.Draw.Event.DELETED, function (event) {
    setbackGroup.clearLayers();
    edgesGroup.clearLayers();
    document.getElementById('calc-area').innerText = '0 m²';
    document.getElementById('poi-desc').innerText = 'Dibuja un terreno para analizar el entorno cercano.';
    document.getElementById('gmaps-link-container').style.display = 'none';
    const cfg = document.getElementById('edges-config');
    if(cfg) cfg.innerHTML = 'Dibuja un terreno en el mapa para configurar sus lados.';
    window.edgeMapping = [];
});

// Calculate area using Leaflet GeometryUtil or Turf.js
function calculateArea(layer) {
    let area = 0;
    
    // If it's a polygon, use Turf.js for accurate area calculation
    const geojson = layer.toGeoJSON();
    if (geojson.geometry.type === 'Polygon') {
        area = turf.area(geojson); // Area in square meters
    }
    
    // Update UI
    const areaDisplay = document.getElementById('calc-area');
    areaDisplay.textContent = Math.round(area).toLocaleString('es-AR') + ' m²';
    
    // Store area as data attribute for analysis logic
    areaDisplay.dataset.area = Math.round(area);
}

// React to form inputs
document.getElementById('zone').addEventListener('change', updateAnalysis);
document.getElementById('address').addEventListener('input', debounce(updateAnalysis, 500));
document.getElementById('fot').addEventListener('input', debounce(updateAnalysis, 500));
document.getElementById('fos').addEventListener('input', debounce(updateAnalysis, 500));
document.getElementById('retiro-frente').addEventListener('input', debounce(updateAnalysis, 500));
document.getElementById('retiro-lateral').addEventListener('input', debounce(updateAnalysis, 500));
document.getElementById('retiro-fondo').addEventListener('input', debounce(updateAnalysis, 500));

// AI Button Listener
document.getElementById('ai-analyze-btn').addEventListener('click', analyzeWithAI);

// Excel Export Listener
document.getElementById('export-excel-btn').addEventListener('click', exportToExcel);

// Generate UI for explicitly picking edge types
function generateEdgeConfigUI(layer) {
    edgesGroup.clearLayers();
    window.edgeMapping = [];
    const container = document.getElementById('edges-config');
    container.innerHTML = '';
    
    if (!(layer instanceof L.Polygon)) return;
    
    let polygonCoords = layer.toGeoJSON().geometry.coordinates[0];
    if(polygonCoords.length > 0 && polygonCoords[0][0] === polygonCoords[polygonCoords.length-1][0]) {
        polygonCoords.pop(); // Remove closing point
    }
    const n = polygonCoords.length;
    if(n < 3) return;
    
    const colors = ['#2196F3', '#4CAF50', '#FF9800', '#E91E63', '#9C27B0', '#00BCD4'];
    
    for(let i=0; i<n; i++) {
        const p1 = polygonCoords[i];
        const p2 = polygonCoords[(i+1)%n];
        const color = colors[i % colors.length];
        
        // draw line
        L.polyline([[p1[1], p1[0]], [p2[1], p2[0]]], {
            color: color,
            weight: 5,
            opacity: 0.8
        }).bindPopup(`Lado ${i+1}`).addTo(edgesGroup);
        
        // Default mapping
        let type = (i === 0) ? 'frente' : (i === Math.floor(n/2) ? 'fondo' : 'lateral');
        window.edgeMapping[i] = type;
        
        // ui
        const div = document.createElement('div');
        div.style.cssText = 'display:flex; align-items:center; margin-bottom:6px; gap:8px;';
        div.innerHTML = `
            <span style="width:14px; height:14px; background:${color}; display:inline-block; border-radius:2px;"></span>
            <label style="flex:1; margin:0;">Lado ${i+1}</label>
            <select class="edge-type-select" data-index="${i}" style="width:110px; padding:3px; background:#1e1e1e; border:1px solid #444; color:#fff; border-radius:4px;">
                <option value="frente" ${type==='frente'?'selected':''}>Frente</option>
                <option value="lateral" ${type==='lateral'?'selected':''}>Lateral</option>
                <option value="fondo" ${type==='fondo'?'selected':''}>Fondo</option>
            </select>
        `;
        container.appendChild(div);
    }
    
    // Attach events
    container.querySelectorAll('.edge-type-select').forEach(sel => {
        sel.addEventListener('change', (e) => {
            const idx = parseInt(e.target.getAttribute('data-index'));
            window.edgeMapping[idx] = e.target.value;
            updateAnalysis();
        });
    });
}

async function analyzeWithAI() {
    const btn = document.getElementById('ai-analyze-btn');
    const address = document.getElementById('address').value;
    const zone = document.getElementById('zone').value;
    
    if (!address) {
        alert("Por favor ingresa una dirección primero.");
        return;
    }
    
    btn.textContent = "Pensando...";
    btn.disabled = true;
    
    try {
        const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
        const response = await fetch(`${API_URL}/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ address, zone })
        });
        
        if (!response.ok) throw new Error("Error en el servidor Python");
        
        const data = await response.json();
        
        if (data.error) throw new Error(data.error);
        
        // Populate fields
        if (data.fot) document.getElementById('fot').value = data.fot;
        if (data.fos) document.getElementById('fos').value = data.fos;
        if (data.retiroFrente) document.getElementById('retiro-frente').value = data.retiroFrente;
        if (data.retiroLateral) document.getElementById('retiro-lateral').value = data.retiroLateral;
        if (data.retiroFondo) document.getElementById('retiro-fondo').value = data.retiroFondo;
        
        // Show justification in Normativa block
        const nDesc = document.getElementById('normativa-desc');
        nDesc.innerHTML = `<strong>✨ Análisis Inteligente (Gemini):</strong><br><em>${data.justificacion}</em><br><br>` + nDesc.innerHTML;
        
        // Trigger update visuals
        updateAnalysis();
        
    } catch (e) {
        console.error(e);
        alert("Ocurrió un error consultando la IA local: " + e.message);
    } finally {
        btn.textContent = "Analizar IA 🧠";
        btn.disabled = false;
    }
}

// Mock logic for analysis based on user prompt rules
function updateAnalysis() {
    const zone = document.getElementById('zone').value;
    const address = document.getElementById('address').value;
    const fot = parseFloat(document.getElementById('fot').value || 0);
    const fos = parseFloat(document.getElementById('fos').value || 0);
    
    // Retiros
    const retiroFrente = parseFloat(document.getElementById('retiro-frente').value || 0);
    const retiroLateral = parseFloat(document.getElementById('retiro-lateral').value || 0);
    const retiroFondo = parseFloat(document.getElementById('retiro-fondo').value || 0);
    
    const areaDisplay = document.getElementById('calc-area');
    const currentArea = parseFloat(areaDisplay.dataset.area || 0);
    
    const normativaDesc = document.getElementById('normativa-desc');
    const mercadoDesc = document.getElementById('mercado-desc');
    const infoEdificabilidad = document.getElementById('edificabilidad-info');
    
    if (currentArea === 0 && !address) {
        return;
    }

    // Calcula y Muestra FOT y FOS si están cargados
    if ((fot > 0 || fos > 0) && currentArea > 0) {
        infoEdificabilidad.style.display = 'block';
        document.getElementById('fos-area').textContent = (currentArea * fos).toLocaleString('es-AR') + ' m²';
        document.getElementById('fot-area').textContent = (currentArea * fot).toLocaleString('es-AR') + ' m²';
    } else {
        infoEdificabilidad.style.display = 'none';
    }
    
    // Para el gráfico 2D simplificado usamos el nuevo algoritmo de intersección asimétrica.
    renderAsymmetricSetback(retiroFrente, retiroLateral, retiroFondo);
    
    // Trigger POI fetch if we have a drawn layer calculate center
    updatePOIs();

    // 1. Normativa y Catastro (Oficial)
    let normativaHtml = '';
    if (zone === 'centro') {
        normativaHtml = `<strong>FOT Alto:</strong> Permitido desarrollo en altura (ej: 10-15 pisos).<br>
        <em>Verificación Infomapa:</em> Area central, requiere dejar pulmón de manzana. Se permiten cocheras subterráneas.`;
    } else if (zone === 'gran_rosario') {
        normativaHtml = `<strong>Zona de Desarrollo:</strong> Pensado para loteos o barrios cerrados. FOS bajo (generalmente 30-40%).<br>
        <em>Requisitos:</em> Mensura y subdivisión requerida. Obligación de estudios geotécnicos preventivos según suelo.`;
    } else if (zone === 'funes') {
        normativaHtml = `<strong>Ciudad de Funes:</strong> Predomina el uso residencial (Zona R). Exige dejar un amplio FOS libre (espacio verde absorbente).<br>
        <em>Retiros:</em> Estrictos retiros de frente, fondo y laterales. Altura máxima suele limitarse a Planta Baja y 1 ó 2 pisos.`;
    } else {
        normativaHtml = `<strong>Zona Mixta:</strong> Altura máxima permitida típicamente entre 11.5m a 19m (ej: planta baja y 3-6 pisos) según pasillo urbano.<br>
        <em>Certificado municipal:</em> Se sugiere iniciar visado en obras particulares.`;
    }
    normativaDesc.innerHTML = normativaHtml;

    // 2. Análisis de Mercado y Tasación
    let mercadoHtml = '';
    let pricePerSqm = 0;
    let poiAnalysis = '';

    if (zone === 'centro') {
        pricePerSqm = 2500; // USD
        poiAnalysis = `Zonas premium cerca del río superan los USD 2,500/m². Alta rentabilidad para departamentos de 1 y 2 dormitorios cerca de universidades o zona gastronómica Pichincha/Oroño.`;
    } else if (zone === 'gran_rosario') {
        pricePerSqm = 120; // USD 
        poiAnalysis = `Gran Rosario (Roldán, Ibarlucea) en alto desarrollo. Valor tierra aprox USD 100-150/m². Rentable comercializando lotes de 300-500m² cerca de nuevos paseos comerciales.`;
    } else if (zone === 'funes') {
        pricePerSqm = 180; // USD
        poiAnalysis = `Funes (Muy alta demanda). Valor de tierra en loteos premium entre USD 150 y 300/m². Ideal para casa-quinta, condominios cerrados y desarrollos near-nature con excelentes accesos y servicios educativos.`;
    } else if (zone === 'macrocentro') {
        pricePerSqm = 1000;
        poiAnalysis = `Rentabilidad estable. Atractivo para proyectos de vivienda familiar cerca de escuelas y hospitales o sanatorios grandes.`;
    } else {
        pricePerSqm = 500;
        poiAnalysis = `Ideal vivienda propia o locales comerciales sobre avenidas. Requiere análisis de seguridad de la zona y cercanía a nudos de transporte.`;
    }
    
    const totalValue = currentArea * pricePerSqm;
    
    mercadoHtml = `
        <strong>Valor estimado tierra:</strong> USD ${pricePerSqm}/m²<br>
        <strong>Valor Total (aprox):</strong> USD ${totalValue.toLocaleString('en-US')}<br>
        <br>
        <strong>Interés cercano:</strong> ${poiAnalysis}
    `;
    mercadoDesc.innerHTML = mercadoHtml;
}

// Render asymmetric setback polygon
function renderAsymmetricSetback(retiroFrente, retiroLateral, retiroFondo) {
    setbackGroup.clearLayers();
    if (retiroFrente <= 0 && retiroLateral <= 0 && retiroFondo <= 0) return;
    
    drawnItems.eachLayer(function(layer) {
        if (layer instanceof L.Polygon) {
            try {
                let polygonCoords = layer.toGeoJSON().geometry.coordinates[0];
                if(polygonCoords.length > 0 && polygonCoords[0][0] === polygonCoords[polygonCoords.length-1][0] && polygonCoords[0][1] === polygonCoords[polygonCoords.length-1][1]) {
                    polygonCoords.pop(); // remove closing point for edge processing
                }
                const n = polygonCoords.length;
                if(n < 3) return; // Need at least triangle
                
                // Mapear el retiro a cada segmento según el UI config
                let setbacks = [];
                for(let i=0; i<n; i++) {
                    let type = window.edgeMapping[i];
                    if(!type) type = (i === 0) ? 'frente' : (i === Math.floor(n/2) ? 'fondo' : 'lateral');
                    
                    if(type === 'frente') setbacks.push(retiroFrente);
                    else if(type === 'fondo') setbacks.push(retiroFondo);
                    else setbacks.push(retiroLateral);
                }
                
                // Check if Clockwise
                const loop = [...polygonCoords, polygonCoords[0]];
                const isClockwise = turf.booleanClockwise(turf.lineString(loop));
                
                let offsetLines = [];
                for(let i=0; i<n; i++) {
                    const p1 = polygonCoords[i];
                    const p2 = polygonCoords[(i+1)%n];
                    const line = turf.lineString([p1, p2]);
                    const distance = isClockwise ? setbacks[i] : -setbacks[i]; // Turf: positive is right. CW->right is inside.
                    
                    // Solo offset si hay retiro, o 0.0001 (muy poco) para evitar cruces extraños si es 0
                    const dist = (distance !== 0) ? (distance / 1000) : (isClockwise ? 0.0001 : -0.0001);
                    const offsetLine = turf.lineOffset(line, dist, {units: 'kilometers'});
                    offsetLines.push(offsetLine);
                }
                
                let newCoords = [];
                for(let i=0; i<n; i++) {
                    const L1 = offsetLines[i];
                    const L2 = offsetLines[(i+1)%n];
                    const intersection = intersectLines(
                        L1.geometry.coordinates[0], L1.geometry.coordinates[L1.geometry.coordinates.length-1],
                        L2.geometry.coordinates[0], L2.geometry.coordinates[L2.geometry.coordinates.length-1]
                    );
                    if(intersection) {
                        newCoords.push(intersection);
                    } else {
                        // Si son paralelos, mantener el fin del L1
                        newCoords.push(L1.geometry.coordinates[L1.geometry.coordinates.length-1]);
                    }
                }
                newCoords.push(newCoords[0]); // Cerrar polígono
                
                const newPoly = turf.polygon([newCoords]);
                
                L.geoJSON(newPoly, {
                    style: {
                        color: '#ff1744',
                        weight: 2,
                        fillColor: '#ff1744',
                        fillOpacity: 0.3,
                        dashArray: '5, 5'
                    }
                }).bindPopup("<b>Área Construible (Retiros Inward)</b>").addTo(setbackGroup);
                
            } catch (e) {
                console.error("No se pudo calcular el retiro asimétrico avanzado (usualmente ocurre si el retiro es mayor al tamaño del lote).", e);
            }
        }
    });
}

// Math util for Line Intersection
function intersectLines(p1, p2, p3, p4) {
    const x1 = p1[0], y1 = p1[1];
    const x2 = p2[0], y2 = p2[1];
    const x3 = p3[0], y3 = p3[1];
    const x4 = p4[0], y4 = p4[1];

    const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    if (Math.abs(denom) < 1e-10) return null; // Paralelas

    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
    const x = x1 + t * (x2 - x1);
    const y = y1 + t * (y2 - y1);
    return [x, y];
}

// Export to Excel / Sheets logic
async function exportToExcel() {
    const btn = document.getElementById('export-excel-btn');
    btn.textContent = "Generando Exportación...";
    btn.disabled = true;
    
    try {
        const wb = new ExcelJS.Workbook();
        const ws = wb.addWorksheet('Análisis Terreno');
        
        // Setup Columns
        ws.columns = [
            { header: 'PARÁMETRO', key: 'name', width: 25 },
            { header: 'VALOR / DETALLE', key: 'val', width: 50 },
            { header: 'MAPA', key: 'map', width: 60 } // Spacer for image
        ];
        
        ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
        ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF217346' } };
        
        // Add Data Rows
        ws.addRow({name: 'Nombre / Referencia', val: document.getElementById('plot-name').value});
        ws.addRow({name: 'Dirección Exacta', val: document.getElementById('address').value});
        const zoneSelect = document.getElementById('zone');
        ws.addRow({name: 'Zona', val: zoneSelect.options[zoneSelect.selectedIndex].text});
        ws.addRow({name: 'Área del Terreno', val: document.getElementById('calc-area').innerText});
        ws.addRow({name: 'F.O.T. (Factor Ocup. Total)', val: document.getElementById('fot').value});
        ws.addRow({name: 'F.O.S. (Factor Ocup. Suelo)', val: document.getElementById('fos').value});
        ws.addRow({name: 'Retiro de Frente', val: document.getElementById('retiro-frente').value + ' m'});
        ws.addRow({name: 'Retiro Lateral', val: document.getElementById('retiro-lateral').value + ' m'});
        ws.addRow({name: 'Retiro de Fondo', val: document.getElementById('retiro-fondo').value + ' m'});
        ws.addRow({name: 'Huella Máxima', val: document.getElementById('fos-area').innerText});
        ws.addRow({name: 'Superficie Edificable', val: document.getElementById('fot-area').innerText});
        
        let entornoText = document.getElementById('poi-desc').innerText;
        entornoText = entornoText.replace(/\n/g, ' - ');
        ws.addRow({name: 'Entorno (Radios 800m)', val: entornoText});
        
        // Add Observations & Data
        ws.addRow({});
        ws.addRow({name: 'Observaciones', val: document.getElementById('observaciones').value});
        ws.addRow({name: 'Datos Varios', val: document.getElementById('datos-varios').value});
        
        ws.getColumn(2).alignment = { wrapText: true, vertical: 'top' };
        
        // Try to capture Map Screenshot
        try {
            const mapNode = document.getElementById('map');
            const canvas = await html2canvas(mapNode, { 
                useCORS: true, 
                allowTaint: false,
                ignoreElements: (el) => el.className && typeof el.className === 'string' && el.className.includes('leaflet-control-zoom')
            });
            const imgData = canvas.toDataURL('image/png');
            const imageId = wb.addImage({
                base64: imgData,
                extension: 'png',
            });
            // Merge cells for the image to fit
            ws.mergeCells('C2:D15');
            ws.addImage(imageId, 'C2:D15');
        } catch (imgError) {
            console.warn("No se pudo adjuntar el mapa en Excel (CORS):", imgError);
            ws.getCell('C2').value = "Imagen de mapa no disponible (CORS)";
        }
        
        const buffer = await wb.xlsx.writeBuffer();
        saveAs(new Blob([buffer]), 'Analisis_Terreno_Rosario.xlsx');
        
    } catch (e) {
        console.error(e);
        alert("Ocurrió un error generando el Excel: " + e.message);
    } finally {
        btn.innerHTML = "📥 Exportar (Excel / Sheets)";
        btn.disabled = false;
    }
}

// Fetch POIs using Overpass API
async function updatePOIs() {
    let centerLat = null;
    let centerLng = null;
    
    drawnItems.eachLayer(function(layer) {
        if (layer instanceof L.Polygon) {
            const bounds = layer.getBounds();
            const center = bounds.getCenter();
            centerLat = center.lat;
            centerLng = center.lng;
        }
    });
    
    const poiDesc = document.getElementById('poi-desc');
    const gmapsBox = document.getElementById('gmaps-link-container');
    
    if (!centerLat || !centerLng) {
        poiDesc.textContent = "Dibuja un terreno para analizar el entorno cercano.";
        gmapsBox.style.display = 'none';
        return;
    }
    
    // Configurar enlace a Google Maps
    const gmapsUrl = `https://www.google.com/maps/search/escuelas+supermercados+parques+hospitales/@${centerLat},${centerLng},15z`;
    document.getElementById('gmaps-link').href = gmapsUrl;
    gmapsBox.style.display = 'block';
    
    poiDesc.innerHTML = "<em>Buscando lugares de interés en un radio de 800m...</em>";
    
    const radius = 800;
    const query = `
        [out:json];
        (
          node["amenity"~"school|hospital|clinic"](around:${radius},${centerLat},${centerLng});
          node["shop"~"supermarket|mall"](around:${radius},${centerLat},${centerLng});
          node["leisure"~"park|pitch"](around:${radius},${centerLat},${centerLng});
        );
        out 50;
    `;
    const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;
    
    try {
        const response = await fetch(url);
        const data = await response.json();
        let schools = 0, health = 0, commerce = 0, parks = 0;
        
        data.elements.forEach(el => {
            if (el.tags.amenity === 'school') schools++;
            if (el.tags.amenity === 'hospital' || el.tags.amenity === 'clinic') health++;
            if (el.tags.shop === 'supermarket' || el.tags.shop === 'mall') commerce++;
            if (el.tags.leisure === 'park' || el.tags.leisure === 'pitch') parks++;
        });
        
        poiDesc.innerHTML = `<strong>A menos de 800m:</strong><ul>
            <li>🏫 Escuelas: ${schools}</li>
            <li>🏪 Supermercados: ${commerce}</li>
            <li>🌳 Parques/Plazas: ${parks}</li>
            <li>🏥 Centros de Salud: ${health}</li>
        </ul>
        <em>Datos de OpenStreetMap</em>`;
    } catch (e) {
        console.error("Error fetching POIs", e);
        poiDesc.innerHTML = "No se pudieron obtener los datos automáticos. Utiliza el enlace de Google Maps.";
    }
}

// Utility: debounce
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}
