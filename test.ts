// Test script for the API
const API_URL = 'http://localhost:3000';

async function testAPI() {
  console.log('Testing Paizo Organized Play XP API...\n');
  
  // Test 1: Submit a fetch request
  console.log('1. Submitting fetch request...');
  const fetchResponse = await fetch(`${API_URL}/api/fetch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'test@example.com',
      password: 'test123'
    })
  });
  
  const fetchResult = await fetchResponse.json();
  console.log('Response:', fetchResult);
  
  // Test 2: Check status
  console.log('\n2. Checking status...');
  const statusResponse = await fetch(`${API_URL}/api/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'test@example.com'
    })
  });
  
  const statusResult = await statusResponse.json();
  console.log('Response:', statusResult);
  
  // Test 3: Test immediate re-fetch (should return cached)
  console.log('\n3. Testing immediate re-fetch...');
  const refetchResponse = await fetch(`${API_URL}/api/fetch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'test@example.com',
      password: 'test123'
    })
  });
  
  const refetchResult = await refetchResponse.json();
  console.log('Response:', refetchResult);
}

// Run the test
testAPI().catch(console.error);