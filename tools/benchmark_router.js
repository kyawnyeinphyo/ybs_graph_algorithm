const fs = require('fs');
const path = require('path');

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371; // km
  const p1 = lat1 * Math.PI / 180;
  const p2 = lat2 * Math.PI / 180;
  const dp = (lat2 - lat1) * Math.PI / 180;
  const dl = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// 1. Load stops
const stopsTsv = fs.readFileSync(path.join(__dirname, '../data/stops.tsv'), 'utf-8');
const lines = stopsTsv.split(/\r?\n/).filter(l => l.trim().length > 0);
const stops = {};
for (let i = 1; i < lines.length; i++) {
  const p = lines[i].split('\t');
  const id = parseInt(p[0]);
  if (!isNaN(id)) {
    stops[id] = {
      id,
      lat: parseFloat(p[1]),
      lng: parseFloat(p[2]),
      name_en: p[3],
      name_mm: p[4],
      road_en: p[5],
      road_mm: p[6],
      township_en: p[7],
      township_mm: (p[8] || '').trim()
    };
  }
}

// 2. Precompute nearby opposite stops within 90m
const stopList = Object.values(stops);
const nearbyStops = {}; // stopId -> [ { id, dist } ]
for (const s of stopList) {
  nearbyStops[s.id] = [];
  for (const o of stopList) {
    if (s.id !== o.id && Math.abs(s.lat - o.lat) < 0.0015 && Math.abs(s.lng - o.lng) < 0.0015) {
      const d = haversine(s.lat, s.lng, o.lat, o.lng) * 1000; // in meters
      if (d <= 90) {
        nearbyStops[s.id].push({ id: o.id, dist: Math.round(d) });
      }
    }
  }
}

// 3. Load routes
const routesDir = path.join(__dirname, '../data/routes');
const routeFiles = fs.readdirSync(routesDir).filter(f => f.endsWith('.json'));
const routes = [];
const stopToRouteIndices = {};

routeFiles.forEach((rf, rIdx) => {
  const d = JSON.parse(fs.readFileSync(path.join(routesDir, rf), 'utf-8'));
  const r = {
    id: d.route_id || rf.replace('.json', ''),
    name: d.name,
    color: d.color ? ('#' + d.color.replace('#', '')) : '#3b82f6',
    stops: d.stops || []
  };
  routes.push(r);
  r.stops.forEach((sId, sIdx) => {
    if (!stopToRouteIndices[sId]) stopToRouteIndices[sId] = [];
    stopToRouteIndices[sId].push({ routeIndex: rIdx, stopIndex: sIdx });
  });
});

console.log('Graph initialized. Testing comprehensive search engine...');

class TransitRouter {
  constructor(stops, routes, stopToRouteIndices, nearbyStops) {
    this.stops = stops;
    this.routes = routes;
    this.stopToRouteIndices = stopToRouteIndices;
    this.nearbyStops = nearbyStops;
  }

  calcDist(stopArray) {
    let d = 0;
    for (let i = 0; i < stopArray.length - 1; i++) {
      const s1 = this.stops[stopArray[i]];
      const s2 = this.stops[stopArray[i + 1]];
      if (s1 && s2) d += haversine(s1.lat, s1.lng, s2.lat, s2.lng);
    }
    return d;
  }

  search(startStopId, targetStopId) {
    const sStart = this.stops[startStopId];
    const sTarget = this.stops[targetStopId];
    if (!sStart || !sTarget) return { direct: [], oneTransfer: [], twoTransfers: [], all: [] };

    // Find candidate boarding stops (selected stop + paired stops across street within 90m)
    const startCandidates = [{ id: startStopId, walkDist: 0 }];
    (this.nearbyStops[startStopId] || []).forEach(n => {
      startCandidates.push({ id: n.id, walkDist: n.dist / 1000 });
    });

    const targetCandidates = [{ id: targetStopId, walkDist: 0 }];
    (this.nearbyStops[targetStopId] || []).forEach(n => {
      targetCandidates.push({ id: n.id, walkDist: n.dist / 1000 });
    });

    const targetSet = new Set(targetCandidates.map(t => t.id));
    const targetDistMap = new Map(targetCandidates.map(t => [t.id, t.walkDist]));

    const directRoutes = [];
    const directSeen = new Set();

    // 1. DIRECT ROUTES (၁ ဆင့်)
    for (const sc of startCandidates) {
      const sRoutes = this.stopToRouteIndices[sc.id] || [];
      for (const sr of sRoutes) {
        const r = this.routes[sr.routeIndex];
        for (let j = sr.stopIndex + 1; j < r.stops.length; j++) {
          const destId = r.stops[j];
          if (targetSet.has(destId)) {
            const key = `${r.id}_${sc.id}_${destId}`;
            if (!directSeen.has(key)) {
              directSeen.add(key);
              const segStops = r.stops.slice(sr.stopIndex, j + 1);
              const rideDist = this.calcDist(segStops);
              const totalDist = rideDist + sc.walkDist + targetDistMap.get(destId);
              const stopCount = segStops.length - 1;
              const score = totalDist + (stopCount * 0.1);

              directRoutes.push({
                stages: 1,
                transfers: 0,
                score,
                totalDistance: totalDist,
                totalStops: stopCount,
                estimatedMinutes: Math.round((totalDist / 20) * 60 + stopCount * 0.5),
                segments: [{
                  stageIndex: 1,
                  type: 'bus',
                  routeId: r.id,
                  routeName: r.name,
                  color: r.color,
                  boardStopId: sc.id,
                  alightStopId: destId,
                  walkBeforeMeters: Math.round(sc.walkDist * 1000),
                  walkAfterMeters: Math.round(targetDistMap.get(destId) * 1000),
                  stopCount,
                  stops: segStops,
                  distance: rideDist
                }]
              });
            }
          }
        }
      }
    }

    // 2. ONE TRANSFER ROUTES (၂ ဆင့်)
    // Downstream reachable map: stopId -> array of { routeIndex, fromIdx, toIdx, startCand }
    const r1Downstream = new Map();
    for (const sc of startCandidates) {
      const sRoutes = this.stopToRouteIndices[sc.id] || [];
      for (const sr of sRoutes) {
        const r = this.routes[sr.routeIndex];
        for (let j = sr.stopIndex + 1; j < r.stops.length; j++) {
          const tStop = r.stops[j];
          if (targetSet.has(tStop)) continue;
          if (!r1Downstream.has(tStop)) r1Downstream.set(tStop, []);
          r1Downstream.get(tStop).push({
            routeIndex: sr.routeIndex,
            fromIdx: sr.stopIndex,
            toIdx: j,
            startCand: sc
          });
        }
      }
    }

    // Upstream origins map to target
    const r2Upstream = new Map();
    for (const tc of targetCandidates) {
      const tRoutes = this.stopToRouteIndices[tc.id] || [];
      for (const tr of tRoutes) {
        const r = this.routes[tr.routeIndex];
        for (let j = 0; j < tr.stopIndex; j++) {
          const tStop = r.stops[j];
          if (!r2Upstream.has(tStop)) r2Upstream.set(tStop, []);
          r2Upstream.get(tStop).push({
            routeIndex: tr.routeIndex,
            fromIdx: j,
            toIdx: tr.stopIndex,
            targetCand: tc
          });
        }
      }
    }

    const oneTransferRoutes = [];
    const oneTransferSeen = new Set();

    // Check same-stop transfer and nearby walk transfer (across the street)
    for (const [tStop, seg1List] of r1Downstream.entries()) {
      // Direct same stop transfer
      const transferStops = [{ id: tStop, walkDist: 0 }];
      (this.nearbyStops[tStop] || []).forEach(n => {
        transferStops.push({ id: n.id, walkDist: n.dist / 1000 });
      });

      for (const ts of transferStops) {
        if (r2Upstream.has(ts.id)) {
          const seg2List = r2Upstream.get(ts.id);
          for (const s1 of seg1List) {
            for (const s2 of seg2List) {
              if (s1.routeIndex === s2.routeIndex) continue; // Same route no transfer
              const r1 = this.routes[s1.routeIdx !== undefined ? s1.routeIdx : s1.routeIndex];
              const r2 = this.routes[s2.routeIdx !== undefined ? s2.routeIdx : s2.routeIndex];
              const key = `${r1.id}_${s1.startCand.id}->${tStop}|${r2.id}_${ts.id}->${s2.targetCand.id}`;
              if (oneTransferSeen.has(key)) continue;
              oneTransferSeen.add(key);

              const stops1 = r1.stops.slice(s1.fromIdx, s1.toIdx + 1);
              const stops2 = r2.stops.slice(s2.fromIdx, s2.toIdx + 1);
              const dist1 = this.calcDist(stops1);
              const dist2 = this.calcDist(stops2);
              const walkTotal = s1.startCand.walkDist + ts.walkDist + s2.targetCand.walkDist;
              const totalDist = dist1 + dist2 + walkTotal;
              const totalStops = (stops1.length - 1) + (stops2.length - 1);

              // Transfer penalty = 8 km equivalent (~12 mins)
              const score = totalDist + 8.0 + (ts.walkDist * 2) + (totalStops * 0.08);

              oneTransferRoutes.push({
                stages: 2,
                transfers: 1,
                score,
                totalDistance: totalDist,
                totalStops,
                estimatedMinutes: Math.round((totalDist / 20) * 60 + totalStops * 0.5 + 12),
                transferInfo: {
                  atStopId: tStop,
                  nextStopId: ts.id,
                  walkMeters: Math.round(ts.walkDist * 1000)
                },
                segments: [
                  {
                    stageIndex: 1,
                    type: 'bus',
                    routeId: r1.id,
                    routeName: r1.name,
                    color: r1.color,
                    boardStopId: s1.startCand.id,
                    alightStopId: tStop,
                    walkBeforeMeters: Math.round(s1.startCand.walkDist * 1000),
                    stopCount: stops1.length - 1,
                    stops: stops1,
                    distance: dist1
                  },
                  {
                    stageIndex: 2,
                    type: 'bus',
                    routeId: r2.id,
                    routeName: r2.name,
                    color: r2.color,
                    boardStopId: ts.id,
                    alightStopId: s2.targetCand.id,
                    walkBeforeMeters: Math.round(ts.walkDist * 1000),
                    walkAfterMeters: Math.round(s2.targetCand.walkDist * 1000),
                    stopCount: stops2.length - 1,
                    stops: stops2,
                    distance: dist2
                  }
                ]
              });
            }
          }
        }
      }
    }

    // 3. TWO TRANSFERS ROUTES (၃ ဆင့်)
    // Only search 3 stages if needed or to provide full comprehensive choices
    const twoTransfersRoutes = [];
    const twoTransfersSeen = new Set();

    // To make 3-stage search lightning fast and optimal:
    // We select the top transfer candidate hubs using A* heuristic
    // Hub must be in r1Downstream, and destination hub must be in r2Upstream
    // Intermediate route connects T1 to T2
    const rMidList = [];
    for (let rIdx = 0; rIdx < this.routes.length; rIdx++) {
      const rMid = this.routes[rIdx];
      for (let i = 0; i < rMid.stops.length; i++) {
        const t1 = rMid.stops[i];
        if (r1Downstream.has(t1)) {
          for (let j = i + 1; j < rMid.stops.length; j++) {
            const t2 = rMid.stops[j];
            if (r2Upstream.has(t2) && t1 !== t2) {
              rMidList.push({ rMidIdx: rIdx, t1, t2, i, j });
            }
          }
        }
      }
    }

    // Rank candidate bridges by A* heuristic
    rMidList.sort((a, b) => {
      const stopA1 = this.stops[a.t1], stopA2 = this.stops[a.t2];
      const stopB1 = this.stops[b.t1], stopB2 = this.stops[b.t2];
      const distA = haversine(sStart.lat, sStart.lng, stopA1.lat, stopA1.lng) + haversine(stopA2.lat, stopA2.lng, sTarget.lat, sTarget.lng);
      const distB = haversine(sStart.lat, sStart.lng, stopB1.lat, stopB1.lng) + haversine(stopB2.lat, stopB2.lng, sTarget.lat, sTarget.lng);
      return distA - distB;
    });

    for (const cand of rMidList.slice(0, 150)) {
      const s1List = r1Downstream.get(cand.t1);
      const s2List = r2Upstream.get(cand.t2);
      if (!s1List || !s2List) continue;

      const s1 = s1List[0];
      const s2 = s2List[0];
      if (s1.routeIndex === cand.rMidIdx || s2.routeIndex === cand.rMidIdx || s1.routeIndex === s2.routeIndex) continue;

      const r1 = this.routes[s1.routeIndex];
      const rMid = this.routes[cand.rMidIdx];
      const r2 = this.routes[s2.routeIndex];

      const key = `${r1.id}_${cand.t1}|${rMid.id}_${cand.t2}|${r2.id}`;
      if (twoTransfersSeen.has(key)) continue;
      twoTransfersSeen.add(key);

      const stops1 = r1.stops.slice(s1.fromIdx, s1.toIdx + 1);
      const stopsMid = rMid.stops.slice(cand.i, cand.j + 1);
      const stops2 = r2.stops.slice(s2.fromIdx, s2.toIdx + 1);

      const dist1 = this.calcDist(stops1);
      const distMid = this.calcDist(stopsMid);
      const dist2 = this.calcDist(stops2);
      const totalDist = dist1 + distMid + dist2;
      const totalStops = (stops1.length - 1) + (stopsMid.length - 1) + (stops2.length - 1);
      const score = totalDist + 18.0 + (totalStops * 0.08);

      twoTransfersRoutes.push({
        stages: 3,
        transfers: 2,
        score,
        totalDistance: totalDist,
        totalStops,
        estimatedMinutes: Math.round((totalDist / 20) * 60 + totalStops * 0.5 + 24),
        segments: [
          {
            stageIndex: 1,
            type: 'bus',
            routeId: r1.id,
            routeName: r1.name,
            color: r1.color,
            boardStopId: s1.startCand.id,
            alightStopId: cand.t1,
            stopCount: stops1.length - 1,
            stops: stops1,
            distance: dist1
          },
          {
            stageIndex: 2,
            type: 'bus',
            routeId: rMid.id,
            routeName: rMid.name,
            color: rMid.color,
            boardStopId: cand.t1,
            alightStopId: cand.t2,
            stopCount: stopsMid.length - 1,
            stops: stopsMid,
            distance: distMid
          },
          {
            stageIndex: 3,
            type: 'bus',
            routeId: r2.id,
            routeName: r2.name,
            color: r2.color,
            boardStopId: cand.t2,
            alightStopId: s2.targetCand.id,
            stopCount: stops2.length - 1,
            stops: stops2,
            distance: dist2
          }
        ]
      });

      if (twoTransfersRoutes.length >= 20) break;
    }

    directRoutes.sort((a, b) => a.score - b.score);
    oneTransferRoutes.sort((a, b) => a.score - b.score);
    twoTransfersRoutes.sort((a, b) => a.score - b.score);

    const all = [...directRoutes, ...oneTransferRoutes, ...twoTransfersRoutes];
    all.sort((a, b) => a.score - b.score);

    return {
      direct: directRoutes,
      oneTransfer: oneTransferRoutes,
      twoTransfers: twoTransfersRoutes,
      all
    };
  }
}

const router = new TransitRouter(stops, routes, stopToRouteIndices, nearbyStops);

console.log('\n--- TEST 1: Hledan (288) to Sule (141) ---');
console.time('Search 1');
const res1 = router.search(288, 141);
console.timeEnd('Search 1');
console.log(`Found: Direct=${res1.direct.length}, 1-Transfer=${res1.oneTransfer.length}, 2-Transfers=${res1.twoTransfers.length}, Total=${res1.all.length}`);
console.log('Top route: [Stages: ' + res1.all[0].stages + ', Score: ' + res1.all[0].score.toFixed(2) + ', Dist: ' + res1.all[0].totalDistance.toFixed(2) + 'km]');

console.log('\n--- TEST 2: Nat Sin South Dagon (1) to Hlaing Tharyar TU (24) ---');
console.time('Search 2');
const res2 = router.search(1, 24);
console.timeEnd('Search 2');
console.log(`Found: Direct=${res2.direct.length}, 1-Transfer=${res2.oneTransfer.length}, 2-Transfers=${res2.twoTransfers.length}, Total=${res2.all.length}`);
if (res2.all.length > 0) {
  const b = res2.all[0];
  console.log(`Top route: [Stages: ${b.stages}, Transfers: ${b.transfers}, Dist: ${b.totalDistance.toFixed(2)}km, Time: ~${b.estimatedMinutes} mins]`);
  b.segments.forEach(s => {
    console.log(`   - Leg ${s.stageIndex}: [${s.routeId}] ${s.routeName} (${stops[s.boardStopId].name_mm} -> ${stops[s.alightStopId].name_mm})`);
  });
}
