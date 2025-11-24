#!/usr/bin/env node

/**
 * Test script for KML generator with mock data
 */

const fs = require('fs').promises;
const { generateKML, orderStoresNearestNeighbor, loadPostalData } = require('./kml-generator.js');

// Mock store data for testing
const mockStores = [
  {
    map_store_id: 'store_001',
    store_name: 'テストストア 丸の内店',
    latitude: 35.6812,
    longitude: 139.7671,
    postal_code: '100-0001'
  },
  {
    map_store_id: 'store_002',
    store_name: 'テストストア 大手町店',
    latitude: 35.6862,
    longitude: 139.7649,
    postal_code: '100-0001'
  },
  {
    map_store_id: 'store_003',
    store_name: 'テストストア 日比谷店',
    latitude: 35.6742,
    longitude: 139.7594,
    postal_code: '100-0001'
  },
  {
    map_store_id: 'store_004',
    store_name: 'テストストア 有楽町店',
    latitude: 35.6751,
    longitude: 139.7633,
    postal_code: '100-0001'
  },
  {
    map_store_id: 'store_005',
    store_name: 'テストストア 東京駅店',
    latitude: 35.6809,
    longitude: 139.7673,
    postal_code: '100-0001'
  }
];

async function runTest() {
  console.log('🧪 Testing KML Generator with Mock Data\n');
  console.log('=====================================\n');

  // Test 1: Load postal data
  console.log('Test 1: Loading postal data...');
  const postalData = await loadPostalData();
  const postalInfo = postalData['1000001'];

  if (postalInfo && postalInfo.length > 0) {
    console.log('✅ Postal data loaded successfully');
    console.log(`   Postal Code: 100-0001`);
    console.log(`   Address: ${postalInfo[0].prefecture} ${postalInfo[0].city} ${postalInfo[0].address}`);
    console.log(`   Romaji: ${postalInfo[0].prefecture_rome} ${postalInfo[0].city_rome} ${postalInfo[0].address_rome}\n`);
  } else {
    console.log('❌ Postal data not found\n');
  }

  // Test 2: Order stores
  console.log('Test 2: Ordering stores with nearest neighbor...');
  const orderedStores = orderStoresNearestNeighbor(mockStores);
  console.log('✅ Stores ordered successfully');
  console.log(`   Total stores: ${orderedStores.length}`);
  orderedStores.forEach((store, idx) => {
    console.log(`   ${idx + 1}. ${store.store_name} (${store.latitude}, ${store.longitude})`);
  });
  console.log();

  // Test 3: Generate KML
  console.log('Test 3: Generating KML file...');
  const kml = generateKML(orderedStores, '100-0001', postalInfo);
  const outputPath = 'test_mock_route.kml';
  await fs.writeFile(outputPath, kml, 'utf8');
  console.log('✅ KML file generated successfully');
  console.log(`   File: ${outputPath}`);
  console.log(`   Size: ${kml.length} bytes`);
  console.log(`   Stores in route: ${orderedStores.length}\n`);

  // Test 4: Verify KML structure
  console.log('Test 4: Verifying KML structure...');
  const hasXmlDeclaration = kml.startsWith('<?xml version="1.0"');
  const hasKmlTag = kml.includes('<kml xmlns="http://www.opengis.net/kml/2.2">');
  const hasPlacemarks = kml.includes('<Placemark>');
  const hasRoute = kml.includes('<LineString>');
  const hasStyles = kml.includes('<Style id="startPoint">');

  console.log(`   XML declaration: ${hasXmlDeclaration ? '✅' : '❌'}`);
  console.log(`   KML namespace: ${hasKmlTag ? '✅' : '❌'}`);
  console.log(`   Placemarks: ${hasPlacemarks ? '✅' : '❌'}`);
  console.log(`   Route line: ${hasRoute ? '✅' : '❌'}`);
  console.log(`   Styles: ${hasStyles ? '✅' : '❌'}\n`);

  // Test 5: Display KML preview
  console.log('Test 5: KML content preview...');
  const lines = kml.split('\n');
  console.log('   First 20 lines:');
  lines.slice(0, 20).forEach(line => {
    console.log(`   ${line}`);
  });
  console.log(`   ... (${lines.length - 20} more lines)\n`);

  console.log('=====================================');
  console.log('🎉 All tests completed successfully!\n');
  console.log('💡 You can now import test_mock_route.kml into Google Maps.\n');
}

// Run the test
runTest().catch(error => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});
