#!/usr/bin/env node

/**
 * Test script to probe potential Rakuten Pay API endpoints
 */

const fetch = require('node-fetch');

const ENDPOINTS_TO_TEST = [
  // Direct pay.rakuten.co.jp
  'https://pay.rakuten.co.jp/api/v3/stores',
  'https://pay.rakuten.co.jp/api/v2/stores',
  'https://pay.rakuten.co.jp/mmeu/api/v3/stores',

  // Map subdomain
  'https://map.rakuten.co.jp/api/v3/stores',
  'https://map.rakuten.co.jp/mmeu/api/v3/stores',

  // API gateway
  'https://api.rakuten.co.jp/mmeu/v3/stores',
  'https://api.rakuten.co.jp/rpay/v3/stores',

  // Shop subdomain
  'https://shop.rakuten.co.jp/api/v3/stores',

  // Mobile/app endpoints
  'https://app.rakuten.co.jp/mmeu/api/v3/stores',
  'https://mobile.rakuten.co.jp/api/v3/stores',
];

const TEST_PARAMS = {
  client_id: 'integrated',
  longitude: 139.7671,
  latitude: 35.6812,
};

async function testEndpoint(baseUrl) {
  const params = new URLSearchParams(TEST_PARAMS);
  const url = `${baseUrl}?${params}`;

  console.log(`\nTesting: ${url}`);
  console.log('─'.repeat(80));

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
        'Referer': 'https://pay.rakuten.co.jp/shop/map/',
      },
      timeout: 5000,
    });

    console.log(`✓ Status: ${response.status} ${response.statusText}`);
    console.log(`✓ Content-Type: ${response.headers.get('content-type')}`);

    if (response.ok) {
      const text = await response.text();
      console.log(`✓ Response length: ${text.length} bytes`);

      try {
        const json = JSON.parse(text);
        console.log(`✓ Valid JSON response`);
        console.log(`✓ Keys: ${Object.keys(json).join(', ')}`);

        if (json.stores && Array.isArray(json.stores)) {
          console.log(`✅ FOUND VALID ENDPOINT!`);
          console.log(`✅ Store count: ${json.stores.length}`);
          if (json.stores[0]) {
            console.log(`✅ Sample store keys: ${Object.keys(json.stores[0]).join(', ')}`);
          }
        }
      } catch (e) {
        console.log(`✗ Not JSON: ${text.substring(0, 100)}...`);
      }
    } else {
      console.log(`✗ Error response`);
    }

  } catch (error) {
    if (error.code === 'ENOTFOUND') {
      console.log(`✗ DNS lookup failed (domain doesn't exist)`);
    } else if (error.code === 'ECONNREFUSED') {
      console.log(`✗ Connection refused`);
    } else if (error.code === 'ETIMEDOUT') {
      console.log(`✗ Timeout`);
    } else {
      console.log(`✗ Error: ${error.message}`);
    }
  }
}

async function main() {
  console.log('🔍 Rakuten Pay API Endpoint Probe');
  console.log('='.repeat(80));
  console.log(`Testing ${ENDPOINTS_TO_TEST.length} potential endpoints...`);
  console.log(`Location: ${TEST_PARAMS.latitude}, ${TEST_PARAMS.longitude} (Tokyo)`);
  console.log('='.repeat(80));

  for (const endpoint of ENDPOINTS_TO_TEST) {
    await testEndpoint(endpoint);
    await new Promise(resolve => setTimeout(resolve, 1000)); // Rate limit
  }

  console.log('\n' + '='.repeat(80));
  console.log('✓ Probe complete');
  console.log('\nNote: If no endpoints work, you may need:');
  console.log('  - Valid authentication/API keys');
  console.log('  - Session cookies from logged-in browser');
  console.log('  - CORS proxy for browser-only APIs');
  console.log('  - VPN/Japan IP address');
}

main().catch(console.error);
