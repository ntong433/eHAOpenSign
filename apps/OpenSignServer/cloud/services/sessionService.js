import axios from 'axios';

export async function createSessionForUser(user) {
  const localAppUrl = `http://127.0.0.1:${process.env.PORT || 8085}${process.env.PARSE_MOUNT || '/app'}`;
  const APPID = process.env.APP_ID || "opensign";
  const masterKEY = process.env.MASTER_KEY;
  
  const url = `${localAppUrl}/loginAs`;
  
  try {
    const response = await axios.post(url, { userId: user.id }, {
      headers: {
        'Content-Type': 'application/json;charset=utf-8',
        'X-Parse-Application-Id': APPID,
        'X-Parse-Master-Key': masterKEY,
      }
    });
    return response.data;
  } catch (error) {
    console.error('Failed to generate session token via loginAs:', error.response?.data || error.message);
    throw new Error('Could not generate session token.');
  }
}
