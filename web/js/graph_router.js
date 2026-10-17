/**
 * YBS Transit Graph Router using A* Algorithm
 * Yangon Bus Service (YBS) လမ်းကြောင်းရှာဖွေရေး အယ်ဂိုရီသမ်
 * 
 * - Bus Stop များကို Nodes အနေဖြင့် သတ်မှတ်သည်
 * - Bus Routes များကို Directed Edges အနေဖြင့် ဆက်သွယ်သည်
 * - A* Heuristic: Haversine Geodesic Distance h(n) <= h*(n) (Admissible)
 * - Multi-Stage Pathfinding:
 *     - ၁ ဆင့်: တိုက်ရိုက်ခရီးစဥ် (Direct Bus - 0 Transfers)
 *     - ၂ ဆင့်: ၁ ကြိမ်ပြောင်းစီးခရီးစဥ် (1 Transfer - 2 Stages)
 *     - ၃ ဆင့်: ၂ ကြိမ်ပြောင်းစီးခရီးစဥ် (2 Transfers - 3 Stages)
 * - Ranking: အကောင်းဆုံးလမ်းကြောင်းကို ရမှတ် (Score) အနည်းဆုံးဖြင့် အပေါ်ဆုံးတွင် ပြသသည်
 */

class YBSTransitRouter {
  constructor(stopsData, routesData) {
    this.stops = {};
    this.routes = [];
    this.stopToRouteIndices = {};
    this.nearbyStops = {}; // Opposite/paired stops within walking distance (90m)

    this.initStops(stopsData);
    this.initNearbyStops();
    this.initRoutes(routesData);
  }

  /**
   * Earth surface distance using Haversine formula (km)
   */
  static haversine(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth radius in km
    const p1 = (lat1 * Math.PI) / 180;
    const p2 = (lat2 * Math.PI) / 180;
    const dp = ((lat2 - lat1) * Math.PI) / 180;
    const dl = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dp / 2) * Math.sin(dp / 2) +
      Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  initStops(stopsData) {
    for (const s of stopsData) {
      this.stops[s.id] = {
        id: s.id,
        lat: s.lat,
        lng: s.lng,
        name_en: s.name_en || '',
        name_mm: s.name_mm || '',
        road_en: s.road_en || '',
        road_mm: s.road_mm || '',
        township_en: s.township_en || '',
        township_mm: s.township_mm || ''
      };
    }
  }

  /**
   * လမ်းတစ်ဖက်တစ်ချက်ရှိ မျက်နှာချင်းဆိုင်မှတ်တိုင်များ (သို့) ၉၀ မီတာအတွင်းရှိ မှတ်တိုင်များကို ချိတ်ဆက်ခြင်း
   */
  initNearbyStops() {
    const stopList = Object.values(this.stops);
    for (const s of stopList) {
      this.nearbyStops[s.id] = [];
      for (const o of stopList) {
        if (s.id !== o.id && Math.abs(s.lat - o.lat) < 0.0015 && Math.abs(s.lng - o.lng) < 0.0015) {
          const d = YBSTransitRouter.haversine(s.lat, s.lng, o.lat, o.lng) * 1000; // in meters
          if (d <= 90) {
            this.nearbyStops[s.id].push({ id: o.id, dist: Math.round(d) });
          }
        }
      }
    }
  }

  initRoutes(routesData) {
    this.routes = routesData.map((r, rIdx) => {
      const routeObj = {
        id: r.id,
        name: r.name,
        color: r.color || '#2563eb',
        stops: r.stops || [],
        coordinates: r.coordinates || []
      };

      // Map stop ID to this route and its sequence position
      routeObj.stops.forEach((sId, sIdx) => {
        if (!this.stopToRouteIndices[sId]) {
          this.stopToRouteIndices[sId] = [];
        }
        this.stopToRouteIndices[sId].push({ routeIndex: rIdx, stopIndex: sIdx });
      });

      return routeObj;
    });
  }

  calcSegmentDist(stopIdArray) {
    let d = 0;
    for (let i = 0; i < stopIdArray.length - 1; i++) {
      const s1 = this.stops[stopIdArray[i]];
      const s2 = this.stops[stopIdArray[i + 1]];
      if (s1 && s2) {
        d += YBSTransitRouter.haversine(s1.lat, s1.lng, s2.lat, s2.lng);
      }
    }
    return d;
  }

  /**
   * Search routes from startStopId to targetStopId using A* heuristic
   */
  search(startStopId, targetStopId) {
    const sStart = this.stops[startStopId];
    const sTarget = this.stops[targetStopId];

    if (!sStart || !sTarget) {
      return { direct: [], oneTransfer: [], twoTransfers: [], all: [] };
    }

    if (startStopId === targetStopId) {
      return { direct: [], oneTransfer: [], twoTransfers: [], all: [], sameStop: true };
    }

    // Departure candidates: selected stop + nearby paired opposite stops (within 90m)
    const startCandidates = [{ id: startStopId, walkDist: 0 }];
    (this.nearbyStops[startStopId] || []).forEach(n => {
      startCandidates.push({ id: n.id, walkDist: n.dist / 1000 });
    });

    // Arrival candidates: selected stop + nearby paired opposite stops (within 90m)
    const targetCandidates = [{ id: targetStopId, walkDist: 0 }];
    (this.nearbyStops[targetStopId] || []).forEach(n => {
      targetCandidates.push({ id: n.id, walkDist: n.dist / 1000 });
    });

    const targetSet = new Set(targetCandidates.map(t => t.id));
    const targetDistMap = new Map(targetCandidates.map(t => [t.id, t.walkDist]));

    const directRoutes = [];
    const directSeen = new Set();

    // -------------------------------------------------------------
    // STAGE 1: DIRECT ROUTES (၁ ဆင့် - တိုက်ရိုက်ခရီးစဥ်)
    // -------------------------------------------------------------
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
              const segStopIds = r.stops.slice(sr.stopIndex, j + 1);
              const rideDist = this.calcSegmentDist(segStopIds);
              const totalDist = rideDist + sc.walkDist + targetDistMap.get(destId);
              const stopCount = segStopIds.length - 1;

              // A* Cost Score: distance + stop dwell penalty (0 transfers = 0 transfer penalty)
              const score = totalDist + stopCount * 0.08;

              // Estimated time: ~20 km/h average speed in Yangon + 0.6 min dwell per stop + walking time
              const rideMinutes = (rideDist / 20) * 60 + stopCount * 0.6;
              const walkMinutes = ((sc.walkDist + targetDistMap.get(destId)) / 4.5) * 60;
              const estimatedMinutes = Math.max(5, Math.round(rideMinutes + walkMinutes));

              const segStops = segStopIds.map(id => this.stops[id]);

              directRoutes.push({
                stages: 1,
                transfers: 0,
                score,
                totalDistance: parseFloat(totalDist.toFixed(2)),
                totalStops: stopCount,
                estimatedMinutes,
                segments: [
                  {
                    stageIndex: 1,
                    type: 'bus',
                    routeId: r.id,
                    routeName: r.name,
                    color: r.color,
                    boardStop: this.stops[sc.id],
                    alightStop: this.stops[destId],
                    walkBeforeMeters: Math.round(sc.walkDist * 1000),
                    walkAfterMeters: Math.round(targetDistMap.get(destId) * 1000),
                    stopCount,
                    stops: segStops,
                    distance: parseFloat(rideDist.toFixed(2))
                  }
                ]
              });
            }
          }
        }
      }
    }

    // -------------------------------------------------------------
    // STAGE 2: 1 TRANSFER ROUTES (၂ ဆင့် - ၁ ကြိမ်ပြောင်းစီး)
    // -------------------------------------------------------------
    // Downstream reachable stops from departure candidates
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

    // Upstream reachable origins leading to target candidates
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

    // Check same-stop transfer and nearby opposite-side walk transfer (<= 90m)
    for (const [tStop, seg1List] of r1Downstream.entries()) {
      const transferStops = [{ id: tStop, walkDist: 0 }];
      (this.nearbyStops[tStop] || []).forEach(n => {
        transferStops.push({ id: n.id, walkDist: n.dist / 1000 });
      });

      for (const ts of transferStops) {
        if (r2Upstream.has(ts.id)) {
          const seg2List = r2Upstream.get(ts.id);
          for (const s1 of seg1List) {
            for (const s2 of seg2List) {
              if (s1.routeIndex === s2.routeIndex) continue; // Same route no transfer needed

              const r1 = this.routes[s1.routeIndex];
              const r2 = this.routes[s2.routeIndex];

              const key = `${r1.id}_${s1.startCand.id}->${tStop}|${r2.id}_${ts.id}->${s2.targetCand.id}`;
              if (oneTransferSeen.has(key)) continue;
              oneTransferSeen.add(key);

              const stops1 = r1.stops.slice(s1.fromIdx, s1.toIdx + 1);
              const stops2 = r2.stops.slice(s2.fromIdx, s2.toIdx + 1);
              const dist1 = this.calcSegmentDist(stops1);
              const dist2 = this.calcSegmentDist(stops2);
              const walkTotal = s1.startCand.walkDist + ts.walkDist + s2.targetCand.walkDist;
              const totalDist = dist1 + dist2 + walkTotal;
              const totalStops = stops1.length - 1 + (stops2.length - 1);

              // Transfer penalty: 10 km equivalent (~12-15 mins)
              // Walking penalty: 2x walk distance
              const score = totalDist + 10.0 + ts.walkDist * 2.0 + totalStops * 0.08;

              const rideMinutes = ((dist1 + dist2) / 20) * 60 + totalStops * 0.6;
              const walkMinutes = (walkTotal / 4.5) * 60;
              const transferWaitMinutes = 10;
              const estimatedMinutes = Math.max(10, Math.round(rideMinutes + walkMinutes + transferWaitMinutes));

              oneTransferRoutes.push({
                stages: 2,
                transfers: 1,
                score,
                totalDistance: parseFloat(totalDist.toFixed(2)),
                totalStops,
                estimatedMinutes,
                transferInfo: {
                  alightStop: this.stops[tStop],
                  boardNextStop: this.stops[ts.id],
                  walkMeters: Math.round(ts.walkDist * 1000)
                },
                segments: [
                  {
                    stageIndex: 1,
                    type: 'bus',
                    routeId: r1.id,
                    routeName: r1.name,
                    color: r1.color,
                    boardStop: this.stops[s1.startCand.id],
                    alightStop: this.stops[tStop],
                    walkBeforeMeters: Math.round(s1.startCand.walkDist * 1000),
                    stopCount: stops1.length - 1,
                    stops: stops1.map(id => this.stops[id]),
                    distance: parseFloat(dist1.toFixed(2))
                  },
                  {
                    stageIndex: 2,
                    type: 'bus',
                    routeId: r2.id,
                    routeName: r2.name,
                    color: r2.color,
                    boardStop: this.stops[ts.id],
                    alightStop: this.stops[s2.targetCand.id],
                    walkBeforeMeters: Math.round(ts.walkDist * 1000),
                    walkAfterMeters: Math.round(s2.targetCand.walkDist * 1000),
                    stopCount: stops2.length - 1,
                    stops: stops2.map(id => this.stops[id]),
                    distance: parseFloat(dist2.toFixed(2))
                  }
                ]
              });
            }
          }
        }
      }
    }

    // -------------------------------------------------------------
    // STAGE 3: 2 TRANSFERS ROUTES (၃ ဆင့် - ၂ ကြိမ်ပြောင်းစီး)
    // -------------------------------------------------------------
    const twoTransfersRoutes = [];
    const twoTransfersSeen = new Set();

    // Find candidate bridge routes R_mid connecting r1Downstream to r2Upstream
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

    // A* Heuristic optimization: prioritize transfer hubs that make forward progress
    rMidList.sort((a, b) => {
      const stopA1 = this.stops[a.t1], stopA2 = this.stops[a.t2];
      const stopB1 = this.stops[b.t1], stopB2 = this.stops[b.t2];
      const distA =
        YBSTransitRouter.haversine(sStart.lat, sStart.lng, stopA1.lat, stopA1.lng) +
        YBSTransitRouter.haversine(stopA2.lat, stopA2.lng, sTarget.lat, sTarget.lng);
      const distB =
        YBSTransitRouter.haversine(sStart.lat, sStart.lng, stopB1.lat, stopB1.lng) +
        YBSTransitRouter.haversine(stopB2.lat, stopB2.lng, sTarget.lat, sTarget.lng);
      return distA - distB;
    });

    for (const cand of rMidList.slice(0, 200)) {
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

      const dist1 = this.calcSegmentDist(stops1);
      const distMid = this.calcSegmentDist(stopsMid);
      const dist2 = this.calcSegmentDist(stops2);
      const totalDist = dist1 + distMid + dist2;
      const totalStops = stops1.length - 1 + (stopsMid.length - 1) + (stops2.length - 1);

      // Transfer penalty for 2 transfers: 20 km equivalent
      const score = totalDist + 20.0 + totalStops * 0.08;

      const rideMinutes = ((dist1 + distMid + dist2) / 20) * 60 + totalStops * 0.6;
      const transferWaitMinutes = 20; // 2 transfers
      const estimatedMinutes = Math.max(20, Math.round(rideMinutes + transferWaitMinutes));

      twoTransfersRoutes.push({
        stages: 3,
        transfers: 2,
        score,
        totalDistance: parseFloat(totalDist.toFixed(2)),
        totalStops,
        estimatedMinutes,
        segments: [
          {
            stageIndex: 1,
            type: 'bus',
            routeId: r1.id,
            routeName: r1.name,
            color: r1.color,
            boardStop: this.stops[s1.startCand.id],
            alightStop: this.stops[cand.t1],
            stopCount: stops1.length - 1,
            stops: stops1.map(id => this.stops[id]),
            distance: parseFloat(dist1.toFixed(2))
          },
          {
            stageIndex: 2,
            type: 'bus',
            routeId: rMid.id,
            routeName: rMid.name,
            color: rMid.color,
            boardStop: this.stops[cand.t1],
            alightStop: this.stops[cand.t2],
            stopCount: stopsMid.length - 1,
            stops: stopsMid.map(id => this.stops[id]),
            distance: parseFloat(distMid.toFixed(2))
          },
          {
            stageIndex: 3,
            type: 'bus',
            routeId: r2.id,
            routeName: r2.name,
            color: r2.color,
            boardStop: this.stops[cand.t2],
            alightStop: this.stops[s2.targetCand.id],
            stopCount: stops2.length - 1,
            stops: stops2.map(id => this.stops[id]),
            distance: parseFloat(dist2.toFixed(2))
          }
        ]
      });

      if (twoTransfersRoutes.length >= 30) break;
    }

    // Sort each stage by A* score
    directRoutes.sort((a, b) => a.score - b.score);
    oneTransferRoutes.sort((a, b) => a.score - b.score);
    twoTransfersRoutes.sort((a, b) => a.score - b.score);

    // Combine all routes, globally sorted by score (The best route is at the very top!)
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

// Export for both Browser and Node.js environment
if (typeof module !== 'undefined' && module.exports) {
  module.exports = YBSTransitRouter;
} else {
  window.YBSTransitRouter = YBSTransitRouter;
}
