require('dotenv').config();
const key = process.env.CLAUDE_API_KEY;
console.log('Key length:', key ? key.length : 0);
console.log('Key starts with:', key ? key.substring(0, 10) : 'N/A');
console.log('Key ends with:', key ? key.substring(key.length - 10) : 'N/A');
console.log('Has spaces:', key ? key.includes(' ') : 'N/A');
