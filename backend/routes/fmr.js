/**
 * /api/fmr  —  HUD Fair Market Rent proxy
 *
 * GET /api/fmr?zip=63101
 *
 * Flow:
 *   1. ZIP → CBSA geoid        (HUD USPS crosswalk, type=3)
 *   2. Find all HUD Metro areas sharing that CBSA code (cached metro list)
 *   3. Search each area's basicdata for the ZIP-specific SAFMR
 *      Falls back to MSA-level if ZIP not found in any sub-area
 *
 * Handles simple metros (1 area per CBSA) and large split metros
 * (NYC, LA, Chicago, etc. which have multiple HUD sub-areas per CBSA).
 *
 * Token lives in process.env.HUD_API_TOKEN — never sent to the browser.
 */

const express = require('express');
const router  = express.Router();

const HUD_BASE        = 'https://www.huduser.gov/hudapi/public';
const CACHE_TTL_MS    = 24 * 60 * 60 * 1000;   // ZIP results cached 24 h
const METRO_TTL_MS    = 7  * 24 * 60 * 60 * 1000; // metro list cached 7 days
const zipCache        = new Map();
let   metroListCache  = null;
let   metroListTs     = 0;

function hudHeaders() {
  const token = process.env.HUD_API_TOKEN;
  if (!token || token === 'your_hud_token_here') {
    throw new Error('HUD_API_TOKEN is not configured. Contact the site administrator.');
  }
  return { Authorization: `Bearer ${token}` };
}

async function getMetroList(headers) {
  if (metroListCache && Date.now() - metroListTs < METRO_TTL_MS) {
    return metroListCache;
  }
  const res  = await fetch(`${HUD_BASE}/fmr/listMetroAreas`, { headers });
  const data = await res.json();
  metroListCache = Array.isArray(data) ? data : [];
  metroListTs    = Date.now();
  return metroListCache;
}

// ── GET /api/fmr?zip=XXXXX ────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const zip = (req.query.zip || '').trim();

  if (!/^\d{5}$/.test(zip)) {
    return res.status(400).json({ error: 'A valid 5-digit ZIP code is required.' });
  }

  // Serve from cache
  const cached = zipCache.get(zip);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return res.json(cached.data);
  }

  try {
    const headers = hudHeaders();

    // ── Step 1: ZIP → CBSA geoid (type=3) ────────────────────────────────────
    const xwRes = await fetch(`${HUD_BASE}/usps?type=3&query=${zip}`, { headers });

    if (xwRes.status === 401) {
      return res.status(502).json({ error: 'HUD API token is invalid or expired. Contact the site administrator.' });
    }
    if (!xwRes.ok) {
      return res.status(502).json({ error: `HUD crosswalk API error: ${xwRes.status}` });
    }

    const xwData  = await xwRes.json();
    const results = xwData?.data?.results || [];

    if (!results.length) {
      return res.status(404).json({ error: `ZIP code ${zip} was not found in the HUD database.` });
    }

    const best     = results.reduce((a, b) => parseFloat(a.res_ratio) >= parseFloat(b.res_ratio) ? a : b);
    const cbsaCode = best.geoid;  // e.g. "41180" or "35620"

    // ── Step 2: Find all HUD Metro FMR Areas for this CBSA ───────────────────
    const metroList = await getMetroList(headers);

    // Collect all entity IDs that belong to this CBSA
    // Simple metro: one entry like "METRO41180M41180"
    // Split metro:  multiple entries like "METRO35620MM5600", "METRO35620MM0875", etc.
    const matchingAreas = metroList.filter(m => m.cbsa_code && m.cbsa_code.includes(cbsaCode));

    // Also try the simple single-area format as a candidate
    const simpleId = `METRO${cbsaCode}M${cbsaCode}`;
    const entityIds = [
      simpleId,
      ...matchingAreas.map(m => m.cbsa_code).filter(c => c !== simpleId),
    ];

    // ── Step 3: Search each area for the ZIP ─────────────────────────────────
    let bestMatch   = null;  // { bd, areaName, year, entityId, dataLevel }

    for (const entityId of entityIds) {
      const fmrRes = await fetch(`${HUD_BASE}/fmr/data/${entityId}`, { headers });
      if (!fmrRes.ok) continue;

      const fmrJson  = await fmrRes.json();
      const basicdata = fmrJson?.data?.basicdata;
      if (!Array.isArray(basicdata) || basicdata.length === 0) continue;

      const zipRow = basicdata.find(r => r.zip_code === zip);
      if (zipRow) {
        // Exact ZIP match — best possible result
        bestMatch = {
          bd:        zipRow,
          areaName:  fmrJson?.data?.area_name || fmrJson?.data?.metro_name || entityId,
          year:      fmrJson?.data?.year,
          entityId,
          dataLevel: 'ZIP-specific SAFMR',
        };
        break;  // no need to check more areas
      }

      // Keep MSA-level as fallback from first area that has data
      if (!bestMatch) {
        const msaRow = basicdata.find(r => r.zip_code === 'MSA level') || basicdata[0];
        if (msaRow) {
          bestMatch = {
            bd:        msaRow,
            areaName:  fmrJson?.data?.area_name || fmrJson?.data?.metro_name || entityId,
            year:      fmrJson?.data?.year,
            entityId,
            dataLevel: 'MSA-level FMR',
          };
        }
      }
    }

    if (!bestMatch) {
      return res.status(404).json({ error: `No FMR data found for ZIP ${zip}. Try a nearby ZIP.` });
    }

    const bd = bestMatch.bd;
    const payload = {
      zip,
      cbsaCode,
      entityId:  bestMatch.entityId,
      areaName:  bestMatch.areaName,
      year:      bestMatch.year || new Date().getFullYear(),
      dataLevel: bestMatch.dataLevel,
      fmr: {
        studio: Math.round(bd['Efficiency']    || 0),
        br1:    Math.round(bd['One-Bedroom']   || 0),
        br2:    Math.round(bd['Two-Bedroom']   || 0),
        br3:    Math.round(bd['Three-Bedroom'] || 0),
        br4:    Math.round(bd['Four-Bedroom']  || 0),
      },
    };

    zipCache.set(zip, { ts: Date.now(), data: payload });
    res.json(payload);

  } catch (err) {
    console.error('[fmr proxy]', err.message);
    if (err.message.includes('HUD_API_TOKEN')) {
      return res.status(503).json({ error: err.message });
    }
    res.status(500).json({ error: 'Failed to fetch FMR data. Please try again.' });
  }
});

module.exports = router;
