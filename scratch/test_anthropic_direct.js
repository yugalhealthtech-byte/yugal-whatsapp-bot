require('dotenv').config();
const axios = require('axios');

async function testClaude() {
  try {
    const response = await axios.post('https://api.anthropic.com/v1/messages', {
      model: 'claude-3-5-sonnet-20240620',
      max_tokens: 10,
      messages: [{ role: 'user', content: 'Hi' }]
    }, {
      headers: {
        'x-api-key': process.env.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      }
    });
    console.log('Success:', response.data);
  } catch (err) {
    console.error('Error:', err.response ? err.response.status : err.message);
    console.error('Data:', err.response ? JSON.stringify(err.response.data) : 'N/A');
  }
}

testClaude();
