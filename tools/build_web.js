const fs = require('fs');
const path = require('path');
const https = require('https');

// Create directories if not exist
const dirs = ['web', 'web/js', 'web/css', 'web/lib', 'web/lib/images'];
dirs.forEach(d => {
  const p = path.join(__dirname, '..', d);
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
});

// Helper to download a file
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Failed to download ${url}: status ${res.statusCode}`));
      }
      const fileStream = fs.createWriteStream(dest);
      res.pipe(fileStream);
      fileStream.on('finish', () => {
        fileStream.close();
        resolve();
      });
    }).on('error', reject);
  });
}

async function build() {
  console.log('Building stops and routes data...');

  // 1. Process stops
  const stopsTsv = fs.readFileSync(path.join(__dirname, '../data/stops.tsv'), 'utf-8');
  const lines = stopsTsv.split(/\r?\n/).filter(l => l.trim().length > 0);
  const stops = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split('\t');
    const id = parseInt(p[0]);
    if (!isNaN(id)) {
      stops.push({
        id,
        lat: parseFloat(p[1]),
        lng: parseFloat(p[2]),
        name_en: (p[3] || '').trim(),
        name_mm: (p[4] || '').trim(),
        road_en: (p[5] || '').trim(),
        road_mm: (p[6] || '').trim(),
        township_en: (p[7] || '').trim(),
        township_mm: (p[8] || '').trim()
      });
    }
  }

  // 2. Process routes
  const routesDir = path.join(__dirname, '../data/routes');
  const routeFiles = fs.readdirSync(routesDir).filter(f => f.endsWith('.json'));
  const routes = [];
  for (const rf of routeFiles) {
    const d = JSON.parse(fs.readFileSync(path.join(routesDir, rf), 'utf-8'));
    routes.push({
      id: d.route_id || rf.replace('.json', ''),
      name: d.name || '',
      color: d.color ? ('#' + d.color.replace('#', '')) : '#2563eb',
      stops: d.stops || [],
      // coordinates in GeoJSON are [lng, lat], convert to [lat, lng] for Leaflet
      coordinates: (d.shape && d.shape.geometry && d.shape.geometry.coordinates)
        ? d.shape.geometry.coordinates.map(c => [c[1], c[0]])
        : []
    });
  }

  // Write JS data files
  const stopsJsPath = path.join(__dirname, '../web/js/data_stops.js');
  const routesJsPath = path.join(__dirname, '../web/js/data_routes.js');
  const stopsHeader = 'var YBS_STOPS = ' + JSON.stringify(stops) + ';\nif (typeof window !== "undefined") window.YBS_STOPS = YBS_STOPS;\nif (typeof module !== "undefined") module.exports = YBS_STOPS;\n';
  const routesHeader = 'var YBS_ROUTES = ' + JSON.stringify(routes) + ';\nif (typeof window !== "undefined") window.YBS_ROUTES = YBS_ROUTES;\nif (typeof module !== "undefined") module.exports = YBS_ROUTES;\n';
  fs.writeFileSync(stopsJsPath, stopsHeader, 'utf-8');
  fs.writeFileSync(routesJsPath, routesHeader, 'utf-8');

  console.log(`Saved ${stops.length} stops to ${stopsJsPath}`);
  console.log(`Saved ${routes.length} routes to ${routesJsPath}`);

  // Download Leaflet assets for offline resilience
  console.log('Downloading Leaflet offline assets...');
  try {
    await downloadFile('https://unpkg.com/leaflet@1.9.4/dist/leaflet.css', path.join(__dirname, '../web/lib/leaflet.css'));
    await downloadFile('https://unpkg.com/leaflet@1.9.4/dist/leaflet.js', path.join(__dirname, '../web/lib/leaflet.js'));
    await downloadFile('https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png', path.join(__dirname, '../web/lib/images/marker-icon.png'));
    await downloadFile('https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png', path.join(__dirname, '../web/lib/images/marker-icon-2x.png'));
    await downloadFile('https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png', path.join(__dirname, '../web/lib/images/marker-shadow.png'));
    console.log('Leaflet assets downloaded successfully!');
  } catch (err) {
    console.warn('Note: Could not download Leaflet offline assets:', err.message);
    console.log('App will fall back to online CDN in index.html.');
  }

  console.log('Build completed successfully!');
}

build();
