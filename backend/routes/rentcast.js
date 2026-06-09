/**
 * /api/rentcast  —  Rentcast Rent Estimate proxy
 *
 * GET /api/rentcast?address=123+Main+St+St+Louis+MO+63101&bedrooms=3&bathrooms=2&propertyType=Single+Family
 *
 * Calls the Rentcast AVM rent estimate endpoint server-side so the API key
 * is never exposed to the browser.
 *
 * Docs: https://developers.rentcast.io/reference/rent-estimate-long-term
 */

const express = require('express');
const router  = express.Router();

const RENTCAST_BASE = 'https://api.rentcast.io/v1';
const CACHE_TTL_MS  = 24 * 60 * 60 * 1000; // cache 24 h — rent estimates don't change daily
const cache         = new Map();

function rentcastHeaders() {
  const key = process.env.RENTCAST_API_KEY;
  if (!key || key === 'your_rentcast_key_here') {
    throw new Error('RENTCAST_API_KEY is not configured. Contact the site administrator.');
  }
  return { 'X-Api-Key': key, 'Accept': 'application/json' };
}

// ── GET /api/rentcast ─────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const { address, bedrooms, bathrooms, propertyType } = req.query;

  if (!address || address.trim().length < 5) {
    return res.status(400).json({ error: 'A full property address is required (e.g. 123 Main St, St. Louis, MO 63101).' });
  }

  const cacheKey = `${address}|${bedrooms || ''}|${bathrooms || ''}|${propertyType || ''}`.toLowerCase();
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return res.json(cached.data);
  }

  try {
    const headers = rentcastHeaders();

    // Build query string
    const params = new URLSearchParams({ address: address.trim() });
    if (bedrooms)     params.set('bedrooms',     bedrooms);
    if (bathrooms)    params.set('bathrooms',     bathrooms);
    if (propertyType) params.set('propertyType',  propertyType);

    const url = `${RENTCAST_BASE}/avm/rent/long-term?${params}`;
    const resp = await fetch(url, { headers });

    if (resp.status === 401) {
      return res.status(502).json({ error: 'Rentcast API key is invalid or expired. Contact the site administrator.' });
    }
    if (resp.status === 404) {
      return res.status(404).json({ error: 'No rent estimate found for this address. Try a nearby address or check the spelling.' });
    }
    if (resp.status === 429) {
      return res.status(429).json({ error: 'Rentcast API limit reached for this month. Try again next month or upgrade the plan.' });
    }
    if (!resp.ok) {
      return res.status(502).json({ error: `Rentcast API error: ${resp.status} ${resp.statusText}` });
    }

    const data = await resp.json();

    // Normalise field names — Rentcast may return 'rent' or 'rentEstimate'
    const estimate  = data.rent        ?? data.rentEstimate        ?? data.price        ?? null;
    const rangeLow  = data.rentRangeLow  ?? data.rentEstimateLow  ?? data.priceLow     ?? null;
    const rangeHigh = data.rentRangeHigh ?? data.rentEstimateHigh ?? data.priceHigh    ?? null;

    if (estimate === null) {
      return res.status(502).json({ error: 'Rentcast returned data but no rent estimate was found. The property may not have enough rental comps.' });
    }

    // Pull a few comparable listings for context
    // Rentcast returns comparables in data.comparables; each comp's rent is data.price
    const listings = (data.comparables || data.listings || []).slice(0, 5).map(l => ({
      address:   l.formattedAddress || l.address || '',
      rent:      l.price            || l.rent    || 0,
      bedrooms:  l.bedrooms         || 0,
      bathrooms: l.bathrooms        || 0,
      distance:  l.distance         || null,
      daysOnMarket: l.daysOnMarket  || null,
      correlation:  l.correlation   || null,
    }));

    const payload = {
      address:      address.trim(),
      bedrooms:     bedrooms ? parseInt(bedrooms) : null,
      propertyType: data.propertyType || propertyType || null,
      estimate:     Math.round(estimate),
      rangeLow:     rangeLow  ? Math.round(rangeLow)  : Math.round(estimate * 0.90),
      rangeHigh:    rangeHigh ? Math.round(rangeHigh) : Math.round(estimate * 1.10),
      listings,
      dataSource: 'Rentcast AVM',
    };

    cache.set(cacheKey, { ts: Date.now(), data: payload });
    res.json(payload);

  } catch (err) {
    console.error('[rentcast proxy]', err.message);
    if (err.message.includes('RENTCAST_API_KEY')) {
      return res.status(503).json({ error: err.message });
    }
    res.status(500).json({ error: 'Failed to fetch rent estimate. Please try again.' });
  }
});

module.exports = router;
