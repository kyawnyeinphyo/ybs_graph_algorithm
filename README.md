# Yangon Bus Service – YBS Data
YBS Data is improved update-to-date version of officially released version.

Data are gathered around Facebook/Groups/Pages that are related to YBS. Data validity is by best effort.

### ./data
- **./routes/** are json files that contain bus line information by ID, name, bus route as line shape and bus stop IDs in sequence.
	-  Bus stop IDs are equals to ID in `stops.tsv`
	- `shape.geometry` is in geojson LineString format.
	- separated into respective json file for easier git versioning
- **stops.tsv** is in tsv format contains stop ID along with name, road, township.

### ./tools
- python scripts for importing/exporting to/from mongo

## Thanks
- Soe Moe - for helping with data updates

---

## 🚌 YBS Route Planner (A* Algorithm & Web UI)

A* Search Algorithm ကို အသုံးပြုထားသော ရန်ကုန်ဘတ်စ်ကား (YBS) လမ်းကြောင်းရှာဖွေရေး Web Application ဖြစ်ပါသည်။

### ✨ Features
- **Graph Modeling**: YBS မှတ်တိုင်ပေါင်း ၂,၀၉၃ ခုကို Nodes အဖြစ် သတ်မှတ်ပြီး ဘတ်စ်ကားလိုင်း ၁၂၅ လိုင်းကို Directed Edges များအဖြစ် ချိတ်ဆက်ထားသည်။
- **A* Algorithm**: Earth Geodesic (Haversine Formula) ဖြင့် တွက်ချက်ထားသော Admissible Heuristic $h(n)$ ကို အသုံးပြုထားသည်။
- **Multi-Stage Routing**:
  - **၁ ဆင့် (တိုက်ရိုက်)**: ကားတစ်စီးတည်းဖြင့် တိုက်ရိုက်ရောက်ရှိနိုင်သော လမ်းကြောင်းများ
  - **၂ ဆင့် (၁ ကြိမ်ပြောင်း)**: အလယ်မှတ်တိုင်တစ်ခုတွင် ကားပြောင်းစီးရသော လမ်းကြောင်းများ (လမ်းတစ်ဖက်တစ်ချက် မျက်နှာချင်းဆိုင်မှတ်တိုင်သို့ လမ်းကူးပြောင်းစီးမှု အပါအဝင်)
  - **၃ ဆင့် (၂ ကြိမ်ပြောင်း)**: မြို့နယ်အစွန်အဖျားများအကြား ချိတ်ဆက်ပေးသော လမ်းကြောင်းများ
- **Best Route Ranking**: Transfers အနည်းဆုံးနှင့် ခရီးအကွာအဝေး အတိုဆုံး လမ်းကြောင်းကို အပေါ်ဆုံးတွင် ထိပ်တန်းရလဒ်အဖြစ် ဖော်ပြပေးပါသည်။
- **Interactive UI & Map**:
  - စာရိုက်ရှာဖွေနိုင်သော Autocomplete (မြန်မာ/အင်္ဂလိပ်/မြို့နယ်/လမ်းအမည်)
  - Leaflet Interactive Map ဖြင့် ဘတ်စ်ကားလမ်းကြောင်း အရောင်များ၊ မှတ်တိုင်များ ပေါ်လွင်စွာ ဖော်ပြခြင်း
  - မှတ်တိုင်အဆင့်ဆင့် အသေးစိတ် ကြည့်ရှုနိုင်သော Accordion Dropdown
  - အင်တာနက်မရှိဘဲ Offline လည်း အသုံးပြုနိုင်ခြင်း

### 🚀 အသုံးပြုပုံ (How to Run)
1. **နည်းလမ်း ၁ (တိုက်ရိုက်ဖွင့်ခြင်း - No Installation Needed)**:
   - `web/index.html` ဖိုင်ကို မည်သည့် Web Browser ဖြင့်မဆို Double Click နှိပ်၍ တိုက်ရိုက်ဖွင့်လှစ် အသုံးပြုနိုင်ပါသည်။
2. **နည်းလမ်း ၂ (Local Server ဖြင့် ဖွင့်ခြင်း)**:
   ```bash
   node server.js
   ```
   ထို့နောက် Browser တွင် `http://localhost:3000` သို့ ဝင်ရောက်အသုံးပြုနိုင်ပါသည်။
