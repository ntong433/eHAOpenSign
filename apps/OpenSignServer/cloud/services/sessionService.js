// Removed node-fetch to use native fetch for IPv4/IPv6 Happy Eyeballs support

export async function createSessionForUser(user) {
  const serverUrl = process.env.SERVER_URL || "http://localhost:8085/app";
  const APPID = process.env.APP_ID || "opensign";
  const masterKEY = process.env.MASTER_KEY;
  
  const url = `${serverUrl}/loginAs`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json;charset=utf-8',
      'X-Parse-Application-Id': APPID,
      'X-Parse-Master-Key': masterKEY,
    },
    body: JSON.stringify({ userId: user.id }),
  });

  if (!response.ok) {
    throw new Error('Could not generate session token.');
  }

  const result = await response.json();
  return result;
}
