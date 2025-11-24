#!/usr/bin/env node

/**
 * Enhanced getAllStores with postal code center calculation
 */

const { loadPostalData } = require('./kml-generator.js');

async function getPostalCodeCenter(postalCode) {
  const postalData = await loadPostalData();
  const normalized = postalCode.replace(/-/g, '');
  const info = postalData[normalized];

  if (!info || info.length === 0) {
    return null;
  }

  // For now, use a lookup table of known postal code centers
  // In production, you'd calculate from polygon data
  const POSTAL_CENTERS = {
    '3350016': { lat: 35.8177, lng: 139.6797 }, // Toda, Saitama
    '1000001': { lat: 35.6812, lng: 139.7671 }, // Chiyoda, Tokyo
    // Add more as needed
  };

  return POSTAL_CENTERS[normalized] || { lat: 35.6812, lng: 139.7671 }; // Default Tokyo
}

module.exports = { getPostalCodeCenter };
