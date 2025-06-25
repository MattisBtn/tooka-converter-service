const axios = require('axios');

// Configuration
const API_URL = 'http://localhost:3000';

async function testAPI() {
  try {
    console.log('🧪 Testing Conversion API...\n');

    // Test 1: Health check
    console.log('1. Testing health endpoint...');
    const healthResponse = await axios.get(`${API_URL}/health`);
    console.log('✅ Health check:', healthResponse.data);

    // Test 2: Conversion avec des IDs d'exemple
    console.log('\n2. Testing conversion endpoint...');
    
    // Remplace ces IDs par des vrais IDs de ta base
    const testImageIds = [
      '1cdddc68-d97b-4760-8e7d-aba72c9b5082', // Remplace par un vrai UUID
      '334aa904-28bd-4d13-8cd9-94b517045d94'  // Remplace par un vrai UUID
    ];

    const conversionResponse = await axios.post(`${API_URL}/convert`, {
      imageIds: testImageIds
    });

    console.log('✅ Conversion response:', JSON.stringify(conversionResponse.data, null, 2));

    // Test 3: Vérification du statut
    if (testImageIds.length > 0) {
      console.log('\n3. Testing status endpoint...');
      const statusResponse = await axios.get(`${API_URL}/status/${testImageIds[0]}`);
      console.log('✅ Status check:', statusResponse.data);
    }

  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
  }
}

// Test avec gestion d'erreurs
async function testErrorHandling() {
  try {
    console.log('\n🧪 Testing error handling...\n');

    // Test avec des IDs invalides
    console.log('1. Testing with invalid IDs...');
    const errorResponse = await axios.post(`${API_URL}/convert`, {
      imageIds: ['invalid-id']
    });
    console.log('Response:', errorResponse.data);

  } catch (error) {
    if (error.response?.status === 404) {
      console.log('✅ Error handling works correctly - 404 for invalid IDs');
    } else {
      console.error('❌ Unexpected error:', error.response?.data || error.message);
    }
  }
}

// Exécution des tests
async function runTests() {
  await testAPI();
  await testErrorHandling();
  console.log('\n🎉 Tests completed!');
}

runTests();